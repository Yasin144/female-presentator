"""Local, checked letter-name synthesis for the SC3 voice server.

Generate a short sentence for pronunciation context, retain only the final
letter, and independently recognize that crop before returning or caching it.
"""
import hashlib
from array import array
import io
import json
import math
import os
from pathlib import Path
import re
import threading
import wave

VERSION = 'indian-letter-names-v2'
NAMES = dict(zip('ABCDEFGHIJKLMNOPQRSTUVWXYZ', (
    'A', 'bee', 'see', 'dee', 'E', 'eff', 'jee', 'aitch', 'eye', 'jay',
    'kay', 'ell', 'em', 'en', 'oh', 'pee', 'cue', 'are', 'ess', 'tee',
    'you', 'vee', 'double you', 'ex', 'why', 'zed')))
ALIASES = {letter: {letter.lower(), name.lower()} for letter, name in NAMES.items()}
# Whisper may spell the same letter name differently (for example ef/eff).
# Use explicit equivalents only; fuzzy matching can accept a different letter.
for letter, alternatives in {'B': ['be'], 'C': ['sea'], 'E': ['ee'], 'F': ['ef'], 'G': ['gee'],
        'I': ['i'], 'L': ['el'], 'Q': ['queue'], 'R': ['ar'],
        'P': ['pea'], 'T': ['tea'], 'W': ['double u'], 'X': ['eks']}.items():
    ALIASES[letter].update(alternatives)
# Zed must actually be recognized as zed, not an ambiguous Z or American zee.
ALIASES['Z'] = {'zed'}


def tokens(text):
    return re.findall(r'[a-z]+', str(text).lower())


def isolated_letter(text):
    match = re.fullmatch(r'\s*([A-Za-z])[.!?]?\s*', str(text or ''))
    return match[1].upper() if match else None


def letter_sequence(text):
    text = str(text or '').strip()
    if re.fullmatch(r'[A-Z](?:[\s,;]+[A-Z])+[.!?]?', text):
        return re.findall(r'[A-Z]', text)
    return None


def join_letters(letters, synthesize):
    result = io.BytesIO()
    with wave.open(result, 'wb') as joined:
        expected = None
        for index, letter in enumerate(letters):
            with wave.open(io.BytesIO(synthesize(letter)), 'rb') as clip:
                layout = (clip.getnchannels(), clip.getsampwidth(), clip.getframerate())
                if expected is None:
                    expected = layout
                    joined.setparams(clip.getparams())
                elif layout != expected:
                    raise LetterClarityError('Alphabet recordings have incompatible audio formats.')
                if index:
                    joined.writeframes(bytes(round(layout[2] * .7) * layout[0] * layout[1]))
                joined.writeframes(clip.readframes(clip.getnframes()))
    return result.getvalue()


class LetterClarityError(ValueError):
    pass


def pause_boundary(pcm, channels, rate, start, end):
    """Find a sustained quiet gap near a word boundary, not a single zero crossing."""
    samples = array('h', pcm)
    step = max(1, round(rate * .005))
    levels = []
    for frame in range(max(0, round(start * rate)), min(len(samples) // channels, round(end * rate)), step):
        values = samples[frame * channels:(frame + step) * channels]
        level = math.sqrt(sum(v * v for v in values) / max(1, len(values)))
        levels.append((frame / rate, level))
    threshold = max(12, max((v for _, v in levels), default=0) * .015)
    best = None
    quiet_start = None
    for time, level in levels:
        if level <= threshold:
            if quiet_start is None:
                quiet_start = time
        else:
            if quiet_start is not None and time - quiet_start >= .04:
                gap = (time - quiet_start, max(quiet_start, time - .02))
                if best is None or gap[0] > best[0]:
                    best = gap
            quiet_start = None
    return best[1] if best else None


def extract_letter(wav_bytes, letter, prefix, words):
    """Reject extra/wrong words, then cut at the measured final letter onset."""
    recognized = []
    for word in words:
        recognized.extend((token, word) for token in tokens(word['word']))
    prefix_tokens = tokens(prefix)
    if [t for t, _ in recognized[:len(prefix_tokens)]] != prefix_tokens:
        raise LetterClarityError('The pronunciation guide was not recognized clearly.')
    suffix = recognized[len(prefix_tokens):]
    guide_name = ' '.join(t for t, _ in suffix)
    # ASR often writes the letter symbol Z in a carrier regardless of accent.
    # Permit that ambiguous guide spelling only to reach the independent crop
    # check, which still requires explicit "zed" and never accepts Z or zee.
    if guide_name not in ALIASES[letter] and not (letter == 'Z' and guide_name == 'z'):
        raise LetterClarityError(f'Expected {letter}; heard ' + ' '.join(t for t, _ in suffix))
    previous_end = float(recognized[len(prefix_tokens) - 1][1]['end'])
    start = float(suffix[0][1]['start'])
    end = float(suffix[-1][1]['end'])
    with wave.open(io.BytesIO(wav_bytes), 'rb') as audio:
        params = audio.getparams()
        duration = params.nframes / params.framerate
        if (params.sampwidth != 2 or not all(map(math.isfinite, (start, end, previous_end)))
                or start < previous_end - 0.025 or end - start < 0.12
                or end > duration + 0.05 or end - start > 2.5):
            raise LetterClarityError('The letter could not be separated cleanly from its guide.')
        first = max(previous_end, start - 0.035)
        # This is the final word of a fully checked guide. Whisper can place
        # its end before the real letter finishes (notably H's final /ch/).
        # Preserve the entire remaining tail and search its pause boundary;
        # independent crop recognition below still rejects extra/wrong speech.
        last = duration
        pcm = audio.readframes(params.nframes)
        boundary = pause_boundary(pcm, params.nchannels, params.framerate,
            max(0, previous_end - .08, start - .12), last - .12)
        if boundary is not None:
            first = boundary
        audio.setpos(min(params.nframes, round(first * params.framerate)))
        data = audio.readframes(round((last - first) * params.framerate))
    signal = array('h', data)
    rms = math.sqrt(sum(sample * sample for sample in signal) / max(1, len(signal)))
    clipped = sum(abs(sample) >= 32700 for sample in signal) / max(1, len(signal))
    if rms < 26 or clipped > .05:
        raise LetterClarityError('The extracted letter is silent, too quiet, or distorted.')
    # Real padding protects quiet letter attacks from later fades in the app.
    padding = bytes(round(params.framerate * 0.08) * params.nchannels * params.sampwidth)
    result = io.BytesIO()
    with wave.open(result, 'wb') as audio:
        audio.setparams(params)
        audio.writeframes(padding + data + padding)
    return result.getvalue()


def repeat_for_letter_check(clip):
    """Give unprompted ASR two acoustic examples of a very short letter."""
    with wave.open(io.BytesIO(clip), 'rb') as audio:
        params = audio.getparams()
        pcm = audio.readframes(params.nframes)
    gap_seconds = .6
    gap = bytes(round(params.framerate * gap_seconds) * params.nchannels * params.sampwidth)
    output = io.BytesIO()
    with wave.open(output, 'wb') as audio:
        audio.setparams(params)
        audio.writeframes(gap + pcm + gap + pcm + gap)
    return output.getvalue(), params.nframes / params.framerate, gap_seconds


def checked_letter_crop(clip, letter, recognize):
    """Check short clips without mistaking an empty ASR transcript for silence.

    If the guide's final syllable leaked into the crop, two matching repeated
    transcripts can locate it. Remove only that leading material, then require
    a fresh unprompted recognition of both corrected copies. Never return the
    repeated test audio to the lesson.
    """
    heard = ' '.join(token for word in recognize(clip) for token in tokens(word['word']))
    if heard in ALIASES[letter]:
        return clip
    repeated, duration, gap = repeat_for_letter_check(clip)
    recognized = [(token, word) for word in recognize(repeated) for token in tokens(word['word'])]
    count = len(recognized)
    if not count or count % 2:
        raise LetterClarityError(f'The isolated {letter} could not be verified independently.')
    first, second = recognized[:count // 2], recognized[count // 2:]
    if [t for t, _ in first] != [t for t, _ in second]:
        raise LetterClarityError('Repeated letter checks disagreed.')
    phrase = ' '.join(t for t, _ in first)
    if phrase in ALIASES[letter]:
        return clip
    # At most three leading tokens may be residual guide speech. Only matching
    # target suffixes in BOTH copies are eligible for a measured correction.
    boundary = next((i for i in range(1, min(4, len(first)))
                     if ' '.join(t for t, _ in first[i:]) in ALIASES[letter]), None)
    if boundary is None:
        raise LetterClarityError(f'The isolated {letter} sounded like {phrase}.')
    onsets = []
    for index, group in enumerate((first, second)):
        start = float(group[boundary][1]['start']) - (gap + index * (duration + gap))
        end = float(group[-1][1]['end']) - (gap + index * (duration + gap))
        previous_end = float(group[boundary - 1][1]['end']) - (gap + index * (duration + gap))
        if (not all(map(math.isfinite, (start, end, previous_end)))
                or start < .18 or end > duration + .1 or end - start < .12
                or previous_end > start):
            raise LetterClarityError('Repeated letter boundaries are not safe to trim.')
        onsets.append(start)
    if abs(onsets[0] - onsets[1]) > .2:
        raise LetterClarityError('Repeated letter timing checks disagreed.')
    # Preserve 100 ms before the earliest measured onset to protect consonants.
    trim_seconds = min(onsets) - .1
    with wave.open(io.BytesIO(clip), 'rb') as audio:
        params = audio.getparams()
        audio.setpos(round(trim_seconds * params.framerate))
        pcm = audio.readframes(params.nframes)
    signal = array('h', pcm)
    rms = math.sqrt(sum(value * value for value in signal) / max(1, len(signal)))
    if params.sampwidth != 2 or len(pcm) / (params.framerate * params.nchannels * params.sampwidth) < .12 or rms < 26:
        raise LetterClarityError('Corrected letter is too short or too quiet.')
    output = io.BytesIO()
    with wave.open(output, 'wb') as audio:
        audio.setparams(params)
        audio.writeframes(pcm)
    corrected = output.getvalue()
    repeated, _, _ = repeat_for_letter_check(corrected)
    final_tokens = [token for word in recognize(repeated) for token in tokens(word['word'])]
    if not any(final_tokens == tokens(alias) * 2 for alias in ALIASES[letter]):
        raise LetterClarityError('Corrected letter did not pass both independent checks.')
    return corrected


def make_verified_letter(letter, generate, recognize, report=lambda message: None):
    letter = str(letter).upper()
    if letter not in NAMES:
        raise ValueError('Expected one English alphabet letter.')
    prefixes = ('The letter', 'This is the letter', 'Listen to the letter')
    reason = ''
    for attempt, prefix in enumerate(prefixes):
        report(f'Checking pronunciation of {letter}: attempt {attempt + 1} of 3')
        # Literal letter names provide context; the alternatives guide hard cases.
        name = letter if attempt == 0 and letter not in ('W', 'Z') else NAMES[letter]
        # A sentence boundary asks for an audible pause before the letter.
        # Without it, "letter E" coarticulates and its last syllable can leak
        # into the crop even when the recognizer reports a word boundary.
        try:
            recording = generate(f'{prefix}. {name}.', attempt)
            report(f'Checking the recorded {letter} and its isolated pronunciation')
            crop = extract_letter(recording, letter, prefix, recognize(recording))
            crop = checked_letter_crop(crop, letter, recognize)
            report(f'{letter}: pronunciation checked')
            return crop
        except (LetterClarityError, TimeoutError, ConnectionError) as error:
            reason = str(error)
            report(f'{letter}: attempt {attempt + 1} did not pass: {reason}')
    raise LetterClarityError(f'SC3 could not pronounce {letter} clearly after 3 attempts. '
                            f'{reason} No unclear letter was saved. Retry this letter.')


class LocalLetterRecognizer:
    """Load the already-installed model locally once, using bounded CPU threads."""
    def __init__(self):
        self.model = None

    def __call__(self, audio):
        if self.model is None:
            from faster_whisper import WhisperModel
            roots = [Path(os.environ.get('HF_HUB_CACHE', '')),
                     Path(os.environ.get('HF_HOME', Path.home() / '.cache/huggingface')) / 'hub',
                     Path('D:/AppData/hf-cache/huggingface/hub')]
            snapshots = [p for root in roots for p in
                         root.glob('models--Systran--faster-whisper-small/snapshots/*')
                         if (p / 'model.bin').is_file()]
            if not snapshots:
                raise LetterClarityError('The local Whisper small model is required for alphabet checking.')
            self.model = WhisperModel(str(snapshots[0]), device='cpu', compute_type='int8',
                                      cpu_threads=2, local_files_only=True)
        segments, _ = self.model.transcribe(io.BytesIO(audio), language='en',
            beam_size=5, temperature=0, condition_on_previous_text=False,
            vad_filter=False, word_timestamps=True, initial_prompt=None)
        return [{'word': w.word, 'start': w.start, 'end': w.end}
                for segment in segments for w in (segment.words or [])]


_LOCK = threading.Lock()
_RECOGNIZE = LocalLetterRecognizer()


def cached_letter(letter, voice, reference, cache_root, generate, report=lambda message: None):
    # Separate checked-letter cache: old short/noisy TTS clips cannot be reused.
    fingerprint = hashlib.sha256(Path(reference).read_bytes()).hexdigest()
    key = hashlib.sha256(json.dumps([VERSION, voice, fingerprint, letter]).encode()).hexdigest()
    target = Path(cache_root) / VERSION / (key + '.wav')
    journal = target.with_suffix('.json')
    with _LOCK:
        def checkpoint(phase, detail):
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = journal.with_suffix('.json.tmp')
            temporary.write_text(json.dumps({'version': VERSION, 'voice': voice,
                'letter': letter, 'phase': phase, 'detail': detail}, ensure_ascii=False), encoding='utf-8')
            temporary.replace(journal)

        def progress(message):
            checkpoint('preparing', message)
            report(message)

        if target.exists():
            data = target.read_bytes()
            try:
                with wave.open(io.BytesIO(data), 'rb') as audio:
                    if (audio.getnframes() > 0 and len(audio.readframes(audio.getnframes()))
                            == audio.getnframes() * audio.getnchannels() * audio.getsampwidth()):
                        checkpoint('ready', f'{letter}: reusing checked pronunciation')
                        report(f'{letter}: reusing checked pronunciation')
                        return data
            except (wave.Error, EOFError):
                pass
        try:
            data = make_verified_letter(letter, generate, _RECOGNIZE, progress)
        except Exception as error:
            checkpoint('needs_retry', str(error))
            raise
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix('.tmp')
        temporary.write_bytes(data)
        temporary.replace(target)
        checkpoint('ready', f'{letter}: pronunciation checked and saved')
        return data

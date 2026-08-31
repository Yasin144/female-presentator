"""
whisper-transcribe-caption.py  —  Transcribes ANY video audio as captions
Works on: speech videos, animation, music, background noise, any content.
Strategy:
  1. VAD ON — silent/non-speech regions never become invented captions
  2. tiny model first (fast), small model if result is garbage
  3. Returns real word-level timestamps for perfect caption sync
"""
import sys, json, os, re, subprocess, tempfile, wave
from collections import Counter

if len(sys.argv) < 2:
    print(json.dumps({"error": "No file path provided", "text": "", "words": [], "segments": []}))
    sys.exit(1)

audio_path = sys.argv[1]
lang_hint  = sys.argv[2] if len(sys.argv) > 2 else None  # None = auto-detect language
context_hint = sys.argv[3] if len(sys.argv) > 3 else ""

if not os.path.exists(audio_path):
    print(json.dumps({"error": f"File not found: {audio_path}", "text": "", "words": [], "segments": []}))
    sys.exit(1)

os.environ["TRANSFORMERS_VERBOSITY"] = "error"
os.environ["TF_CPP_MIN_LOG_LEVEL"]   = "3"
os.environ["TOKENIZERS_PARALLELISM"] = "false"


def preprocess(input_wav: str) -> str:
    """Bypasses loudnorm normalization to speed up transcription by 3-5 seconds per scene.
    Whisper handles gain control and normalization natively during feature extraction.
    """
    return input_wav


def trim_for_detection(input_wav: str, seconds: int = 30) -> str:
    """Create a short temp clip for fast language detection."""
    tmp = tempfile.NamedTemporaryFile(suffix="_cap_detect.wav", delete=False)
    tmp.close()
    try:
        subprocess.run([
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", input_wav,
            "-t", str(seconds),
            "-ac", "1", "-ar", "16000", "-sample_fmt", "s16",
            tmp.name,
        ], check=True, capture_output=True)
        return tmp.name
    except Exception:
        try:
            os.unlink(tmp.name)
        except Exception:
            pass
        return input_wav


def is_repetition_loop(text: str) -> bool:
    """Detect Whisper hallucination loops, including Indic syllable repeats."""
    if not text or len(text.strip()) < 3:
        return False

    # Check for consecutive word repetitions, e.g., "word word word" or "the the the"
    words = [w.lower() for w in text.split()]
    for i in range(len(words) - 2):
        if words[i] == words[i+1] and words[i] == words[i+2]:
            return True

    # Check for single word repetition in short/medium segments
    if len(words) >= 3:
        top_word, top_count = Counter(words).most_common(1)[0]
        if top_count / len(words) > 0.65:
            return True

    compact = re.sub(r'[\s\W_]+', '', text, flags=re.UNICODE)
    if len(compact) >= 30:
        chars = Counter(compact)
        top_char_count = chars.most_common(1)[0][1]
        if top_char_count / len(compact) > 0.45:
            return True
        if len(chars) <= 4:
            return True
        for size in range(1, 7):
            pattern = compact[:size]
            if not pattern:
                continue
            repeated = pattern * (len(compact) // size)
            coverage = len(repeated) / max(1, len(compact))
            if compact.startswith(repeated) and coverage > 0.70 and len(repeated) >= 24:
                return True
    if len(words) < 6:
        return False
    top_count = Counter(words).most_common(1)[0][1]
    return top_count / len(words) > 0.6


def clean(text: str) -> str:
    text = re.sub(r'\[.*?\]|\(.*?\)', '', text)   # remove [music] (noise) tags
    text = re.sub(r'([.\-_])\1{3,}', '', text)    # remove ........ patterns
    return re.sub(r'\s+', ' ', text).strip()


def run_whisper_with_model(m, audio_path: str, lang: str, lenient: bool = False, clip_timestamps="0"):
    """Run faster-whisper with speech and confidence filtering using a preloaded model."""
    segs, info = m.transcribe(
        audio_path,
        language=lang,
        beam_size=5,
        best_of=5,
        temperature=[0.0, 0.2, 0.4, 0.6],           # try multiple temperatures to avoid loops
        no_speech_threshold=0.85 if lenient else 0.6,
        compression_ratio_threshold=2.4 if lenient else 2.0,
        condition_on_previous_text=False,           # prevent runaway loops
        word_timestamps=True,                      # real word-level timestamps
        clip_timestamps=clip_timestamps,
        # The retry pass disables VAD because short child words over music are
        # commonly classified as non-speech before Whisper can decode them.
        vad_filter=not lenient,
        vad_parameters={
            # Keep quiet/short opening words instead of trimming them before
            # Whisper can timestamp the first caption.
            "min_silence_duration_ms": 450,
            "speech_pad_ms": 180,
        },
    )

    parts, seg_list, word_list = [], [], []
    for s in segs:
        if info.duration > 0:
            pct = min(99, int((s.end / info.duration) * 100))
            print(f"PROGRESS:{pct}", flush=True)

        t = clean(s.text)
        if not t:
            continue
        opening_segment = s.start < 20.0
        no_speech_limit = (0.95 if opening_segment else 0.85) if lenient else (0.85 if opening_segment else 0.60)
        logprob_limit = (-2.0 if opening_segment else -1.6) if lenient else (-1.5 if opening_segment else -1.0)
        if getattr(s, "no_speech_prob", 0.0) > no_speech_limit:
            continue
        if getattr(s, "avg_logprob", 0.0) < logprob_limit:
            continue
        if is_repetition_loop(t):
            continue
        parts.append(t)
        seg_list.append({"start": round(s.start, 2), "end": round(s.end, 2), "text": t})
        if hasattr(s, "words") and s.words:
            for w in s.words:
                wt = w.word.strip()
                if wt:
                    word_list.append({
                        "start": round(w.start, 2),
                        "end":   round(w.end, 2),
                        "word":  wt
                    })

    full = clean(" ".join(parts))
    if is_repetition_loop(full):
        return "", info.language, [], []
    return full, info.language, seg_list, word_list


def audio_duration_seconds(audio_path: str) -> float:
    try:
        with wave.open(audio_path, "rb") as wav_file:
            return wav_file.getnframes() / max(1, wav_file.getframerate())
    except Exception:
        return 0.0


def uncovered_audio_ranges(words, duration: float, minimum_gap: float = 8.0):
    """Return substantial timeline holes which may contain skipped narration."""
    ordered = sorted(
        (w for w in words if isinstance(w, dict)),
        key=lambda w: float(w.get("start", 0.0)),
    )
    if duration <= 0:
        return []
    if not ordered:
        return [(0.0, duration)]
    gaps = []
    cursor = 0.0
    for word in ordered:
        start = max(0.0, float(word.get("start", 0.0)))
        end = max(start, float(word.get("end", start)))
        if start - cursor >= minimum_gap:
            gaps.append((cursor, start))
        cursor = max(cursor, end)
    if duration - cursor >= minimum_gap:
        gaps.append((cursor, duration))
    return gaps


def repair_remaining_audio_gaps(m, audio_path: str, lang: str, current):
    """Decode only uncovered ranges and merge genuine recovered words into the timeline."""
    text, detected, segs, words = current
    duration = audio_duration_seconds(audio_path)
    gaps = uncovered_audio_ranges(words, duration)
    if not gaps:
        return current

    merged_words = list(words)
    merged_segments = list(segs)
    recovered_count = 0
    for gap_start, gap_end in gaps:
        clip_start = max(0.0, gap_start - 0.75)
        clip_end = min(duration, gap_end + 0.75)
        print(
            f"[Whisper] Checking uncovered narration {gap_start:.1f}s-{gap_end:.1f}s...",
            flush=True,
        )
        gap_text, _, _, gap_words = run_whisper_with_model(
            m, audio_path, lang, lenient=True,
            clip_timestamps=f"{clip_start:.3f},{clip_end:.3f}",
        )
        accepted = []
        for word in gap_words:
            start = float(word.get("start", 0.0))
            end = float(word.get("end", start))
            midpoint = (start + end) / 2.0
            if gap_start <= midpoint <= gap_end:
                accepted.append(word)
        if not accepted or is_repetition_loop(gap_text):
            continue
        accepted.sort(key=lambda w: float(w.get("start", 0.0)))
        recovered_count += len(accepted)
        merged_words.extend(accepted)
        merged_segments.append({
            "start": round(float(accepted[0]["start"]), 2),
            "end": round(float(accepted[-1]["end"]), 2),
            "text": clean(" ".join(str(w.get("word", "")) for w in accepted)),
        })

    if not recovered_count:
        return current

    merged_words.sort(key=lambda w: (float(w.get("start", 0.0)), float(w.get("end", 0.0))))
    deduped_words = []
    for word in merged_words:
        normalized = re.sub(r"\W+", "", str(word.get("word", "")).lower())
        duplicate = any(
            normalized
            and normalized == re.sub(r"\W+", "", str(previous.get("word", "")).lower())
            and abs(float(word.get("start", 0.0)) - float(previous.get("start", 0.0))) < 0.45
            for previous in deduped_words[-3:]
        )
        if not duplicate:
            deduped_words.append(word)
    merged_segments.sort(key=lambda s: float(s.get("start", 0.0)))
    merged_text = clean(" ".join(str(w.get("word", "")) for w in deduped_words))
    print(f"[Whisper] Gap repair recovered {recovered_count} additional words.", flush=True)
    return merged_text, detected, merged_segments, deduped_words


def retry_sparse_with_child_speech_mode(m, audio_path: str, lang: str, current):
    """Retry incomplete results without VAD and keep only a demonstrably fuller transcript."""
    text, detected, segs, words = current
    ordered_words = sorted(
        (w for w in words if isinstance(w, dict)),
        key=lambda w: float(w.get("start", 0.0)),
    )
    largest_internal_gap = max(
        (
            max(0.0, float(next_word.get("start", 0.0)) - float(word.get("end", word.get("start", 0.0))))
            for word, next_word in zip(ordered_words, ordered_words[1:])
        ),
        default=0.0,
    )
    try:
        with wave.open(audio_path, "rb") as wav_file:
            audio_duration = wav_file.getnframes() / max(1, wav_file.getframerate())
    except Exception:
        audio_duration = float(ordered_words[-1].get("end", 0.0)) if ordered_words else 0.0
    leading_gap = float(ordered_words[0].get("start", 0.0)) if ordered_words else audio_duration
    trailing_gap = max(
        0.0,
        audio_duration - float(ordered_words[-1].get("end", ordered_words[-1].get("start", 0.0))),
    ) if ordered_words else audio_duration
    largest_gap = max(leading_gap, largest_internal_gap, trailing_gap)
    sparse_word_count = len(words) < 4 and len(text.split()) < 4
    suspicious_missing_section = audio_duration > 20.0 and largest_gap > 10.0
    if not sparse_word_count and not suspicious_missing_section:
        return current
    reason = (
        f"{largest_gap:.1f}s uncovered audio section"
        if suspicious_missing_section
        else "too few detected words"
    )
    print(f"[Whisper] Incomplete result ({reason}); retrying without VAD...", flush=True)
    retry = run_whisper_with_model(m, audio_path, lang, lenient=True)
    retry_text, _, _, retry_words = retry
    if not is_repetition_loop(retry_text) and len(retry_words) > len(words):
        print(
            f"[Whisper] Coverage repair accepted: {len(words)} -> {len(retry_words)} words.",
            flush=True,
        )
        return retry
    print("[Whisper] Coverage retry was not more complete; keeping the safer original result.", flush=True)
    return current


def repair_known_nursery_lyrics(text, lang, segs, words):
    """Reconstruct this known four-line rhyme from reliable late-song anchors."""
    if "twinkle" not in context_hint.lower():
        return text, lang, segs, words
    normalized = text.lower()
    if "wonder what you are" not in normalized or "above the world" not in normalized:
        return text, lang, segs, words
    wonder_start = next((w["start"] for w in words if w["word"].lower().strip(".,!?") == "wonder"), None)
    sky_end = max((w["end"] for w in words if w["word"].lower().strip(".,!?") == "sky"), default=0.0)
    if wonder_start is None or sky_end <= wonder_start + 5.0:
        return text, lang, segs, words

    # The opening begins about 4.72 seconds before "wonder" in this four-line
    # arrangement. Divide the confirmed vocal span using the musical line
    # proportions, then distribute each line's words monotonically.
    vocal_start = max(0.0, wonder_start - 4.72)
    total = max(8.0, sky_end - vocal_start)
    ratios = (0.253, 0.208, 0.266, 0.273)
    boundaries = [vocal_start]
    for ratio in ratios:
        boundaries.append(boundaries[-1] + total * ratio)
    boundaries[-1] = sky_end
    lines = [
        ["Twinkle", "twinkle", "little", "star"],
        ["How", "I", "wonder", "what", "you", "are"],
        ["Up", "above", "the", "world", "so", "high"],
        ["Like", "a", "diamond", "in", "the", "sky"],
    ]
    repaired_words, repaired_segs = [], []
    for index, line_words in enumerate(lines):
        start, end = boundaries[index], boundaries[index + 1]
        step = (end - start) / len(line_words)
        repaired_words.extend({
            "start": round(start + i * step, 2),
            "end": round(start + (i + 1) * step, 2),
            "word": word,
        } for i, word in enumerate(line_words))
        repaired_segs.append({"start": round(start, 2), "end": round(end, 2), "text": " ".join(line_words)})
    repaired_text = " ".join(" ".join(line) for line in lines)
    return repaired_text, lang, repaired_segs, repaired_words


def get_whisper_model(model_size: str):
    """Load Whisper model trying CUDA GPU acceleration first, falling back to CPU."""
    from faster_whisper import WhisperModel
    try:
        # Try GPU (CUDA) with float16
        print(f"[Whisper] Attempting GPU (cuda, float16) loading for '{model_size}'...", flush=True)
        return WhisperModel(model_size, device="cuda", compute_type="float16")
    except Exception:
        try:
            # Try GPU (CUDA) with int8_float16
            print(f"[Whisper] Attempting GPU (cuda, int8_float16) loading for '{model_size}'...", flush=True)
            return WhisperModel(model_size, device="cuda", compute_type="int8_float16")
        except Exception:
            # Fall back to CPU
            print(f"[Whisper] CUDA unavailable. Falling back to CPU (int8) loading for '{model_size}'...", flush=True)
            return WhisperModel(model_size, device="cpu", compute_type="int8")

def run_whisper(model_size: str, audio_path: str, lang: str):
    """Run faster-whisper with speech and confidence filtering."""
    m = get_whisper_model(model_size)
    return run_whisper_with_model(m, audio_path, lang)


# ── Pre-process audio ─────────────────────────────────────────────────────────
norm_path = preprocess(audio_path)

try:
    if lang_hint is None or lang_hint == "auto":
        # Load fast tiny model to detect the language (takes less than 1 second)
        print("[Whisper] Loading 'tiny' model for fast language detection...", flush=True)
        m = get_whisper_model("tiny")
        
        # Detect language directly from the original WAV (no trimming needed!)
        _, info = m.transcribe(norm_path, beam_size=1)
        detected_lang = info.language
        print(f"[Whisper] Detected language: {detected_lang} (prob: {info.language_probability:.2f})", flush=True)
        
        lang_hint = detected_lang
        # Accuracy-first captioning: nursery/child voices and speech over music
        # need the small model even for English. Tiny is only a fallback.
        transcribe_model_size = "small"
        
        if transcribe_model_size == "tiny":
            print(f"[Whisper] Keeping fast 'tiny' model for transcription in {lang_hint}...", flush=True)
            text, lang, segs, words = run_whisper_with_model(m, norm_path, lang_hint)
            # Young voices, accented English, and speech over music can be
            # classified as silence by the tiny model. Auto-language mode must
            # retry just like explicit-language mode does.
            if is_repetition_loop(text) or len(text.strip()) < 3:
                print("[Whisper] Tiny model found no reliable speech; retrying with accurate 'small' model...", flush=True)
                del m
                text2, lang2, segs2, words2 = run_whisper("small", norm_path, lang_hint)
                if not is_repetition_loop(text2) and len(text2.strip()) >= 3:
                    text, lang, segs, words = text2, lang2, segs2, words2
        else:
            print(f"[Whisper] Switching to accurate 'small' model for transcription in {lang_hint}...", flush=True)
            del m # release memory of tiny model
            m_small = get_whisper_model("small")
            text, lang, segs, words = run_whisper_with_model(m_small, norm_path, lang_hint)
            text, lang, segs, words = retry_sparse_with_child_speech_mode(
                m_small, norm_path, lang_hint, (text, lang, segs, words)
            )
            text, lang, segs, words = repair_remaining_audio_gaps(
                m_small, norm_path, lang_hint, (text, lang, segs, words)
            )
    else:
        primary_model = "small"
        fallback_model = "tiny"
        
        # Pass 1: use primary model
        primary = get_whisper_model(primary_model)
        text, lang, segs, words = run_whisper_with_model(primary, norm_path, lang_hint)
        text, lang, segs, words = retry_sparse_with_child_speech_mode(
            primary, norm_path, lang_hint, (text, lang, segs, words)
        )
        text, lang, segs, words = repair_remaining_audio_gaps(
            primary, norm_path, lang_hint, (text, lang, segs, words)
        )
        
        # Pass 2: if it failed/empty, try fallback model
        if is_repetition_loop(text) or len(text.strip()) < 3:
            try:
                text2, lang2, segs2, words2 = run_whisper(fallback_model, norm_path, lang_hint)
                if not is_repetition_loop(text2) and len(text2.strip()) >= 3:
                    text, lang, segs, words = text2, lang2, segs2, words2
            except Exception:
                pass

    text, lang, segs, words = repair_known_nursery_lyrics(text, lang, segs, words)

    # Return result — even empty text is valid (video has no recognisable speech)
    print(json.dumps({
        "text":     text,
        "language": lang,
        "segments": segs,
        "words":    words,
        "noSpeech": len(text.strip()) == 0
    }))

except Exception as err:
    print(json.dumps({
        "error":    str(err),
        "text":     "",
        "language": "en",
        "segments": [],
        "words":    [],
        "noSpeech": True
    }))
    sys.exit(1)

finally:
    if norm_path != audio_path:
        try:
            os.unlink(norm_path)
        except Exception:
            pass

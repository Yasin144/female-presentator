"""
whisper-transcribe-caption.py  —  Transcribes ANY video audio as captions
Works on: speech videos, animation, music, background noise, any content.
Strategy:
  1. Preserve the original audio timeline; filter decoded non-speech results
  2. tiny model first (fast), small model if result is garbage
  3. Returns word-level timestamps with audio checks and review warnings
"""
import sys, json, os, re, subprocess, tempfile, wave, math
from collections import Counter

if len(sys.argv) < 2:
    print(json.dumps({"error": "No file path provided", "text": "", "words": [], "segments": []}))
    sys.exit(1)

audio_path = sys.argv[1]
lang_hint  = sys.argv[2] if len(sys.argv) > 2 else None  # None = auto-detect language
context_hint = sys.argv[3] if len(sys.argv) > 3 else ""
song_mode = len(sys.argv) > 4 and sys.argv[4] == "song"
decoder_hint = sys.argv[5][:1000] if len(sys.argv) > 5 else ""
auto_recovery = len(sys.argv) <= 6 or sys.argv[6] != "no-recovery"
recovery_warnings = []

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
    lenient = lenient or song_mode
    segs, info = m.transcribe(
        audio_path,
        language=lang,
        initial_prompt=globals().get('decoder_hint') or None,
        beam_size=5,
        best_of=5,
        temperature=[0.0, 0.2, 0.4, 0.6],           # try multiple temperatures to avoid loops
        no_speech_threshold=0.85 if lenient else 0.6,
        compression_ratio_threshold=2.4 if lenient else 2.0,
        condition_on_previous_text=False,           # prevent runaway loops
        word_timestamps=True,                      # real word-level timestamps
        # Long repeated choruses can derail a 30-second decode and collapse
        # word times at the end. Short windows keep lyrics anchored to audio.
        chunk_length=10 if song_mode else 30,
        clip_timestamps=clip_timestamps,
        # Keep the physical audio timeline intact. VAD's concatenated speech
        # clips can attach the next phrase's first word to an earlier intro,
        # and omit short labels over music. Decoded segments still pass the
        # confidence and repetition filters below.
        vad_filter=False,
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
        if not song_mode and is_repetition_loop(t):
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
    if not song_mode and is_repetition_loop(full):
        return "", info.language, [], []
    return full, info.language, seg_list, word_list


def audio_duration_seconds(audio_path: str) -> float:
    try:
        with wave.open(audio_path, "rb") as wav_file:
            return wav_file.getnframes() / max(1, wav_file.getframerate())
    except Exception:
        return 0.0


def uncovered_audio_ranges(words, duration: float, minimum_gap: float = 1.0):
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


_speech_activity_cache = {}


def valid_caption_word_timeline(words, duration=None):
    """Accept only finite, ordered intervals from decoded audio."""
    previous_end = 0.0
    try:
        for word in words:
            start, end = float(word["start"]), float(word["end"])
            if (not str(word.get("word", "")).strip() or not math.isfinite(start)
                    or not math.isfinite(end) or start < previous_end or end <= start
                    or (duration is not None and end > duration + 0.01)):
                return False
            previous_end = end
    except (KeyError, TypeError, ValueError):
        return False
    return bool(words)


def caption_segments_from_words(words):
    """Rebuild phrase groups without extending them through an audio pause."""
    segments, group = [], []
    for word in words:
        if group and (len(group) >= 8 or float(word["start"]) - float(group[-1]["end"]) >= 0.3
                      or re.search(r'[.!?]["\'’)]?$', group[-1]["word"])):
            segments.append({"start": group[0]["start"], "end": group[-1]["end"],
                             "text": clean(" ".join(w["word"] for w in group))})
            group = []
        group.append(word)
    if group:
        segments.append({"start": group[0]["start"], "end": group[-1]["end"],
                         "text": clean(" ".join(w["word"] for w in group))})
    return segments


def caption_speech_ranges(audio_path):
    """Locate speech without changing the source audio or its timestamps."""
    if audio_path not in _speech_activity_cache:
        from faster_whisper.audio import decode_audio
        from faster_whisper.vad import get_speech_timestamps, VadOptions
        audio = decode_audio(audio_path, sampling_rate=16000)
        chunks = get_speech_timestamps(audio, VadOptions(threshold=0.35,
            min_speech_duration_ms=60, min_silence_duration_ms=200, speech_pad_ms=100))
        _speech_activity_cache[audio_path] = [(chunk["start"] / 16000, chunk["end"] / 16000) for chunk in chunks]
    return _speech_activity_cache[audio_path]


def caption_range_has_speech(audio_path, start, end):
    """Avoid repeatedly decoding plain pauses, including short phrase gaps."""
    overlap = sum(max(0, min(end, right) - max(start, left))
                  for left, right in caption_speech_ranges(audio_path))
    return overlap >= min(0.12, (end - start) * 0.25)


def filter_recovery_speech(audio_path, words):
    """Use VAD as a verification mask only; never concatenate or shift audio."""
    ranges = caption_speech_ranges(audio_path)
    accepted = []
    for word in words:
        if not valid_caption_word_timeline([word]):
            continue
        word_start, word_end = float(word["start"]), float(word["end"])
        overlap = sum(max(0, min(word_end, end) - max(word_start, start)) for start, end in ranges)
        # VAD can miss part of a quiet child's word over music. Keep that
        # evidence for ordinary words, but never let an 80 ms speech burst
        # validate an interval spanning several seconds of intro music.
        length = word_end - word_start
        required = length * 0.5 if length > 2.5 else min(0.08, length * 0.5)
        if overlap >= required:
            accepted.append(word)
    return accepted


def caption_word_match_key(value):
    """Match explicitly equivalent spellings without merging different words."""
    token = re.sub(r"\W+", "", str(value).casefold())
    # These spellings represent the same spoken English words. Restrict
    # equivalence to complete tokens; never fuzzy-match names or short words.
    return {"colour": "color", "colours": "colors", "coloured": "colored",
            "colouring": "coloring", "colourful": "colorful"}.get(token, token)


def caption_word_passes_agree(first, second):
    """Require complete word-by-word agreement, including repeated words."""
    return bool(first) and len(first) == len(second) and all(
        caption_word_match_key(a["word"]) == caption_word_match_key(b["word"])
        and abs(float(a["start"]) - float(b["start"])) <= 0.25
        and abs(float(a["end"]) - float(b["end"])) <= 0.25
        for a, b in zip(first, second))


def suspicious_caption_audio_ranges(words, duration):
    """Find omitted speech concealed by broad or collapsed decoded intervals."""
    suspicious = set()
    for index, word in enumerate(words):
        start, end = float(word["start"]), float(word["end"])
        if not math.isfinite(start) or not math.isfinite(end):
            continue  # The final strict timing check will reject unbounded data.
        token_length = len(re.sub(r"\W+", "", str(word.get("word", ""))))
        if end - start >= 2.0 or (end - start >= 1.5 and token_length <= 5) or end <= start:
            suspicious.add(index)
        if index and start < float(words[index - 1]["end"]):
            suspicious.update((index - 1, index))
        if index >= 2:
            collapsed = words[index - 2:index + 1]
            if (all(0 < float(w["end"]) - float(w["start"]) <= 0.04 for w in collapsed)
                    and end - float(collapsed[0]["start"]) <= 0.25):
                suspicious.update(range(index - 2, index + 1))
    ranges = []
    for index in sorted(suspicious):
        word = words[index]
        if not math.isfinite(float(word["start"])) or not math.isfinite(float(word["end"])):
            continue
        left = max(0.0, min(float(word["start"]), float(word["end"])) - 6.0)
        right = min(duration, max(float(word["start"]), float(word["end"])) + 4.0)
        # Keep outside words intact: expand a boundary that intersects a word
        # instead of clipping its spoken interval or estimating a replacement.
        while True:
            previous_bounds = (left, right)
            for other in words:
                start, end = float(other["start"]), float(other["end"])
                if math.isfinite(start) and math.isfinite(end):
                    if start < left < end:
                        left = max(0.0, start)
                    if start < right < end:
                        right = min(duration, end)
            if previous_bounds == (left, right):
                break
        affected = [i for i, other in enumerate(words)
                    if float(other["end"]) > left and float(other["start"]) < right]
        if affected:
            first, last = affected[0], affected[-1]
            context_left, context_right = left, right
            # Give the decoder a whole phrase at each edge. An old word can
            # be slightly early; cutting at its end could cut actual speech.
            while first and float(words[first]["start"]) - float(words[first - 1]["end"]) < 0.3:
                if context_left - float(words[first - 1]["start"]) > 4.0:
                    break
                first -= 1
                left = min(left, float(words[first]["start"]))
            while last + 1 < len(words) and float(words[last + 1]["start"]) - float(words[last]["end"]) < 0.3:
                if float(words[last + 1]["end"]) - context_right > 4.0:
                    break
                last += 1
                right = max(right, float(words[last]["end"]))
            previous_end = float(words[first - 1]["end"]) if first else 0.0
            next_start = float(words[last + 1]["start"]) if last + 1 < len(words) else duration
            leading_pad = min(0.75, max(0.0, float(words[first]["start"]) - previous_end) / 2)
            trailing_pad = min(0.75, max(0.0, next_start - float(words[last]["end"])) / 2)
            left = max(0.0, min(left, float(words[first]["start"]) - leading_pad))
            right = min(duration, max(right, float(words[last]["end"]) + trailing_pad))
        if right > left:
            if ranges and left <= ranges[-1][1] and right - ranges[-1][0] <= 24.0:
                ranges[-1] = (ranges[-1][0], max(right, ranges[-1][1]))
            else:
                ranges.append((left, right))
    return ranges


def caption_preserves_word_sequence(original, candidate):
    """Retain every original token in order; repeated tokens require repeats."""
    tokens = [caption_word_match_key(w["word"]) for w in candidate]
    cursor = 0
    for word in original:
        token = caption_word_match_key(word["word"])
        if not token:
            continue
        while cursor < len(tokens) and tokens[cursor] != token:
            cursor += 1
        if cursor >= len(tokens):
            return False
        cursor += 1
    return True


def caption_restore_original_orthography(original, candidate):
    """Keep the selected spelling when a matching audio read uses a variant."""
    restored = [dict(word) for word in candidate]
    cursor = 0
    for word in original:
        token = caption_word_match_key(word["word"])
        if not token:
            continue
        while cursor < len(restored) and caption_word_match_key(restored[cursor]["word"]) != token:
            cursor += 1
        if cursor >= len(restored):
            raise ValueError("Rechecked narration omitted an original word")
        original_spelling = re.sub(r"\W+", "", str(word["word"]).casefold())
        decoded_spelling = re.sub(r"\W+", "", str(restored[cursor]["word"]).casefold())
        if original_spelling != decoded_spelling:
            # Only the explicit orthographic equivalences above can reach
            # this branch. Keep decoded punctuation and physical timestamps.
            spelling = re.search(r"\w+", str(word["word"])).group(0)
            restored[cursor]["word"] = re.sub(r"\w+", lambda _: spelling,
                                                str(restored[cursor]["word"]), count=1)
        cursor += 1
    return restored


def repair_covered_audio_speech(m, audio_path: str, lang: str, current):
    """Recheck suspicious narration even when a stretched word hides the gap."""
    if not auto_recovery or song_mode:
        return current
    text, detected, segs, words = current
    duration = audio_duration_seconds(audio_path)
    try:
        ranges = suspicious_caption_audio_ranges(words, duration)
    except (KeyError, TypeError, ValueError):
        return current  # Preserve malformed input for the strict final check.
    merged = list(words)
    changed = False
    for start, end in ranges:
        warning = f"Local narration recheck on audio {start:.2f}–{end:.2f}s"
        if end - start > 24.0:
            recovery_warnings.append(warning + " was too broad. Existing captions were retained; review this section.")
            continue
        prefix = [w for w in merged if float(w["end"]) <= start and float(w["start"]) < start]
        suffix = [w for w in merged if float(w["start"]) >= end]
        original = [w for w in merged if w not in prefix and w not in suffix]
        try:
            if not caption_range_has_speech(audio_path, start, end):
                continue
            clip = f"{start:.3f},{end:.3f}"
            first_text, _, _, first = run_whisper_with_model(
                m, audio_path, lang, lenient=False, clip_timestamps=clip)
            second_text, _, _, second = run_whisper_with_model(
                m, audio_path, lang, lenient=True, clip_timestamps=clip)
            normalize = lambda value: re.sub(r"\W+", "", str(value).casefold())
            complete = all(normalize(decoded) == normalize(" ".join(w["word"] for w in candidates))
                           for decoded, candidates in ((first_text, first), (second_text, second)))
            valid = (complete and valid_caption_word_timeline(first, duration)
                     and valid_caption_word_timeline(second, duration)
                     and all(start <= float(w["start"]) < float(w["end"]) <= end for w in second)
                     and caption_word_passes_agree(first, second)
                     and caption_preserves_word_sequence(original, second)
                     and len(filter_recovery_speech(audio_path, second)) == len(second)
                     and not is_repetition_loop(second_text))
            replacement = caption_restore_original_orthography(original, second) if valid else second
            proposal = prefix + replacement + suffix
            if not valid or not valid_caption_word_timeline(proposal, duration):
                recovery_warnings.append(warning + " could not confirm complete words and timing. Existing captions were retained; review this section.")
                continue
        except Exception:
            recovery_warnings.append(warning + " failed. Existing captions were retained; review this section.")
            continue
        if proposal != merged:
            print(f"[Whisper] Narration recheck {start:.1f}s-{end:.1f}s: {len(original)} -> {len(second)} words.", flush=True)
            merged = proposal
            changed = True
    if not changed:
        return current
    return clean(" ".join(w["word"] for w in merged)), detected, caption_segments_from_words(merged), merged


def repair_remaining_audio_gaps(m, audio_path: str, lang: str, current, only_gaps=None):
    """Decode only uncovered ranges and merge genuine recovered words into the timeline."""
    text, detected, segs, words = current
    if not auto_recovery:
        return current
    duration = audio_duration_seconds(audio_path)
    gaps = uncovered_audio_ranges(words, duration) if only_gaps is None else only_gaps
    if not gaps:
        return current

    merged_words = list(words)
    recovered_count = 0
    for gap_start, gap_end in gaps:
        clip_start = max(0.0, gap_start - 0.75)
        clip_end = min(duration, gap_end + 0.75)
        print(
            f"[Whisper] Checking uncovered narration {gap_start:.1f}s-{gap_end:.1f}s...",
            flush=True,
        )
        try:
            if not caption_range_has_speech(audio_path, gap_start, gap_end):
                continue
            gap_text, _, _, gap_words = run_whisper_with_model(
                m, audio_path, lang, lenient=False,
                clip_timestamps=f"{clip_start:.3f},{clip_end:.3f}",
            )
            _, _, _, confirmed_words = run_whisper_with_model(
                m, audio_path, lang, lenient=True,
                clip_timestamps=f"{clip_start:.3f},{clip_end:.3f}",
            )
            # Compare complete phrases within the hole, rather than accepting
            # whichever individual words happen to match two different reads.
            inside = lambda candidate: (gap_start <= float(candidate["start"])
                                        < float(candidate["end"]) <= gap_end)
            gap_words = [word for word in gap_words if inside(word)]
            confirmed_words = [word for word in confirmed_words if inside(word)]
            if not caption_word_passes_agree(gap_words, confirmed_words):
                if gap_words or confirmed_words:
                    recovery_warnings.append(f"Local recovery audio checks disagreed on audio {gap_start:.2f}–{gap_end:.2f}s. Existing captions were retained; review this gap.")
                continue
            supported = filter_recovery_speech(audio_path, gap_words)
            if len(supported) != len(gap_words):
                recovery_warnings.append(f"Local recovery could not confirm all speech on audio {gap_start:.2f}–{gap_end:.2f}s. Existing captions were retained; review this gap.")
                continue
        except Exception:
            print("[Whisper] Gap recovery failed; retaining existing captions. Review this gap.", flush=True)
            recovery_warnings.append(f"Local recovery failed on audio {gap_start:.2f}–{gap_end:.2f}s. Existing captions were retained; review this gap.")
            continue
        accepted = []
        for word in gap_words:
            start = float(word.get("start", 0.0))
            end = float(word.get("end", start))
            if end > start and gap_start <= start and end <= gap_end:
                accepted.append(word)
        if not accepted or (not song_mode and is_repetition_loop(gap_text)):
            continue
        accepted.sort(key=lambda w: float(w.get("start", 0.0)))
        if any(float(left["end"]) > float(right["start"])
               for left, right in zip(accepted, accepted[1:])):
            print("[Whisper] Skipped recovered words with overlapping timing; review this gap.", flush=True)
            recovery_warnings.append(f"Local recovery skipped overlapping word timing on audio {gap_start:.2f}–{gap_end:.2f}s. Review this gap.")
            continue
        recovered_count += len(accepted)
        merged_words.extend(accepted)

    if not recovered_count:
        return current

    merged_words.sort(key=lambda w: (float(w.get("start", 0.0)), float(w.get("end", 0.0))))
    if not valid_caption_word_timeline(merged_words, duration):
        recovery_warnings.append("Local recovered timing was invalid. Existing captions were retained; review the gaps.")
        return current
    # Recovery is restricted to disjoint gaps. Nearby repeated words may be
    # genuine speech, so they must not be removed by a proximity heuristic.
    merged_text = clean(" ".join(str(w.get("word", "")) for w in merged_words))
    print(f"[Whisper] Gap repair recovered {recovered_count} additional words.", flush=True)
    return merged_text, detected, caption_segments_from_words(merged_words), merged_words


def verify_opening_speech(m, audio_path: str, lang: str, current):
    """Recheck the opening using audio, never guessed brand/name replacements."""
    if not auto_recovery or song_mode:
        return current
    text, detected, segments, words = current
    duration = audio_duration_seconds(audio_path)
    boundary = min(12.0, duration)
    for left, right in zip(words, words[1:]):
        if 8.0 <= float(right["start"]) <= 15.0 and float(right["start"]) - float(left["end"]) >= 0.3:
            boundary = (float(left["end"]) + float(right["start"])) / 2
            break
    if boundary <= 0 or any(float(w["start"]) < boundary < float(w["end"]) for w in words):
        return current
    def read(extra):
        _, _, _, decoded = run_whisper_with_model(m, audio_path, lang, lenient=True,
            clip_timestamps=f"0,{min(duration, boundary + extra):.3f}")
        return filter_recovery_speech(audio_path, [w for w in decoded if 0 <= float(w["start"]) < float(w["end"]) <= boundary])
    try:
        first, second = read(0), read(0.25)
        normalize = lambda value: re.sub(r"\W+", "", str(value).lower())
        valid = bool(first) and len(first) == len(second) and all(
            normalize(a["word"]) == normalize(b["word"])
            and abs(float(a["start"]) - float(b["start"])) <= 0.25
            and abs(float(a["end"]) - float(b["end"])) <= 0.25
            for a, b in zip(first, second))
        valid = valid and valid_caption_word_timeline(second, duration)
        if not valid:
            recovery_warnings.append("Local opening audio checks disagreed. Review the opening words and timing.")
            return current
        original = [w for w in words if float(w["end"]) <= boundary]
        later = [w for w in words if float(w["start"]) >= boundary]
        proposal = second + later
        original_tokens = [normalize(w["word"]) for w in original]
        if any(token and token not in "".join(normalize(w["word"]) for w in second) for token in original_tokens):
            # A word timestamped too early may straddle the short clip's
            # boundary after repair. Recheck the following gap as part of
            # this proposal before accepting any replacement.
            gap_start = float(second[-1]["end"])
            gap_end = float(later[0]["start"]) if later else duration
            if gap_end > gap_start:
                candidate = (clean(" ".join(w["word"] for w in proposal)), detected, [], proposal)
                candidate = repair_remaining_audio_gaps(m, audio_path, lang, candidate,
                    only_gaps=[(gap_start, gap_end)])
                proposal = candidate[3]
                second = [w for w in proposal if float(w["start"]) < gap_end]
        corrected_tokens = [normalize(w["word"]) for w in second]
        corrected_text = "".join(corrected_tokens)
        # Agreement between two clips is not proof that every original word
        # was captured. Preserve audio-supported words that both clips omit.
        supported = filter_recovery_speech(audio_path, original)
        cursor = 0
        omitted_speech = False
        for word in supported:
            token = normalize(word["word"])
            position = corrected_text.find(token, cursor) if token else cursor
            if len(token) <= 2:
                # Short words such as "a"/"to" cannot be verified merely
                # because their letters occur inside another decoded word.
                offset = 0
                matches = []
                for candidate in corrected_tokens:
                    if offset >= cursor and candidate == token:
                        matches.append(offset)
                    offset += len(candidate)
                position = matches[0] if matches else -1
            if position < 0:
                omitted_speech = True
                break
            cursor = position + len(token)
        if omitted_speech:
            recovery_warnings.append("Local opening recheck omitted previously detected speech. Existing captions were retained; review the opening.")
            return current
        merged = proposal
        if not valid_caption_word_timeline(merged, duration):
            recovery_warnings.append("Local opening recheck returned invalid timing. Existing captions were retained; review the opening.")
            return current
        return clean(" ".join(w["word"] for w in merged)), detected, caption_segments_from_words(merged), merged
    except Exception:
        recovery_warnings.append("Local opening verification failed. Existing captions were retained; review the opening.")
        return current


def retry_sparse_with_child_speech_mode(m, audio_path: str, lang: str, current):
    """Retry incomplete results without VAD and keep only a demonstrably fuller transcript."""
    if not auto_recovery:
        return current
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
    # Short instructional labels can disappear inside two-second pauses.
    # Ignore ordinary intro silence, but inspect internal and ending gaps.
    suspicious_missing_section = audio_duration > 10.0 and (
        largest_internal_gap > 2.0 or trailing_gap > 3.0 or leading_gap > 8.0
    )
    # Once there is useful speech, the focused opening/gap checks below can
    # recover missing words without replacing the entire transcript or
    # decoding all of the same audio twice.
    if not sparse_word_count:
        return current
    reason = (
        f"{largest_gap:.1f}s uncovered audio section"
        if suspicious_missing_section
        else "too few detected words"
    )
    print(f"[Whisper] Incomplete result ({reason}); retrying without VAD...", flush=True)
    try:
        retry = run_whisper_with_model(m, audio_path, lang, lenient=True)
    except Exception:
        recovery_warnings.append("Local coverage retry failed. Existing captions were retained; review any missing speech.")
        return current
    retry_text, _, _, retry_words = retry
    timing_valid = valid_caption_word_timeline(retry_words, audio_duration)
    normalize = lambda value: re.sub(r"\W+", "", str(value).lower())
    # A more verbose decode can be hallucinated. Existing words must still
    # have the same audio anchors; new words need acoustic speech support.
    preserves_original = timing_valid and all(any(normalize(word["word"]) == normalize(candidate["word"])
        and abs(float(word["start"]) - float(candidate["start"])) <= 0.35
        and abs(float(word["end"]) - float(candidate["end"])) <= 0.35
        for candidate in retry_words) for word in words)
    try:
        speech_supported = song_mode or len(filter_recovery_speech(audio_path, retry_words)) == len(retry_words)
    except Exception:
        recovery_warnings.append("Local coverage audio check failed. Existing captions were retained; review any missing speech.")
        return current
    if timing_valid and preserves_original and speech_supported and (song_mode or not is_repetition_loop(retry_text)) and len(retry_words) > len(words):
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


INDIC_SR_LANG_MAP = {
    "te": "te-IN",
    "hi": "hi-IN",
    "ta": "ta-IN",
    "kn": "kn-IN",
    "ml": "ml-IN",
    "mr": "mr-IN",
    "bn": "bn-IN",
    "gu": "gu-IN",
    "pa": "pa-IN",
    "ur": "ur-IN",
}


def transcribe_indic_with_vad_speech_recognition(audio_path: str, lang_code: str):
    """Fast, accurate VAD-bounded speech recognition for Indic languages where small CPU Whisper loops."""
    import concurrent.futures
    import speech_recognition as sr

    sr_lang = INDIC_SR_LANG_MAP.get(str(lang_code or "").lower().strip(), "te-IN")
    duration = audio_duration_seconds(audio_path)
    if duration <= 0:
        return "", lang_code, [], []

    try:
        raw_ranges = caption_speech_ranges(audio_path)
    except Exception:
        raw_ranges = []

    if not raw_ranges:
        step = 10.0
        raw_ranges = [
            (round(i * step, 3), round(min(duration, (i + 1) * step), 3))
            for i in range(max(1, int(math.ceil(duration / step))))
        ]

    merged_ranges = []
    for start, end in raw_ranges:
        start = max(0.0, float(start))
        end = min(duration, float(end))
        if end <= start:
            continue
        if merged_ranges and (start - merged_ranges[-1][1] < 0.35) and (end - merged_ranges[-1][0] <= 10.0):
            merged_ranges[-1] = (merged_ranges[-1][0], end)
        else:
            merged_ranges.append((start, end))

    windows = []
    for start, end in merged_ranges:
        cursor = start
        while end - cursor > 12.0:
            windows.append((round(cursor, 3), round(cursor + 10.0, 3)))
            cursor += 10.0
        if end > cursor:
            windows.append((round(cursor, 3), round(end, 3)))

    if not windows:
        return "", lang_code, [], []

    with wave.open(audio_path, "rb") as wf:
        rate = wf.getframerate()
        sampwidth = wf.getsampwidth()
        total_frames = wf.getnframes()
        raw_pcm = wf.readframes(total_frames)

    bytes_per_frame = sampwidth
    window_audio = []
    for idx, (start, end) in enumerate(windows):
        f0 = max(0, min(total_frames, int(start * rate)))
        f1 = max(f0, min(total_frames, int(end * rate)))
        chunk_bytes = raw_pcm[f0 * bytes_per_frame : f1 * bytes_per_frame]
        window_audio.append((idx, start, end, chunk_bytes, rate, sampwidth))

    def recognize_window(item):
        idx, start, end, chunk_bytes, rate, sampwidth = item
        if not chunk_bytes:
            return idx, start, end, ""
        recognizer = sr.Recognizer()
        audio_data = sr.AudioData(chunk_bytes, rate, sampwidth)
        for attempt in range(2):
            try:
                text = recognizer.recognize_google(audio_data, language=sr_lang)
                return idx, start, end, clean(str(text or ""))
            except sr.UnknownValueError:
                return idx, start, end, ""
            except Exception:
                if attempt == 0:
                    continue
                return idx, start, end, ""
        return idx, start, end, ""

    print(f"[Whisper] Running VAD-guided Indic speech recognition ({sr_lang}) across {len(window_audio)} speech windows...", flush=True)
    decoded_windows = [None] * len(window_audio)
    completed = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(recognize_window, item) for item in window_audio]
        for fut in concurrent.futures.as_completed(futures):
            idx, start, end, w_text = fut.result()
            decoded_windows[idx] = (start, end, w_text)
            completed += 1
            pct = min(95, max(12, int((completed / len(window_audio)) * 90)))
            print(f"PROGRESS:{pct}", flush=True)

    words = []
    prev_end = 0.0
    max_dur = round(float(duration), 3)
    for item in decoded_windows:
        if not item:
            continue
        start, end, w_text = item
        tokens = [tok.strip() for tok in w_text.split() if tok.strip()]
        if not tokens:
            continue
        win_start = max(prev_end, round(float(start), 3))
        win_end = min(max_dur, round(float(end), 3))
        if win_end <= win_start + 0.02 * len(tokens):
            win_end = min(max_dur, round(win_start + 0.05 * len(tokens), 3))
        if win_end <= win_start:
            continue
        span = win_end - win_start
        weights = [max(1, len(tok)) for tok in tokens]
        total_weight = sum(weights)
        acc = 0
        for i, (tok, weight) in enumerate(zip(tokens, weights)):
            w_s = round(win_start + (acc / total_weight) * span, 3)
            acc += weight
            w_e = win_end if i == len(tokens) - 1 else round(win_start + (acc / total_weight) * span, 3)
            if w_s < prev_end:
                w_s = prev_end
            if w_e <= w_s:
                w_e = round(min(win_end, w_s + 0.01), 3)
            if w_e > w_s:
                words.append({"word": tok, "start": w_s, "end": w_e})
                prev_end = w_e

    if not words or not valid_caption_word_timeline(words, duration):
        return "", lang_code, [], []

    full_text = clean(" ".join(w["word"] for w in words))
    segs = caption_segments_from_words(words)
    return full_text, lang_code, segs, words


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
        
        if not song_mode and lang_hint in INDIC_SR_LANG_MAP:
            del m
            text, lang, segs, words = transcribe_indic_with_vad_speech_recognition(norm_path, lang_hint)
            if not words or len(text.strip()) < 3:
                print(f"[Whisper] Indic speech recognition returned empty; falling back to 'small' model in {lang_hint}...", flush=True)
                m_small = get_whisper_model("small")
                text, lang, segs, words = run_whisper_with_model(m_small, norm_path, lang_hint)
                text, lang, segs, words = retry_sparse_with_child_speech_mode(
                    m_small, norm_path, lang_hint, (text, lang, segs, words)
                )
                text, lang, segs, words = repair_covered_audio_speech(m_small, norm_path, lang_hint, (text, lang, segs, words))
                text, lang, segs, words = verify_opening_speech(m_small, norm_path, lang_hint, (text, lang, segs, words))
                text, lang, segs, words = repair_remaining_audio_gaps(m_small, norm_path, lang_hint, (text, lang, segs, words))
        elif transcribe_model_size == "tiny":
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
            text, lang, segs, words = repair_covered_audio_speech(m_small, norm_path, lang_hint, (text, lang, segs, words))
            text, lang, segs, words = verify_opening_speech(m_small, norm_path, lang_hint, (text, lang, segs, words))
            text, lang, segs, words = repair_remaining_audio_gaps(m_small, norm_path, lang_hint, (text, lang, segs, words))
    else:
        primary_model = "small"
        fallback_model = "tiny"
        
        if not song_mode and lang_hint in INDIC_SR_LANG_MAP:
            text, lang, segs, words = transcribe_indic_with_vad_speech_recognition(norm_path, lang_hint)
        else:
            text, lang, segs, words = "", lang_hint, [], []

        if not words or len(text.strip()) < 3:
            # Pass 1: use primary model
            primary = get_whisper_model(primary_model)
            text, lang, segs, words = run_whisper_with_model(primary, norm_path, lang_hint)
            text, lang, segs, words = retry_sparse_with_child_speech_mode(
                primary, norm_path, lang_hint, (text, lang, segs, words)
            )
            text, lang, segs, words = repair_covered_audio_speech(primary, norm_path, lang_hint, (text, lang, segs, words))
            text, lang, segs, words = verify_opening_speech(primary, norm_path, lang_hint, (text, lang, segs, words))
            text, lang, segs, words = repair_remaining_audio_gaps(primary, norm_path, lang_hint, (text, lang, segs, words))
            
            # Pass 2: if it failed/empty, try fallback model
            if (not song_mode and is_repetition_loop(text)) or len(text.strip()) < 3:
                try:
                    text2, lang2, segs2, words2 = run_whisper(fallback_model, norm_path, lang_hint)
                    if not is_repetition_loop(text2) and len(text2.strip()) >= 3:
                        text, lang, segs, words = text2, lang2, segs2, words2
                except Exception:
                    pass

    # Keep only decoded speech. Never reconstruct lyrics from a filename and
    # guessed timing: the recording may use a different version or omit lines.

    # Return result — even empty text is valid (video has no recognisable speech)
    print(json.dumps({
        "text":     text,
        "language": lang,
        "segments": segs,
        "words":    words,
        "warnings": recovery_warnings,
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

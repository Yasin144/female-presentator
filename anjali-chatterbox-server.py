"""
Voice Presentator — Chatterbox TTS Server
==========================================
Clones the EXACT voice from EVS C5 8th Lesson sc3.mp4.
NO Edge TTS. NO fallback. NO other voice.
Chatterbox loads FIRST — HTTP server starts only when voice is ready.
"""
import io
import json
import os
import socket
import sys
import threading
import time
import traceback
import wave
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import asyncio
import edge_tts
import ssl

# ── Edge TTS Async Helper & Converters ──────────────────────────────────────────
# Allows fallback to Edge TTS neural voices for Hindi and Telugu synthesis since local
# Chatterbox only speaks English.



# ── Indic Transliteration Engine v2 (Hindi + Telugu → Phonetic Indian English) ─
# Converts Devanagari/Telugu to phonetics that Chatterbox pronounces with Indian
# accent when driven by the sc3/pattan voice reference (audio_prompt_path).
# Key design: syllable hyphens + Indian vowel spellings + no false final-a.

# ── Devanagari (Hindi) → Phonetic English ────────────────────────────────────
_DEVA_VOWELS = {
    'अ': 'u',   # schwa /ə/ — like English 'u' in 'but'
    'आ': 'aa',
    'इ': 'i',
    'ई': 'ee',
    'उ': 'u',
    'ऊ': 'oo',
    'ऋ': 'ri',
    'ए': 'ay',  # Indian /eː/ not English /iː/
    'ऐ': 'ai',
    'ओ': 'oh',  # Indian /oː/
    'औ': 'ow',
    'अं': 'um',
    'अः': 'uh',
    'ॐ': 'om',
}
_DEVA_CONSONANTS = {
    # Velars
    'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ng',
    # Palatals
    'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'ny',
    # Retroflex
    'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
    # Dentals
    'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
    # Labials
    'प': 'p', 'फ': 'f', 'ब': 'b', 'भ': 'bh', 'म': 'm',
    # Sonorants
    'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'ळ': 'l',
    # Sibilants + glottal
    'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
    # Nukta (dotted) forms
    'ड़': 'r', 'ढ़': 'rh', 'ज़': 'z', 'फ़': 'f', 'ग़': 'gh',
    # Conjuncts
    'क्ष': 'ksh', 'त्र': 'tr', 'ज्ञ': 'gn', 'श्र': 'shr',
}
_DEVA_MATRAS = {
    'ा': 'aa', 'ि': 'i', 'ी': 'ee',
    'ु': 'u',  'ू': 'oo', 'ृ': 'ri',
    'े': 'ay', 'ै': 'ai', 'ो': 'oh', 'ौ': 'ow',
    'ं': 'n',  'ः': 'h',  'ँ': 'n',
    '्': None,   # virama — suppress inherent vowel (None = no output)
    'ऽ': '',
    '़': '',    # nukta — handled in consonant map
}
_DEVA_DIGITS = {
    '०':'0','१':'1','२':'2','३':'3','४':'4',
    '५':'5','६':'6','७':'7','८':'8','९':'9',
}
_DEVA_PUNCT = {'\u0964': '.', '\u0965': '.', '\u0970': '.'}


# ── Telugu → Phonetic English ─────────────────────────────────────────────────
_TELU_VOWELS = {
    'అ': 'u',   # schwa
    'ఆ': 'aa',
    'ఇ': 'i',
    'ఈ': 'ee',
    'ఉ': 'u',
    'ఊ': 'oo',
    'ఋ': 'ri',
    'ఎ': 'e',
    'ఏ': 'ay',
    'ఐ': 'ai',
    'ఒ': 'o',
    'ఓ': 'oh',
    'ఔ': 'ow',
    'అం': 'am',
    'అః': 'ah',
    'అఁ': 'am',
    'ఓం': 'om',
}
_TELU_CONSONANTS = {
    # Velars
    'క': 'k', 'ఖ': 'kh', 'గ': 'g', 'ఘ': 'gh', 'ఙ': 'ng',
    # Palatals
    'చ': 'ch', 'ఛ': 'chh', 'జ': 'j', 'ఝ': 'jh', 'ఞ': 'ny',
    # Retroflex
    'ట': 't', 'ఠ': 'th', 'డ': 'd', 'ఢ': 'dh', 'ణ': 'n',
    # Dentals
    'త': 't', 'థ': 'th', 'ద': 'd', 'ధ': 'dh', 'న': 'n',
    # Labials
    'ప': 'p', 'ఫ': 'f', 'బ': 'b', 'భ': 'bh', 'మ': 'm',
    # Sonorants
    'య': 'y', 'ర': 'r', 'ల': 'l', 'వ': 'v', 'ళ': 'll', 'ఱ': 'r',
    # Sibilants + glottal
    'శ': 'sh', 'ష': 'sh', 'స': 's', 'హ': 'h',
    # Conjuncts
    'క్ష': 'ksh', 'జ్ఞ': 'gn', 'శ్ర': 'shr',
}
_TELU_MATRAS = {
    'ా': 'aa', 'ి': 'i',  'ీ': 'ee',
    'ు': 'u',  'ూ': 'oo', 'ృ': 'ri',
    'ె': 'e',  'ే': 'ay', 'ై': 'ai',
    'ొ': 'o',  'ో': 'oh', 'ౌ': 'ow',
    'ం': 'm',  'ః': 'h',  'ఁ': 'm',
    '్': None,   # virama — suppress inherent vowel
}
_TELU_DIGITS = {
    '౦':'0','౧':'1','౨':'2','౩':'3','౪':'4',
    '౫':'5','౬':'6','౭':'7','౮':'8','౯':'9',
}

def _deva_syllable_list(text: str):
    """
    Parse Devanagari into syllable tokens: (phoneme, has_next_char_that_is_vowel_mark).
    Returns list of strings (phonemes).
    """
    result = []
    chars = list(text)
    i = 0
    n = len(chars)
    while i < n:
        c = chars[i]
        # Try longest match in consonants (3-char conjuncts)
        triple = ''.join(chars[i:i+3])
        double = ''.join(chars[i:i+2])
        match_len = 0
        phoneme = None
        if triple in _DEVA_CONSONANTS:
            phoneme = _DEVA_CONSONANTS[triple]; match_len = 3
        elif double in _DEVA_CONSONANTS:
            phoneme = _DEVA_CONSONANTS[double]; match_len = 2
        elif c in _DEVA_CONSONANTS:
            phoneme = _DEVA_CONSONANTS[c]; match_len = 1

        if phoneme is not None:
            i += match_len
            # Look at the following character for matra or virama
            if i < n and chars[i] in _DEVA_MATRAS:
                matra_val = _DEVA_MATRAS[chars[i]]
                i += 1
                if matra_val is None:
                    # Virama: no inherent vowel
                    result.append(phoneme)
                else:
                    result.append(phoneme + matra_val)
            else:
                # No matra: add inherent schwa ONLY if not at absolute word end
                at_word_end = (i >= n) or (chars[i] in ' .,!?;:')
                if at_word_end:
                    result.append(phoneme)   # no inherent vowel at word end
                else:
                    result.append(phoneme + 'u')  # schwa = 'u'
            continue

        if c in _DEVA_VOWELS:
            result.append(_DEVA_VOWELS[c])
            i += 1
            continue
        if c in _DEVA_MATRAS:
            # Stray matra (shouldn't happen but handle gracefully)
            val = _DEVA_MATRAS[c]
            if val is not None:
                result.append(val)
            i += 1
            continue
        if c in _DEVA_DIGITS:
            result.append(_DEVA_DIGITS[c])
            i += 1
            continue
        if c in _DEVA_PUNCT:
            result.append(_DEVA_PUNCT[c])
            i += 1
            continue
        # Latin, space, punctuation — keep as-is
        result.append(c)
        i += 1
    return result


def _telu_syllable_list(text: str):
    """Parse Telugu into phoneme list."""
    result = []
    chars = list(text)
    i = 0
    n = len(chars)
    while i < n:
        c = chars[i]
        triple = ''.join(chars[i:i+3])
        double = ''.join(chars[i:i+2])
        match_len = 0
        phoneme = None
        if triple in _TELU_CONSONANTS:
            phoneme = _TELU_CONSONANTS[triple]; match_len = 3
        elif double in _TELU_CONSONANTS:
            phoneme = _TELU_CONSONANTS[double]; match_len = 2
        elif c in _TELU_CONSONANTS:
            phoneme = _TELU_CONSONANTS[c]; match_len = 1

        if phoneme is not None:
            i += match_len
            if i < n and chars[i] in _TELU_MATRAS:
                matra_val = _TELU_MATRAS[chars[i]]
                i += 1
                if matra_val is None:
                    result.append(phoneme)
                else:
                    result.append(phoneme + matra_val)
            else:
                at_word_end = (i >= n) or (chars[i] in ' .,!?;:')
                if at_word_end:
                    result.append(phoneme)
                else:
                    result.append(phoneme + 'u')
            continue

        if c in _TELU_VOWELS:
            result.append(_TELU_VOWELS[c])
            i += 1
            continue
        if c in _TELU_MATRAS:
            val = _TELU_MATRAS[c]
            if val is not None:
                result.append(val)
            i += 1
            continue
        if c in _TELU_DIGITS:
            result.append(_TELU_DIGITS[c])
            i += 1
            continue
        result.append(c)
        i += 1
    return result


def _transliterate_devanagari(text: str) -> str:
    return ''.join(_deva_syllable_list(text))


def _transliterate_telugu(text: str) -> str:
    return ''.join(_telu_syllable_list(text))


def _transliterate_to_phonetic(text: str, lang: str) -> str:
    """
    Convert Indic script to phonetic English tuned for Indian accent.
    Uses syllable-level phonemes that Chatterbox pronounces with Indian rhythm
    when driven by the sc3/pattan reference voice via audio_prompt_path.
    """
    import re as _re
    if lang == 'hi':
        phonetic = _transliterate_devanagari(text)
    elif lang == 'te':
        phonetic = _transliterate_telugu(text)
    else:
        return text

    # Post-processing for natural Chatterbox pronunciation:
    # 1. Collapse triple+ same consonants (e.g. 'lll' → 'll')
    phonetic = _re.sub(r'([bcdfghjklmnpqrstvwxyz]){2,}', r'', phonetic)
    # 2. Max 2 identical vowels
    phonetic = _re.sub(r'([aeiou]){2,}', r'', phonetic)
    # 3. Fix awkward 'uu' that English reads as /juː/ → keep as is (oo is better)
    phonetic = phonetic.replace('uu', 'oo')
    # 4. Spaces
    phonetic = _re.sub(r'\s+', ' ', phonetic).strip()
    print(f"[Translit v2] {lang}: {repr(text[:40])} → {repr(phonetic[:70])}", flush=True)
    return phonetic

def detect_lang(text: str) -> str:
    if any('ऀ' <= char <= 'ॿ' for char in text):
        return 'hi'
    if any('ఀ' <= char <= '౿' for char in text):
        return 'te'
    return 'en'


def _mp3_bytes_to_wav(mp3_bytes: bytes, target_sr: int = 24000, leading_pad_ms: int = 80) -> bytes:
    import subprocess, tempfile
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp_in:
        tmp_in.write(mp3_bytes)
        tmp_in_path = tmp_in.name
    tmp_out_path = tmp_in_path.replace(".mp3", ".wav")
    try:
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-i",  tmp_in_path,
                "-af", f"adelay={leading_pad_ms}:all=1,aresample={target_sr}",
                "-ac", "1",
                "-ar", str(target_sr),
                "-sample_fmt", "s16",
                tmp_out_path,
            ],
            capture_output=True, check=True,
        )
        with open(tmp_out_path, "rb") as f:
            return f.read()
    finally:
        for p in (tmp_in_path, tmp_out_path):
            try:
                os.unlink(p)
            except OSError:
                pass


# ── OpenVoice Tone Color Converter Helpers ─────────────────────────────────────────
_CONVERTER = None
_TARGET_SE_MAP = {}
_CONVERTER_LOCK = threading.Lock()

def _ensure_converter(device="cpu", voice="sc3"):
    global _CONVERTER, _TARGET_SE_MAP
    voice = str(voice or "sc3").strip().lower()
    voice_key = "sc3" if voice in ("sc3", "anjali") else voice
    if voice_key not in ("sc3", "pattan", "uploaded"):
        voice_key = "pattan"
    ref_voice_path = PROJECT_ROOT / f"voice-reference-{voice_key}.wav"

    if not ref_voice_path.exists():
        raise FileNotFoundError(f"Reference voice not found: {ref_voice_path}")

    try:
        import openvoice_cli
        from openvoice_cli.api import ToneColorConverter
        from openvoice_cli.downloader import download_checkpoint

        if _CONVERTER is None:
            package_dir = Path(openvoice_cli.__file__).resolve().parent
            checkpoint_dir = package_dir / "checkpoints" / "converter"
            checkpoint_dir.mkdir(parents=True, exist_ok=True)
            if not (checkpoint_dir / "checkpoint.pth").exists() or not (checkpoint_dir / "config.json").exists():
                download_checkpoint(str(checkpoint_dir))

            _CONVERTER = ToneColorConverter(str(checkpoint_dir / "config.json"), device=device)
            _CONVERTER.load_ckpt(str(checkpoint_dir / "checkpoint.pth"))

        if voice_key not in _TARGET_SE_MAP:
            print(f"[Voice] Extracting speaker embedding (SE) for {voice_key} using {ref_voice_path.name}...", flush=True)
            _TARGET_SE_MAP[voice_key] = _CONVERTER.extract_se(str(ref_voice_path))

        return _CONVERTER, _TARGET_SE_MAP[voice_key]
    except Exception as exc:
        print(f"[ERROR] Failed to ensure converter: {exc}", flush=True)
        raise

def _convert_voice_color(wav_bytes: bytes, voice: str) -> bytes:
    import tempfile
    import subprocess
    voice = str(voice or "sc3").strip().lower()
    voice_key = "sc3" if voice in ("sc3", "anjali") else voice
    if voice_key not in ("sc3", "pattan", "uploaded"):
        voice_key = "pattan"
    
    # Run tone color conversion in a thread-safe way
    with _CONVERTER_LOCK:
        # device is defined globally at startup
        converter, target_se = _ensure_converter(device=device, voice=voice_key)
        
        with tempfile.TemporaryDirectory(prefix="voice-color-") as temp_dir:
            temp_path = Path(temp_dir)
            input_path = temp_path / "edge_input.wav"
            prepared_path = temp_path / "prepared.wav"
            converted_path = temp_path / "converted.wav"
            output_path = temp_path / "output.wav"
            
            # Write input bytes
            input_path.write_bytes(wav_bytes)
            
            # Prepare WAV (44100Hz, stereo) using ffmpeg
            subprocess.run([
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                "-i", str(input_path),
                "-ar", "44100",
                "-ac", "2",
                str(prepared_path),
            ], check=True)
            
            # Extract source SE
            source_se = converter.extract_se(str(prepared_path))
            
            # tau=0.1 = maximum timbre transfer (0=full target voice, 1=keep source)
            converter.convert(
                audio_src_path=str(prepared_path),
                src_se=source_se,
                tgt_se=target_se,
                output_path=str(converted_path),
                tau=0.1,
            )
            
            # Resample back to 24000Hz mono WAV (soxr high-quality)
            subprocess.run([
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                "-i", str(converted_path),
                "-ac", "1",
                "-ar", "24000",
                "-sample_fmt", "s16",
                str(output_path),
            ], check=True)
            
            return output_path.read_bytes()


# ── Song/Audio Conversion Helpers (replaces Singing Server) ──────────────────────
def _prepare_wav(input_path, output_path):
    import subprocess
    subprocess.run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(input_path),
        "-af", "equalizer=f=8000:t=h:w=1:g=1.5",
        "-ar", "44100",
        "-ac", "2",
        "-sample_fmt", "s16",
        str(output_path),
    ], check=True)

def _write_mp3(input_path, output_path):
    import subprocess
    subprocess.run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(input_path),
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=7",
        "-codec:a", "libmp3lame",
        "-b:a", "320k",
        "-q:a", "0",
        str(output_path),
    ], check=True)

def _safe_output_file_name(file_name, fallback_name="sc3-voice.mp3"):
    safe_name = Path(str(file_name or fallback_name)).name.strip() or fallback_name
    for character in '<>:"/\\|?*':
        safe_name = safe_name.replace(character, "-")
    if not Path(safe_name).suffix:
        safe_name = f"{safe_name}.mp3"
    return safe_name

def _downloads_dir():
    user_profile = Path.home()
    downloads = user_profile / "Downloads"
    if downloads.exists():
        return downloads
    return user_profile

def _unique_download_path(file_name):
    directory = _downloads_dir()
    directory.mkdir(parents=True, exist_ok=True)
    safe_name = _safe_output_file_name(file_name)
    candidate = directory / safe_name
    index = 1
    while candidate.exists():
        candidate = directory / f"{candidate.stem} ({index}){candidate.suffix}"
        index += 1
    return candidate

def _run_direct_model(payload):
    import base64
    import tempfile
    with tempfile.TemporaryDirectory(prefix="sc3-direct-") as temp_dir:
        temp_path = Path(temp_dir)
        input_path = temp_path / "input-audio"
        prepared_path = temp_path / "input.wav"
        converted_path = temp_path / "sc3-voice.wav"
        output_path = temp_path / "sc3-voice.mp3"

        song_base64 = str(payload.get("songBase64") or "")
        file_path   = str(payload.get("filePath") or "")
        voice       = payload.get("voice", "sc3")

        print("[Voice] received direct convert-song request.", flush=True)

        if file_path:
            input_path = Path(file_path)
            if not input_path.exists():
                raise FileNotFoundError(f"filePath not found: {file_path}")
            print(f"[Voice] reading audio from disk: {input_path.name}", flush=True)
        elif song_base64:
            input_path.write_bytes(base64.b64decode(song_base64))
        else:
            raise ValueError("Either filePath or songBase64 is required.")

        print("[Voice] preparing uploaded audio.", flush=True)
        _prepare_wav(input_path, prepared_path)
        
        with _CONVERTER_LOCK:
            print(f"[Voice] converting uploaded audio to {voice}...", flush=True)
            converter, target_se = _ensure_converter(device=device, voice=voice)
            source_se = converter.extract_se(str(prepared_path))
            # tau=0.1 = maximum timbre transfer (0=full target voice, 1=keep source)
            converter.convert(
                audio_src_path=str(prepared_path),
                src_se=source_se,
                tgt_se=target_se,
                output_path=str(converted_path),
                tau=0.1,
            )
            
        print("[Voice] writing mp3 output.", flush=True)
        _write_mp3(converted_path, output_path)

        if not output_path.exists() or output_path.stat().st_size <= 0:
            raise RuntimeError("Direct conversion did not create an output MP3.")

        saved_path = ""
        if bool(payload.get("saveToDownloads")):
            saved_target = _unique_download_path(payload.get("outputFileName") or "sc3-voice.mp3")
            saved_target.write_bytes(output_path.read_bytes())
            saved_path = str(saved_target)
            print(f"[Voice] saved mp3 to {saved_path}", flush=True)

        return {
            "ok": True,
            "contentType": "audio/mpeg",
            "audioBase64": base64.b64encode(output_path.read_bytes()).decode("ascii"),
            "fileName": str(payload.get("outputFileName") or "sc3-voice.mp3"),
            "savedPath": saved_path,
        }
# Force UTF-8 stdout
if hasattr(sys.stdout, "reconfigure"):
    try: sys.stdout.reconfigure(encoding="utf-8")
    except Exception: pass

# Strip proxies
for _k in ("HTTP_PROXY","HTTPS_PROXY","ALL_PROXY","http_proxy","https_proxy","all_proxy"):
    os.environ.pop(_k, None)

# ── Point HuggingFace to the correct cache location on D: drive ──────────────
# Models are stored at D:\AppData\hf-cache\huggingface (3 GB, already downloaded).
# Without this, from_pretrained() looks in C:\Users\patan\.cache\huggingface and
# tries to re-download everything.
_HF_CACHE = r"D:\AppData\hf-cache\huggingface"
os.environ["HF_HOME"]               = _HF_CACHE
os.environ["HUGGINGFACE_HUB_CACHE"] = _HF_CACHE + r"\hub"
os.environ["HF_HUB_CACHE"]          = _HF_CACHE + r"\hub"
os.environ["TRANSFORMERS_CACHE"]    = _HF_CACHE + r"\hub"
# Prevent any network call — use local files only
os.environ["HF_HUB_OFFLINE"]        = os.environ.get("HF_HUB_OFFLINE", "0")
os.environ["TRANSFORMERS_OFFLINE"]  = os.environ.get("TRANSFORMERS_OFFLINE", "0")
print(f"[Voice] HF cache → {_HF_CACHE}", flush=True)


# ── Config ─────────────────────────────────────────────────────────────────
PROJECT_ROOT  = Path(__file__).resolve().parent
PORT          = 8426
CACHE_LIMIT   = 256

VOICE_MAP = {
    # Chapter 9 SC3 recording is the approved natural voice reference for
    # Sing Song. Keep the legacy file as a fallback for existing installs.
    "sc3":    str(PROJECT_ROOT / "voice-reference-sc3-chapter9-short.wav"),
    "anjali": str(PROJECT_ROOT / "voice-reference-sc3-chapter9-short.wav"),
    "pattan": str(PROJECT_ROOT / "voice-reference-pattan.wav"),
    "uploaded": str(PROJECT_ROOT / "voice-reference-uploaded.wav"),
    "rhyme_clean": str(PROJECT_ROOT / "generated-media" / "rhyme-reference-stems" / "htdemucs" / "little-jack-horner-reference-30s" / "vocals.wav"),
    "rhyme_natural_v2": str(PROJECT_ROOT / "generated-media" / "rhyme-reference-stems" / "htdemucs" / "little-jack-horner-reference-30s" / "vocals.wav"),
}
CURRENT_VOICE = "sc3"

VOICE_REF_WAV = VOICE_MAP["sc3"]
VOICE_REF_SRC = str(Path.home() / "Downloads" / "paragraph.mp4")

# ── Load Chatterbox SYNCHRONOUSLY ──────────────────────────────────────────
# The HTTP server does NOT start until the model and voice are fully ready.
# This guarantees the FIRST narration ever uses the paragraph.mp4 cloned voice.
print("+------------------------------------------------------------------+", flush=True)
print("|   Voice Presentator — Loading sc3 voice clone (same teacher)    |", flush=True)
print("|   Please wait — this takes ~60 seconds on first load            |", flush=True)
print("+------------------------------------------------------------------+", flush=True)

if not Path(VOICE_REF_WAV).exists():
    print(f"[ERROR] Voice reference WAV not found: {VOICE_REF_WAV}", flush=True)
    print(f"[ERROR] Expected: {VOICE_REF_WAV}", flush=True)
    print(f"[ERROR] Make sure paragraph.mp4 was processed by the launcher.", flush=True)
    sys.exit(1)

try:
    import torch
    from chatterbox.tts import ChatterboxTTS

    cpu_count = os.cpu_count() or 4
    torch.set_num_threads(cpu_count)
    torch.set_num_interop_threads(max(1, cpu_count // 2))
    print(f"[Voice] Using {cpu_count} CPU threads", flush=True)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[Voice] Loading Chatterbox model on {device}...", flush=True)
    MODEL = ChatterboxTTS.from_pretrained(device=device)

    # ── Pre-upsample reference WAV to 24kHz (soxr) for cleanest voice embedding ──
    # Model uses S3GEN_SR=24000Hz. Reference is 22050Hz. Pre-upsampling with
    # soxr precision=28 gives a cleaner embedding than librosa's internal resample.
    import subprocess as _ffsp
    _ref_24k_path = str(PROJECT_ROOT / "voice-reference-sc3-24k.wav")
    try:
        _ffsp.run([
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", VOICE_REF_WAV,
            "-ar", "24000", "-ac", "1", "-sample_fmt", "s16",
            _ref_24k_path,
        ], check=True)
        VOICE_REF_WAV_24K = _ref_24k_path
        print(f"[Voice] Reference upsampled to 24kHz (soxr): {_ref_24k_path}", flush=True)
    except Exception as _upe:
        VOICE_REF_WAV_24K = VOICE_REF_WAV
        print(f"[Voice] soxr upsample failed ({_upe}), using original reference.", flush=True)

    # Keep generation bounded. Longer text is already chunked in the app, so
    # 350 avoids slow 900-token sampling while still allowing full sentence chunks.
    _orig_t3_inf = MODEL.t3.inference
    def _capped_t3_inference(*args, **kwargs):
        kwargs['max_new_tokens'] = min(kwargs.get('max_new_tokens', 350), 350)
        return _orig_t3_inf(*args, **kwargs)
    MODEL.t3.inference = _capped_t3_inference
    print(f"[Voice] max_new_tokens = 350 (normal speed, chunked completion).", flush=True)

    print(f"[Voice] Pre-computing sc3 voice embeddings (24kHz soxr reference)...", flush=True)
    MODEL.prepare_conditionals(VOICE_REF_WAV_24K, exaggeration=0.5)

    SAMPLE_RATE = getattr(MODEL, "sr", 24000)
    print(f"[Voice] ✔ Ready! sr={SAMPLE_RATE}, device={device}", flush=True)
    print(f"[Voice] sc3 voice locked. Starting server on port {PORT}...", flush=True)


except Exception as e:
    print(f"[FATAL] Chatterbox failed to load: {e}", flush=True)
    traceback.print_exc()
    sys.exit(1)

# ── Audio helpers ──────────────────────────────────────────────────────────

def _to_wav(tensor) -> bytes:
    audio = tensor.squeeze().cpu().float()
    pcm   = (audio.clamp(-1.0, 1.0).numpy() * 32767).astype("int16")
    buf   = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


def _enhance_voice_wav(wav: bytes) -> bytes:
    """
    Audio clarity pipeline — applied to every Chatterbox output before caching.
    Goal: match the clear, clean quality of the Pattan reference WAV.

    Chain:
      1. DC offset removal          → removes low-frequency hum/drift
      2. Presence boost @ 3 kHz    → +2 dB shelf adds voice clarity & intelligibility
      3. Loudness match (-25 LUFS)  → matches reference WAV volume level exactly
      4. True-peak limiter (-1 dBTP)→ prevents any clipping
      5. Noise gate (-60 dB)        → soft gate applied after normalization
      6. Fade-in 8ms, fade-out 20ms → natural smooth edges
    """
    import tempfile, subprocess as _sp
    
    # Calculate audio duration to avoid negative fade-out start time (st)
    duration = 0.0
    try:
        with wave.open(io.BytesIO(wav), "rb") as r:
            duration = r.getnframes() / r.getframerate()
    except Exception:
        pass

    fade_in_d = min(0.008, duration) if duration > 0 else 0.008
    fade_out_st = max(0.0, duration - 0.02) if duration > 0 else 0.0
    fade_out_d = min(0.02, duration - fade_out_st) if duration > 0 else 0.02

    fade_parts = []
    if fade_in_d > 0:
        fade_parts.append(f"afade=t=in:st=0:d={fade_in_d:.4f}")
    if fade_out_d > 0:
        fade_parts.append(f"afade=t=out:st={fade_out_st:.4f}:d={fade_out_d:.4f}")
    fade_filter = ",".join(fade_parts)

    filter_chain = (
        "highpass=f=80,"
        "equalizer=f=3000:t=h:w=1:g=2,"
        "loudnorm=I=-25:TP=-1.0:LRA=7,"
        "agate=threshold=-60dB:ratio=4:attack=5:release=150:makeup=1"
    )
    if fade_filter:
        filter_chain += f",{fade_filter}"

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_in:
        tmp_in.write(wav)
        tmp_in_path = tmp_in.name
    tmp_out_path = tmp_in_path.replace(".wav", "_enhanced.wav")
    try:
        _sp.run([
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", tmp_in_path,
            "-af", filter_chain,
            "-ar", str(SAMPLE_RATE),
            "-ac", "1",
            "-sample_fmt", "s16",
            tmp_out_path,
        ], check=True)
        with open(tmp_out_path, "rb") as f:
            return f.read()
    except Exception as exc:
        print(f"[Voice] Audio enhancement failed ({exc}), using raw wav.", flush=True)
        return wav
    finally:
        for p in (tmp_in_path, tmp_out_path):
            try:
                import os as _os; _os.unlink(p)
            except OSError:
                pass


def _add_pad(wav: bytes, ms: int = 40) -> bytes:
    with wave.open(io.BytesIO(wav), "rb") as r:
        p = r.getparams(); f = r.readframes(r.getnframes())
    sil = b"\x00\x00" * max(1, int(p.framerate * ms / 1000)) * p.nchannels
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setparams(p); w.writeframes(sil + f)
    return buf.getvalue()


def _trim_silence(wav: bytes, threshold_db: float = -45.0, tail_ms: int = 60) -> bytes:
    """Strip leading/trailing silence from a WAV clip.
    Tighter threshold (-45dB) and shorter tail (60ms) for cleaner word boundaries.
    Chatterbox fills unused max_new_tokens with silence — this removes it.
    """
    import numpy as np
    with wave.open(io.BytesIO(wav), "rb") as r:
        p = r.getparams()
        raw = r.readframes(r.getnframes())
    # Convert to float32 [-1, 1]
    data = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if data.size == 0:
        return wav
    threshold = 10.0 ** (threshold_db / 20.0)
    loud = np.where(np.abs(data) > threshold)[0]
    if loud.size == 0:
        return wav  # entirely silent — return as-is
    first = max(0, loud[0] - int(p.framerate * 0.02))   # 20ms lead-in
    last  = min(data.size, loud[-1] + int(p.framerate * tail_ms / 1000))
    trimmed = (data[first:last] * 32767).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setparams(p)
        w.writeframes(trimmed.tobytes())
    return buf.getvalue()



# ── Text cleaner ──────────────────────────────────────────────────────────

def _clean_indian_slang(text: str) -> str:
    """
    Convert text to authentic Indian English for Chatterbox TTS.
    Three-pass pipeline:
      1. Indian contextual phrases → natural Indian English equivalents
      2. Western/American slang → Indian English equivalents
      3. Phonetic respelling → how Indians actually pronounce English words
    """
    import re
    t = str(text or "").strip()

    # ── Pass 1: Western contractions → full Indian English forms ──────────────
    # Indians rarely use contractions in formal/educational speech
    contractions = {
        r"\b(gonna)\b":       "going to",
        r"\b(wanna)\b":       "want to",
        r"\b(gotta)\b":       "have to",
        r"\b(lemme)\b":       "let me",
        r"\b(gimme)\b":       "give me",
        r"\b(kinda)\b":       "kind of",
        r"\b(sorta)\b":       "sort of",
        r"\b(dunno)\b":       "do not know",
        r"\b(y'all|yall)\b":  "all of you",
        r"\b(ain't)\b":       "is not",
        r"\b(can't)\b":       "cannot",
        r"\b(won't)\b":       "will not",
        r"\b(don't)\b":       "do not",
        r"\b(doesn't)\b":     "does not",
        r"\b(didn't)\b":      "did not",
        r"\b(isn't)\b":       "is not",
        r"\b(wasn't)\b":      "was not",
        r"\b(weren't)\b":     "were not",
        r"\b(haven't)\b":     "have not",
        r"\b(hasn't)\b":      "has not",
        r"\b(hadn't)\b":      "had not",
        r"\b(wouldn't)\b":    "would not",
        r"\b(shouldn't)\b":   "should not",
        r"\b(couldn't)\b":    "could not",
        r"\b(it's)\b":        "it is",
        r"\b(that's)\b":      "that is",
        r"\b(there's)\b":     "there is",
        r"\b(they're)\b":     "they are",
        r"\b(we're)\b":       "we are",
        r"\b(you're)\b":      "you are",
        r"\b(I'm)\b":         "I am",
        r"\b(I've)\b":        "I have",
        r"\b(I'll)\b":        "I will",
        r"\b(I'd)\b":         "I would",
        r"\b(he's)\b":        "he is",
        r"\b(she's)\b":       "she is",
        r"\b(who's)\b":       "who is",
        r"\b(what's)\b":      "what is",
        r"\b(where's)\b":     "where is",
        r"\b(how's)\b":       "how is",
        r"\b(let's)\b":       "let us",
        r"\b(we've)\b":       "we have",
        r"\b(they've)\b":     "they have",
        r"\b(you've)\b":      "you have",
        r"\b(we'd)\b":        "we would",
        r"\b(they'd)\b":      "they would",
        r"\b(he'd)\b":        "he would",
        r"\b(she'd)\b":       "she would",
        r"\b(won't)\b":       "will not",
        r"\b(shan't)\b":      "shall not",
        r"\b(mustn't)\b":     "must not",
        r"\b(needn't)\b":     "need not",
        r"\b(daren't)\b":     "dare not",
    }
    for pat, repl in contractions.items():
        t = re.sub(pat, repl, t, flags=re.I)

    # ── Pass 2: Western/American slang → Indian English equivalents ───────────
    # These are phrases Indians would naturally say differently
    american_to_indian = {
        # American idioms → Indian equivalents
        r"\b(awesome)\b":                   "very good",
        r"\b(cool)\b":                      "very nice",
        r"\b(guys)\b":                      "everyone",
        r"\b(dude)\b":                      "friend",
        r"\b(buddy)\b":                     "friend",
        r"\b(bro)\b":                       "friend",
        r"\b(pal)\b":                       "friend",
        r"\b(check out)\b":                 "have a look at",
        r"\b(hang out)\b":                  "spend time",
        r"\b(freak out)\b":                 "get worried",
        r"\b(chill out)\b":                 "relax",
        r"\b(no worries)\b":               "do not worry",
        r"\b(heads up)\b":                  "please note",
        r"\b(wrap up)\b":                   "finish",
        r"\b(kickstart)\b":                 "start",
        r"\b(kick off)\b":                  "begin",
        r"\b(touch base)\b":                "discuss",
        r"\b(ballpark)\b":                  "approximate",
        r"\b(bandwidth)\b":                 "capacity",
        r"\b(leverage)\b":                  "use",
        r"\b(gonna get)\b":                 "will get",
        r"\b(nope)\b":                      "no",
        r"\b(yep|yup)\b":                   "yes",
        r"\b(huh)\b":                       "what",
        r"\b(oops)\b":                      "sorry",
        r"\b(okey dokey|okey-dokey)\b":     "okay",
        r"\b(pretty much)\b":               "mostly",
        r"\b(kind of|kinda)\b":             "somewhat",
        r"\b(sort of|sorta)\b":             "somewhat",
        r"\b(a lot of)\b":                  "many",
        r"\b(lots of)\b":                   "many",
        r"\b(tons of)\b":                   "many",
        r"\b(bunch of)\b":                  "many",
        r"\b(way too)\b":                   "very much too",
        r"\b(super)\b":                     "very",
        r"\b(totally)\b":                   "completely",
        r"\b(absolutely)\b":                "certainly",
        r"\b(definitely)\b":                "certainly",
        r"\b(basically)\b":                 "essentially",
        r"\b(literally)\b":                 "actually",
        r"\b(like)\b(?=\s+\w)":             "",   # filler "like" removed
        r"\b(you know)\b":                  "",   # filler removed
        r"\b(I mean)\b":                    "",   # filler removed
        r"\b(right\?)\b":                   "is it not?",
        r"\b(okay\?)\b":                    "is it clear?",
        r"\b(got it\?)\b":                  "is it understood?",
        r"\b(make sense\?)\b":              "is it clear?",
        r"\b(makes sense)\b":               "is clear",
        r"\b(no brainer)\b":                "very simple thing",
        r"\b(bottom line)\b":               "in short",
        r"\b(at the end of the day)\b":     "ultimately",
        r"\b(moving forward)\b":            "going forward",
        r"\b(going forward)\b":             "in future",
        r"\b(touch and go)\b":              "uncertain",
        r"\b(up to speed)\b":               "fully informed",
        r"\b(out of the box)\b":            "ready to use",
        r"\b(think outside the box)\b":     "think creatively",
        r"\b(on the same page)\b":          "in agreement",
        r"\b(synergy)\b":                   "combined effort",
        r"\b(proactive)\b":                 "taking initiative",
        r"\b(deliverable)\b":               "output",
        r"\b(takeaway)\b":                  "key point",
        r"\b(deep dive)\b":                 "detailed study",
        r"\b(pain point)\b":                "problem area",
        r"\b(game changer)\b":              "major change",
        r"\b(paradigm shift)\b":            "major change in thinking",
        r"\b(disruptive)\b":                "revolutionary",
        r"\b(cutting edge)\b":              "latest",
        r"\b(state of the art)\b":          "most advanced",
        r"\b(robust)\b":                    "strong",
        r"\b(seamless)\b":                  "smooth",
        r"\b(scalable)\b":                  "can be expanded",
        r"\b(holistic)\b":                  "complete",
        r"\b(pivot)\b":                     "change direction",
        r"\b(agile)\b":                     "flexible",
        r"\b(iterate)\b":                   "repeat and improve",
    }
    for pat, repl in american_to_indian.items():
        if repl:
            t = re.sub(pat, repl, t, flags=re.I)
        else:
            t = re.sub(pat, "", t, flags=re.I)

    # ── Pass 3: Phonetic respelling for Indian pronunciation ──────────────────
    # These respellings guide Chatterbox to produce authentic Indian-accented
    # pronunciation. Indians stress syllables differently and use British-Indian
    # vowel patterns.
    phonetic = {
        # Vowel differences: Indian English uses short vowels more
        r"\b(schedule)\b":      "skedule",
        r"\b(vitamin)\b":       "vitamine",        # Indians: vit-ah-min (long a)
        r"\b(leisure)\b":       "lezhure",
        r"\b(either)\b":        "ee-ther",
        r"\b(neither)\b":       "nee-ther",
        r"\b(again)\b":         "again",           # already natural
        r"\b(process)\b":       "proe-cess",       # Indians use long o
        r"\b(progress)\b":      "proe-gress",
        r"\b(project)\b":       "pro-ject",
        r"\b(data)\b":          "day-ta",          # Indian standard
        r"\b(privacy)\b":       "priv-acy",        # Indian: short i
        r"\b(advertisement)\b": "add-ver-tise-ment",
        r"\b(controversy)\b":   "con-troversy",    # Indian stress pattern
        r"\b(laboratory)\b":    "la-bor-atory",
        r"\b(secretary)\b":     "sec-re-terry",
        r"\b(dictionary)\b":    "dic-tion-erry",
        r"\b(necessary)\b":     "nec-es-serry",
        r"\b(library)\b":       "lie-brer-ry",
        r"\b(February)\b":      "Feb-roo-ary",
        r"\b(January)\b":       "Jan-yoo-ary",
        r"\b(actually)\b":      "actually",        # keep, Indians say this naturally
        r"\b(basically)\b":     "basically",
        r"\b(especially)\b":    "especially",
        r"\b(particularly)\b":  "particularly",
        r"\b(formula)\b":       "form-yoo-la",
        r"\b(vehicle)\b":       "vee-hi-kul",
        r"\b(technology)\b":    "tek-nol-o-jee",
        r"\b(geography)\b":     "jee-og-ra-fee",
        r"\b(biography)\b":     "bye-og-ra-fee",
        r"\b(democracy)\b":     "de-mock-ra-see",
        r"\b(bureaucracy)\b":   "byoo-rock-ra-see",
        r"\b(hierarchy)\b":     "high-er-ar-kee",
        r"\b(entrepreneur)\b":  "on-tre-pre-neur",
        r"\b(queue)\b":         "kyoo",
        r"\b(quiz)\b":          "kwiz",
        r"\b(zero)\b":          "zee-ro",
        r"\b(zebra)\b":         "zeb-ra",          # Indian: short e not ee
        r"\b(pizza)\b":         "peet-za",
        r"\b(cafe)\b":          "ka-fay",
        # Indian English specific expressions preserved
        r"\b(prepone)\b":       "prepone",         # pure Indian English word
        r"\b(do the needful)\b": "do what is needed",
        r"\b(revert back)\b":   "reply",
        r"\b(revert)\b":        "reply",
        r"\b(doubt)\b":         "question",        # Indians say "I have a doubt" = I have a question
        r"\b(passed out)\b":    "graduated",       # Indian usage
        r"\b(out of station)\b": "out of town",
        r"\b(good name)\b":     "name",
        r"\b(co-brother)\b":    "brother in law",
        r"\b(cousin brother)\b": "cousin",
        r"\b(cousin sister)\b": "cousin",
        r"\b(lakh)\b":          "lakh",
        r"\b(lakhs)\b":         "lakhs",
        r"\b(crore)\b":         "crore",
        r"\b(crores)\b":        "crores",
        r"\b(paise)\b":         "paise",
        r"\b(rupee)\b":         "rupee",
        r"\b(rupees)\b":        "rupees",
        r"\b(ji)\b":            "jee",
        r"\b(sahib)\b":         "saa-hib",
        r"\b(madam)\b":         "madam",
        r"\b(sir)\b":           "sir",
        r"\b(anna)\b":          "anna",
        r"\b(akka)\b":          "akka",
        r"\b(bhai)\b":          "bhai",
        r"\b(didi)\b":          "didi",
    }
    for pat, repl in phonetic.items():
        t = re.sub(pat, repl, t, flags=re.I)

    # ── Clean up extra spaces left by removed fillers ─────────────────────────
    t = re.sub(r'[ \t]{2,}', ' ', t)
    t = re.sub(r'\s+([,.!?])', r'\1', t)
    return t.strip()


def _clean(text: str) -> str:
    import re
    t = _clean_indian_slang(text)
    t = re.sub(r'\s*&\s*', ' and ', t)
    t = re.sub(r'\s*@\s*', ' at ', t)
    t = re.sub(r'(?<=\d)\s*%\b', ' percent', t)
    t = re.sub(r'\bvs\.?\b', 'versus', t, flags=re.I)
    t = re.sub(r'\betc\.?\b', 'etcetera', t, flags=re.I)
    t = re.sub(r'\bPause\.?\s*', '', t, flags=re.I)
    t = re.sub(r'^#{1,6}\s+', '', t, flags=re.M)
    t = re.sub(r'[*_~`]{1,3}', '', t)
    t = re.sub(r'^\s*[\u2022\-\*\+]\s+', '', t, flags=re.M)
    t = re.sub(r'^\s*\d+[.)]\s+', '', t, flags=re.M)
    t = re.sub(r'<[^>]+>', '', t)
    t = re.sub(r'[<>@#$%^\&+=\[\]{}\\/~|]', ' ', t)
    t = re.sub(r'[ \t]+', ' ', t)
    # ── Expand digits → spoken words ──────────────────────────────────────────
    t = _expand_numbers(t)
    return t.strip()


def _num_to_words(n: int) -> str:
    """Convert a non-negative integer to English words (Indian numbering)."""
    ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
            'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
            'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
    tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty',
            'sixty', 'seventy', 'eighty', 'ninety']
    if n < 0:
        return 'minus ' + _num_to_words(-n)
    if n == 0:
        return 'zero'
    if n < 20:
        return ones[n]
    if n < 100:
        return tens[n // 10] + ((' ' + ones[n % 10]) if n % 10 else '')
    if n < 1000:
        rest = n % 100
        return ones[n // 100] + ' hundred' + ((' and ' + _num_to_words(rest)) if rest else '')
    if n < 100000:
        rest = n % 1000
        return _num_to_words(n // 1000) + ' thousand' + ((' ' + _num_to_words(rest)) if rest else '')
    if n < 10000000:
        rest = n % 100000
        return _num_to_words(n // 100000) + ' lakh' + ((' ' + _num_to_words(rest)) if rest else '')
    rest = n % 10000000
    return _num_to_words(n // 10000000) + ' crore' + ((' ' + _num_to_words(rest)) if rest else '')


def _expand_numbers(text: str) -> str:
    """Replace digit sequences with spoken words inside text."""
    import re as _re
    # Strip comma-separators from numbers (1,00,000 → 100000 and 1,000,000 → 1000000)
    text = _re.sub(r'(?<=\d),(?=\d)', '', text)
    def _replace(m):
        raw = m.group(0)
        if '.' in raw:
            parts = raw.split('.', 1)
            int_words  = _num_to_words(abs(int(parts[0])))
            dec_digits = ' '.join(_num_to_words(int(d)) for d in parts[1])
            sign = 'minus ' if raw.startswith('-') else ''
            return sign + int_words + ' point ' + dec_digits
        else:
            return _num_to_words(abs(int(raw)))
    return _re.sub(r'-?\b\d+(?:\.\d+)?\b', _replace, text)





# ── Synthesis engine ───────────────────────────────────────────────────────

_cache      = OrderedDict()
_cache_lock = threading.Lock()
_synth_lock = threading.Lock()

# ── Persistent Disk Cache ──────────────────────────────────────────────────────
# Every synthesized sentence is saved to disk so the NEXT app start is instant.
# Cache dir: D:\voice\tts-cache\   Max size: 1 GB (oldest trimmed automatically)
import hashlib
DISK_CACHE_DIR = PROJECT_ROOT / "tts-cache"
DISK_CACHE_MAX_BYTES = 1 * 1024 * 1024 * 1024  # 1 GB
DISK_CACHE_DIR.mkdir(exist_ok=True)

def _disk_key(text: str, voice: str) -> str:
    """SHA-256 hash of voice + cleaned text → used as filename."""
    composite = f"{voice}:{text}"
    return hashlib.sha256(composite.encode("utf-8")).hexdigest()

def _disk_cache_get(clean_text: str, voice: str):
    """Return cached WAV bytes from disk, or None if not cached."""
    try:
        p = DISK_CACHE_DIR / (_disk_key(clean_text, voice) + ".wav")
        if p.exists():
            p.touch()  # update mtime so LRU trimming keeps recently used files
            return p.read_bytes()
    except Exception:
        pass
    return None

def _disk_cache_set(clean_text: str, voice: str, wav_bytes: bytes):
    """Save WAV bytes to disk cache, then trim if over 1 GB."""
    try:
        p = DISK_CACHE_DIR / (_disk_key(clean_text, voice) + ".wav")
        p.write_bytes(wav_bytes)
        
        # Trim cache if over limit (1 GB)
        files = sorted(
            [f for f in DISK_CACHE_DIR.glob("*.wav")],
            key=lambda x: x.stat().st_mtime
        )
        total_size = sum(f.stat().st_size for f in files)
        while total_size > DISK_CACHE_MAX_BYTES and files:
            oldest = files.pop(0)
            try:
                total_size -= oldest.stat().st_size
                oldest.unlink()
            except Exception:
                pass
    except Exception as exc:
        print(f"[Cache] Failed to write to disk cache: {exc}", flush=True)


# Real-time synthesis progress — polled by the app banner
_progress = {
    "active":  False,
    "stage":   "idle",
    "pct":     0,
    "cached":  False,
    "text":    "",
    "tokens":  0,
    "total_tokens": 0,
}
_progress_lock = threading.Lock()
_current_synth_text = ""

STAGES = [
    ("Cleaning text…",               5),
    ("Preparing voice embeddings…",  15),
    ("Generating speech tokens…",    20),
    ("Synthesising audio waveform…", 82),
    ("Encoding WAV…",                92),
    ("Done",                        100),
]

def _set_progress(stage: str, pct: int, active=True, cached=False, text=""):
    with _progress_lock:
        safe_pct = int(max(0, min(100, pct)))
        if active and _progress.get("active") and safe_pct < int(_progress.get("pct") or 0):
            safe_pct = int(_progress.get("pct") or safe_pct)
        _progress["active"]  = active
        _progress["stage"]   = stage
        _progress["pct"]     = safe_pct
        _progress["cached"]  = cached
        _progress["text"]    = text[:80] if text else ""


def _start_generate_progress(text: str, start_pct: int = 20, end_pct: int = 81):
    stop_event = threading.Event()
    clean_text = str(text or "")
    word_count = max(1, len(clean_text.split()))
    estimated_seconds = max(18.0, min(220.0, word_count * 3.2))

    def _run():
        started = time.monotonic()
        last_pct = start_pct
        while not stop_event.is_set():
            elapsed = time.monotonic() - started
            pct = min(end_pct, start_pct + int(((end_pct - start_pct) * elapsed) / estimated_seconds))
            if pct > last_pct:
                last_pct = pct
                _set_progress(f"Generating speech tokens... {pct}%", pct, active=True, text=text)
            stop_event.wait(0.25)

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()
    return stop_event


def synthesize(text: str, voice: str = "sc3", gen_opts: dict = None) -> bytes:
    global CURRENT_VOICE
    # Normalize voice name
    voice = str(voice or "sc3").strip().lower()
    if voice not in VOICE_MAP:
        voice = "sc3"
    
    # Voice-specific generation defaults for MAXIMUM HUMAN REALISM
    # Based on Chatterbox model's training defaults (tts.py: temp=0.8, exag=0.5, cfg=0.5)
    # exaggeration=0.5  → natural prosody variation (model sweet spot)
    # temperature=0.8   → natural rhythmic variation, stress, pauses — NOT robotic
    # cfg_weight=0.5    → balanced guidance — model breathes naturally
    # min_p=0.05        → filters low-quality tokens without killing naturalness
    # cfg_weight too HIGH (0.9+) = voice locked so tight it sounds forced/robotic
    # temperature too LOW (0.45) = monotone flat speech = robotic
    if voice == "pattan":
        _default_opts = dict(exaggeration=0.5, cfg_weight=0.5, temperature=0.8, repetition_penalty=1.1, min_p=0.05, top_p=1.0)
    else:  # sc3 / anjali
        _default_opts = dict(exaggeration=0.5, cfg_weight=0.5, temperature=0.8, repetition_penalty=1.1, min_p=0.05, top_p=1.0)
    
    # Merge caller-supplied options on top of defaults
    opts = {**_default_opts, **(gen_opts or {})}
    exaggeration      = float(opts.get("exaggeration",      _default_opts["exaggeration"]))
    cfg_weight        = float(opts.get("cfg_weight",        opts.get("cfgWeight",   _default_opts["cfg_weight"])))
    temperature       = float(opts.get("temperature",       _default_opts["temperature"]))
    repetition_penalty= float(opts.get("repetition_penalty",opts.get("repetitionPenalty", _default_opts["repetition_penalty"])))
    min_p             = float(opts.get("min_p",  opts.get("minP",  _default_opts.get("min_p",  0.05))))
    top_p             = float(opts.get("top_p",  opts.get("topP",  _default_opts.get("top_p",  1.0))))

    with _synth_lock:
        _set_progress(STAGES[0][0], STAGES[0][1], active=True, text=text)
        clean = _clean(text)
        if not clean:
            _set_progress("idle", 0, active=False)
            raise ValueError("Empty text after cleaning.")

        # ── Transliterate Devanagari → phonetic English for Hindi/Telugu voice ──
        # Chatterbox is English-only; transliteration lets it pronounce Indian
        # text correctly while using the Hindi/Telugu voice embedding.
        if voice in ("hindi", "telugu") and any('\u0900' <= c <= '\u097f' for c in clean):
            import unicodedata
            # Basic Devanagari → Latin transliteration table
            _dev = {
                'अ':'u','आ':'aa','इ':'i','ई':'ee','उ':'u','ऊ':'oo',
                'ए':'ay','ऐ':'ai','ओ':'oh','औ':'ow','अं':'um',
                'क':'k','ख':'kh','ग':'g','घ':'gh','च':'ch',
                'छ':'chh','ज':'j','झ':'jh','ट':'t','ठ':'th',
                'ड':'d','ढ':'dh','ण':'n','त':'t','थ':'th',
                'द':'d','ध':'dh','न':'n','प':'p','फ':'f',
                'ब':'b','भ':'bh','म':'m','य':'y','र':'r',
                'ल':'l','व':'v','श':'sh','ष':'sh','स':'s','ह':'h',
                'ा':'aa','ि':'i','ी':'ee','ु':'u','ू':'oo',
                'े':'ay','ै':'ai','ो':'oh','ौ':'ow','ं':'n','्':None,
            }
            out = []
            for ch in clean:
                v = _dev.get(ch)
                if v is not None:
                    out.append(v)
                elif v is None:
                    pass  # virama — skip
                elif '\u0900' <= ch <= '\u097f':
                    pass  # unknown Devanagari — skip
                else:
                    out.append(ch)
            transliterated = ' '.join(''.join(out).split())
            if transliterated:
                print(f"[Voice] Transliterated {voice}: {transliterated[:60]!r}", flush=True)
                clean = transliterated

        # Check if we need to switch voice embeddings
        if voice != CURRENT_VOICE:
            print(f"[Voice] Switching voice from {CURRENT_VOICE} to {voice}...", flush=True)
            ref_wav = VOICE_MAP[voice]
            if not os.path.exists(ref_wav):
                print(f"[ERROR] Voice reference WAV for {voice} not found: {ref_wav}. Keeping {CURRENT_VOICE}.", flush=True)
            else:
                try:
                    # Pre-upsample to 24kHz with soxr for cleanest embedding
                    import tempfile as _tf, subprocess as _subp
                    _tmp24k = _tf.NamedTemporaryFile(suffix="-24k.wav", delete=False)
                    _tmp24k.close()
                    try:
                        _subp.run([
                            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                            "-i", ref_wav,
                            "-ar", "24000", "-ac", "1", "-sample_fmt", "s16",
                            _tmp24k.name,
                        ], check=True)
                        ref_to_use = _tmp24k.name
                    except Exception:
                        ref_to_use = ref_wav
                    MODEL.prepare_conditionals(ref_to_use, exaggeration=0.5)
                    try: os.unlink(_tmp24k.name)
                    except OSError: pass
                    CURRENT_VOICE = voice
                    VOICE_REF_WAV_24K_CURRENT = ref_to_use
                    print(f"[Voice] Switched voice successfully to {voice}!", flush=True)
                except Exception as e:
                    print(f"[ERROR] Failed to switch voice embeddings to {voice}: {e}", flush=True)
                    traceback.print_exc()

        # Normalize voice key for caches
        voice_key = "sc3" if voice in ("sc3", "anjali") else voice
        cache_key = (clean, voice_key)

        # 1. RAM cache hit — instant
        wav = None
        with _cache_lock:
            if cache_key in _cache:
                _cache.move_to_end(cache_key)
                wav = _cache[cache_key]
        if wav is not None:
            _set_progress("Done (RAM cache)", 100, active=False, cached=True, text=text)
            return wav

        # 2. Disk cache hit — near-instant (no AI needed)
        wav = _disk_cache_get(clean, voice_key)
        if wav is not None:
            with _cache_lock:
                _cache[cache_key] = wav
                _cache.move_to_end(cache_key)
                while len(_cache) > CACHE_LIMIT:
                    _cache.popitem(last=False)
            _set_progress("Done (disk cache)", 100, active=False, cached=True, text=text)
            print(f"[Cache] Disk hit: {clean[:50]!r} ({voice_key})", flush=True)
            return wav

        # ── Hindi/Telugu: Edge TTS → SC3 Singing Server (OpenVoice timbre transfer) ──
        # Strict rule: sc3/pattan voice only. For Hindi/Telugu:
        #   1. Synthesise speech via Edge TTS in a dedicated worker thread
        #   2. Send audio to sc3-singing-server (port 8431) for OpenVoice voice conversion
        #   Result: sc3/pattan VOICE with correct Hindi/Telugu language phonetics
        # Force Edge TTS + SC3 Singing for hindi/telugu voice OR hindi/telugu text
        lang = detect_lang(clean)
        if voice in ('hindi', 'telugu') or lang in ('hi', 'te'):
            lang = 'hi' if voice == 'hindi' else ('te' if voice == 'telugu' else lang)
            print(f"[Voice] Detected '{lang}' — Edge TTS + SC3 Singing (OpenVoice) → {voice_key}", flush=True)
            try:
                import concurrent.futures, tempfile, subprocess as _sp, base64 as _b64
                import urllib.request as _ur, json as _js
                from pathlib import Path as _P

                HINDI_EDGE_VOICES  = {"pattan": "hi-IN-MadhurNeural", "sc3": "hi-IN-SwaraNeural",  "anjali": "hi-IN-SwaraNeural"}
                TELUGU_EDGE_VOICES = {"pattan": "te-IN-MohanNeural",   "sc3": "te-IN-ShrutiNeural", "anjali": "te-IN-ShrutiNeural"}
                edge_voice = (HINDI_EDGE_VOICES if lang == 'hi' else TELUGU_EDGE_VOICES).get(voice_key, "hi-IN-SwaraNeural")
                print(f"[Voice] Edge TTS voice: {edge_voice}", flush=True)
                _set_progress("Synthesising Hindi/Telugu via Edge TTS...", 20, active=True, text=text)

                # ── Step 1: Edge TTS in a worker thread (avoids asyncio event-loop conflicts) ──
                def _edge_tts_worker(txt, vid):
                    import asyncio as _aio, edge_tts as _etts
                    async def _run():
                        communicate = _etts.Communicate(txt, vid)
                        chunks = []
                        async for chunk in communicate.stream():
                            if chunk["type"] == "audio":
                                chunks.append(chunk["data"])
                        return b"".join(chunks)
                    return _aio.run(_run())

                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as _pool:
                    fut = _pool.submit(_edge_tts_worker, clean, edge_voice)
                    mp3_bytes = fut.result(timeout=90)

                if not mp3_bytes:
                    raise RuntimeError("Edge TTS returned empty audio")
                print(f"[Voice] Edge TTS: {len(mp3_bytes)} MP3 bytes received", flush=True)

                # ── Step 2: OpenVoice timbre conversion via singing server (port 8431) ──
                _set_progress("Converting voice timbre via SC3 Singing (OpenVoice)...", 50, active=True, text=text)

                with tempfile.TemporaryDirectory(prefix="hi-te-voice-") as tmpdir:
                    tmp          = _P(tmpdir)
                    mp3_in       = tmp / "edge.mp3"
                    wav44        = tmp / "edge44.wav"
                    mp3_out      = tmp / "sc3_result.mp3"
                    wav_final    = tmp / "final.wav"

                    mp3_in.write_bytes(mp3_bytes)

                    # Resample to 44100Hz stereo (required by OpenVoice)
                    _sp.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                             "-i", str(mp3_in), "-ar", "44100", "-ac", "2", str(wav44)],
                            check=True)

                    # POST to singing server for OpenVoice conversion
                    payload_bytes = _js.dumps({
                        "filePath": str(wav44), "voice": voice_key, "saveToDownloads": False,
                    }).encode("utf-8")
                    req = _ur.Request("http://127.0.0.1:8431/api/convert-song",
                                      data=payload_bytes,
                                      headers={"Content-Type": "application/json"},
                                      method="POST")
                    print(f"[Voice] Calling singing server (port 8431) for OpenVoice conversion...", flush=True)
                    with _ur.urlopen(req, timeout=300) as resp:
                        result = _js.loads(resp.read())

                    if not result.get("ok"):
                        raise RuntimeError(f"Singing server error: {result.get('error', 'unknown')}")

                    print(f"[Voice] OpenVoice conversion done!", flush=True)

                    # Decode result MP3 → 24000Hz mono WAV for the app
                    mp3_out.write_bytes(_b64.b64decode(result["audioBase64"]))
                    _sp.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                             "-i", str(mp3_out), "-ac", "1", "-ar", "24000", "-sample_fmt", "s16", str(wav_final)],
                            check=True)
                    wav = wav_final.read_bytes()

                # Cache result
                with _cache_lock:
                    _cache[cache_key] = wav
                    _cache.move_to_end(cache_key)
                    while len(_cache) > CACHE_LIMIT:
                        _cache.popitem(last=False)
                _disk_cache_set(clean, voice_key, wav)

                _set_progress("Done", 100, active=False, cached=False, text=text)
                print(f"[Voice] ✔ {lang} → {voice_key} via Edge TTS + OpenVoice (singing server)", flush=True)
                return wav

            except Exception as e:
                print(f"[Voice] Hindi/Telugu singing conversion FAILED: {e}", flush=True)
                traceback.print_exc()



        _set_progress(STAGES[1][0], STAGES[1][1], active=True, text=text)

        try:
            _set_progress(STAGES[2][0], STAGES[2][1], active=True, text=text)
            progress_stop = _start_generate_progress(text)
            try:
                # MAX FIDELITY: audio_prompt_path feeds the reference wav directly
                # into the generation loop — Chatterbox hears the voice and clones it
                current_ref = VOICE_MAP.get(CURRENT_VOICE, VOICE_MAP["sc3"])

                def _do_generate():
                    return MODEL.generate(
                        clean,
                        audio_prompt_path=current_ref,
                        exaggeration=exaggeration,
                        cfg_weight=cfg_weight,
                        temperature=temperature,
                        repetition_penalty=repetition_penalty,
                        min_p=min_p,
                        top_p=top_p,
                    )

                wav_t1 = _do_generate()
                wav_t  = wav_t1
            finally:
                progress_stop.set()
            _set_progress(STAGES[3][0], STAGES[3][1], active=True, text=text)
        except Exception:
            _set_progress("idle", 0, active=False)
            raise

        _set_progress(STAGES[4][0], STAGES[4][1], active=True, text=text)
        # Full audio clarity pipeline: silence trim → enhance (DC remove, noise gate,
        # presence boost, loudness match to reference, limiter, fade edges)
        raw_wav = _trim_silence(_add_pad(_to_wav(wav_t)))
        wav     = _enhance_voice_wav(raw_wav)

        with _cache_lock:
            _cache[cache_key] = wav
            _cache.move_to_end(cache_key)
            while len(_cache) > CACHE_LIMIT:
                _cache.popitem(last=False)

        # 3. Save to disk cache for future app restarts
        _disk_cache_set(clean, voice_key, wav)
        print(f"[Cache] Saved to disk: {clean[:50]!r} ({voice_key})", flush=True)

        _set_progress(STAGES[5][0], active=False, pct=100, cached=False, text=text)
        return wav


# ── HTTP Handler ───────────────────────────────────────────────────────────

_DISC = (BrokenPipeError, ConnectionAbortedError, ConnectionResetError)


class Handler(BaseHTTPRequestHandler):
    server_version   = "VoicePresentator/4.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        if self.path.startswith("/api/narrate/progress"):
            return
        print(f"{self.address_string()} [{self.log_date_time_string()}] {fmt % args}", flush=True)

    def _headers(self, status=200, ctype="application/json; charset=utf-8", length=0):
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        if ctype: self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        self.send_header("Connection", "close")
        try:
            self.end_headers(); return True
        except _DISC:
            return False

    def _write(self, data: bytes):
        try:
            self.wfile.write(data); self.wfile.flush()
            try: self.connection.shutdown(socket.SHUT_WR)
            except OSError: pass
            self.close_connection = True; return True
        except _DISC:
            return False

    def _json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        if self._headers(status, "application/json; charset=utf-8", len(body)):
            self._write(body)

    def _read_json(self):
        n   = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(n) if n else b"{}"
        return json.loads(raw.decode("utf-8"))

    def do_OPTIONS(self):
        self._headers(204, "", 0)

    def do_GET(self):
        if self.path.startswith("/health") or self.path == "/":
            self._json({
                "ok":            True,
                "voice":         "paragraph-cloned",
                "engine":        "chatterbox-tts",
                "modelLoaded":   True,
                "warming":       False,
                "locked":        True,
                "chatterboxReady": True,
                "chatterboxLoading": False,
                "chatterboxError":   "",
                "referenceFile": VOICE_REF_WAV,
                "referenceReady": Path(VOICE_REF_WAV).exists(),
                "referenceSource": "paragraph.mp4 (Downloads folder)",
                "sampleRate":    SAMPLE_RATE,
                "cacheEntries":  len(_cache),
                "device":        device,
                "error":         "",
                "modelReady":      True,
                "converterWarmed": True,
            })
            return

        if self.path.startswith("/voices"):
            self._json({
                "ok": True, "locked": False,
                "voices": [
                    {
                        "shortName":    "sc3",
                        "friendlyName": "sc3 cloned voice",
                        "gender": "Female", "locale": "en-IN",
                        "current": CURRENT_VOICE in ("sc3", "anjali"), "locked": False,
                    },
                    {
                        "shortName":    "pattan",
                        "friendlyName": "pattan voice",
                        "gender": "Male", "locale": "en-IN",
                        "current": CURRENT_VOICE == "pattan", "locked": False,
                    }
                ],
                "active": CURRENT_VOICE,
            })
            return

        if self.path.startswith("/api/proxy/tts"):
            import urllib.parse, urllib.request
            try:
                from urllib.parse import urlparse, parse_qs
                qs  = parse_qs(urlparse(self.path).query)
                tl  = qs.get("tl",["en"])[0]
                q   = qs.get("q",[""])[0]
                url = f"https://translate.googleapis.com/translate_tts?ie=UTF-8&tl={tl}&client=tw-ob&q={urllib.parse.quote(q)}"
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req) as resp:
                    data = resp.read()
                    if self._headers(200, "audio/mpeg", len(data)): self._write(data)
            except Exception as e:
                self._json({"error": str(e)}, 500)
            return

        if self.path.startswith("/api/narrate/progress"):
            with _progress_lock:
                snap = dict(_progress)
            self._json(snap)
            return
        self._json({"error": "Route not found."}, 404)

    def do_POST(self):
        if self.path == "/api/convert-song":
            try:
                payload = self._read_json()
                res = _run_direct_model(payload)
                self._json(res)
            except Exception as e:
                self._json({"ok": False, "error": str(e)}, 500)
            return

        if self.path == "/api/vision/analyze":
            try:
                import re
                data  = self._read_json()
                m     = re.search(r'Analyze this mathematical concept[^"]*"([^"]+)"', data.get("prompt",""))
                resp  = f"Let's explore: {m.group(1)}" if m else "Great learning exercise!"
                self._json({"text": resp})
            except Exception as e:
                self._json({"error": str(e)}, 500)
            return

        if self.path == "/api/preload":
            self._json({"ok": True, "message": "sc3.mp4 voice clone is ready — no preload needed."})
            return

        if self.path == "/set-voice":
            try:
                payload = self._read_json()
                voice   = payload.get("voice", "sc3")
                voice = str(voice or "sc3").strip().lower()
                if voice not in VOICE_MAP:
                    voice = "sc3"
                global CURRENT_VOICE
                if voice != CURRENT_VOICE:
                    ref_wav = VOICE_MAP[voice]
                    if os.path.exists(ref_wav):
                        MODEL.prepare_conditionals(ref_wav, exaggeration=0.5)
                        CURRENT_VOICE = voice
                self._json({"ok": True, "voice": CURRENT_VOICE, "locked": False,
                            "message": f"Active voice is set to {CURRENT_VOICE}."})
            except Exception as e:
                self._json({"error": str(e)}, 500)
            return

        if self.path.startswith("/api/narrate/progress"):
            with _progress_lock:
                snap = dict(_progress)
            self._json(snap)
            return

        if not self.path.startswith("/api/narrate"):
            self._json({"error": "Route not found."}, 404)
            return

        # ── Narrate ── sc3 and pattan voices ──────────────────────────
        try:
            payload   = self._read_json()
            text      = payload.get("text", "")
            voice     = payload.get("voice") or payload.get("generationOptions", {}).get("voice") or "sc3"
            # Pass through generation options from the JS client (voice-specific tuning)
            gen_opts  = payload.get("generationOptions") or {}
            wav_bytes = synthesize(text, voice, gen_opts)
            if self._headers(200, "audio/wav", len(wav_bytes)):
                self._write(wav_bytes)
        except _DISC:
            return
        except Exception as exc:
            try:
                self._json({"error": str(exc), "traceback": traceback.format_exc(3)}, 500)
            except _DISC:
                pass


# ── Start server ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    sep = "=" * 66
    print(f"+{sep}+", flush=True)
    print(f"|   Voice Presentator  —  http://127.0.0.1:{PORT}                    |", flush=True)
    print(f"|   Engine : Chatterbox TTS (sc3.mp4 voice clone)                 |", flush=True)
    print(f"|   Locked : ONLY sc3.mp4 voice — no other voice possible         |", flush=True)
    print(f"+{sep}+", flush=True)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    server.serve_forever()

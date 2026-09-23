"""
Timed Voiceover Server
======================
A modular TTS server that generates speech to fit a specific target duration.
Runs on port 8427 (separate from the main Anjali narration server on 8426).

API:
  POST /api/generate
    Body: { "text": "...", "targetSeconds": 10.5, "voice": "anjali" (opt),
            "pitch": "+0Hz" (opt), "volume": "+0%" (opt) }
    Returns: audio/wav  (the generated audio fitted to targetSeconds)

  POST /api/preview
    Body: { "text": "...", "rate": "+0%" (opt), ... }
    Returns: audio/wav  (single-pass, no fitting)

  GET  /health
    Returns: JSON health info

Strategy
--------
1. Generate audio at the neutral rate (+0%).
2. Measure the actual duration.
3. If it is within ±TOLERANCE_S of the target → done.
4. Otherwise binary-search the Edge TTS rate parameter until the audio
   fits the target duration (max MAX_ITERATIONS attempts).
5. If the natural speech is shorter than the target, pad with silence at the end.
"""

import asyncio
import io
import json
import os
import re
import struct
import subprocess
import tempfile
import threading
import traceback
import wave
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# ── Single persistent event loop for all async TTS calls ──────────────────────
# ThreadingHTTPServer handles each request in a separate thread. Using
# asyncio.run() per call creates a new event loop each time, which causes
# "ECONNREFUSED" / connection-reset errors when two requests fire concurrently.
# Instead we run one event loop forever in a daemon thread and submit all
# coroutines to it with run_coroutine_threadsafe().
_tts_loop = asyncio.new_event_loop()
_tts_loop_thread = threading.Thread(target=_tts_loop.run_forever, daemon=True, name="tts-event-loop")
_tts_loop_thread.start()


def _run_async(coro):
    """Submit a coroutine to the shared TTS event loop and block until done."""
    future = asyncio.run_coroutine_threadsafe(coro, _tts_loop)
    return future.result()  # blocks calling thread; raises on exception

import edge_tts

# ── Config ────────────────────────────────────────────────────────────────────
PORT              = 8427
ANJALI_PORT       = 8426          # existing narration server (for health check)
VOICE_NAME        = "en-IN-NeerjaExpressiveNeural"
SAMPLE_RATE       = 24000         # Hz
TOLERANCE_S       = 0.25          # accept ±250 ms from target
MAX_ITERATIONS    = 8             # binary search cap
RATE_MIN          = -50           # Edge TTS rate floor  (%)
RATE_MAX          = 200           # Edge TTS rate ceiling (%)
CACHE_LIMIT       = 256

# Voice reference — EVS C5 8th Lesson, Fact File, Scene 3
VOICE_REFERENCE_SOURCE = (
    r"D:\LESSONS\EVS\EVS C5 8TH LESSON\EVS C5 8TH LESSON"
    r"\EVS C5 8TH Lesson fact file\sc3.mp4"
)
# Default rate tuned to match EVS lesson pacing
DEFAULT_RATE = "-16%"

for _k in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
    os.environ.pop(_k, None)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _fmt_rate(pct: float) -> str:
    """Convert a float percentage to Edge TTS rate string, e.g. 12 → '+12%'."""
    v = int(round(pct))
    return f"+{v}%" if v >= 0 else f"{v}%"


def _clean_text(text: str) -> str:
    """Strip markdown and symbols that Edge TTS would vocalize."""
    t = str(text or "").strip()
    t = re.sub(r'\bPause\.?\s*', '', t, flags=re.IGNORECASE)
    t = re.sub(r'^#{1,6}\s+', '', t, flags=re.MULTILINE)
    t = re.sub(r'[*_~]{1,3}', '', t)
    t = re.sub(r'^\s*[•◦▪\-\*\+]\s+', '', t, flags=re.MULTILINE)
    t = re.sub(r'^\s*\d+[.)]\s+', '', t, flags=re.MULTILINE)
    t = re.sub(r'`{1,3}[^`]*`{1,3}', '', t)
    t = re.sub(r'\|', ' ', t)
    t = re.sub(r'<[^>]+>', '', t)
    t = re.sub(r'[@#$%^&+=\[\]{}\\/~]', ' ', t)
    t = re.sub(r'([.!?])\s*\1+', r'\1', t)
    t = re.sub(r',\s*,+', ',', t)
    t = re.sub(r'[ \t]+', ' ', t)
    t = re.sub(r'\n{3,}', '\n\n', t)
    return t.strip()



async def _synthesize_mp3(text: str, voice: str, rate: str, pitch: str, volume: str) -> bytes:
    """Call Edge TTS, return MP3 bytes. Retries up to 3 times on transient failures."""
    last_exc = None
    for attempt in range(3):
        try:
            chunks: list[bytes] = []
            comm = edge_tts.Communicate(text, voice=voice, rate=rate, pitch=pitch, volume=volume)
            async for chunk in comm.stream():
                if chunk["type"] == "audio":
                    chunks.append(chunk["data"])
            if chunks:
                return b"".join(chunks)
            # No audio received — wait and retry
            last_exc = RuntimeError(f"Edge TTS voice '{voice}' returned no audio data.")
        except Exception as exc:
            last_exc = exc
        if attempt < 2:
            await asyncio.sleep(1.5)
    raise last_exc or RuntimeError(f"Edge TTS failed after 3 attempts.")



def _mp3_to_wav(mp3_bytes: bytes) -> bytes:
    """Convert MP3 → 24 kHz mono PCM WAV via ffmpeg."""
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
        f.write(mp3_bytes)
        inp = f.name
    out = inp.replace(".mp3", ".wav")
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", inp, "-ac", "1", "-ar", str(SAMPLE_RATE), "-sample_fmt", "s16", out],
            capture_output=True, check=True,
        )
        return Path(out).read_bytes()
    finally:
        for p in (inp, out):
            try: os.unlink(p)
            except OSError: pass


def _wav_duration_s(wav_bytes: bytes) -> float:
    """Return duration of a WAV file in seconds."""
    with wave.open(io.BytesIO(wav_bytes)) as wf:
        return wf.getnframes() / wf.getframerate()


def _make_silence_wav(duration_s: float, sample_rate: int = SAMPLE_RATE) -> bytes:
    """Return a silent WAV blob of the given duration."""
    n_frames = int(duration_s * sample_rate)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(b"\x00\x00" * n_frames)
    return buf.getvalue()


def _concat_wavs(a: bytes, b: bytes) -> bytes:
    """Concatenate two mono WAV files (same sample rate)."""
    buf = io.BytesIO()
    with wave.open(io.BytesIO(a)) as wa, wave.open(io.BytesIO(b)) as wb:
        params = wa.getparams()
        data_a = wa.readframes(wa.getnframes())
        data_b = wb.readframes(wb.getnframes())
    with wave.open(buf, "wb") as wout:
        wout.setparams(params)
        wout.writeframes(data_a + data_b)
    return buf.getvalue()


# ── Core engine ───────────────────────────────────────────────────────────────

_cache: "OrderedDict[str, bytes]" = OrderedDict()
_cache_lock = threading.Lock()


def _cache_key(text: str, rate: str, pitch: str, volume: str, voice: str) -> str:
    return f"{voice}|{rate}|{pitch}|{volume}||{text.strip()}"


def _get_cached(key: str):
    with _cache_lock:
        v = _cache.get(key)
        if v is not None:
            _cache.move_to_end(key)
        return v


def _store_cached(key: str, data: bytes):
    with _cache_lock:
        _cache[key] = data
        _cache.move_to_end(key)
        while len(_cache) > CACHE_LIMIT:
            _cache.popitem(last=False)


def generate_single_pass(text: str, voice: str, rate: str, pitch: str, volume: str) -> bytes:
    """Generate WAV for the given text at the given rate — cached."""
    key = _cache_key(text, rate, pitch, volume, voice)
    cached = _get_cached(key)
    if cached is not None:
        return cached
    mp3 = _run_async(_synthesize_mp3(text, voice, rate, pitch, volume))
    wav = _mp3_to_wav(mp3)
    _store_cached(key, wav)
    return wav


def generate_single_pass_mp3(text: str, voice: str, rate: str, pitch: str, volume: str) -> bytes:
    """Generate Edge TTS MP3 directly, without the slower FFmpeg WAV conversion."""
    key = "mp3|" + _cache_key(text, rate, pitch, volume, voice)
    cached = _get_cached(key)
    if cached is not None:
        return cached
    mp3 = _run_async(_synthesize_mp3(text, voice, rate, pitch, volume))
    _store_cached(key, mp3)
    return mp3


def generate_timed(
    text: str,
    target_s: float,
    voice: str   = VOICE_NAME,
    pitch: str   = "+0Hz",
    volume: str  = "+0%",
    max_rate_pct: float = RATE_MAX,
) -> dict:
    """
    Generate a WAV that fits within `target_s` seconds.

    Returns a dict:
      {
        "wav":          bytes,
        "actualSeconds": float,
        "targetSeconds": float,
        "rate":          str,
        "iterations":    int,
        "padded":        bool,
      }
    """
    safe_text = _clean_text(text)
    if not safe_text:
        raise ValueError("Text is empty after cleaning.")
    if target_s <= 0:
        raise ValueError("targetSeconds must be positive.")

    # ── Step 1: baseline at +0% ──────────────────────────────────────────────
    base_wav  = generate_single_pass(safe_text, voice, "+0%", pitch, volume)
    base_dur  = _wav_duration_s(base_wav)

    # ── Step 2: check tolerance immediately ─────────────────────────────────
    if abs(base_dur - target_s) <= TOLERANCE_S:
        return {
            "wav": base_wav, "actualSeconds": base_dur,
            "targetSeconds": target_s, "rate": "+0%",
            "iterations": 0, "padded": False,
        }

    # ── Step 3: pad with silence if speech is naturally shorter ─────────────
    if base_dur <= target_s:
        gap = target_s - base_dur
        silence = _make_silence_wav(gap)
        padded_wav = _concat_wavs(base_wav, silence)
        actual = _wav_duration_s(padded_wav)
        return {
            "wav": padded_wav, "actualSeconds": actual,
            "targetSeconds": target_s, "rate": "+0%",
            "iterations": 0, "padded": True,
        }

    # ── Step 4: speech is too long → binary-search for faster rate ──────────
    # Approximate: rate_pct ≈ (base_dur / target_s − 1) * 100
    # Use this as a starting midpoint to converge faster.
    estimated_pct = (base_dur / target_s - 1.0) * 100.0
    safe_rate_max = max(0.0, min(float(RATE_MAX), float(max_rate_pct)))
    lo = max(0.0, min(safe_rate_max, estimated_pct - 20))
    hi = min(safe_rate_max, estimated_pct + 40)

    best_wav  = base_wav
    best_rate = "+0%"
    best_dur  = base_dur
    iterations = 0

    for _ in range(MAX_ITERATIONS):
        mid_pct  = (lo + hi) / 2.0
        mid_rate = _fmt_rate(mid_pct)
        iterations += 1

        candidate = generate_single_pass(safe_text, voice, mid_rate, pitch, volume)
        dur = _wav_duration_s(candidate)

        if abs(dur - target_s) < abs(best_dur - target_s):
            best_wav  = candidate
            best_rate = mid_rate
            best_dur  = dur

        if abs(dur - target_s) <= TOLERANCE_S:
            break

        if dur > target_s:
            lo = mid_pct      # too slow → increase rate
        else:
            hi = mid_pct      # too fast → decrease rate

    # If still shorter than target, pad remainder
    padded = False
    if best_dur < target_s - TOLERANCE_S:
        gap    = target_s - best_dur
        silence = _make_silence_wav(gap)
        best_wav = _concat_wavs(best_wav, silence)
        best_dur = _wav_duration_s(best_wav)
        padded = True

    return {
        "wav": best_wav, "actualSeconds": best_dur,
        "targetSeconds": target_s, "rate": best_rate,
        "iterations": iterations, "padded": padded,
    }


# ── HTTP Handler ──────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    server_version = "TimedVoiceoverServer/1.0"
    _DISC = (BrokenPipeError, ConnectionAbortedError, ConnectionResetError)

    def log_message(self, fmt, *args):
        print(f"[timed-vo] {self.address_string()} {fmt % args}", flush=True)

    # ── helpers ──────────────────────────────────────────────────────────────

    def _cors(self, status=200, ctype="application/json", length=0, finish=True):
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        if ctype:
            self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        if not finish:
            return True
        try:
            self.end_headers()
            return True
        except self._DISC:
            return False

    def _write(self, data: bytes):
        try:
            self.wfile.write(data)
            return True
        except self._DISC:
            return False

    def _json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode()
        if self._cors(status, "application/json; charset=utf-8", len(body)):
            self._write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8"))

    # ── routing ──────────────────────────────────────────────────────────────

    def do_OPTIONS(self):
        self._cors(204, "", 0)

    def do_GET(self):
        if self.path.startswith("/health"):
            self._json({
                "ok": True,
                "server": "timed-voiceover",
                "port": PORT,
                "voice": VOICE_NAME,
                "engine": "edge-tts",
                "cacheEntries": len(_cache),
                "toleranceS": TOLERANCE_S,
                "maxIterations": MAX_ITERATIONS,
                "referenceSource": "EVS C5 8th Lesson — Fact File, Scene 3 (sc3.mp4)",
                "defaultRate": DEFAULT_RATE,
            })
        else:
            self._json({"error": "Route not found."}, 404)

    def do_POST(self):
        try:
            payload = self._read_json()
        except Exception as exc:
            self._json({"error": f"Invalid JSON: {exc}"}, 400)
            return

        # ── /api/generate  →  timed generation ───────────────────────────────
        if self.path.startswith("/api/generate"):
            text         = str(payload.get("text", "")).strip()
            target_s     = float(payload.get("targetSeconds", 0))
            voice        = str(payload.get("voice",  VOICE_NAME))
            pitch        = str(payload.get("pitch",  "+0Hz"))
            volume       = str(payload.get("volume", "+0%"))
            max_rate_pct = float(payload.get("maxRatePercent", RATE_MAX))

            if not text:
                self._json({"error": "text is required."}, 400)
                return
            if target_s <= 0:
                self._json({"error": "targetSeconds must be > 0."}, 400)
                return

            # Resolve voice alias "anjali" → actual model name
            if voice.lower() in ("anjali", "neerja", "default", ""):
                voice = VOICE_NAME

            try:
                result = generate_timed(text, target_s, voice=voice, pitch=pitch, volume=volume, max_rate_pct=max_rate_pct)
            except Exception as exc:
                self._json({"error": str(exc), "traceback": traceback.format_exc(3)}, 500)
                return

            wav = result["wav"]
            # Attach metadata as custom response headers
            if self._cors(200, "audio/wav", len(wav), finish=False):
                self.send_header("X-Actual-Seconds",  f'{result["actualSeconds"]:.3f}')
                self.send_header("X-Target-Seconds",  f'{result["targetSeconds"]:.3f}')
                self.send_header("X-Rate-Used",       result["rate"])
                self.send_header("X-Iterations",      str(result["iterations"]))
                self.send_header("X-Padded",          str(result["padded"]).lower())
                self.send_header(
                    "Content-Disposition",
                    'attachment; filename="timed-voiceover.wav"',
                )
                try:
                    self.end_headers()
                except self._DISC:
                    return
                self._write(wav)
            return

        # ── /api/preview  →  single-pass, no fitting ─────────────────────────
        if self.path.startswith("/api/preview"):
            text   = str(payload.get("text", "")).strip()
            rate   = str(payload.get("rate",   "+0%"))
            pitch  = str(payload.get("pitch",  "+0Hz"))
            volume = str(payload.get("volume", "+0%"))
            voice  = str(payload.get("voice",  VOICE_NAME))
            if voice.lower() in ("anjali", "neerja", "default", ""):
                voice = VOICE_NAME
            if not text:
                self._json({"error": "text is required."}, 400)
                return
            try:
                if self.path.startswith("/api/preview-mp3"):
                    mp3 = generate_single_pass_mp3(_clean_text(text), voice, rate, pitch, volume)
                    if self._cors(200, "audio/mpeg", len(mp3), finish=False):
                        self.send_header("Content-Disposition", 'attachment; filename="preview.mp3"')
                        try:
                            self.end_headers()
                        except self._DISC:
                            return
                        self._write(mp3)
                    return

                wav = generate_single_pass(_clean_text(text), voice, rate, pitch, volume)
            except Exception as exc:
                self._json({"error": str(exc)}, 500)
                return
            dur = _wav_duration_s(wav)
            if self._cors(200, "audio/wav", len(wav), finish=False):
                self.send_header("X-Actual-Seconds", f"{dur:.3f}")
                self.send_header("Content-Disposition", 'attachment; filename="preview.wav"')
                try:
                    self.end_headers()
                except self._DISC:
                    return
                self._write(wav)
            return

        # ── /api/cache/clear ─────────────────────────────────────────────────
        if self.path.startswith("/api/cache/clear"):
            with _cache_lock:
                _cache.clear()
            self._json({"ok": True, "message": "Cache cleared."})
            return

        self._json({"error": "Route not found."}, 404)


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    print(f"╔══════════════════════════════════════════════════════╗", flush=True)
    print(f"║   Timed Voiceover Server  —  http://127.0.0.1:{PORT}   ║", flush=True)
    print(f"╠══════════════════════════════════════════════════════╣", flush=True)
    print(f"║  Voice : {VOICE_NAME:<43}║", flush=True)
    print(f"║  Engine: Microsoft Azure Neural (edge-tts, free)     ║", flush=True)
    print(f"║  Tol   : ±{TOLERANCE_S}s   Max iterations: {MAX_ITERATIONS:<23}  ║", flush=True)
    print(f"╚══════════════════════════════════════════════════════╝", flush=True)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()

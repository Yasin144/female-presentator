"""Isolated Telugu validation gateway for the production SC3 voice.

This process does not load, restart, patch, or stop Chatterbox. It asks the
existing SC3 service for a Telugu candidate, verifies that candidate with the
existing local Whisper service, and returns audio only after strict checks pass.
Nothing here is wired into the production app until real samples pass.
"""
from __future__ import annotations

import base64
import asyncio
import hashlib
import json
import re
import threading
import time
import unicodedata
import urllib.error
import urllib.request
from difflib import SequenceMatcher
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from indic_transliteration import sanscript
from indic_transliteration.sanscript import transliterate

ROOT = Path(__file__).resolve().parent
PORT = 8441
CONVERTER_URL = "http://127.0.0.1:8431/api/convert-song"
CONVERTER_HEALTH = "http://127.0.0.1:8431/health"
ASR_URL = "http://127.0.0.1:8428/api/transcribe"
ASR_HEALTH = "http://127.0.0.1:8428/health"
CACHE = ROOT / "tts-cache" / "telugu-sc3-lab-v1"
CACHE.mkdir(parents=True, exist_ok=True)
REJECTED = ROOT / "temp" / "telugu-sc3-lab-rejected"
REJECTED.mkdir(parents=True, exist_ok=True)
LOCK = threading.Semaphore(1)
MAX_ATTEMPTS = 3
TELUGU_EDGE_VOICE = "te-IN-ShrutiNeural"


def _post_json(url: str, payload: dict, timeout: int) -> tuple[bytes, str]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read(), response.headers.get("Content-Type", "")


def _health(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=3) as response:
            return response.status == 200 and bool(json.loads(response.read()).get("ok"))
    except Exception:
        return False


def normalize_telugu(text: str) -> str:
    value = unicodedata.normalize("NFC", str(text or "")).lower()
    value = "".join(ch for ch in value if "\u0c00" <= ch <= "\u0c7f" or ch.isdigit() or ch.isspace())
    return re.sub(r"\s+", " ", value).strip()


def normalize_phonetic(text: str, source_script: str) -> str:
    value = transliterate(unicodedata.normalize("NFC", str(text or "")), source_script, sanscript.ITRANS).lower()
    value = value.replace("è", "e").replace("ò", "o")
    value = re.sub(r"[^a-z0-9\s]", "", value)
    return re.sub(r"\s+", " ", value).strip()


def score_telugu(expected: str, recognized: str) -> dict:
    wanted = normalize_telugu(expected)
    heard = normalize_telugu(recognized)
    cross_script = not heard and bool(re.search(r"[\u0900-\u097f]", str(recognized or "")))
    if cross_script:
        wanted_for_score = normalize_phonetic(wanted, sanscript.TELUGU)
        heard_for_score = normalize_phonetic(recognized, sanscript.DEVANAGARI)
    else:
        wanted_for_score, heard_for_score = wanted, heard
    wanted_compact = wanted_for_score.replace(" ", "")
    heard_compact = heard_for_score.replace(" ", "")
    char_score = SequenceMatcher(None, wanted_compact, heard_compact).ratio() if wanted_compact and heard_compact else 0.0
    wanted_words = wanted.split()
    heard_words = heard.split()
    matched = sum(1 for word in wanted_words if word in heard_words)
    word_recall = matched / len(wanted_words) if wanted_words else 0.0
    passed = bool(wanted_compact and heard_compact and char_score >= 0.82
                  and (cross_script or len(wanted_words) <= 2 or word_recall >= 0.75))
    return {
        "passed": passed,
        "charScore": round(char_score, 4),
        "wordRecall": round(word_recall, 4),
        "expected": wanted,
        "recognized": heard,
        "recognizedRaw": str(recognized or "").strip(),
        "phoneticExpected": wanted_for_score if cross_script else "",
        "phoneticRecognized": heard_for_score if cross_script else "",
        "crossScript": cross_script,
    }


def transcribe_candidate(audio: bytes) -> str:
    raw, _ = _post_json(ASR_URL, {"audioBase64": base64.b64encode(audio).decode("ascii"), "language": "te"}, 900)
    result = json.loads(raw.decode("utf-8"))
    if result.get("error"):
        raise RuntimeError(str(result["error"]))
    return str(result.get("text") or " ".join(str(item.get("text", "")) for item in result.get("segments", []))).strip()


def generate_telugu_source(text: str) -> bytes:
    import edge_tts

    async def _generate() -> bytes:
        chunks = bytearray()
        communicate = edge_tts.Communicate(text, TELUGU_EDGE_VOICE, rate="-5%")
        async for chunk in communicate.stream():
            if chunk.get("type") == "audio":
                chunks.extend(chunk.get("data") or b"")
        return bytes(chunks)

    audio = asyncio.run(_generate())
    if len(audio) < 1024:
        raise RuntimeError("Native Telugu source voice returned no usable audio.")
    return audio


def convert_source_to_sc3(source_audio: bytes) -> bytes:
    raw, _ = _post_json(CONVERTER_URL, {
        "songBase64": base64.b64encode(source_audio).decode("ascii"),
        "voice": "sc3",
        "tonePreservation": 0.65,
        "outputFileName": "telugu-sc3-lab.mp3",
        "saveToDownloads": False,
    }, 900)
    result = json.loads(raw.decode("utf-8"))
    if not result.get("ok") or not result.get("audioBase64"):
        raise RuntimeError(str(result.get("error") or "SC3 voice conversion returned no audio."))
    return base64.b64decode(result["audioBase64"])


def generate_checked(text: str, attempts: int = MAX_ATTEMPTS) -> tuple[bytes, dict]:
    if not normalize_telugu(text):
        raise ValueError("Enter Telugu script for Telugu SC3 validation.")
    if not _health(CONVERTER_HEALTH):
        raise RuntimeError("The isolated SC3 voice converter is unavailable; production SC3 was not changed.")
    if not _health(ASR_HEALTH):
        raise RuntimeError("Local Whisper validation is unavailable; no unchecked audio was returned.")

    safe_attempts = max(1, min(MAX_ATTEMPTS, int(attempts or MAX_ATTEMPTS)))
    history = []
    with LOCK:
        for attempt in range(1, safe_attempts + 1):
            regeneration_key = f"telugu-lab-{time.time_ns()}-{attempt}"
            source_audio = generate_telugu_source(text)
            audio = convert_source_to_sc3(source_audio)
            if len(audio) < 1024:
                raise RuntimeError("SC3 conversion returned no usable Telugu audio.")
            recognized = transcribe_candidate(audio)
            result = score_telugu(text, recognized)
            result["attempt"] = attempt
            history.append(result)
            if result["passed"]:
                digest = hashlib.sha256((normalize_telugu(text) + "\0" + regeneration_key).encode("utf-8")).hexdigest()
                wav_path = CACHE / f"{digest}.wav"
                json_path = CACHE / f"{digest}.json"
                wav_path.write_bytes(audio)
                json_path.write_text(json.dumps({"text": text, "validation": result}, ensure_ascii=False, indent=2), encoding="utf-8")
                return audio, {"ok": True, "validation": result, "attempts": history, "labCache": str(wav_path)}
            diagnostic_key = f"{time.time_ns()}-attempt-{attempt}"
            (REJECTED / f"{diagnostic_key}-source.mp3").write_bytes(source_audio)
            (REJECTED / f"{diagnostic_key}-converted.mp3").write_bytes(audio)
            (REJECTED / f"{diagnostic_key}.json").write_text(
                json.dumps({"text": text, "validation": result}, ensure_ascii=False, indent=2), encoding="utf-8"
            )
    raise RuntimeError("Telugu pronunciation review required: " + json.dumps(history, ensure_ascii=False))


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "http://127.0.0.1")
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path.rstrip("/") in ("", "/health"):
            self._json(200, {"ok": True, "mode": "isolated-validation-only", "port": PORT,
                             "teluguVoice": TELUGU_EDGE_VOICE,
                             "converterReady": _health(CONVERTER_HEALTH), "whisperReady": _health(ASR_HEALTH),
                             "productionIntegrated": False})
            return
        self._json(404, {"ok": False, "error": "Route not found"})

    def do_POST(self) -> None:
        if self.path.rstrip("/") != "/api/narrate":
            self._json(404, {"ok": False, "error": "Route not found"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0 or size > 100_000:
                raise ValueError("Invalid request size.")
            payload = json.loads(self.rfile.read(size).decode("utf-8"))
            audio, report = generate_checked(str(payload.get("text", "")), payload.get("attempts", MAX_ATTEMPTS))
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(audio)))
            self.send_header("X-Telugu-Lab-Validated", "true")
            self.send_header("X-Telugu-Lab-Score", str(report["validation"]["charScore"]))
            self.send_header("Access-Control-Allow-Origin", "http://127.0.0.1")
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(audio)
        except (ValueError, RuntimeError) as error:
            self._json(422, {"ok": False, "error": str(error)})
        except Exception as error:
            self._json(500, {"ok": False, "error": str(error)})


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    server.daemon_threads = True
    print(f"Telugu SC3 Lab listening on http://127.0.0.1:{PORT} (not integrated into production)", flush=True)
    server.serve_forever()

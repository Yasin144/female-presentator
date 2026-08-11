"""Threaded local Whisper HTTP service for Pattan Presentator.

Keeps /health responsive while one long transcription is running.  It exposes
the same POST /api/transcribe contract as the former PowerShell helper.
"""
from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WHISPER = ROOT / "whisper-transcribe-caption.py"
QUEUE = threading.Semaphore(1)


def transcribe(audio: bytes, language: str) -> dict:
    cache_dir = ROOT / "generated-media" / "transcription-inputs"
    cache_dir.mkdir(parents=True, exist_ok=True)
    source = cache_dir / f"transcribe-{int(time.time() * 1000)}.wav"
    source.write_bytes(audio)
    with QUEUE:
        completed = subprocess.run(
            [sys.executable, str(WHISPER), str(source), language or "auto"],
            cwd=str(ROOT), capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=900,
        )
    if completed.returncode != 0:
        raise RuntimeError((completed.stderr or completed.stdout or "Whisper failed").strip()[-600:])
    lines = [line.strip() for line in completed.stdout.splitlines() if line.strip()]
    if not lines:
        raise RuntimeError("Whisper returned no result")
    result = json.loads(lines[-1])
    if result.get("error"):
        raise RuntimeError(str(result["error"]))
    return result


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def reply(self, status: int, data: dict) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.reply(204, {})

    def do_GET(self) -> None:
        if self.path.rstrip("/") in ("", "/health"):
            available = QUEUE.acquire(blocking=False)
            if available:
                QUEUE.release()
            self.reply(200, {"ok": True, "engine": "threaded-local-whisper", "busy": not available})
        else:
            self.reply(404, {"error": "Route not found"})

    def do_POST(self) -> None:
        if self.path.rstrip("/") != "/api/transcribe":
            self.reply(404, {"error": "Route not found"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0 or size > 250_000_000:
                raise ValueError("Invalid audio upload size")
            payload = json.loads(self.rfile.read(size).decode("utf-8"))
            raw = base64.b64decode(payload.get("audioBase64", ""), validate=True)
            if not raw:
                raise ValueError("No audio data received")
            self.reply(200, transcribe(raw, str(payload.get("language", "auto"))))
        except subprocess.TimeoutExpired:
            self.reply(504, {"error": "Whisper transcription timed out after 900 seconds"})
        except Exception as error:
            self.reply(500, {"error": str(error)})


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8428), Handler)
    server.daemon_threads = True
    print("Threaded transcription server listening on http://127.0.0.1:8428", flush=True)
    server.serve_forever()

import base64
import json
import os
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


PORT = 8431
ROOT = Path(__file__).resolve().parent
MODEL_DIR = ROOT / "AI_Models" / "sc3-singing"
CONFIG_PATH = MODEL_DIR / "singing-model.json"
REFERENCE_VOICE = ROOT / "voice-reference-sc3.wav"
_CONVERTER = None
_TARGET_SE_MAP = {}
_CONVERTER_ERROR = ""
_CONVERTER_LOCK = threading.Lock()


def _json_response(handler, status, payload):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
    handler.send_header("Connection", "close")
    handler.end_headers()
    handler.wfile.write(body)


def _read_request_json(handler):
    length = int(handler.headers.get("Content-Length", "0") or "0")
    if length <= 0:
        return {}
    raw = handler.rfile.read(length)
    return json.loads(raw.decode("utf-8"))


def _model_status():
    if not CONFIG_PATH.exists():
        return {
            "ok": True,
            "server": "sc3-singing",
            "port": PORT,
            "modelReady": False,
            "mode": "not-installed",
            "modelDir": str(MODEL_DIR),
            "message": "Separate sc3 singing model is not installed yet. Existing sc3 narration is untouched.",
        }

    try:
        config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        return {
            "ok": True,
            "server": "sc3-singing",
            "port": PORT,
            "modelReady": False,
            "mode": "config-error",
            "modelDir": str(MODEL_DIR),
            "message": f"Could not read singing-model.json: {exc}",
        }

    command = config.get("command")
    if not isinstance(command, list) or not command:
        return {
            "ok": True,
            "server": "sc3-singing",
            "port": PORT,
            "modelReady": False,
            "mode": "config-error",
            "modelDir": str(MODEL_DIR),
            "message": "singing-model.json must contain a command array.",
        }

    direct_ready = _direct_converter_importable()
    return {
        "ok": True,
        "server": "sc3-singing",
        "port": PORT,
        "modelReady": True,
        "mode": "direct-openvoice" if direct_ready else "external-command",
        "converterWarmed": _CONVERTER is not None and bool(_TARGET_SE_MAP),
        "modelDir": str(MODEL_DIR),
        "message": "sc3 direct voice replacement is ready." if direct_ready else "Separate sc3 singing model is ready.",
    }


def _direct_converter_importable():
    try:
        import openvoice_cli  # noqa: F401
        return True
    except Exception:
        return False


def _prepare_wav(input_path, output_path):
    """Prepare audio for OpenVoice conversion.
    HD resample to 48000Hz stereo.
    Multiband presence EQ & dynamics compressor restores crisp vocal articulation
    and air frequencies so OpenVoice extracts an ultra-clear HD source embedding.
    """
    subprocess.run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(input_path),
        "-af", "highpass=f=85,equalizer=f=280:t=q:w=1.2:g=-3.5,equalizer=f=3500:t=h:w=1.0:g=4.5,equalizer=f=10500:t=h:w=1.0:g=3.5,acompressor=threshold=-18dB:ratio=2.8:attack=10:release=100",
        "-ar", "48000",
        "-ac", "2",
        "-sample_fmt", "s16",
        str(output_path),
    ], cwd=str(ROOT), check=True)


def _write_mp3(input_path, output_path):
    """Write maximum-quality MP3.
    320kbps + -14 LUFS broadcast loudness standard for HD crystal-clear audio.
    """
    subprocess.run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(input_path),
        "-af", "loudnorm=I=-14:TP=-1.0:LRA=7",
        "-codec:a", "libmp3lame",
        "-b:a", "320k",
        "-q:a", "0",
        str(output_path),
    ], cwd=str(ROOT), check=True)


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


def _ensure_converter(device="cpu", voice="sc3"):
    global _CONVERTER, _TARGET_SE_MAP, _CONVERTER_ERROR
    voice = str(voice or "sc3").strip().lower()
    voice_key = "sc3" if voice in ("sc3", "anjali") else voice
    if voice_key not in ("sc3", "pattan", "uploaded"):
        voice_key = "pattan"
    voice_file = f"voice-reference-{voice_key}.wav"
    ref_voice_path = ROOT / voice_file

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
            print(f"[sc3-singing] extracting SE for {voice_key} using {ref_voice_path.name}...", flush=True)
            _TARGET_SE_MAP[voice_key] = _CONVERTER.extract_se(str(ref_voice_path))

        _CONVERTER_ERROR = ""
        return _CONVERTER, _TARGET_SE_MAP[voice_key]
    except Exception as exc:
        _CONVERTER_ERROR = str(exc)
        raise


def _run_direct_model(payload):
    with tempfile.TemporaryDirectory(prefix="sc3-direct-") as temp_dir:
        temp_path = Path(temp_dir)
        input_path = temp_path / "input-audio"
        prepared_path = temp_path / "input.wav"
        converted_path = temp_path / "sc3-voice.wav"
        output_path = temp_path / "sc3-voice.mp3"

        song_base64 = str(payload.get("songBase64") or "")
        file_path   = str(payload.get("filePath") or "")
        voice       = payload.get("voice", "sc3")

        print("[sc3-singing] received direct conversion request.", flush=True)

        if file_path:
            # Caller already wrote the audio to disk — read it directly.
            # This avoids base64 encoding/decoding for large files (no OOM, no ECONNRESET).
            input_path = Path(file_path)
            if not input_path.exists():
                raise FileNotFoundError(f"filePath not found: {file_path}")
            print(f"[sc3-singing] reading audio from disk: {input_path.name}", flush=True)
        elif song_base64:
            input_path.write_bytes(base64.b64decode(song_base64))
        else:
            raise ValueError("Either filePath or songBase64 is required.")


        print("[sc3-singing] preparing uploaded audio.", flush=True)
        _prepare_wav(input_path, prepared_path)
        with _CONVERTER_LOCK:
            print(f"[sc3-singing] converting uploaded audio to {voice}.", flush=True)
            converter, target_se = _ensure_converter("cpu", voice)
            source_se = converter.extract_se(str(prepared_path))
            # tau=0.1 → maximum timbre transfer strength (0=full target, 1=full source).
            # At 0.1 the output voice identity locks to sc3 reference as closely as possible.
            converter.convert(
                audio_src_path=str(prepared_path),
                src_se=source_se,
                tgt_se=target_se,
                output_path=str(converted_path),
                tau=0.1,
            )
        print("[sc3-singing] writing mp3 output.", flush=True)
        _write_mp3(converted_path, output_path)

        if not output_path.exists() or output_path.stat().st_size <= 0:
            raise RuntimeError("Direct sc3 conversion did not create an output MP3.")

        saved_path = ""
        if bool(payload.get("saveToDownloads")):
            saved_target = _unique_download_path(payload.get("outputFileName") or "sc3-voice.mp3")
            saved_target.write_bytes(output_path.read_bytes())
            saved_path = str(saved_target)
            print(f"[sc3-singing] saved mp3 to {saved_path}", flush=True)

        return {
            "ok": True,
            "contentType": "audio/mpeg",
            "audioBase64": base64.b64encode(output_path.read_bytes()).decode("ascii"),
            "fileName": str(payload.get("outputFileName") or "sc3-voice.mp3"),
            "savedPath": saved_path,
        }


def _run_external_model(payload):
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    command = config["command"]
    timeout_seconds = int(config.get("timeoutSeconds", 1800))
    env = os.environ.copy()
    env.update({str(k): str(v) for k, v in dict(config.get("env") or {}).items()})

    with tempfile.TemporaryDirectory(prefix="sc3-singing-") as temp_dir:
        temp_path = Path(temp_dir)
        song_path = temp_path / "song.mp3"
        output_path = temp_path / "sc3-singing-output.mp3"
        song_base64 = str(payload.get("songBase64") or "")
        if not song_base64:
            raise ValueError("songBase64 is required.")
        song_path.write_bytes(base64.b64decode(song_base64))

        replacements = {
            "{song}": str(song_path),
            "{output}": str(output_path),
            "{modelDir}": str(MODEL_DIR),
        }
        resolved_command = []
        for part in command:
            value = str(part)
            for key, replacement in replacements.items():
                value = value.replace(key, replacement)
            resolved_command.append(value)

        completed = subprocess.run(
            resolved_command,
            cwd=str(config.get("cwd") or MODEL_DIR),
            env=env,
            timeout=timeout_seconds,
            capture_output=True,
            text=True,
            check=False,
        )

        if completed.returncode != 0:
            raise RuntimeError((completed.stderr or completed.stdout or "Singing model command failed.").strip())

        if not output_path.exists() or output_path.stat().st_size <= 0:
            raise RuntimeError("Singing model did not create an output MP3.")

        return {
            "ok": True,
            "contentType": "audio/mpeg",
            "audioBase64": base64.b64encode(output_path.read_bytes()).decode("ascii"),
            "fileName": str(payload.get("outputFileName") or "sc3-singing-model.mp3"),
        }


class Handler(BaseHTTPRequestHandler):
    server_version = "Sc3SingingServer/1.0"

    def log_message(self, fmt, *args):
        print("[sc3-singing]", fmt % args, flush=True)

    def do_OPTIONS(self):
        _json_response(self, 200, {"ok": True})

    def do_GET(self):
        if self.path.split("?", 1)[0] == "/health":
            _json_response(self, 200, _model_status())
            return
        _json_response(self, 404, {"ok": False, "error": "Not found."})

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path != "/api/convert-song":
            _json_response(self, 404, {"ok": False, "error": "Not found."})
            return

        status = _model_status()
        if not status.get("modelReady"):
            _json_response(self, 503, {
                "ok": False,
                "error": status.get("message") or "sc3 singing model is not ready.",
                "status": status,
            })
            return

        try:
            payload = _read_request_json(self)
            if _direct_converter_importable():
                _json_response(self, 200, _run_direct_model(payload))
            else:
                _json_response(self, 200, _run_external_model(payload))
        except Exception as exc:
            _json_response(self, 500, {"ok": False, "error": str(exc)})


if __name__ == "__main__":
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    print(f"sc3 singing server listening on http://127.0.0.1:{PORT}", flush=True)
    if _direct_converter_importable():
        def _warm_converter():
            try:
                _ensure_converter("cpu")
                print("[sc3-singing] direct OpenVoice converter warmed.", flush=True)
            except Exception as exc:
                print(f"[sc3-singing] direct OpenVoice warmup failed: {exc}", flush=True)
        threading.Thread(target=_warm_converter, daemon=True).start()
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()

"""Verify backup caption-worker options without starting Whisper or an HTTP server."""
import base64
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location("caption_http", Path(__file__).resolve().parents[1] / "transcribe-http-server.py")
caption_http = importlib.util.module_from_spec(spec)
spec.loader.exec_module(caption_http)


class CaptionHttpFallbackTests(unittest.TestCase):
    def test_backup_worker_preserves_language_hints_and_disabled_recovery(self):
        recognized = {"text": "Ria", "words": [{"word": "Ria", "start": 1, "end": 1.4}], "warnings": ["Review opening"]}
        completed = mock.Mock(returncode=0, stderr="", stdout="PROGRESS:50\n" + json.dumps(recognized))
        with tempfile.TemporaryDirectory() as work, mock.patch.object(caption_http, "ROOT", Path(work)), \
                mock.patch.object(caption_http.subprocess, "run", return_value=completed) as run:
            result = caption_http.transcribe(b"fixture audio", "hi", source_name="lesson.mp4", transcription_hints="Ria",
                                             auto_recover_missing_speech=False)
        args = run.call_args.args[0]
        self.assertEqual(args[3:], ["hi", "lesson.mp4", "speech", "Ria", "no-recovery"])
        self.assertEqual(result, recognized)

    def test_http_payload_options_reach_backup_worker(self):
        payload = {"audioBase64": base64.b64encode(b"fixture audio").decode(), "language": "te",
                   "sourceName": "lesson.mp4", "transcriptionHints": "Ria", "autoRecoverMissingSpeech": False}
        body = json.dumps(payload).encode()
        handler = caption_http.Handler.__new__(caption_http.Handler)
        handler.path = "/api/transcribe"
        handler.headers = {"Content-Length": str(len(body))}
        handler.rfile = io.BytesIO(body)
        handler.reply = mock.Mock()
        with mock.patch.object(caption_http, "transcribe", return_value={"text": "Ria"}) as transcribe:
            handler.do_POST()
        transcribe.assert_called_once_with(b"fixture audio", "te", source_name="lesson.mp4", transcription_hints="Ria",
                                          auto_recover_missing_speech=False, content_mode="speech")
        handler.reply.assert_called_once_with(200, {"text": "Ria"})

    def test_existing_clients_keep_auto_language_and_recovery(self):
        completed = mock.Mock(returncode=0, stderr="", stdout='{"text":"Hello"}')
        with tempfile.TemporaryDirectory() as work, mock.patch.object(caption_http, "ROOT", Path(work)), \
                mock.patch.object(caption_http.subprocess, "run", return_value=completed) as run:
            caption_http.transcribe(b"fixture audio", "auto")
        self.assertEqual(run.call_args.args[0][3:], ["auto", "", "speech", "", "recover"])


if __name__ == "__main__":
    unittest.main()

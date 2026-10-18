"""Exercise local HTTP caption jobs without models, network requests, or a server."""
import base64
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location("caption_http", Path(__file__).resolve().parents[1] / "transcribe-http-server.py")
caption_http = importlib.util.module_from_spec(spec)
spec.loader.exec_module(caption_http)


class CaptionHttpFallbackTests(unittest.TestCase):
    def run_worker(self, output='{"text":"Hello"}', *, returncode=0, stderr="", **options):
        completed = mock.Mock(returncode=returncode, stderr=stderr, stdout=output)
        with tempfile.TemporaryDirectory() as work, mock.patch.object(caption_http, "ROOT", Path(work)), \
                mock.patch.object(caption_http.subprocess, "run", return_value=completed) as run:
            result = caption_http.transcribe(b"fixture audio", **options)
            remaining = list((Path(work) / "generated-media" / "transcription-inputs").glob("*"))
        return result, run.call_args, remaining

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

    def test_worker_preserves_complete_word_result(self):
        recognized = {"text": "Ria likes red", "language": "en", "words": [
            {"word": "Ria", "start": 0.8, "end": 1.2}, {"word": "likes", "start": 1.3, "end": 1.5},
            {"word": "red", "start": 1.6, "end": 2.0}], "segments": [{"text": "Ria likes red", "start": 0.8, "end": 2}],
            "warnings": ["Review opening"], "noSpeech": False}
        result, _, _ = self.run_worker("[Whisper] Loading model\nPROGRESS:99\n" + json.dumps(recognized), language="en")
        self.assertEqual(result, recognized)

    def test_worker_preserves_no_speech_result(self):
        recognized = {"text": "", "words": [], "segments": [], "noSpeech": True, "language": "auto"}
        result, _, _ = self.run_worker(json.dumps(recognized), language="auto")
        self.assertEqual(result, recognized)

    def test_worker_takes_final_nonempty_json_after_progress(self):
        result, _, _ = self.run_worker('debug line\r\nPROGRESS:12\r\n{"text":"Hello"}\r\n\r\n  \r\n', language="en")
        self.assertEqual(result, {"text": "Hello"})

    def test_source_and_decoder_hints_are_bounded_without_shell_interpolation(self):
        hint = "$() & | ` ; " + "x" * 1100
        source = "lesson $(echo test);" + "z" * 310
        _, call, _ = self.run_worker(language="en", source_name=source, transcription_hints=hint)
        args = call.args[0]
        self.assertEqual(args[4], source[:300])
        self.assertEqual(args[6], hint[:1000])
        self.assertNotIn("shell", call.kwargs)
        self.assertEqual(call.kwargs["timeout"], 900)
        self.assertEqual(call.kwargs["encoding"], "utf-8")
        self.assertTrue(call.kwargs["capture_output"])

    def test_worker_error_payload_is_reported(self):
        with self.assertRaisesRegex(RuntimeError, "Decoder rejected the file"):
            self.run_worker('{"error":"Decoder rejected the file","text":""}', language="auto")

    def test_nonzero_worker_exit_is_rejected_even_with_valid_result(self):
        with self.assertRaisesRegex(RuntimeError, "GPU memory exhausted"):
            self.run_worker('{"text":"Hello"}', returncode=2, stderr="GPU memory exhausted", language="en")

    def test_failed_worker_stderr_is_bounded(self):
        with self.assertRaises(RuntimeError) as caught:
            self.run_worker(returncode=1, stderr="x" * 1400 + " final diagnostic", language="en")
        self.assertEqual(len(str(caught.exception)), 600)
        self.assertTrue(str(caught.exception).endswith("final diagnostic"))

    def test_failed_worker_uses_stdout_when_stderr_is_empty(self):
        with self.assertRaisesRegex(RuntimeError, "Fatal worker error"):
            self.run_worker("Fatal worker error", returncode=1, language="en")

    def test_failed_worker_with_no_output_has_clear_error(self):
        with self.assertRaisesRegex(RuntimeError, "Whisper failed"):
            self.run_worker("", returncode=1, language="auto")

    def test_empty_worker_output_has_clear_error(self):
        for output in ("", "\r\n \n\t"):
            with self.subTest(output=repr(output)), self.assertRaisesRegex(RuntimeError, "Whisper returned no result"):
                self.run_worker(output, language="en")

    def test_worker_malformed_json_is_rejected(self):
        for output in ("PROGRESS:99", "{", "{text:'Hello'}", '{"text":"Hello"}\ntrailing log'):
            with self.subTest(output=output), self.assertRaises((RuntimeError, json.JSONDecodeError)):
                self.run_worker(output, language="en")

    def test_worker_nonobject_json_has_clear_error(self):
        for output in ("null", "[]", '"Hello"', "1", "true"):
            with self.subTest(output=output), self.assertRaisesRegex(RuntimeError, "result|object"):
                self.run_worker(output, language="auto")

    def test_worker_input_is_deleted_after_success(self):
        _, _, remaining = self.run_worker(language="en")
        self.assertEqual(remaining, [])

    def test_worker_input_is_deleted_after_every_failure(self):
        outcomes = [mock.Mock(returncode=1, stdout="", stderr="Worker failed"),
                    mock.Mock(returncode=0, stdout="", stderr=""),
                    mock.Mock(returncode=0, stdout='{"error":"decode failed"}', stderr=""),
                    mock.Mock(returncode=0, stdout="{", stderr=""),
                    caption_http.subprocess.TimeoutExpired("whisper", 900), OSError("Python not installed")]
        for outcome in outcomes:
            with self.subTest(outcome=type(outcome).__name__), tempfile.TemporaryDirectory() as work, \
                    mock.patch.object(caption_http, "ROOT", Path(work)), \
                    mock.patch.object(caption_http.subprocess, "run", side_effect=outcome if isinstance(outcome, Exception) else None,
                                      return_value=outcome):
                with self.assertRaises(Exception):
                    caption_http.transcribe(b"fixture", "auto")
                self.assertEqual(list((Path(work) / "generated-media" / "transcription-inputs").glob("*")), [])

    def test_cleanup_does_not_remove_another_jobs_input(self):
        with tempfile.TemporaryDirectory() as work, mock.patch.object(caption_http, "ROOT", Path(work)), \
                mock.patch.object(caption_http.subprocess, "run", return_value=mock.Mock(returncode=0, stdout='{"text":"ok"}', stderr="")):
            directory = Path(work) / "generated-media" / "transcription-inputs"
            directory.mkdir(parents=True)
            unrelated = directory / "existing-job.wav"
            unrelated.write_bytes(b"another job")
            caption_http.transcribe(b"fixture", "en")
            self.assertEqual(unrelated.read_bytes(), b"another job")
            self.assertEqual(list(directory.glob("*")), [unrelated])

    def test_partial_upload_is_deleted_if_input_write_fails(self):
        make_upload = caption_http.tempfile.NamedTemporaryFile

        class BrokenUpload:
            def __init__(self, upload):
                self.upload = upload
                self.name = upload.name

            def __enter__(self):
                return self

            def write(self, audio):
                self.upload.write(audio[:2])
                raise OSError("Disk is full")

            def __exit__(self, *_args):
                self.upload.close()

        with tempfile.TemporaryDirectory() as work, mock.patch.object(caption_http, "ROOT", Path(work)), \
                mock.patch.object(caption_http.tempfile, "NamedTemporaryFile", side_effect=lambda **kwargs: BrokenUpload(make_upload(**kwargs))), \
                mock.patch.object(caption_http.subprocess, "run") as run:
            with self.assertRaisesRegex(OSError, "Disk is full"):
                caption_http.transcribe(b"fixture", "en")
            run.assert_not_called()
            self.assertEqual(list((Path(work) / "generated-media" / "transcription-inputs").glob("*")), [])

    def test_timeout_releases_worker_queue(self):
        queue = threading.Semaphore(1)
        with tempfile.TemporaryDirectory() as work, mock.patch.object(caption_http, "ROOT", Path(work)), \
                mock.patch.object(caption_http, "QUEUE", queue), \
                mock.patch.object(caption_http.subprocess, "run", side_effect=caption_http.subprocess.TimeoutExpired("whisper", 900)):
            with self.assertRaises(caption_http.subprocess.TimeoutExpired):
                caption_http.transcribe(b"fixture", "en")
            self.assertTrue(queue.acquire(blocking=False))
            queue.release()

    def test_same_millisecond_concurrent_uploads_are_distinct_and_serialized(self):
        started = threading.Event()
        release = threading.Event()
        second_waiting = threading.Event()
        paths, audio, results, errors = [], [], [], []

        class ObservedQueue:
            def __init__(self):
                self.semaphore = threading.Semaphore(1)

            def __enter__(self):
                if not self.semaphore.acquire(blocking=False):
                    second_waiting.set()
                    self.semaphore.acquire()

            def __exit__(self, *_args):
                self.semaphore.release()

        def fake_worker(args, **_kwargs):
            paths.append(args[2])
            if len(paths) == 1:
                started.set()
                if not release.wait(3):
                    raise RuntimeError("Test did not release first worker")
            audio.append(Path(args[2]).read_bytes())
            return mock.Mock(returncode=0, stdout='{"text":"Hello"}', stderr="")

        def job(data):
            try:
                results.append(caption_http.transcribe(data, "auto"))
            except Exception as error:
                errors.append(error)

        with tempfile.TemporaryDirectory() as work, mock.patch.object(caption_http, "ROOT", Path(work)), \
                mock.patch.object(caption_http, "QUEUE", ObservedQueue()), \
                mock.patch.object(caption_http.time, "time", return_value=1234.0), \
                mock.patch.object(caption_http.subprocess, "run", side_effect=fake_worker):
            first = threading.Thread(target=job, args=(b"first audio",), daemon=True)
            second = threading.Thread(target=job, args=(b"second audio",), daemon=True)
            first.start()
            try:
                self.assertTrue(started.wait(3))
                second.start()
                self.assertTrue(second_waiting.wait(3))
                self.assertEqual(len(paths), 1, "Whisper workers must be serialized")
            finally:
                release.set()
                first.join(3)
                if second.ident is not None:
                    second.join(3)
            self.assertFalse(first.is_alive())
            self.assertFalse(second.is_alive())
            self.assertEqual(errors, [])
            self.assertEqual(len(results), 2)
            self.assertEqual(audio, [b"first audio", b"second audio"])
            self.assertEqual(len(set(paths)), 2)
            self.assertEqual(list((Path(work) / "generated-media" / "transcription-inputs").glob("*")), [])


class CaptionHttpRequestTests(unittest.TestCase):
    def handler(self, payload=None, *, body=None, size=None, path="/api/transcribe"):
        if body is None:
            body = json.dumps(payload if payload is not None else {"audioBase64": "YXVkaW8="}).encode()
        handler = caption_http.Handler.__new__(caption_http.Handler)
        handler.path = path
        handler.headers = {"Content-Length": str(len(body)) if size is None else str(size)}
        handler.rfile = io.BytesIO(body)
        handler.reply = mock.Mock()
        return handler

    def test_trailing_slash_transcription_route(self):
        handler = self.handler(path="/api/transcribe/")
        with mock.patch.object(caption_http, "transcribe", return_value={"text": "Hello"}) as transcribe:
            handler.do_POST()
        self.assertEqual(transcribe.call_args.args, (b"audio", "auto"))
        handler.reply.assert_called_once_with(200, {"text": "Hello"})

    def test_unknown_post_route_does_not_start_a_worker(self):
        handler = self.handler(path="/api/unknown")
        with mock.patch.object(caption_http, "transcribe") as transcribe:
            handler.do_POST()
        transcribe.assert_not_called()
        handler.reply.assert_called_once_with(404, {"error": "Route not found"})

    def test_http_worker_error_is_reported_without_success(self):
        handler = self.handler()
        with mock.patch.object(caption_http, "transcribe", side_effect=RuntimeError("CPU decoder failed")):
            handler.do_POST()
        handler.reply.assert_called_once_with(500, {"error": "CPU decoder failed"})

    def test_http_worker_timeout_is_gateway_timeout(self):
        handler = self.handler()
        with mock.patch.object(caption_http, "transcribe", side_effect=caption_http.subprocess.TimeoutExpired("whisper", 900)):
            handler.do_POST()
        handler.reply.assert_called_once_with(504, {"error": "Whisper transcription timed out after 900 seconds"})

    def test_malformed_worker_json_is_server_error(self):
        handler = self.handler()
        completed = mock.Mock(returncode=0, stdout="{", stderr="")
        with tempfile.TemporaryDirectory() as work, mock.patch.object(caption_http, "ROOT", Path(work)), \
                mock.patch.object(caption_http.subprocess, "run", return_value=completed):
            handler.do_POST()
        status, payload = handler.reply.call_args.args
        self.assertEqual(status, 500)
        self.assertTrue(payload.get("error"))

    def test_valid_payload_unicode_preserves_audio_and_options(self):
        payload = {"audioBase64": base64.b64encode(b"\x00\xfffixture").decode(), "language": "hi",
                   "sourceName": "lesson \u0930\u093f\u092f\u093e.mp4", "transcriptionHints": "\u0930\u093f\u092f\u093e red",
                   "contentMode": "song", "autoRecoverMissingSpeech": False}
        handler = self.handler(payload)
        with mock.patch.object(caption_http, "transcribe", return_value={"text": "\u0930\u093f\u092f\u093e"}) as transcribe:
            handler.do_POST()
        transcribe.assert_called_once_with(b"\x00\xfffixture", "hi", source_name=payload["sourceName"],
                                          transcription_hints=payload["transcriptionHints"], auto_recover_missing_speech=False, content_mode="song")
        handler.reply.assert_called_once_with(200, {"text": "\u0930\u093f\u092f\u093e"})

    def test_options_default_when_optional_fields_are_null(self):
        handler = self.handler({"audioBase64": "YXVkaW8=", "language": None, "sourceName": None,
                                "transcriptionHints": None, "contentMode": None, "autoRecoverMissingSpeech": None})
        with mock.patch.object(caption_http, "transcribe", return_value={"text": "Hi"}) as transcribe:
            handler.do_POST()
        transcribe.assert_called_once_with(b"audio", "auto", source_name="", transcription_hints="",
                                          auto_recover_missing_speech=True, content_mode="speech")

    def test_only_explicit_false_disables_recovery(self):
        for value in (True, None, 0, "false", "", [], {}):
            with self.subTest(value=value):
                handler = self.handler({"audioBase64": "YXVkaW8=", "autoRecoverMissingSpeech": value})
                with mock.patch.object(caption_http, "transcribe", return_value={"text": "Hi"}) as transcribe:
                    handler.do_POST()
                self.assertTrue(transcribe.call_args.kwargs["auto_recover_missing_speech"])

    def test_health_remains_responsive_while_worker_is_busy(self):
        queue = threading.Semaphore(1)
        queue.acquire()
        handler = self.handler(path="/health")
        with mock.patch.object(caption_http, "QUEUE", queue):
            handler.do_GET()
        handler.reply.assert_called_once_with(200, {"ok": True, "engine": "threaded-local-whisper", "busy": True})
        self.assertFalse(queue.acquire(blocking=False))
        queue.release()

    def test_health_idle_check_releases_worker_queue(self):
        for path in ("", "/", "/health", "/health/"):
            with self.subTest(path=path):
                queue = threading.Semaphore(1)
                handler = self.handler(path=path)
                with mock.patch.object(caption_http, "QUEUE", queue):
                    handler.do_GET()
                handler.reply.assert_called_once_with(200, {"ok": True, "engine": "threaded-local-whisper", "busy": False})
                self.assertTrue(queue.acquire(blocking=False))
                queue.release()

    def test_unknown_get_route_is_not_health(self):
        handler = self.handler(path="/api/transcribe")
        handler.do_GET()
        handler.reply.assert_called_once_with(404, {"error": "Route not found"})

    def test_http_reply_has_unicode_json_and_matching_byte_length(self):
        handler = self.handler()
        handler.send_response = mock.Mock()
        handler.send_header = mock.Mock()
        handler.end_headers = mock.Mock()
        handler.wfile = io.BytesIO()
        caption_http.Handler.reply(handler, 200, {"text": "\u0930\u093f\u092f\u093e"})
        body = handler.wfile.getvalue()
        self.assertEqual(json.loads(body), {"text": "\u0930\u093f\u092f\u093e"})
        headers = dict(call.args for call in handler.send_header.call_args_list)
        self.assertEqual(headers["Content-Length"], str(len(body)))
        self.assertEqual(headers["Content-Type"], "application/json; charset=utf-8")
        self.assertEqual(headers["Access-Control-Allow-Origin"], "*")
        self.assertEqual(headers["Connection"], "close")
        handler.send_response.assert_called_once_with(200)

    def test_preflight_allows_json_post_and_has_no_204_body(self):
        handler = self.handler()
        handler.send_response = mock.Mock()
        handler.send_header = mock.Mock()
        handler.end_headers = mock.Mock()
        handler.wfile = io.BytesIO()
        handler.reply = lambda status, data: caption_http.Handler.reply(handler, status, data)
        handler.do_OPTIONS()
        headers = dict(call.args for call in handler.send_header.call_args_list)
        handler.send_response.assert_called_once_with(204)
        self.assertIn("POST", headers.get("Access-Control-Allow-Methods", ""))
        self.assertIn("content-type", headers.get("Access-Control-Allow-Headers", "").lower())
        self.assertEqual(handler.wfile.getvalue(), b"")


def worker_language_case(language):
    def scenario(self):
        _, call, _ = self.run_worker(language=language)
        self.assertEqual(call.args[0][3], language or "auto")
    return scenario


for language in ("auto", "en", "hi", "te", "ta", "ur", "ar", "es", "fr", "ja", "zh", ""):
    setattr(CaptionHttpFallbackTests, "test_worker_language_" + (language or "empty"), worker_language_case(language))


def worker_mode_case(mode, expected):
    def scenario(self):
        _, call, _ = self.run_worker(language="auto", content_mode=mode)
        self.assertEqual(call.args[0][5], expected)
    return scenario


for mode, expected in (("speech", "speech"), ("song", "song"), ("", "speech"), (None, "speech"), ("unexpected", "speech")):
    setattr(CaptionHttpFallbackTests, "test_worker_mode_" + str(mode or "empty"), worker_mode_case(mode, expected))


def bad_request_case(body, size=None):
    def scenario(self):
        handler = self.handler(body=body, size=size)
        with mock.patch.object(caption_http, "transcribe") as transcribe:
            handler.do_POST()
        transcribe.assert_not_called()
        self.assertEqual(handler.reply.call_count, 1)
        status, payload = handler.reply.call_args.args
        self.assertEqual(status, 400)
        self.assertTrue(payload.get("error"))
    return scenario


BAD_REQUESTS = {
    "empty_body": (b"", None), "zero_size": (b"{}", 0), "negative_size": (b"{}", -1),
    "size_exceeds_limit": (b"{}", 250_000_001), "size_not_numeric": (b"{}", "many"),
    "truncated_body": (b'{"audioBase64":', None), "invalid_utf8": (b"\xff", None),
    "invalid_json": (b"{bad}", None), "json_null": (b"null", None), "json_list": (b"[]", None),
    "json_number": (b"42", None), "json_string": (b'"audio"', None),
    "missing_audio": (b"{}", None), "empty_audio": (b'{"audioBase64":""}', None),
    "null_audio": (b'{"audioBase64":null}', None), "numeric_audio": (b'{"audioBase64":4}', None),
    "list_audio": (b'{"audioBase64":[]}', None), "object_audio": (b'{"audioBase64":{}}', None),
    "invalid_base64": (b'{"audioBase64":"not@base64"}', None),
    "base64_with_whitespace": (b'{"audioBase64":"YXV kaW8="}', None),
    "base64_bad_padding": (b'{"audioBase64":"YXVkaW8"}', None),
    "nonascii_base64": (json.dumps({"audioBase64": "\u0930\u093f\u092f\u093e"}).encode(), None),
}

for name, (body, size) in BAD_REQUESTS.items():
    setattr(CaptionHttpRequestTests, "test_rejects_" + name, bad_request_case(body, size))


if __name__ == "__main__":
    unittest.main()

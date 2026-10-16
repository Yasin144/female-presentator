"""Caption translation contract regressions with mocked providers.

Run: python -I scripts/test-caption-translation-backend.py
Uses only the standard library and an ephemeral loopback HTTP server. It never
reads real API keys or sends requests to an online translation provider.
"""
import contextlib
import copy
import http.client
import importlib.util
import io
import json
from pathlib import Path
import threading
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("caption_translation_backend", ROOT / "translate-server.py")
server = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(server)


class JsonResponse:
    def __init__(self, payload):
        self.body = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self):
        return self.body


class TranslationTests(unittest.TestCase):
    def setUp(self):
        self.logs = io.StringIO()
        self.capture = contextlib.redirect_stdout(self.logs)
        self.capture.__enter__()
        with server._cache_lock:
            server._cache.clear()

    def tearDown(self):
        self.capture.__exit__(None, None, None)

    def test_language_defaults_aliases_and_unsupported_codes(self):
        self.assertEqual(server.normalize_lang(None), "en")
        self.assertEqual(server.normalize_lang("ENGLISH"), "en")
        self.assertEqual(server.normalize_lang("Telugu"), "te")
        self.assertEqual(server.normalize_lang("Hindi"), "hi")
        self.assertEqual(server.normalize_lang("AUTO", allow_auto=True), "auto")
        for code in ("auto", "unsupported", 123, {}):
            with self.subTest(code=code), self.assertRaises(ValueError):
                server.normalize_lang(code)

    def test_explicit_same_language_needs_no_provider_but_auto_does(self):
        with patch.object(server, "translate_chunk", return_value=["Hello"]) as translate:
            self.assertEqual(server.translate_batch([" Hello "], "English", "en"), ["Hello"])
            translate.assert_not_called()
            self.assertEqual(server.translate_batch(["Hello"], "en", "auto"), ["Hello"])
            translate.assert_called_once_with(["Hello"], "en", "auto")

    def test_invalid_input_items_are_never_stringified(self):
        for texts in ("hello", {}, [], [None], [7], [{"text": "hello"}], ["hello", " "]):
            with self.subTest(texts=texts), self.assertRaises(ValueError), patch.object(server, "translate_chunk") as translate:
                server.translate_batch(texts, "hi")
                translate.assert_not_called()

    def test_single_animal_glossary_corrects_only_the_source_grounded_cue(self):
        originals = ["Fox", "Tiger is a wild animal.", "The deer eats grass.", "Hello"]
        translations = ["నక్క", "నక్క ఒక అడవి జంతువు.", "ఏనుగు గడ్డి తింటుంది.", "నమస్కారం"]
        self.assertEqual(server.validate_caption_meaning(originals, translations, "te", "auto"),
                         ["నక్క", "పులి ఒక అడవి జంతువు.", "జింక గడ్డి తింటుంది.", "నమస్కారం"])
        self.assertEqual(translations[1], "నక్క ఒక అడవి జంతువు.")

    def test_animal_correction_preserves_explicit_case_number_and_punctuation(self):
        for wrong, corrected in (("నక్క", "పులి"), ("నక్కలు", "పులులు"), ("నక్కను", "పులిని"),
                                 ("నక్కకి", "పులికి"), ("నక్కకు", "పులికి"), ("నక్కతో", "పులితో"),
                                 ("నక్కలను", "పులులను"), ("నక్కలకు", "పులులకు"), ("నక్కలతో", "పులులతో")):
            with self.subTest(wrong=wrong):
                self.assertEqual(server.validate_caption_meaning(["Tiger"], [f'"{wrong}!"'], "te", "en"),
                                 [f'"{corrected}!"'])

    def test_actual_fox_jackal_and_correct_animal_terms_are_preserved(self):
        originals = ["Fox", "A jackal lives here.", "Tiger", "Elephants", "Lion", "Giraffe", "Deer"]
        translations = ["నక్క", "నక్క ఇక్కడ నివసిస్తుంది.", "పులి", "ఏనుగులు", "సింహం", "జిరాఫీ", "జింక"]
        self.assertEqual(server.validate_caption_meaning(originals, translations, "te", "en"), translations)
        self.assertEqual(server.validate_caption_meaning(["Fox"], ["పులి"], "te", "en"), ["నక్క"])

    def test_animal_guard_does_not_match_substrings_proper_names_or_other_source_languages(self):
        for original in ("Tiger Woods won.", "The tiger shark swims.", "Fox News reported it.",
                         "A paper tiger", "Tigerfish", "The lion's share", "Tiger and fox are animals."):
            with self.subTest(original=original):
                self.assertEqual(server.validate_caption_meaning([original], ["నక్క"], "te", "en"), ["నక్క"])
        self.assertEqual(server.validate_caption_meaning(["Tiger"], ["नमस्ते"], "hi", "en"), ["नमस्ते"])
        self.assertEqual(server.validate_caption_meaning(["Tiger"], ["నక్క"], "te", "hi"), ["నక్క"])
        self.assertEqual(server.validate_caption_meaning(["ఇది Tiger"], ["నక్క"], "te", "auto"), ["నక్క"])
        self.assertEqual(server.validate_caption_meaning(["It hides."], ["నక్కింది."], "te", "en"), ["నక్కింది."])

    def test_unknown_morphology_missing_noun_and_mixed_target_animals_are_not_guessed(self):
        for translated in ("ఇది ఒక జంతువు.", "నక్కింది.", "నక్కలా ఉంది.", "నక్క మరియు సింహం", "పులి మరియు నక్క"):
            with self.subTest(translated=translated), self.assertRaises(ValueError):
                server.validate_caption_meaning(["Tiger"], [translated], "te", "en")

    def test_telugu_prompt_keeps_tiger_fox_terms_in_their_own_numbered_cues(self):
        prompt = server.caption_translation_prompt("te", ["Fox", "Tiger is a wild animal.", "Hello"], "en")
        self.assertIn("Cue 1: fox/jackal = నక్క", prompt)
        self.assertIn("Cue 2: tiger = పులి", prompt)
        self.assertNotIn("Cue 3:", prompt)
        self.assertIn("Never substitute one for the other", prompt)
        self.assertEqual(server.caption_translation_prompt("te", ["Tiger Woods"], "en"), server.TELUGU_NARRATION_PROMPT)

    def test_semantically_incomplete_batch_falls_back_without_shifting_cues(self):
        with patch.object(server, "gemini_translate_batch", return_value=["ఇది ఒక జంతువు.", "నక్క"]) as gemini, \
                patch.object(server, "local_ai_translate_batch", return_value=["పులి", "నక్క"]) as local:
            self.assertEqual(server.translate_batch(["Tiger", "Fox"], "te", "en"), ["పులి", "నక్క"])
        gemini.assert_called_once()
        local.assert_called_once()

    def test_compatibility_fallback_also_applies_single_animal_semantics(self):
        with patch.object(server, "gemini_translate_batch", side_effect=OSError("offline")), \
                patch.object(server, "local_ai_translate_batch", side_effect=OSError("offline")), \
                patch.object(server, "google_translate_direct", side_effect=["నక్క", "నక్క"]), \
                patch.object(server, "deep_translate") as deep:
            self.assertEqual(server.translate_batch(["Tiger", "Fox"], "te", "en"), ["పులి", "నక్క"])
        deep.assert_not_called()

    def test_gemini_and_ollama_validate_their_direct_animal_outputs(self):
        gemini = {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": '["నక్క"]'}]}}]}
        ollama = {"message": {"content": '["నక్క"]'}, "done": True, "done_reason": "stop"}
        with patch.dict(server.os.environ, {"GEMINI_API_KEY": "NOT-A-REAL-KEY"}), \
                patch.object(server.urllib.request, "urlopen", return_value=JsonResponse(gemini)):
            self.assertEqual(server.gemini_translate_batch(["Tiger"], "te", "en"), ["పులి"])
        with patch.object(server.urllib.request, "urlopen", return_value=JsonResponse(ollama)):
            self.assertEqual(server.local_ai_translate_batch(["Tiger"], "te", "en"), ["పులి"])

    def test_invalid_provider_arrays_fall_back_as_a_whole(self):
        for invalid in (["one"], ["one", ""], ["one", {"text": "two"}], ["one", 2], "one, two"):
            with self.subTest(invalid=invalid), patch.object(server, "gemini_translate_batch", return_value=invalid), \
                    patch.object(server, "local_ai_translate_batch", return_value=["एक", "दो"]) as local:
                self.assertEqual(server.translate_batch(["one", "two"], "hi"), ["एक", "दो"])
                local.assert_called_once()

    def test_compatibility_partial_results_are_discarded(self):
        with patch.object(server, "gemini_translate_batch", side_effect=OSError("offline")), \
                patch.object(server, "local_ai_translate_batch", side_effect=OSError("offline")), \
                patch.object(server, "deep_translate", side_effect=["bad partial", None]), \
                patch.object(server, "google_translate_direct", side_effect=["एक", "दो"]):
            self.assertEqual(server.translate_batch(["one", "two"], "hi"), ["एक", "दो"])

    def test_all_providers_fail_without_original_text_success_or_secret_logs(self):
        failure = RuntimeError("KEY_TEST_SECRET source-private-caption")
        with patch.object(server, "gemini_translate_batch", side_effect=failure) as gemini, \
                patch.object(server, "local_ai_translate_batch", side_effect=failure) as local, \
                patch.object(server, "deep_translate", return_value=None), \
                patch.object(server, "google_translate_direct", return_value=""):
            with self.assertRaises(server.TranslationUnavailable):
                server.translate_batch(["source-private-caption", "another caption"], "te")
            gemini.assert_called_once()
            local.assert_called_once()
        self.assertNotIn("KEY_TEST_SECRET", self.logs.getvalue())
        self.assertNotIn("source-private-caption", self.logs.getvalue())

    def test_long_batches_preserve_order_and_bound_provider_context(self):
        original = ["aa", "bb", "ccc", "d", "ee"]
        before = copy.deepcopy(original)
        with patch.object(server, "MAX_BATCH_ITEMS", 2), patch.object(server, "MAX_BATCH_CHARACTERS", 5), \
                patch.object(server, "gemini_translate_batch", side_effect=lambda texts, *_: ["T:" + text for text in texts]) as provider:
            self.assertEqual(server.translate_batch(original, "en"), ["T:" + text for text in original])
        self.assertEqual(original, before)
        self.assertEqual([call.args[0] for call in provider.call_args_list], [["aa", "bb"], ["ccc", "d"], ["ee"]])

    def test_later_chunk_failure_returns_no_partial_batch(self):
        original = ["first", "second", "third"]
        before = copy.deepcopy(original)
        with patch.object(server, "MAX_BATCH_ITEMS", 2), \
                patch.object(server, "gemini_translate_batch", side_effect=[["एक", "दो"], OSError("unavailable")]), \
                patch.object(server, "local_ai_translate_batch", side_effect=OSError("unavailable")), \
                patch.object(server, "deep_translate", side_effect=OSError("unavailable")), \
                patch.object(server, "google_translate_direct", side_effect=OSError("unavailable")):
            with self.assertRaises(server.TranslationUnavailable):
                server.translate_batch(original, "hi")
        self.assertEqual(original, before)

    def test_cache_uses_complete_text_and_is_bounded(self):
        first, second = "x" * 120 + " first ending", "x" * 120 + " second ending"
        with patch.object(server, "CACHE_LIMIT", 2), \
                patch.object(server, "translate_batch", side_effect=lambda texts, *_: ["translated:" + texts[0]]) as translate:
            self.assertEqual(server.translate_text(first, "te"), "translated:" + first)
            self.assertEqual(server.translate_text(second, "te"), "translated:" + second)
            self.assertEqual(server.translate_text(first, "te"), "translated:" + first)
            self.assertEqual(translate.call_count, 2)
            server.translate_text("third", "te")
        self.assertEqual(len(server._cache), 2)
        self.assertNotIn(("auto", "te", second), server._cache)

    def test_gemini_english_hindi_telugu_prompts_and_exact_results(self):
        outputs = {"en": ["Hello", "World"], "hi": ["नमस्ते", "दुनिया"], "te": ["నమస్కారం", "ప్రపంచం"]}
        for target, translated in outputs.items():
            payload = {"candidates": [{"finishReason": "STOP", "content": {"parts": [
                {"thought": True, "text": "private reasoning"},
                {"text": json.dumps(translated, ensure_ascii=False)}]}}]}
            with self.subTest(target=target), patch.dict(server.os.environ, {"GEMINI_API_KEY": "NOT-A-REAL-KEY"}), \
                    patch.object(server.urllib.request, "urlopen", return_value=JsonResponse(payload)) as request:
                self.assertEqual(server.gemini_translate_batch(["Hello", "World"], target), translated)
            body = json.loads(request.call_args.args[0].data.decode("utf-8"))
            prompt = body["contents"][0]["parts"][0]["text"]
            self.assertIn("one translated string", prompt)
            self.assertIn("do not move", prompt)
            self.assertIn("concise", prompt)
            if target == "te":
                self.assertIn("Detect the source language", prompt)
                self.assertNotIn("supplied English narration", prompt)
            self.assertNotIn("private reasoning", self.logs.getvalue())

    def test_gemini_rejects_empty_wrong_count_nonstring_and_truncated_output(self):
        variants = [([], "STOP"), (["one"], "STOP"), (["one", 2], "STOP"),
                    (["one", ""], "STOP"), (["one", "two"], "MAX_TOKENS")]
        for translated, reason in variants:
            payload = {"candidates": [{"finishReason": reason, "content": {"parts": [{"text": json.dumps(translated)}]}}]}
            with self.subTest(translated=translated, reason=reason), \
                    patch.dict(server.os.environ, {"GEMINI_API_KEY": "NOT-A-REAL-KEY"}), \
                    patch.object(server.urllib.request, "urlopen", return_value=JsonResponse(payload)), self.assertRaises(ValueError):
                server.gemini_translate_batch(["one", "two"], "hi")

    def test_ollama_validates_wrapped_array_and_complete_generation(self):
        variants = [({"translations": ["ఒకటి", "రెండు"]}, True, "stop", True),
                    (["ఒకటి", {"text": "రెండు"}], True, "stop", False),
                    (["ఒకటి", "రెండు"], False, "stop", False),
                    (["ఒకటి", "రెండు"], True, "length", False)]
        for output, done, reason, valid in variants:
            payload = {"message": {"content": json.dumps(output, ensure_ascii=False)}, "done": done, "done_reason": reason}
            with self.subTest(output=output, done=done, reason=reason), \
                    patch.object(server.urllib.request, "urlopen", return_value=JsonResponse(payload)):
                if valid:
                    self.assertEqual(server.local_ai_translate_batch(["one", "two"], "te"), ["ఒకటి", "రెండు"])
                else:
                    with self.assertRaises(ValueError):
                        server.local_ai_translate_batch(["one", "two"], "te")


class HttpContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http_server = server.ThreadingHTTPServer(("127.0.0.1", 0), server.TranslateHandler)
        cls.http_server.daemon_threads = True
        cls.thread = threading.Thread(target=cls.http_server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.http_server.shutdown()
        cls.http_server.server_close()
        cls.thread.join(timeout=2)

    def post(self, payload, path="/api/translate/batch"):
        connection = http.client.HTTPConnection("127.0.0.1", self.http_server.server_port, timeout=2)
        try:
            connection.request("POST", path, body=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                               headers={"Content-Type": "application/json"})
            response = connection.getresponse()
            return response.status, json.loads(response.read().decode("utf-8"))
        finally:
            connection.close()

    def test_http_invalid_payloads_fail_before_provider_use(self):
        invalid = [[], {"texts": "one"}, {"texts": [None]}, {"texts": [" "]},
                   {"texts": ["one"], "target": "auto"}, {"texts": ["one"], "target": "not-a-language"},
                   {"texts": ["one"], "source": "not-a-language"}]
        with patch.object(server, "translate_batch") as translate, contextlib.redirect_stdout(io.StringIO()):
            for payload in invalid:
                with self.subTest(payload=payload):
                    code, response = self.post(payload)
                    self.assertEqual(code, 400)
                    self.assertIn("error", response)
            translate.assert_not_called()

    def test_http_default_english_keeps_complete_ordered_cue_contract(self):
        with patch.object(server, "translate_batch", return_value=["First", "Second"]) as translate, \
                contextlib.redirect_stdout(io.StringIO()):
            code, response = self.post({"texts": ["మొదటి", "రెండవ"]})
        self.assertEqual(code, 200)
        self.assertEqual(response, {"results": ["First", "Second"], "target": "en"})
        translate.assert_called_once_with(["మొదటి", "రెండవ"], "en", "auto")

    def test_http_provider_errors_and_bad_output_never_return_partial_results_or_keys(self):
        for result in (["one"], ["one", ""], ["one", 2], RuntimeError("KEY_TEST_SECRET")):
            with self.subTest(result=result), contextlib.redirect_stdout(io.StringIO()) as logs:
                provider = patch.object(server, "translate_batch", side_effect=result) if isinstance(result, Exception) else \
                    patch.object(server, "translate_batch", return_value=result)
                with provider:
                    code, response = self.post({"texts": ["one", "two"], "target": "hi"})
                self.assertEqual(code, 502)
                self.assertNotIn("results", response)
                self.assertNotIn("KEY_TEST_SECRET", json.dumps(response) + logs.getvalue())

    def test_http_single_caption_rejects_nontext_and_empty_provider_output(self):
        with patch.object(server, "translate_text") as translate, contextlib.redirect_stdout(io.StringIO()):
            code, _ = self.post({"text": {"caption": "one"}}, "/api/translate")
            self.assertEqual(code, 400)
            translate.assert_not_called()
        with patch.object(server, "translate_text", return_value=""), contextlib.redirect_stdout(io.StringIO()):
            code, response = self.post({"text": "one", "target": "te"}, "/api/translate")
            self.assertEqual(code, 502)
            self.assertNotIn("translated", response)


if __name__ == "__main__":
    unittest.main(verbosity=2)

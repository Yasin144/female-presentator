import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("telugu_sc3_lab", ROOT / "telugu-sc3-lab.py")
LAB = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(LAB)


class TeluguLabTests(unittest.TestCase):
    def test_normalizes_telugu_without_accepting_english(self):
        self.assertEqual(LAB.normalize_telugu(" తెలుగు!  భాష "), "తెలుగు భాష")
        self.assertEqual(LAB.normalize_telugu("English only"), "")

    def test_exact_and_near_exact_telugu_pass(self):
        self.assertTrue(LAB.score_telugu("తెలుగు భాష చాలా మధురమైనది", "తెలుగు భాష చాలా మధురమైనది")["passed"])
        self.assertTrue(LAB.score_telugu("తెలుగు భాష చాలా మధురమైనది", "తెలుగు భాష చాల మధురమైనది")["passed"])

    def test_missing_or_wrong_words_fail(self):
        self.assertFalse(LAB.score_telugu("తెలుగు భాష చాలా మధురమైనది", "తెలుగు భాష")["passed"])
        self.assertFalse(LAB.score_telugu("తెలుగు భాష", "English output")["passed"])

    def test_devanagari_whisper_transcript_is_checked_phonetically(self):
        result = LAB.score_telugu("తెలుగు భాష చాలా మధురమైనది", "तलुगु भाशा चाला मद्रो में नदी")
        self.assertTrue(result["crossScript"])
        self.assertTrue(result["passed"])
        self.assertGreaterEqual(result["charScore"], 0.82)
        wrong = LAB.score_telugu("తెలుగు భాష చాలా మధురమైనది", "यह एक पूरी तरह अलग वाक्य है")
        self.assertFalse(wrong["passed"])

    def test_lab_is_separate_from_production_ports_and_cache(self):
        self.assertEqual(LAB.PORT, 8441)
        self.assertIn("telugu-sc3-lab-v1", str(LAB.CACHE))
        self.assertNotEqual(LAB.PORT, 8426)

    def test_native_telugu_is_converted_then_validated(self):
        self.assertEqual(LAB.TELUGU_EDGE_VOICE, "te-IN-ShrutiNeural")
        source = (ROOT / "telugu-sc3-lab.py").read_text(encoding="utf-8")
        self.assertIn("source_audio = generate_telugu_source(text)", source)
        self.assertIn("audio = convert_source_to_sc3(source_audio)", source)
        self.assertIn("recognized = transcribe_candidate(audio)", source)
        self.assertIn("telugu-sc3-lab-rejected", str(LAB.REJECTED))
        self.assertIn('"tonePreservation": 0.65', source)


if __name__ == "__main__":
    unittest.main()

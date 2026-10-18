"""Check the real SC3 busy snapshot without loading voice models."""
import ast
from pathlib import Path
import threading
import unittest


SOURCE = Path(__file__).resolve().parents[1] / "anjali-chatterbox-server.py"
TREE = ast.parse(SOURCE.read_text(encoding="utf-8"))
SNAPSHOT = next(node for node in TREE.body if isinstance(node, ast.FunctionDef)
                and node.name == "_get_voice_progress_snapshot")


class VoiceBusyTests(unittest.TestCase):
    def setUp(self):
        self.progress = {"active": False, "stage": "Done", "pct": 100}
        self.synth_lock = threading.Lock()
        self.converter_lock = threading.Lock()
        context = {"_progress": self.progress, "_progress_lock": threading.Lock(),
                   "_synth_lock": self.synth_lock, "_CONVERTER_LOCK": self.converter_lock}
        exec(compile(ast.Module(body=[SNAPSHOT], type_ignores=[]), str(SOURCE), "exec"), context)
        self.snapshot = context["_get_voice_progress_snapshot"]

    def test_idle_is_inactive_and_returns_an_independent_snapshot(self):
        result = self.snapshot()
        self.assertFalse(result["active"])
        result["stage"] = "changed"
        self.assertEqual(self.progress["stage"], "Done")

    def test_completed_progress_cannot_hide_synthesis_still_holding_the_model(self):
        with self.synth_lock:
            self.assertTrue(self.snapshot()["active"])
        self.assertFalse(self.snapshot()["active"])
        self.assertFalse(self.progress["active"])

    def test_voice_conversion_is_busy_even_without_narration_progress(self):
        with self.converter_lock:
            result = self.snapshot()
            self.assertTrue(result["active"])
            self.assertEqual(result["stage"], "SC3 voice model is working")
        self.assertFalse(self.snapshot()["active"])

    def test_running_narration_keeps_its_stage_and_progress(self):
        self.progress.update(active=True, stage="Generating speech tokens", pct=45)
        with self.synth_lock:
            self.assertEqual(self.snapshot(), self.progress)

    def test_http_progress_routes_both_use_the_busy_snapshot(self):
        handler = next(node for node in TREE.body if isinstance(node, ast.ClassDef)
                       and node.name == "Handler")
        for name in ("do_GET", "do_POST"):
            method = next(node for node in handler.body if isinstance(node, ast.FunctionDef)
                          and node.name == name)
            calls = [node for node in ast.walk(method) if isinstance(node, ast.Call)
                     and isinstance(node.func, ast.Name)
                     and node.func.id == "_get_voice_progress_snapshot"]
            self.assertEqual(len(calls), 1, name)


if __name__ == "__main__":
    unittest.main()

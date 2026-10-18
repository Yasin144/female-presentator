"""CPU AI eraser contracts, with fake Torch inference and model downloads.

Run with the Caption Eraser runtime or Python with numpy/OpenCV installed:
    python -I scripts/test-caption-eraser-ai.py
No model weights, PyTorch import, or external network request is required.
"""

import contextlib
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("caption_eraser_ai", ROOT / "caption-eraser-ai.py")
ai = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ai)


class NumpyTensor:
    def __init__(self, data):
        self.data = np.asarray(data)

    def unsqueeze(self, dimension):
        return NumpyTensor(np.expand_dims(self.data, dimension))

    def __getitem__(self, item):
        return NumpyTensor(self.data[item])

    def permute(self, *dimensions):
        return NumpyTensor(self.data.transpose(dimensions))

    def detach(self):
        return self

    def cpu(self):
        return self

    def numpy(self):
        return self.data


class FakeTorch:
    def __init__(self):
        self.inference_active = False
        self.inference_calls = 0
        self.thread_count = None
        self.loads = []
        self.model = RecordingModel(self)
        self.jit = self

    def from_numpy(self, array):
        return NumpyTensor(array)

    @contextlib.contextmanager
    def inference_mode(self):
        self.inference_calls += 1
        self.inference_active = True
        try:
            yield
        finally:
            self.inference_active = False

    def set_num_threads(self, count):
        self.thread_count = count

    def load(self, path, map_location):
        self.loads.append((path, map_location))
        return self.model


class RecordingModel:
    def __init__(self, torch):
        self.torch = torch
        self.inputs = []
        self.eval_calls = 0
        self.invalid_output = False

    def eval(self):
        self.eval_calls += 1
        return self

    def __call__(self, image, mask):
        if not self.torch.inference_active:
            raise AssertionError("Model inference was not protected by inference_mode")
        self.inputs.append((image.data.copy(), mask.data.copy()))
        output = np.empty_like(image.data)
        output[:, 0] = 0.2
        output[:, 1] = 0.4
        output[:, 2] = 0.8
        if self.invalid_output:
            output[0, 0, 0, 0] = np.nan
        return NumpyTensor(output)


class DownloadResponse:
    def __init__(self, body, declared_size=None, failure=None):
        self.body = body
        self.headers = {} if declared_size is None else {"Content-Length": str(declared_size)}
        self.position = 0
        self.failure = failure

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self, count):
        if self.failure is not None and self.position:
            raise self.failure
        block = self.body[self.position:self.position + count]
        self.position += len(block)
        return block


class RepairTests(unittest.TestCase):
    def ready_repair(self, max_side=768):
        torch = FakeTorch()
        repair = ai.CaptionAIRepair("unused-test-model.pt", max_side=max_side)
        repair._torch, repair._model = torch, torch.model
        return repair, torch

    def test_rgb_tensor_and_bgr_output_preserve_unselected_pixels_exactly(self):
        repair, torch = self.ready_repair()
        frame = np.full((101, 103, 3), [10, 30, 80], dtype=np.uint8)
        holes = np.zeros(frame.shape[:2], dtype=np.uint8)
        holes[40:51, 45:61] = 255
        original_frame, original_mask = frame.copy(), holes.copy()
        result = repair.repair(frame, holes)
        image, mask = torch.model.inputs[0]
        np.testing.assert_allclose(image[0, :, 0, 0], np.array([80, 30, 10]) / 255, atol=1e-7)
        self.assertEqual(image.dtype, np.float32)
        self.assertEqual(mask.shape, (1, 1, image.shape[2], image.shape[3]))
        self.assertTrue(set(np.unique(mask)).issubset({0.0, 1.0}))
        np.testing.assert_array_equal(result[holes > 0], np.tile([204, 102, 51], (np.count_nonzero(holes), 1)))
        np.testing.assert_array_equal(result[holes == 0], original_frame[holes == 0])
        np.testing.assert_array_equal(frame, original_frame)
        np.testing.assert_array_equal(holes, original_mask)
        self.assertFalse(np.shares_memory(result, frame))

    def test_other_captions_and_logo_are_hidden_but_not_replaced(self):
        repair, torch = self.ready_repair()
        frame = np.full((100, 100, 3), 17, dtype=np.uint8)
        holes = np.zeros((100, 100), dtype=np.uint8)
        holes[40:50, 40:50] = 255
        exclusions = np.zeros_like(holes)
        exclusions[20:30, 20:40] = 255
        exclusions[55:65, 65:75] = 255
        exclusions[40:50, 40:50] = 255
        frame[exclusions > 0] = [200, 250, 255]
        original_exclusions = exclusions.copy()
        result = repair.repair(frame, holes, exclusions)
        model_mask = torch.model.inputs[0][1][0, 0]
        self.assertTrue(model_mask[12:22, 12:32].all())
        self.assertTrue(model_mask[47:57, 57:67].all())
        self.assertTrue(model_mask[32:42, 32:42].all())
        np.testing.assert_array_equal(result[(exclusions > 0) & (holes == 0)], frame[(exclusions > 0) & (holes == 0)])
        np.testing.assert_array_equal(exclusions, original_exclusions)
        self.assertTrue(np.any(result[holes > 0] != frame[holes > 0]))

    def test_model_size_padding_and_thin_masks_remain_bounded(self):
        repair, torch = self.ready_repair(max_side=4096)
        frame = np.full((1080, 1920, 3), [10, 30, 80], dtype=np.uint8)
        holes = np.zeros((1080, 1920), dtype=np.uint8)
        holes[400, 1] = 255
        holes[700, 1918] = 255
        exclusions = np.zeros_like(holes)
        exclusions[500, 301] = 255
        result = repair.repair(frame, holes, exclusions)
        image, mask = torch.model.inputs[0]
        self.assertLessEqual(max(image.shape[2:]), 768)
        self.assertTrue(all(dimension % 8 == 0 for dimension in image.shape[2:]))
        self.assertGreaterEqual(np.count_nonzero(mask), 3)
        np.testing.assert_array_equal(result[holes == 0], frame[holes == 0])
        np.testing.assert_array_equal(result[holes > 0], [[204, 102, 51], [204, 102, 51]])

    def test_small_border_hole_has_usable_padded_input(self):
        repair, torch = self.ready_repair(max_side=63)
        frame = np.full((2, 3, 3), 15, dtype=np.uint8)
        holes = np.zeros((2, 3), dtype=bool)
        holes[0, 0] = True
        result = repair.repair(frame, holes)
        self.assertEqual(torch.model.inputs[0][0].shape, (1, 3, 32, 32))
        np.testing.assert_array_equal(result[holes == 0], frame[holes == 0])

    def test_empty_output_mask_does_not_load_or_download_model(self):
        repair = ai.CaptionAIRepair("unused-test-model.pt")
        frame = np.zeros((9, 7, 3), dtype=np.uint8)
        with patch.object(ai, "ensure_model", side_effect=AssertionError("unexpected download")), \
                patch.object(ai.importlib, "import_module", side_effect=AssertionError("unexpected import")):
            result = repair.repair(frame, np.zeros((9, 7), dtype=np.uint8))
        np.testing.assert_array_equal(result, frame)
        self.assertIsNone(repair._model)

    def test_lazy_model_load_is_cpu_eval_once_with_bounded_threads(self):
        torch = FakeTorch()
        repair = ai.CaptionAIRepair("test-model.pt")
        frame = np.zeros((90, 100, 3), dtype=np.uint8)
        holes = np.zeros((90, 100), dtype=np.uint8)
        holes[40:50, 40:50] = 1
        with patch.object(ai, "ensure_model", return_value="verified-model.pt") as ensure, \
                patch.object(ai.importlib, "import_module", return_value=torch) as load, \
                patch.object(ai.os, "cpu_count", return_value=64):
            repair.repair(frame, holes)
            repair.repair(frame, holes)
        ensure.assert_called_once()
        load.assert_called_once_with("torch")
        self.assertEqual(torch.loads, [("verified-model.pt", "cpu")])
        self.assertEqual(torch.thread_count, 4)
        self.assertEqual(torch.model.eval_calls, 1)
        self.assertEqual(torch.inference_calls, 2)

    def test_invalid_model_output_raises_without_mutating_original(self):
        repair, torch = self.ready_repair()
        torch.model.invalid_output = True
        frame = np.zeros((90, 100, 3), dtype=np.uint8)
        original = frame.copy()
        holes = np.zeros((90, 100), dtype=np.uint8)
        holes[40:50, 40:50] = 1
        with self.assertRaisesRegex(ai.CaptionAIRepairError, "reconstruction failed"):
            repair.repair(frame, holes)
        np.testing.assert_array_equal(frame, original)

    def test_masks_without_visible_context_raise_instead_of_quick_fallback(self):
        repair, torch = self.ready_repair()
        frame = np.zeros((90, 100, 3), dtype=np.uint8)
        holes = np.zeros((90, 100), dtype=np.uint8)
        holes[40:50, 40:50] = 1
        with self.assertRaisesRegex(ai.CaptionAIRepairError, "visible background"):
            repair.repair(frame, holes, np.ones((90, 100), dtype=np.uint8))
        self.assertFalse(torch.model.inputs)

    def test_invalid_frame_mask_and_limits_are_rejected(self):
        repair, _ = self.ready_repair()
        frame = np.zeros((20, 30, 3), dtype=np.uint8)
        for mask in (np.zeros((20, 29)), np.full((20, 30), np.nan), np.full((20, 30), "wrong")):
            with self.subTest(shape=mask.shape, dtype=mask.dtype), self.assertRaises(ValueError):
                repair.repair(frame, mask)
        with self.assertRaises(ValueError):
            repair.repair(frame.astype(np.float32), np.zeros((20, 30)))
        for max_side in (31, True, 64.5):
            with self.subTest(max_side=max_side), self.assertRaises(ValueError):
                ai.CaptionAIRepair("test-model.pt", max_side=max_side)


class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.target = Path(self.directory.name) / "models" / "big-lama.pt"
        self.body = b"verified fixture weights"
        self.digest = hashlib.md5(self.body).hexdigest()

    def tearDown(self):
        self.directory.cleanup()

    def no_temporary_files(self):
        self.assertEqual(list(self.target.parent.glob("*.download")), [])

    def test_existing_verified_model_uses_no_network(self):
        self.target.parent.mkdir()
        self.target.write_bytes(self.body)
        with patch.object(ai, "MODEL_MD5", self.digest), patch.object(ai.urllib.request, "urlopen") as download:
            self.assertEqual(ai.ensure_model(self.target), str(self.target))
        download.assert_not_called()

    def test_verified_download_replaces_only_target_after_checksum(self):
        self.target.parent.mkdir()
        self.target.write_bytes(b"corrupt old weights")
        unrelated = self.target.parent / "another-model.pt"
        unrelated.write_bytes(b"preserve me")
        replacements, updates = [], []
        real_replace = ai.os.replace

        def verified_replace(source, target):
            self.assertEqual(Path(source).read_bytes(), self.body)
            self.assertEqual(self.target.read_bytes(), b"corrupt old weights")
            replacements.append((source, target))
            real_replace(source, target)

        with patch.object(ai, "MODEL_MD5", self.digest), \
                patch.object(ai.urllib.request, "urlopen", return_value=DownloadResponse(self.body, len(self.body))), \
                patch.object(ai.os, "replace", side_effect=verified_replace):
            self.assertEqual(ai.ensure_model(self.target, lambda *update: updates.append(update)), str(self.target))
        self.assertEqual(self.target.read_bytes(), self.body)
        self.assertEqual(unrelated.read_bytes(), b"preserve me")
        self.assertEqual(len(replacements), 1)
        self.assertEqual(updates[-1][0], 100)
        self.assertTrue(all(0 <= percent <= 100 for percent, _ in updates))
        self.no_temporary_files()

    def test_bad_checksum_keeps_old_model_and_removes_partial_download(self):
        self.target.parent.mkdir()
        self.target.write_bytes(b"old file")
        with patch.object(ai, "MODEL_MD5", self.digest), \
                patch.object(ai.urllib.request, "urlopen", return_value=DownloadResponse(b"bad response", 12)), \
                self.assertRaisesRegex(ai.CaptionAIRepairError, "checksum"):
            ai.ensure_model(self.target)
        self.assertEqual(self.target.read_bytes(), b"old file")
        self.no_temporary_files()

    def test_failed_transfer_keeps_old_file_and_leaves_no_model_partial(self):
        self.target.parent.mkdir()
        self.target.write_bytes(b"old file")
        response = DownloadResponse(self.body, len(self.body), failure=TimeoutError("network disconnected"))
        with patch.object(ai, "MODEL_MD5", self.digest), \
                patch.object(ai.urllib.request, "urlopen", return_value=response), \
                self.assertRaisesRegex(ai.CaptionAIRepairError, "retry setup"):
            ai.ensure_model(self.target)
        self.assertEqual(self.target.read_bytes(), b"old file")
        self.no_temporary_files()

    def test_truncated_content_length_does_not_publish_weights(self):
        with patch.object(ai, "MODEL_MD5", self.digest), \
                patch.object(ai.urllib.request, "urlopen", return_value=DownloadResponse(self.body, len(self.body) + 10)), \
                self.assertRaisesRegex(ai.CaptionAIRepairError, "interrupted"):
            ai.ensure_model(self.target)
        self.assertFalse(self.target.exists())
        self.no_temporary_files()

    def test_download_size_limit_enforced_with_and_without_headers(self):
        for declared_size in (21, None):
            response = DownloadResponse(b"x" * 21, declared_size)
            with self.subTest(declared_size=declared_size), patch.object(ai, "MAX_MODEL_BYTES", 20), \
                    patch.object(ai.urllib.request, "urlopen", return_value=response), \
                    self.assertRaisesRegex(ai.CaptionAIRepairError, "limit"):
                ai.ensure_model(self.target)
            self.assertFalse(self.target.exists())
            self.no_temporary_files()

    def test_destination_directory_is_rejected_without_network_or_deletion(self):
        self.target.mkdir(parents=True)
        with patch.object(ai.urllib.request, "urlopen") as download, \
                self.assertRaisesRegex(ai.CaptionAIRepairError, "regular file"):
            ai.ensure_model(self.target)
        self.assertTrue(self.target.is_dir())
        download.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=2)

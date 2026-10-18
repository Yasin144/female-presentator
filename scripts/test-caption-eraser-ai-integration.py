"""Worker/AI adapter contracts with synthetic frames and a recording repair.

Run: python -I scripts/test-caption-eraser-ai-integration.py
No Torch, downloaded weights, OCR, external request, or video render is used.
"""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("caption_eraser_ai_integration", ROOT / "caption-eraser-worker.py")
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


class RecordingRepair:
    """Deliberately changes the entire returned frame to test worker writeback."""
    def __init__(self):
        self.calls = []

    def repair(self, frame, missing, exclusions):
        self.calls.append((frame.copy(), missing.copy(), exclusions.copy()))
        return np.full_like(frame, (7, 22, 39))


class MemoryCache(worker.FrameCache):
    def __init__(self, samples, frames):
        super().__init__(samples)
        self.source_frames = frames

    def get(self, index):
        return self.source_frames[index]


def background():
    yy, xx = np.indices((100, 160))
    return np.stack((50 + xx % 29, 80 + yy % 23, 100 + (xx + yy) % 31), axis=2).astype(np.uint8)


def track(box=(20, 45, 120, 40), times=(0,), protected=(), exclusions=None):
    return dict(box=list(box), height=12, times=list(times), protected=list(protected),
                recoveryExclusions=exclusions or {})


def full_mask(frame, item, mask):
    result = np.zeros(frame.shape[:2], np.uint8)
    x, y, w, h = item["box"]
    result[y:y + h, x:x + w] = mask
    return result


class AIIntegrationTests(unittest.TestCase):
    def test_full_frame_repair_output_changes_only_requested_pixels(self):
        frame = background()
        original = frame.copy()
        item = track()
        mask = np.zeros((40, 120), np.uint8)
        mask[12:22, 15:105] = 255
        selected = full_mask(frame, item, mask) > 0
        repair = RecordingRepair()
        with patch.object(worker, "track_mask", return_value=mask):
            changed, recovered = worker.clean_frame(frame, [item], 0, [], None, .25, repair)
        self.assertEqual((changed, recovered), (900, 0))
        self.assertEqual(len(repair.calls), 1)
        np.testing.assert_array_equal(frame[~selected], original[~selected])
        np.testing.assert_array_equal(frame[selected], np.tile([7, 22, 39], (900, 1)))
        np.testing.assert_array_equal(repair.calls[0][1], selected.astype(np.uint8) * 255)

    def test_real_temporal_pixels_are_retained_and_removed_from_ai_holes(self):
        clean = background()
        item = track(times=(0, 1))
        mask = np.zeros((40, 120), np.uint8)
        mask[12:22, 15:105] = 255
        selected = full_mask(clean, item, mask) > 0
        current = clean.copy()
        current[selected] = 245
        original = current.copy()
        blocked = np.zeros_like(mask)
        blocked[:, 60:] = 255
        samples = [dict(index=0, time=0), dict(index=1, time=1)]
        cache = MemoryCache(samples, [clean.copy(), current.copy()])
        repair = RecordingRepair()

        def masks(unused_frame, unused_track, timestamp):
            return (blocked if timestamp == 0 else mask).copy()

        with patch.object(worker, "track_mask", side_effect=masks):
            changed, recovered = worker.clean_frame(current, [item], 1, samples, cache, .25, repair)
        self.assertEqual(changed, 900)
        self.assertEqual(recovered, 450)
        self.assertEqual(len(repair.calls), 1)
        input_frame, holes, exclusions = repair.calls[0]
        restored = selected & (holes == 0)
        self.assertEqual(np.count_nonzero(holes), 450)
        np.testing.assert_array_equal(current[restored], clean[restored])
        np.testing.assert_array_equal(input_frame[restored], clean[restored])
        self.assertFalse(np.any(exclusions[restored]))
        np.testing.assert_array_equal(current[~selected], original[~selected])

    def test_complete_temporal_recovery_skips_ai(self):
        clean = background()
        item = track(times=(0, 1))
        mask = np.zeros((40, 120), np.uint8)
        mask[12:22, 15:105] = 255
        current = clean.copy()
        current[full_mask(clean, item, mask) > 0] = 245
        samples = [dict(index=0, time=0), dict(index=1, time=1)]
        cache = MemoryCache(samples, [clean.copy(), current.copy()])
        repair = RecordingRepair()
        with patch.object(worker, "track_mask", side_effect=lambda frame, item, time:
                          np.zeros_like(mask) if time == 0 else mask.copy()):
            stats = worker.clean_frame(current, [item], 1, samples, cache, .25, repair)
        self.assertEqual(stats, (900, 900))
        self.assertFalse(repair.calls)
        np.testing.assert_array_equal(current, clean)

    def test_multiple_overlapping_tracks_use_one_union_and_immutable_mask_selection(self):
        frame = background()
        before = frame.copy()
        first, second = track((20, 40, 80, 40)), track((70, 40, 70, 40))
        masks = [np.full((40, 80), 255, np.uint8), np.full((40, 70), 255, np.uint8)]
        snapshots = []
        repair = RecordingRepair()

        def select(snapshot, item, timestamp):
            snapshots.append(snapshot.copy())
            return masks[0 if item is first else 1].copy()

        with patch.object(worker, "track_mask", side_effect=select):
            stats = worker.clean_frame(frame, [first, second], 0, [], None, .25, repair)
        selected = (full_mask(frame, first, masks[0]) | full_mask(frame, second, masks[1])) > 0
        self.assertEqual(stats, (4800, 0))
        self.assertEqual(len(repair.calls), 1)
        self.assertEqual(len(snapshots), 2)
        for snapshot in snapshots:
            np.testing.assert_array_equal(snapshot, before)
        np.testing.assert_array_equal(repair.calls[0][1], selected.astype(np.uint8) * 255)
        np.testing.assert_array_equal(frame[~selected], before[~selected])

    def test_protected_logo_is_excluded_from_real_mask_and_model_context(self):
        frame = background()
        image = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 26)
        ImageDraw.Draw(image).text((25, 48), "HELLO", font=font, fill="white", stroke_width=2, stroke_fill="black")
        frame = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR)
        original = frame.copy()
        logo = [25, 50, 48, 77]
        item = track((10, 40, 140, 45), protected=[logo])
        item.update(height=26, modes=["light"], detections=[dict(
            time=0, box=[25, 50, 92, 28], words=[dict(text="HELLO", box=[25, 50, 92, 28])])])
        selected = full_mask(frame, item, worker.track_mask(frame, item, 0)) > 0
        self.assertTrue(selected.any(), "Fixture must have visible caption pixels.")
        self.assertFalse(selected[50:77, 25:48].any())
        repair = RecordingRepair()
        changed, recovered = worker.clean_frame(frame, [item], 0, [], None, .25, repair)
        self.assertGreater(changed, 0)
        self.assertEqual(recovered, 0)
        self.assertTrue(repair.calls[0][2][50:77, 25:48].all())
        self.assertFalse(repair.calls[0][1][50:77, 25:48].any())
        np.testing.assert_array_equal(frame[50:77, 25:48], original[50:77, 25:48])
        np.testing.assert_array_equal(frame[~selected], original[~selected])

    def test_other_ocr_caption_is_hidden_from_ai_without_becoming_output(self):
        frame = background()
        original = frame.copy()
        item = track(exclusions={"0": [[5, 8, 30, 20]]})
        mask = np.zeros((40, 120), np.uint8)
        mask[12:22, 15:105] = 255
        repair = RecordingRepair()
        samples = [dict(index=0, time=0)]
        with patch.object(worker, "track_mask", return_value=mask), \
                patch.object(worker, "temporal_donor_candidates", return_value=iter(())):
            worker.clean_frame(frame, [item], 0, samples, None, .25, repair)
        _, missing, exclusions = repair.calls[0]
        self.assertTrue(exclusions[8:20, 5:30].all())
        self.assertFalse(missing[8:20, 5:30].any())
        np.testing.assert_array_equal(frame[8:20, 5:30], original[8:20, 5:30])

    def test_no_active_or_visible_caption_skips_ai(self):
        frame = background()
        original = frame.copy()
        repair = RecordingRepair()
        item = track()
        with patch.object(worker, "track_mask", return_value=np.zeros((40, 120), np.uint8)) as select:
            self.assertEqual(worker.clean_frame(frame, [item], 0, [], None, .25, repair), (0, 0))
            self.assertEqual(worker.clean_frame(frame, [item], 5, [], None, .25, repair), (0, 0))
        select.assert_called_once()
        self.assertFalse(repair.calls)
        np.testing.assert_array_equal(frame, original)

    def test_quick_mode_retains_classical_fill_and_pixel_preservation(self):
        frame = background()
        original = frame.copy()
        item = track()
        mask = np.zeros((40, 120), np.uint8)
        mask[12:22, 15:105] = 255
        selected = full_mask(frame, item, mask) > 0
        frame[selected] = 245
        original[selected] = 245
        with patch.object(worker, "track_mask", return_value=mask), \
                patch.object(worker.cv2, "inpaint", wraps=cv2.inpaint) as inpaint:
            self.assertEqual(worker.clean_frame(frame, [item], 0, [], None, .25), (900, 0))
        inpaint.assert_called_once()
        self.assertEqual(inpaint.call_args.args[-1], cv2.INPAINT_TELEA)
        np.testing.assert_array_equal(frame[~selected], original[~selected])
        self.assertTrue(np.any(frame[selected] != original[selected]))

    def test_ai_failure_propagates_without_implicit_quick_fallback(self):
        frame = background()
        original = frame.copy()
        item = track()
        mask = np.ones((40, 120), np.uint8)
        repair = RecordingRepair()
        with patch.object(worker, "track_mask", return_value=mask), \
                patch.object(repair, "repair", side_effect=RuntimeError("fixture model failed")), \
                patch.object(worker.cv2, "inpaint") as inpaint:
            with self.assertRaisesRegex(RuntimeError, "fixture model failed"):
                worker.clean_frame(frame, [item], 0, [], None, .25, repair)
        inpaint.assert_not_called()
        np.testing.assert_array_equal(frame, original)


if __name__ == "__main__":
    unittest.main(verbosity=2)

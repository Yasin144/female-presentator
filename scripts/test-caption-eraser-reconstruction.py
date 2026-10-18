"""Focused reconstruction checks; no OCR, subprocesses, or lesson render.

Run with the already installed OpenCV runtime:
  python -I scripts/test-caption-eraser-reconstruction.py
"""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("caption_eraser_reconstruction", ROOT / "caption-eraser-worker.py")
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


class MemoryCache(worker.FrameCache):
    def __init__(self, samples, frames):
        super().__init__(samples)
        self.source_frames = frames

    def get(self, index):
        return self.source_frames[index]


def background():
    yy, xx = np.indices((100, 160))
    return np.stack((50 + xx % 29, 80 + yy % 23, 100 + (xx + yy) % 31), axis=2).astype(np.uint8)


def fixture(times, frames, masks, exclusions=None, protected=None):
    samples = [dict(index=index, time=time, source="unused") for index, time in enumerate(times)]
    track = dict(box=[20, 45, 120, 40], height=12, times=times,
                 recoveryExclusions=exclusions or {}, protected=protected or [])
    cache = MemoryCache(samples, frames)

    def donor_mask(frame, unused_track, timestamp):
        return masks[times.index(timestamp)].copy()

    return samples, track, cache, donor_mask


def caption_mask():
    mask = np.zeros((40, 120), np.uint8)
    mask[12:22, 15:105] = 255
    return mask


def add_caption(frame, mask, color=(245, 245, 245)):
    frame = frame.copy()
    frame[45:85, 20:140][mask > 0] = color
    return frame


class ReconstructionTests(unittest.TestCase):
    def test_sustained_caption_finds_exact_background_more_than_two_seconds_away(self):
        clean = background()
        mask = caption_mask()
        times = [index / 4 for index in range(41)]
        masks = [mask if 2 <= time <= 8 else np.zeros_like(mask) for time in times]
        frames = [add_caption(clean, current) for current in masks]
        samples, track, cache, donor_mask = fixture(times, frames, masks)
        current = frames[times.index(5)].copy()
        before = current.copy()
        with patch.object(worker, "track_mask", donor_mask):
            restored = worker.restore_region(current, track, mask, 5, samples, cache)
        self.assertEqual(restored, int(np.count_nonzero(mask)))
        self.assertTrue(np.array_equal(current, clean), "Textured scene pixels were not restored exactly.")
        outside = np.ones(current.shape[:2], bool)
        outside[45:85, 20:140] = mask == 0
        self.assertTrue(np.array_equal(current[outside], before[outside]))

    def test_moving_subject_neighborhood_is_not_treated_as_zero_error(self):
        clean = np.full((100, 160, 3), 100, np.uint8)
        mask = np.zeros((40, 120), np.uint8)
        mask[15:24, 53:62] = 255
        current = add_caption(clean, mask)
        wrong = clean.copy()
        wrong[56:74, 69:86] = 135
        wrong[60:69, 73:82] = (20, 200, 20)
        masks = [np.zeros_like(mask), mask]
        samples, track, cache, donor_mask = fixture([0, 1], [wrong, current.copy()], masks)
        with patch.object(worker, "track_mask", donor_mask):
            restored = worker.restore_region(current, track, mask, 1, samples, cache)
        self.assertEqual(restored, 0, "A changed subject passed the visible-neighborhood check.")
        self.assertLess(int(current[64, 77].max()) - int(current[64, 77].min()), 2)

    def test_unknown_neighborhood_and_tiny_support_are_rejected(self):
        difference = np.zeros((50, 50), np.float32)
        clear = np.zeros((50, 50), bool)
        self.assertFalse(worker.supported_local_matches(difference, clear, 20).any())
        clear[24:26, 24:26] = True
        self.assertFalse(worker.supported_local_matches(difference, clear, 20).any())

    def test_cached_fully_blocked_donors_do_not_reload_full_frames(self):
        clean = background()
        mask = caption_mask()
        current = add_caption(clean, mask)
        samples, track, cache, donor_mask = fixture([0, 0.25, 0.5], [current.copy()] * 3, [mask] * 3)
        with patch.object(worker, "track_mask", donor_mask), patch.object(cache, "get", wraps=cache.get) as reads:
            worker.restore_region(current.copy(), track, mask, 0.25, samples, cache)
            cold_reads = reads.call_count
            worker.restore_region(current.copy(), track, mask, 0.25, samples, cache)
            self.assertGreater(cold_reads, 0)
            self.assertEqual(reads.call_count, cold_reads,
                             "Cached masks proved the donors unavailable but full PNGs were reloaded.")

    def test_donor_mask_cache_evicts_by_byte_budget(self):
        mask = caption_mask()
        samples, track, cache, donor_mask = fixture([0, 0.25, 0.5], [background()] * 3, [mask] * 3)
        cache.donor_mask_budget = mask.nbytes * 2
        with patch.object(worker, "track_mask", donor_mask):
            for index in range(3):
                cache.donor_mask(index, track)
        self.assertEqual(cache.donor_mask_bytes, mask.nbytes * 2)
        self.assertEqual(len(cache.donor_masks), 2)
        self.assertNotIn((id(track), 0), cache.donor_masks)
        self.assertEqual(cache.limit, 20, "The full-frame cache size must stay unchanged.")

    def test_different_scene_is_rejected_even_when_local_visible_patch_matches(self):
        clean = background()
        mask = caption_mask()
        current = add_caption(clean, mask)
        wrong = np.full_like(clean, 245)
        wrong[29:100, 4:156] = clean[29:100, 4:156]
        wrong[45:85, 20:140][mask > 0] = (20, 200, 20)
        samples, track, cache, donor_mask = fixture([0, 1], [wrong, current.copy()],
                                                   [np.zeros_like(mask), mask])
        with patch.object(worker, "track_mask", donor_mask):
            restored = worker.restore_region(current, track, mask, 1, samples, cache)
        self.assertEqual(restored, 0, "A different scene supplied concealed pixels.")

    def test_search_stops_at_intervening_cut_before_a_similar_scene_return(self):
        clean = background()
        mask = caption_mask()
        current = add_caption(clean, mask)
        frames = [clean, np.full_like(clean, 230), current.copy()]
        samples, track, cache, donor_mask = fixture([0, 1, 2], frames,
                                                   [np.zeros_like(mask), np.zeros_like(mask), mask])
        candidates = list(worker.temporal_donor_candidates(samples, 2, cache, current, track))
        self.assertEqual(candidates, [2])
        with patch.object(worker, "track_mask", donor_mask):
            restored = worker.restore_region(current, track, mask, 2, samples, cache)
        self.assertEqual(restored, 0)

    def test_other_caption_exclusions_prevent_color_from_being_copied_back(self):
        clean = background()
        mask = caption_mask()
        current = add_caption(clean, mask)
        yellow_caption = add_caption(clean, mask, (20, 240, 250))
        samples, track, cache, donor_mask = fixture([0, 1], [yellow_caption, current.copy()],
                                                   [np.zeros_like(mask), mask],
                                                   exclusions={"0": [[35, 57, 125, 67]]})
        with patch.object(worker, "track_mask", donor_mask):
            restored = worker.restore_region(current, track, mask, 1, samples, cache)
        self.assertEqual(restored, 0)
        colored = (current[:, :, 1] > 220) & (current[:, :, 2] > 220) & (current[:, :, 0] < 50)
        self.assertFalse(colored.any(), "A separately proved donor caption was copied back.")

    def test_unknown_shifted_karaoke_word_is_blocked_without_ocr_or_matching_palette(self):
        clean = np.full((100, 160, 3), 105, np.uint8)
        font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 26)

        def label(x, y, color):
            image = Image.fromarray(cv2.cvtColor(clean, cv2.COLOR_BGR2RGB))
            ImageDraw.Draw(image).text((x, y), "Animals", font=font, fill=color,
                                      stroke_width=2, stroke_fill="black")
            return cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR)

        current = label(35, 48, "white")
        donor = label(29, 54, (255, 230, 30))
        mask = (np.any(current[45:85, 20:140] != clean[45:85, 20:140], axis=2)).astype(np.uint8) * 255
        samples, track, cache, ignored_palette_mask = fixture([0, 1], [donor, current.copy()],
                                                             [np.zeros_like(mask), mask])
        track["height"] = 26
        # Simulate missing OCR and a white-only palette: ordinary donor masks
        # cannot see this yellow word, so only independent glyph proof blocks it.
        self.assertFalse(track["recoveryExclusions"])
        with patch.object(worker, "track_mask", ignored_palette_mask):
            worker.restore_region(current, track, mask, 1, samples, cache)
        hsv = cv2.cvtColor(current, cv2.COLOR_BGR2HSV)
        yellow = (hsv[:, :, 0] >= 20) & (hsv[:, :, 0] <= 40) & (hsv[:, :, 1] > 150) & (hsv[:, :, 2] > 190)
        self.assertFalse(yellow.any(), "An unobserved shifted karaoke word was pasted back.")

    def test_neighboring_caption_outside_output_mask_cannot_feed_fallback(self):
        clean = np.full((100, 160, 3), 105, np.uint8)
        face = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 26)
        image = Image.fromarray(cv2.cvtColor(clean, cv2.COLOR_BGR2RGB))
        ImageDraw.Draw(image).text((50, 50), "ll", font=face, fill="white", stroke_width=2, stroke_fill="black")
        current = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR)
        before = current.copy()
        mask = np.zeros((40, 120), np.uint8)
        mask[10:32, 30:38] = 255
        samples, track, cache, blocked_donor_mask = fixture([0], [current.copy()], [mask],
                                                          exclusions={"0": [[49, 53, 68, 78]]})
        track["height"] = 26
        self.assertGreater(np.count_nonzero(before[55:77, 59:65] > 220), 10)
        with patch.object(worker, "track_mask", blocked_donor_mask):
            worker.restore_region(current, track, mask, 0, samples, cache)
        selected = np.zeros(current.shape[:2], bool)
        selected[45:85, 20:140] = mask > 0
        self.assertLess(int(current[selected].max()), 140,
                        "A neighboring white glyph outside the output mask contaminated the fill.")
        self.assertTrue(np.array_equal(current[~selected], before[~selected]))

    def test_context_fallback_preserves_temporally_recovered_pixels(self):
        clean = background()
        mask = caption_mask()
        current = add_caption(clean, mask)
        blocked = np.zeros_like(mask)
        blocked[:, 60:] = 255
        samples, track, cache, donor_mask = fixture([0, 1], [clean.copy(), current.copy()], [blocked, mask])
        with patch.object(worker, "track_mask", donor_mask):
            recovered = worker.restore_region(current, track, mask, 1, samples, cache)
        self.assertGreater(recovered, 0)
        self.assertLess(recovered, np.count_nonzero(mask))
        known = (mask > 0) & (blocked == 0)
        self.assertTrue(np.array_equal(current[45:85, 20:140][known], clean[45:85, 20:140][known]),
                        "The fallback overwrote clean pixels already recovered from a donor.")

    def test_protected_logo_and_pixels_outside_the_mask_stay_exact(self):
        clean = np.full((100, 160, 3), 75, np.uint8)
        clean[68:82, 115:136] = (240, 245, 250)
        mask = np.zeros((40, 120), np.uint8)
        mask[22:30, 83:92] = 255
        current = add_caption(clean, mask)
        before = current.copy()
        samples, track, cache, donor_mask = fixture([0], [current.copy()], [mask],
                                                   protected=[[115, 68, 136, 82]])
        with patch.object(worker, "track_mask", donor_mask):
            restored = worker.restore_region(current, track, mask, 0, samples, cache)
        self.assertEqual(restored, 0)
        self.assertTrue(np.array_equal(current[68:82, 115:136], before[68:82, 115:136]))
        outside = np.ones(current.shape[:2], bool)
        outside[45:85, 20:140] = mask == 0
        self.assertTrue(np.array_equal(current[outside], before[outside]))


if __name__ == "__main__":
    unittest.main(verbosity=2)

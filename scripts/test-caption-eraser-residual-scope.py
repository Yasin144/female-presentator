"""Caption-fragment scope regressions using deterministic frames and OCR.

Run: python -I scripts/test-caption-eraser-residual-scope.py
Requires OpenCV and NumPy; no Windows OCR, video encode, or external files.
"""
import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("caption_eraser_residual", ROOT / "caption-eraser-worker.py")
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)

WIDTH, HEIGHT = 640, 360
FONT = cv2.FONT_HERSHEY_SIMPLEX
FONT_SCALE = 0.9
TEXT_X, TEXT_BOTTOM = 260, 300
def word_width(text):
    return sum(cv2.getTextSize(letter, FONT, FONT_SCALE, 4)[0][0] for letter in text) + 4 * (len(text) - 1)


TEXT_WIDTH = word_width("HELLO")
WORD_BOX = [TEXT_X, 274, TEXT_WIDTH, 29]


def plain_scene(colour=(140, 140, 140)):
    return np.full((HEIGHT, WIDTH, 3), colour, np.uint8)


def caption_scene():
    frame = plain_scene()
    x = TEXT_X
    # Separate letter fills as in the app's normal caption fonts. Drawing the
    # entire Hershey word with a thick stroke joins ELLO into one component.
    for letter in "HELLO":
        cv2.putText(frame, letter, (x, TEXT_BOTTOM), FONT, FONT_SCALE,
                    (0, 0, 0), 8, cv2.LINE_AA)
        cv2.putText(frame, letter, (x, TEXT_BOTTOM), FONT, FONT_SCALE,
                    (255, 255, 255), 4, cv2.LINE_AA)
        x += cv2.getTextSize(letter, FONT, FONT_SCALE, 4)[0][0] + 4
    return frame


def outlined_object(frame, centre, colour=(255, 255, 255)):
    # A small outlined scene object is deliberately similar to a glyph. OCR
    # supplies no text for it; evidence from another shot must not erase it.
    frame = frame.copy()
    cv2.circle(frame, centre, 12, (0, 0, 0), -1)
    cv2.circle(frame, centre, 9, colour, -1)
    return frame


def ocr_line(text="HELLO", box=None):
    x, y, width, height = box or WORD_BOX
    return {"text": text, "words": [{"text": text, "x": x, "y": y, "w": width, "h": height}]}


def fixture(frames, times, lines):
    images = {"frame-%d" % index: frame for index, frame in enumerate(frames)}
    samples = [{"index": index, "time": time, "source": "frame-%d" % index,
                "scale": 1.0, "lines": copy.deepcopy(sample_lines)}
               for index, (time, sample_lines) in enumerate(zip(times, lines))]
    return images, samples


def proved_track(samples, indexes):
    detections = [worker.line_detection(samples[index]["lines"][0], samples[index], WIDTH, HEIGHT)
                  for index in indexes]
    x, y, width, height = WORD_BOX
    return {"box": [x - 8, y - 8, width + 16, height + 16], "height": height,
            "padding": 8, "modes": ["light"], "times": [samples[index]["time"] for index in indexes],
            "outlined": True, "detections": detections, "protected": []}


def analyze(images, samples, track, target_index):
    track = copy.deepcopy(track)
    with patch.object(worker, "load_png", side_effect=lambda path: images[str(path)].copy()), \
            patch.object(worker, "emit"):
        fragments = worker.residual_tracks(samples, [track], WIDTH, HEIGHT, [], 2)
        frame = images[samples[target_index]["source"]].copy()
        selected, recovered = worker.clean_frame(frame, [track] + fragments, samples[target_index]["time"],
                                                 samples, worker.FrameCache(samples), 0.25)
    return fragments, frame, selected, recovered


class ResidualScopeTests(unittest.TestCase):
    def test_a_caption_proof_does_not_cross_scene_cut(self):
        caption = caption_scene()
        object_scene = outlined_object(plain_scene((20, 70, 30)), (300, 290))
        images, samples = fixture([caption, caption, object_scene, object_scene],
                                  [0.0, 0.25, 0.5, 0.75], [[ocr_line()], [ocr_line()], [], []])
        track = proved_track(samples, [0, 1])
        # This fixture contains a substantial cut, not just a changing caption.
        self.assertFalse(worker.matching_scene(worker.scene_signature(caption), worker.scene_signature(object_scene),
                                              caption.shape, track))
        fragments, cleaned, selected, _ = analyze(images, samples, track, 2)
        self.assertFalse(any(any(time >= 0.5 for time in fragment["times"]) for fragment in fragments))
        self.assertEqual(selected, 0)
        self.assertTrue(np.array_equal(cleaned, object_scene))

    def test_b_returning_to_similar_scene_does_not_bypass_intervening_cut(self):
        caption = caption_scene()
        intervening = plain_scene((20, 70, 30))
        returned = outlined_object(plain_scene(), (300, 290))
        images, samples = fixture([caption, caption, intervening, returned, returned],
                                  [0.0, 0.25, 0.5, 0.75, 1.0], [[ocr_line()], [ocr_line()], [], [], []])
        track = proved_track(samples, [0, 1])
        # Comparing just the endpoint backgrounds would accept this return.
        self.assertTrue(worker.matching_scene(worker.scene_signature(caption), worker.scene_signature(returned),
                                             caption.shape, track))
        fragments, cleaned, selected, _ = analyze(images, samples, track, 3)
        self.assertFalse(any(any(time >= 0.75 for time in fragment["times"]) for fragment in fragments))
        self.assertEqual(selected, 0)
        self.assertTrue(np.array_equal(cleaned, returned))

    def test_c_yellow_scene_objects_outside_caption_evidence_stay_unchanged(self):
        frame = outlined_object(caption_scene(), (40, 290), (30, 230, 255))
        images, samples = fixture([frame, frame], [0.0, 0.25], [[ocr_line()], [ocr_line()]])
        track = proved_track(samples, [0, 1])
        fragments, cleaned, selected, _ = analyze(images, samples, track, 1)
        self.assertGreater(selected, 0, "Caption processing must actually run in this preservation test")
        self.assertTrue(np.array_equal(cleaned[270:310, 20:60], frame[270:310, 20:60]))
        self.assertFalse(any(fragment["box"][0] < 100 for fragment in fragments))

    def test_d_missing_ocr_glyphs_recover_from_same_shot_evidence_two_seconds_away(self):
        caption = caption_scene()
        partial_width = word_width("HE")
        partial = ocr_line("HE", [TEXT_X, WORD_BOX[1], partial_width, WORD_BOX[3]])
        images, samples = fixture([caption] * 5, [0.0, 0.25, 1.75, 2.0, 2.25],
                                  [[partial], [partial], [], [ocr_line()], [ocr_line()]])
        track = proved_track(samples, [3, 4])
        fragments, cleaned, selected, _ = analyze(images, samples, track, 0)
        # The far right of HELLO falls beyond the early HE word box and halo.
        # Later full-caption proof must still allow those missing glyphs.
        last_letter_x = TEXT_X + TEXT_WIDTH - 15
        self.assertTrue(any(fragment["box"][0] <= last_letter_x < fragment["box"][0] + fragment["box"][2]
                            and 0.0 in fragment["times"] and 0.25 in fragment["times"]
                            for fragment in fragments), fragments)
        self.assertGreater(selected, 0)
        self.assertGreater(np.count_nonzero(np.any(cleaned != caption, axis=2)), 0)
        self.assertTrue(np.array_equal(cleaned[:250], caption[:250]))


if __name__ == "__main__":
    unittest.main(verbosity=2)

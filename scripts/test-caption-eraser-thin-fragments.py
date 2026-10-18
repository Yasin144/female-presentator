"""Unknown karaoke edge recovery without admitting ordinary scene objects.

Run: python -I scripts/test-caption-eraser-thin-fragments.py
Uses predefined OCR and synthetic frames; no model, OCR, or video processing.
"""
import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("caption_eraser_thin_fragments", ROOT / "caption-eraser-worker.py")
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


def fixture(kind="thin", count=2):
    width, height = 640, 360
    plain = np.full((height, width, 3), 140, np.uint8)
    caption = plain.copy()
    x = 260
    for letter in "HELLO":
        cv2.putText(caption, letter, (x, 300), cv2.FONT_HERSHEY_SIMPLEX, .9, (0, 0, 0), 8, cv2.LINE_AA)
        cv2.putText(caption, letter, (x, 300), cv2.FONT_HERSHEY_SIMPLEX, .9, (255, 255, 255), 4, cv2.LINE_AA)
        x += cv2.getTextSize(letter, cv2.FONT_HERSHEY_SIMPLEX, .9, 4)[0][0] + 4
    line = dict(text="HELLO", words=[dict(text="HELLO", x=260, y=274, w=x - 260, h=29)])
    residual = plain.copy()
    if kind == "thin":
        residual[276:307, 497:504] = 0
        residual[280:301, 500] = (20, 235, 250)
    elif kind == "unoutlined":
        residual[280:301, 500] = (20, 235, 250)
    elif kind == "broad":
        cv2.circle(residual, (500, 290), 12, (0, 0, 0), -1)
        cv2.circle(residual, (500, 290), 9, (20, 235, 250), -1)
    frames = [caption, caption] + [residual] * count
    times = [0, .25] + [3 + index * .25 for index in range(count)]
    samples = [dict(index=index, time=times[index], scale=1, source=str(index),
                    lines=[copy.deepcopy(line)] if index < 2 else []) for index in range(len(frames))]
    detections = [worker.line_detection(sample["lines"][0], sample, width, height) for sample in samples[:2]]
    item = dict(box=[252, 266, x - 260 + 16, 45], height=29, modes=["light"],
                times=[0, .25], detections=detections, outlined=True, protected=[])
    return frames, samples, item


def fragments(frames, samples, item, protected=()):
    with patch.object(worker, "load_png", side_effect=lambda path: frames[int(path)].copy()), \
            patch.object(worker, "emit"):
        return worker.residual_tracks(samples, [item], 640, 360, list(protected))


class ThinFragmentTests(unittest.TestCase):
    def test_unknown_high_contrast_one_pixel_karaoke_edge_is_recovered(self):
        frames, samples, item = fixture()
        result = fragments(frames, samples, item)
        found = [fragment for fragment in result if fragment["box"][0] < 501 < fragment["box"][0] + fragment["box"][2]]
        self.assertEqual(len(found), 1, result)
        self.assertNotIn(found[0]["modes"][0], item["modes"])
        self.assertEqual(found[0]["times"], [3, 3.25])
        mask = worker.track_mask(frames[-1], found[0], 3.25)
        self.assertGreater(np.count_nonzero(mask), 100)

    def test_unoutlined_coloured_vertical_scene_edge_is_rejected(self):
        frames, samples, item = fixture("unoutlined")
        self.assertEqual(fragments(frames, samples, item), [])

    def test_broad_coloured_scene_object_outside_caption_evidence_is_rejected(self):
        frames, samples, item = fixture("broad")
        self.assertEqual(fragments(frames, samples, item), [])

    def test_unknown_unanchored_edge_requires_repeated_observation(self):
        frames, samples, item = fixture(count=1)
        self.assertEqual(fragments(frames, samples, item), [])

    def test_protected_artwork_with_identical_thin_geometry_is_rejected(self):
        frames, samples, item = fixture()
        self.assertEqual(fragments(frames, samples, item, [[495, 275, 506, 304]]), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)

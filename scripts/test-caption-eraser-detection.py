"""Small glyph/track regressions with predefined OCR and no Windows OCR calls.

Run: python -I scripts/test-caption-eraser-detection.py
"""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("caption_eraser_detection", ROOT / "caption-eraser-worker.py")
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)
WIDTH, HEIGHT = 640, 360


def font(size):
    for name in ("DejaVuSans-Bold.ttf", "arialbd.ttf", "C:/Windows/Fonts/arialbd.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default(size=size)


def scenery():
    yy, xx = np.indices((HEIGHT, WIDTH))
    return np.stack((115 + xx % 29, 145 + yy % 23, 165 + (xx + yy) % 21), axis=2).astype(np.uint8)


def draw_frame(entries):
    clean = scenery()
    image = Image.fromarray(cv2.cvtColor(clean, cv2.COLOR_BGR2RGB))
    draw = ImageDraw.Draw(image)
    lines = []
    for entry in entries:
        text, size = entry["text"], entry.get("size", 24)
        face = font(size)
        position = (entry.get("x", (WIDTH - round(face.getlength(text))) // 2), entry.get("y", 280))
        outline = entry.get("outlined", True)
        draw.text(position, text, font=face, fill=entry.get("color", "white"),
                  stroke_width=2 if outline else 0, stroke_fill="black")
        left, top, right, bottom = draw.textbbox(position, text, font=face)
        lines.append(dict(text=text, words=[dict(text=text, x=left, y=top, w=right - left, h=bottom - top)]))
    return cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR), lines, clean


class DetectionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="caption-detection-test-")
        self.directory = Path(self.temporary.name)
        self.sequence = 0

    def tearDown(self):
        self.temporary.cleanup()

    def analyse(self, entries, times=(0, 0.25, 0.5)):
        samples, frames = [], []
        for index, timestamp in enumerate(times):
            frame, lines, _ = draw_frame(entries(index) if callable(entries) else entries)
            self.sequence += 1
            source = self.directory / ("frame-%03d.png" % self.sequence)
            worker.save_png(source, frame)
            samples.append(dict(index=index, time=timestamp, scale=1, source=str(source), lines=lines))
            frames.append(frame)
        with patch.object(worker, "emit"):
            tracks = worker.choose_styles(worker.select_caption_tracks(samples, WIDTH, HEIGHT, 0.25), samples)
        protected = worker.corner_protection(samples, WIDTH, HEIGHT)
        for track in tracks:
            track["protected"] = protected
        worker.assign_recovery_exclusions(tracks)
        return samples, frames, tracks

    def test_static_short_animal_names_have_real_glyph_masks(self):
        for text, color in (("Fox", "white"), ("Lion", (255, 230, 30)), ("Zebra", "white"), ("Ox", "white")):
            with self.subTest(text=text):
                samples, frames, tracks = self.analyse([dict(text=text, color=color)])
                self.assertEqual(len(tracks), 1, "Repeated short animal label was missed.")
                track = tracks[0]
                self.assertLess(track["detections"][0]["box"][2], WIDTH * 0.14,
                                "Fixture must exercise the short-label admission path.")
                self.assertTrue(track["outlined"])
                mask = np.zeros((HEIGHT, WIDTH), np.uint8)
                x, y, w, h = track["box"]
                mask[y:y + h, x:x + w] = worker.track_mask(frames[1], track, samples[1]["time"])
                actual_text = np.any(frames[1] != scenery(), axis=2)
                self.assertGreater(np.count_nonzero(mask), 100)
                self.assertGreater(np.mean(mask[actual_text] > 0), 0.90,
                                   "The detected label did not mask its real fill and outline.")

    def test_two_spaced_observations_admit_a_proved_short_label(self):
        _, _, tracks = self.analyse([dict(text="Fox")], times=(0, 0.25))
        self.assertEqual(len(tracks), 1)

    def test_single_observation_does_not_admit_a_narrow_static_label(self):
        _, _, tracks = self.analyse([dict(text="Fox")], times=(0,))
        self.assertFalse(tracks)

    def test_three_tightly_clustered_observations_are_insufficient(self):
        _, _, tracks = self.analyse([dict(text="Fox")], times=(0, 0.10, 0.15))
        self.assertFalse(tracks, "Short label needs one sampling interval of repeated evidence.")

    def test_single_letter_is_not_a_caption_track(self):
        _, _, tracks = self.analyse([dict(text="X")])
        self.assertFalse(tracks)

    def test_title_scene_sign_and_corner_logo_remain_untouched(self):
        entries = [dict(text="Fox"), dict(text="Wild animals", y=80, size=32),
                   dict(text="RICE", x=180, y=260, size=20, outlined=False),
                   dict(text="KIDS", x=560, y=318, size=20)]
        samples, frames, tracks = self.analyse(entries)
        self.assertEqual(len(tracks), 1)
        self.assertEqual(tracks[0]["detections"][0]["text"], "Fox")
        before = frames[1]
        cleaned = before.copy()
        worker.clean_frame(cleaned, tracks, 0.25, samples, worker.FrameCache(samples), 0.25)
        self.assertTrue(np.array_equal(cleaned[:180], before[:180]), "Artistic title was modified.")
        self.assertTrue(np.array_equal(cleaned[250:285, 170:235], before[250:285, 170:235]),
                        "Unoutlined scenery sign was modified.")
        self.assertTrue(np.array_equal(cleaned[310:, 545:], before[310:, 545:]), "Corner logo was modified.")

    def test_moving_outlined_scenery_sign_does_not_become_static_caption(self):
        _, _, tracks = self.analyse(lambda index: [dict(text="RICE", x=200 + index * 40,
                                                       y=245 + index * 12, size=24)])
        self.assertFalse(tracks, "Moving physical lettering became a screen-attached track.")

    def test_minor_ocr_title_spelling_jitter_does_not_qualify(self):
        variants = ("Wild animals", "Wild anima1s", "Wild animals")
        _, _, tracks = self.analyse(lambda index: [dict(text=variants[index], y=80, size=32)])
        self.assertFalse(tracks)

    def test_merged_multiline_ocr_does_not_swallow_a_valid_short_label(self):
        frame, lines, _ = draw_frame([dict(text="Forest", y=235), dict(text="Fox", y=280)])
        sample = dict(index=0, time=0, scale=1, lines=lines)
        invalid = dict(text="Forest Fox", words=lines[0]["words"] + lines[1]["words"])
        self.assertIsNone(worker.line_detection(invalid, sample, WIDTH, HEIGHT))
        self.assertIsNotNone(worker.line_detection(lines[1], sample, WIDTH, HEIGHT))

    def test_nearby_large_heading_cannot_merge_into_a_different_caption_baseline(self):
        samples, _, tracks = self.analyse(
            lambda index: [dict(text="Wild animals", y=236, size=60)] if index == 0 else
            [dict(text="Animals live in a forest", y=278, size=32)], times=(0, 0.25, 0.5, 0.75))
        first = worker.line_detection(samples[0]["lines"][0], samples[0], WIDTH, HEIGHT)
        later = worker.line_detection(samples[1]["lines"][0], samples[1], WIDTH, HEIGHT)
        self.assertIsNotNone(first)
        self.assertIsNotNone(later)
        _, y1, _, h1 = first["box"]
        _, y2, _, h2 = later["box"]
        # These broad boxes satisfied the previous centre/height matching rule,
        # but their text baselines identify two separate screen rows.
        self.assertLessEqual(abs(y1 + h1 / 2 - y2 - h2 / 2), max(h1, h2) * 0.65)
        self.assertGreater(abs(y1 + h1 - y2 - h2), max(h1, h2) * 0.30)
        self.assertEqual(len(tracks), 1)
        self.assertEqual(tracks[0]["times"], [0.25, 0.5, 0.75])
        self.assertTrue(all(item["text"] == "Animals live in a forest" for item in tracks[0]["detections"]))

    def test_same_word_at_two_distinct_positions_forms_separate_stable_tracks(self):
        _, _, tracks = self.analyse(lambda index: [dict(text="Fox", x=280 if index < 2 else 335)],
                                    times=(0, 0.25, 0.5, 0.75))
        self.assertEqual(len(tracks), 2, "Different OCR position groups rejected the entire short label.")
        self.assertEqual([track["times"] for track in tracks], [[0, 0.25], [0.5, 0.75]])
        self.assertGreater(tracks[1]["box"][0] - tracks[0]["box"][0], 40)

    def test_outlined_scene_highlight_far_from_caption_anchor_is_preserved(self):
        samples, frames, tracks = self.analyse([dict(text="Fox")])
        self.assertEqual(len(tracks), 1)
        for sample, frame in zip(samples, frames):
            image = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            draw = ImageDraw.Draw(image)
            draw.ellipse((75, 285, 88, 307), fill="white", outline="black", width=2)
            worker.save_png(sample["source"], cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR))
        with patch.object(worker, "emit"):
            fragments = worker.residual_tracks(samples, tracks, WIDTH, HEIGHT, [])
        self.assertFalse(any(any(word["box"][0] < 100 for word in item["words"])
                             for track in fragments for item in track["detections"]),
                         "An unrelated outlined forest highlight became a caption fragment.")
        original = worker.load_png(samples[1]["source"])
        cleaned = original.copy()
        worker.clean_frame(cleaned, tracks + fragments, 0.25, samples, worker.FrameCache(samples), 0.25)
        self.assertTrue(np.array_equal(cleaned[280:312, 70:94], original[280:312, 70:94]))

    def test_partly_erased_cyan_caption_recovers_from_same_scene_two_seconds_away(self):
        samples = []
        frames = []
        for index, timestamp in enumerate((0, 0.25, 2, 2.25)):
            text = "Bell" if index < 2 else "Belling the cat"
            frame, lines, _ = draw_frame([dict(text=text, x=200, color=(35, 190, 245))])
            source = self.directory / ("cyan-remnant-%s.png" % index)
            worker.save_png(source, frame)
            samples.append(dict(index=index, time=timestamp, scale=1, source=str(source),
                                lines=[] if index < 2 else lines))
            frames.append(frame)
        with patch.object(worker, "emit"):
            tracks = worker.choose_styles(worker.select_caption_tracks(samples, WIDTH, HEIGHT, 0.25), samples)
            fragments = worker.residual_tracks(samples, tracks, WIDTH, HEIGHT, [])
        self.assertTrue(tracks, "Later complete caption must establish its color and geometry.")
        self.assertTrue(any(item["time"] == 0 for track in fragments for item in track["detections"]),
                        "A same-scene caption remnant lost its two-second OCR anchor.")
        mask = np.zeros((HEIGHT, WIDTH), np.uint8)
        for track in fragments:
            if worker.active_track(track, 0, 0.25):
                x, y, width, height = track["box"]
                mask[y:y + height, x:x + width] |= worker.track_mask(frames[0], track, 0)
        self.assertGreater(np.count_nonzero(mask[275:315, 195:255]), 100)
        self.assertEqual(np.count_nonzero(mask[:250]), 0)

    def test_two_second_anchor_cannot_cross_an_intervening_scene_cut(self):
        samples = []
        for index, timestamp in enumerate((0, 0.25, 1, 2, 2.25)):
            text = "Bell" if index < 2 else "Belling the cat"
            frame, lines, _ = draw_frame([dict(text=text, x=200, color=(35, 190, 245))])
            if index == 2:
                frame[:] = (25, 40, 55)
            source = self.directory / ("cut-remnant-%s.png" % index)
            worker.save_png(source, frame)
            samples.append(dict(index=index, time=timestamp, scale=1, source=str(source),
                                lines=lines if index >= 3 else []))
        with patch.object(worker, "emit"):
            tracks = worker.choose_styles(worker.select_caption_tracks(samples, WIDTH, HEIGHT, 0.25), samples)
            fragments = worker.residual_tracks(samples, tracks, WIDTH, HEIGHT, [])
        self.assertTrue(tracks)
        self.assertFalse(any(item["time"] < 1 for track in fragments for item in track["detections"]),
                         "Caption geometry leaked through an intervening cut into another scene.")

    def test_rounded_badge_is_preserved_while_its_empty_corner_remains_removable(self):
        base = np.full((HEIGHT, WIDTH, 3), (95, 125, 145), np.uint8)
        image = Image.fromarray(cv2.cvtColor(base, cv2.COLOR_BGR2RGB))
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle((530, 302, 665, 351), radius=24, fill=(230, 245, 250))
        badge = np.any(cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR) != base, axis=2)
        logo_font = font(18)
        draw.text((582, 315), "KIDS", font=logo_font, fill=(20, 120, 190))
        lx, ly, lr, lb = draw.textbbox((582, 315), "KIDS", font=logo_font)
        terminal_font = font(14)
        draw.text((531, 291), "t", font=terminal_font, fill="white", stroke_width=2, stroke_fill="black")
        tx, ty, tr, tb = draw.textbbox((531, 291), "t", font=terminal_font)
        frame = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR)
        samples = []
        for index in range(3):
            source = self.directory / ("rounded-%s.png" % index)
            worker.save_png(source, frame)
            samples.append(dict(index=index, time=index * 0.25, scale=1, source=str(source),
                                lines=[dict(text="KIDS", words=[dict(text="KIDS", x=lx, y=ly,
                                                                     w=lr - lx, h=lb - ly)])]))
        protected = worker.corner_protection(samples, WIDTH, HEIGHT)
        protection = np.zeros((HEIGHT, WIDTH), np.uint8)
        for left, top, right, bottom in protected:
            protection[top:bottom, left:right] = 255
        self.assertTrue(np.all(protection[badge] > 0), "Rounded badge artwork was not fully protected.")
        self.assertEqual(protection[302, tx], 0,
                         "The badge bounding rectangle still hides its empty rounded corner.")
        box = [tx - 6, ty - 6, tr - tx + 12, tb - ty + 12]
        detection = dict(sample=0, time=0, words=[dict(text="t", box=[tx, ty, tr - tx, tb - ty])])
        track = dict(box=box, height=tb - ty, modes=["light"], fragment=True,
                     detections=[detection], times=[0], protected=protected)
        x, y, w, h = box
        mask = worker.track_mask(frame, track, 0)
        full_mask = np.zeros((HEIGHT, WIDTH), np.uint8)
        full_mask[y:y + h, x:x + w] = mask
        self.assertGreater(np.count_nonzero(full_mask[ty:tb, tx:tr]), 5,
                           "A terminal caption stroke beside the curved badge was not removable.")
        self.assertEqual(np.count_nonzero(full_mask[badge]), 0)
        cleaned = frame.copy()
        worker.clean_frame(cleaned, [track], 0, samples, worker.FrameCache(samples), 0.25)
        self.assertTrue(np.array_equal(cleaned[badge], frame[badge]))
        self.assertTrue(np.array_equal(cleaned[full_mask == 0], frame[full_mask == 0]))

    def test_yellow_panel_mask_covers_the_panel_but_yellow_letters_do_not_make_a_panel(self):
        base = np.full((90, 260, 3), (105, 135, 155), np.uint8)
        face = font(26)
        image = Image.fromarray(cv2.cvtColor(base, cv2.COLOR_BGR2RGB))
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle((30, 10, 230, 73), radius=12, fill=(255, 215, 35))
        panel = np.any(cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR) != base, axis=2)
        position = ((260 - round(face.getlength("Elephant"))) // 2, 24)
        draw.text(position, "Elephant", font=face, fill="white", stroke_width=2, stroke_fill="black")
        left, top, right, bottom = draw.textbbox(position, "Elephant", font=face)
        detection = dict(box=[left, top, right - left, bottom - top],
                         words=[dict(text="Elephant", box=[left, top, right - left, bottom - top])], time=0)
        frame = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR)
        mask = worker.caption_backplate_mask(frame, [detection], (0, 0), 28)
        self.assertGreater(np.mean(mask[panel] > 0), 0.98, "Solid caption panel was only partially masked.")
        self.assertEqual(np.count_nonzero(mask[:, :25]), 0, "Scene beside the panel was included.")
        letters = Image.fromarray(cv2.cvtColor(base, cv2.COLOR_BGR2RGB))
        ImageDraw.Draw(letters).text(position, "Elephant", font=face, fill=(255, 215, 35),
                                    stroke_width=2, stroke_fill="black")
        letters = cv2.cvtColor(np.asarray(letters), cv2.COLOR_RGB2BGR)
        self.assertEqual(np.count_nonzero(worker.caption_backplate_mask(letters, [detection], (0, 0), 28)), 0,
                         "Separate yellow glyphs were mistaken for a solid caption panel.")

    def test_missed_ocr_interval_keeps_real_letters_but_preserves_blank_scene(self):
        samples, _, tracks = self.analyse([dict(text="Fox")], times=(0, 0.25, 1.5))
        self.assertEqual(len(tracks), 1)
        track = tracks[0]
        self.assertTrue(worker.active_track(track, 0.75, 0.25))
        visible, _, _ = draw_frame([dict(text="Fox")])
        self.assertGreater(np.count_nonzero(worker.track_mask(visible, track, 0.75)), 100)
        blank = scenery()
        self.assertEqual(np.count_nonzero(worker.track_mask(blank, track, 0.75)), 0,
                         "OCR continuity erased bare scenery without actual outlined letters.")
        cleaned = blank.copy()
        selected, restored = worker.clean_frame(cleaned, tracks, 0.75, samples, worker.FrameCache(samples), 0.25)
        self.assertEqual((selected, restored), (0, 0))
        self.assertTrue(np.array_equal(cleaned, blank))

    def test_separate_caption_runs_do_not_bridge_a_long_empty_interval(self):
        _, _, tracks = self.analyse([dict(text="Fox")], times=(0, 0.25, 0.5, 3, 3.25, 3.5))
        self.assertEqual(len(tracks), 2)
        self.assertFalse(any(worker.active_track(track, 1.75, 0.25) for track in tracks))


if __name__ == "__main__":
    unittest.main(verbosity=2)

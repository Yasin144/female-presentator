"""Meaningful local regression/visual fixture for burned-in caption removal.

Run: python -I scripts/test-caption-eraser-worker.py
Requires the same already-installed OpenCV/Pillow/Windows OCR as the worker.
Leaves small before/after preview images in temp/caption-eraser-validation.
"""
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("caption_eraser", ROOT / "caption-eraser-worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


def write_clip(path, frames, times, durations):
    height, width = frames[0].shape[:2]
    process = subprocess.Popen([shutil.which("ffmpeg"), "-v", "error", "-y", "-f", "matroska", "-i", "pipe:0",
                                "-c:v", "ffv1", "-level", "3", "-fps_mode", "passthrough", "-enc_time_base", "demux", str(path)],
                               stdin=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=subprocess.CREATE_NO_WINDOW)
    process.stdin.write(worker.matroska_header(width, height, durations[-1]))
    for frame, timestamp, duration in zip(frames, times, durations):
        process.stdin.write(worker.timestamped_frame(frame, timestamp, duration))
    process.stdin.close()
    errors = process.stderr.read()
    assert process.wait() == 0, errors
    process.stderr.close()


def invoke(path, output, directory):
    result = subprocess.run([sys.executable, "-I", "-u", str(ROOT / "caption-eraser-worker.py"), "--input", str(path),
                             "--output", str(output), "--work-dir", str(directory)], capture_output=True, text=True,
                            encoding="utf-8", creationflags=subprocess.CREATE_NO_WINDOW)
    lines = [json.loads(line) for line in result.stdout.splitlines() if line.startswith("{")]
    assert result.returncode == 0, (result.stdout[-2000:], result.stderr)
    return lines[-1]


class CaptionRemovalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = ROOT / "temp" / "caption-eraser-validation"
        cls.directory.mkdir(parents=True, exist_ok=True)
        width, height = 640, 360
        yy, xx = np.indices((height, width))
        cls.background = np.stack([60 + xx // 10, 105 + yy // 10, 145 + xx // 20], axis=2).astype(np.uint8)
        cls.font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 32)
        logo_font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 16)
        cls.clean = []
        cls.captioned = []
        cls.true_masks = []
        for index in range(120):
            frame = Image.fromarray(cv2.cvtColor(cls.background, cv2.COLOR_BGR2RGB))
            draw = ImageDraw.Draw(frame)
            draw.ellipse((20 + index * 3 % 540, 75, 60 + index * 3 % 540, 115), fill=(35, 190, 120))
            draw.text((10, 10), "KIDS", font=logo_font, fill="white", stroke_width=1, stroke_fill="black")
            cls.clean.append(cv2.cvtColor(np.asarray(frame), cv2.COLOR_RGB2BGR))
            text = "Little cuckoo, sing with me!" if 20 <= index < 60 else "Spread your wings and fly!" if 65 <= index < 105 else ""
            if text:
                box = draw.textbbox((0, 0), text, font=cls.font)
                x = (width - (box[2] - box[0])) // 2
                draw.text((x + 2, 292), text, font=cls.font, fill=(30, 30, 30), stroke_width=3, stroke_fill=(30, 30, 30))
                draw.text((x, 290), text, font=cls.font, fill="white", stroke_width=2, stroke_fill="black")
            captioned = cv2.cvtColor(np.asarray(frame), cv2.COLOR_RGB2BGR)
            cls.captioned.append(captioned)
            cls.true_masks.append(np.any(captioned != cls.clean[-1], axis=2))
        cls.times = [index / 12 for index in range(120)]
        cls.durations = [1 / 12] * 120
        cls.input = cls.directory / "captioned.mkv"
        cls.clean_input = cls.directory / "no-captions.mkv"
        cls.output = cls.directory / "cleaned.mkv"
        write_clip(cls.input, cls.captioned, cls.times, cls.durations)
        write_clip(cls.clean_input, cls.clean, cls.times, cls.durations)

    def test_a_timestamp_transport_is_lossless(self):
        capture = cv2.VideoCapture(str(self.input))
        actual = []
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            actual.append(frame)
        capture.release()
        self.assertEqual(len(actual), len(self.captioned))
        self.assertTrue(all(np.array_equal(a, b) for a, b in zip(actual, self.captioned)))

    def test_b_ocr_removal_and_visual_quality(self):
        result = invoke(self.input, self.output, self.directory)
        self.assertTrue(result["changed"], result)
        self.assertEqual(result["framesProcessed"], 120)
        self.assertTrue(result["detectedRegions"], result)
        capture = cv2.VideoCapture(str(self.output))
        caption_error, unchanged_error = [], []
        frames = []
        for index, expected in enumerate(self.clean):
            ok, actual = capture.read()
            self.assertTrue(ok)
            frames.append(actual)
            true_mask = self.true_masks[index]
            if true_mask.any():
                caption_error.extend(np.abs(actual.astype(np.int16) - expected.astype(np.int16))[true_mask].ravel().tolist())
            # Upper scenery and corner watermark must remain exactly unchanged.
            unchanged_error.append(np.max(np.abs(actual[:250].astype(np.int16) - expected[:250].astype(np.int16))))
        capture.release()
        metrics = dict(meanCaptionPixelError=float(np.mean(caption_error)),
                       maxOutsideRegionError=int(max(unchanged_error)), result=result)
        (self.directory / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
        worker.save_png(self.directory / "before.png", self.captioned[40])
        worker.save_png(self.directory / "after.png", frames[40])
        worker.save_png(self.directory / "original-background.png", self.clean[40])
        self.assertLess(metrics["meanCaptionPixelError"], 2, metrics)
        self.assertEqual(metrics["maxOutsideRegionError"], 0, metrics)
        times = worker.probe_video(str(self.output), shutil.which("ffprobe"))
        self.assertEqual(times["frameCount"], 120)
        self.assertLess(abs(times["videoDuration"] - 10), 0.01)

    def test_c_no_caption_noop(self):
        output = self.directory / "unchanged-output.mkv"
        if output.exists():
            output.unlink()
        result = invoke(self.clean_input, output, self.directory)
        self.assertFalse(result["changed"], result)
        self.assertTrue(result["noCaptionsDetected"], result)
        self.assertFalse(output.exists())

    def test_d_variable_timestamps(self):
        durations = [0.05, 0.1, 0.15, 0.06, 0.12, 0.08]
        times = np.cumsum([0] + durations[:-1]).tolist()
        source = self.directory / "variable.mkv"
        write_clip(source, self.clean[:6], times, durations)
        probed = worker.probe_video(str(source), shutil.which("ffprobe"))
        self.assertEqual(len(probed["times"]), 6)
        self.assertLess(max(abs(a - b) for a, b in zip(probed["times"], times)), 0.0011)
        self.assertLess(abs(probed["videoDuration"] - sum(durations)), 0.002)
        rendered = self.directory / "variable-rendered.mkv"
        worker.render_video(str(source), str(rendered), probed, [], [], 0.5, shutil.which("ffmpeg"))
        result = worker.probe_video(str(rendered), shutil.which("ffprobe"))
        self.assertEqual(result["frameCount"], 6)
        self.assertLess(max(abs(a - b) for a, b in zip(result["times"], times)), 0.0011)
        self.assertLess(abs(result["videoDuration"] - sum(durations)), 0.002)

    def test_e_rotated_video(self):
        # The coded frames are sideways. Windows OCR and the rendered output
        # must use the same normalized display orientation.
        rotated = self.directory / "sideways.mkv"
        coded = [cv2.rotate(frame, cv2.ROTATE_90_CLOCKWISE) for frame in self.captioned]
        write_clip(rotated, coded, self.times, self.durations)
        encoded = self.directory / "sideways-encoded.mp4"
        tagged = self.directory / "sideways-tagged.mp4"
        subprocess.run([shutil.which("ffmpeg"), "-v", "error", "-y", "-i", str(rotated), "-c:v", "libx264",
                        "-crf", "0", str(encoded)], check=True, creationflags=subprocess.CREATE_NO_WINDOW)
        subprocess.run([shutil.which("ffmpeg"), "-v", "error", "-y", "-display_rotation", "90", "-i", str(encoded),
                        "-c", "copy", str(tagged)], check=True, creationflags=subprocess.CREATE_NO_WINDOW)
        result = invoke(tagged, self.directory / "rotated-clean.mkv", self.directory)
        self.assertTrue(result["changed"], result)
        self.assertEqual((result["width"], result["height"]), (640, 360))
        self.assertEqual(result["framesProcessed"], 120)

    def test_f_white_yellow_and_pastel_karaoke_words(self):
        font = self.font
        frames, clean = [], []
        words = ["Little", "cuckoo", "sing", "with", "me!"]
        gap = 10
        word_widths = [round(font.getlength(word)) for word in words]
        left = (640 - sum(word_widths) - gap * (len(words) - 1)) // 2
        for index in range(96):
            image = Image.fromarray(cv2.cvtColor(self.clean[index], cv2.COLOR_BGR2RGB))
            draw = ImageDraw.Draw(image)
            clean.append(np.asarray(image).copy())
            if 12 <= index < 84:
                active = ((index - 12) // 14) % len(words)
                x = left
                for word_index, word in enumerate(words):
                    highlight = (255, 230, 30) if index < 48 else (145, 140, 240)
                    fill = highlight if word_index == active else (255, 255, 255)
                    draw.text((x + 2, 292), word, font=font, fill=(25, 25, 25), stroke_width=3, stroke_fill=(25, 25, 25))
                    draw.text((x, 290), word, font=font, fill=fill, stroke_width=2, stroke_fill="black")
                    x += word_widths[word_index] + gap
            frames.append(cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR))
        source = self.directory / "karaoke.mkv"
        output = self.directory / "karaoke-clean.mkv"
        times = [index / 12 for index in range(96)]
        write_clip(source, frames, times, [1 / 12] * 96)
        result = invoke(source, output, self.directory)
        self.assertTrue(result["changed"], result)
        analysis = json.loads(Path(result["analysisPath"]).read_text(encoding="utf-8"))
        self.assertTrue(any("125" in track["modes"] for track in analysis["tracks"]),
                        "Pastel karaoke letters need their own foreground colour.")
        capture = cv2.VideoCapture(str(output))
        errors = []
        for index in range(96):
            ok, actual = capture.read()
            self.assertTrue(ok)
            expected = cv2.cvtColor(clean[index], cv2.COLOR_RGB2BGR)
            mask = np.any(frames[index] != expected, axis=2)
            if mask.any():
                errors.extend(np.abs(actual.astype(np.int16) - expected.astype(np.int16))[mask].ravel().tolist())
            if index == 40:
                worker.save_png(self.directory / "karaoke-before.png", frames[index])
                worker.save_png(self.directory / "karaoke-after.png", actual)
        capture.release()
        self.assertLess(float(np.mean(errors)), 2, result)

    def test_g_optional_real_source_focused_ocr_and_fragments(self):
        # Real user frames stay in ignored temp storage; no lesson video or
        # large image fixtures are added to Git. Synthetic tests remain portable.
        folder = ROOT / "temp" / "belling-caption-review"
        if not all((folder / ("before-%s.png" % value)).is_file() for value in [2, 8, 10, 25, 90, 97]):
            self.skipTest("Optional real-source snapshots are not present.")
        with tempfile.TemporaryDirectory(prefix="real-caption-test-", dir=str(self.directory)) as directory:
            samples = []
            for second in [2, 8, 10, 25, 90, 97]:
                source = folder / ("before-%s.png" % second)
                frame = worker.load_png(source)
                smaller = cv2.resize(frame, (1600, 900), interpolation=cv2.INTER_AREA)
                native = Path(directory) / ("native-%s.png" % second)
                lower = Path(directory) / ("lower-%s.png" % second)
                worker.save_png(native, smaller)
                worker.save_png(lower, smaller[684:])
                samples.append(dict(index=len(samples), time=float(second), scale=1600 / 1920,
                                    source=str(source), path=str(native), lowerPath=str(lower), lowerOffset=684))
            worker.recognize_samples(samples, directory, ROOT / "scripts" / "caption-eraser-ocr.ps1")
            title = next(sample for sample in samples if sample["time"] == 10)
            self.assertTrue(any("belling" in line["text"].casefold() for line in title["lines"]))
            # Duplicate the actual persistent glyph observations to check the
            # two-frame safeguard without exporting a second large lesson clip.
            repeated = []
            for sample in samples:
                for offset in [0, 0.25]:
                    repeated.append(dict(sample, index=len(repeated), time=sample["time"] + offset))
            tracks = worker.choose_styles(worker.select_caption_tracks(repeated, 1920, 1080), repeated)
            protection = worker.corner_protection(repeated, 1920, 1080)
            for track in tracks:
                track["protected"] = protection
            fragments = worker.residual_tracks(repeated, tracks, 1920, 1080, protection)
            self.assertFalse(any(any(item["time"] < 3 for item in track["detections"]) for track in fragments),
                             "Intro scene highlights must not become caption fragments.")
            tracks += fragments
            targets = {8: [530, 950, 742, 1015], 10: [530, 948, 995, 1025],
                       25: [1654, 950, 1689, 987], 90: [213, 971, 1056, 1027], 97: [1365, 975, 1387, 1007]}
            for second, (left, top, right, bottom) in targets.items():
                frame = worker.load_png(folder / ("before-%s.png" % second))
                mask = np.zeros(frame.shape[:2], np.uint8)
                for track in tracks:
                    if worker.active_track(track, second, 0.5):
                        x, y, width, height = track["box"]
                        mask[y:y + height, x:x + width] |= worker.track_mask(frame, track, second)
                self.assertGreater(np.count_nonzero(mask[top:bottom, left:right]), 100, second)
                # The empty corner beside a rounded badge can contain a real
                # caption letter. Preserve its measured artwork, not that wedge.
                for left, top, right, bottom in protection:
                    self.assertEqual(np.count_nonzero(mask[top:bottom, left:right]), 0, second)
                self.assertEqual(np.count_nonzero(mask[:850]), 0, second)

    def test_h_sample_cache_binding_and_tamper(self):
        video = worker.probe_video(str(self.clean_input), shutil.which("ffprobe"))
        with tempfile.TemporaryDirectory(prefix="cache-binding-test-", dir=str(self.directory)) as directory:
            cache = Path(directory) / "cache"
            work = Path(directory) / "work"
            cache.mkdir()
            work.mkdir()
            sampled = worker.sample_frames(str(self.clean_input), video, str(cache), 0.5)
            reused = worker.reuse_samples(str(self.clean_input), video, str(cache), str(work), 0.5)
            self.assertEqual(len(reused), len(sampled))
            # Poison a frame that is neither the first/middle/last anchor.
            for name in ["source-000003.png", "ocr-000003.png"]:
                path = cache / name
                original = path.read_bytes()
                changed = worker.load_png(path)
                changed[12, 120] ^= 255
                worker.save_png(path, changed)
                with self.assertRaisesRegex(ValueError, "changed or replaced"):
                    worker.reuse_samples(str(self.clean_input), video, str(cache), str(work), 0.5)
                path.write_bytes(original)
            (cache / "sample-binding.json").unlink()
            with self.assertRaisesRegex(ValueError, "legacy.*no source binding"):
                worker.reuse_samples(str(self.clean_input), video, str(cache), str(work), 0.5)

    def test_i_karaoke_donor_cannot_reintroduce_caption(self):
        # The neighboring frame changes every letter to a colour missing from
        # the current line's palette. OCR still proves that donor region is text.
        with tempfile.TemporaryDirectory(prefix="caption-donor-test-", dir=str(self.directory)) as directory:
            samples, frames, detections = [], [], []
            for index, colour in enumerate(["white", (255, 230, 30)]):
                image = Image.fromarray(cv2.cvtColor(self.background, cv2.COLOR_BGR2RGB))
                draw = ImageDraw.Draw(image)
                draw.text((220, 290), "Karaoke", font=self.font, fill=colour, stroke_width=2, stroke_fill="black")
                left, top, right, bottom = draw.textbbox((220, 290), "Karaoke", font=self.font)
                frame = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR)
                source = Path(directory) / (str(index) + ".png")
                worker.save_png(source, frame)
                frames.append(frame)
                samples.append(dict(index=index, time=index * 0.25, source=str(source)))
                box = [left, top, right - left, bottom - top]
                detections.append(dict(sample=index, time=index * 0.25, box=box,
                                       words=[dict(text="Karaoke", box=box)]))
            track = dict(box=[200, 275, 180, 70], height=30, modes=["light"],
                         times=[0, 0.25], detections=detections, outlined=True)
            tracks = [track]
            tracks += worker.residual_tracks(samples, tracks, 640, 360, [])
            original_mask = np.zeros((360, 640), np.uint8)
            for item in tracks:
                if worker.active_track(item, 0, 0.25):
                    x, y, width, height = item["box"]
                    original_mask[y:y + height, x:x + width] |= worker.track_mask(frames[0], item, 0)
            cleaned = frames[0].copy()
            worker.clean_frame(cleaned, tracks, 0, samples, worker.FrameCache(samples), 0.25)
            hsv = cv2.cvtColor(cleaned, cv2.COLOR_BGR2HSV)
            yellow = (hsv[:, :, 0] >= 20) & (hsv[:, :, 0] <= 40) & (hsv[:, :, 1] > 150) & (hsv[:, :, 2] > 190)
            self.assertEqual(int(np.count_nonzero(yellow)), 0, "A donor karaoke letter was copied back into the image.")
            self.assertTrue(np.array_equal(cleaned[original_mask == 0], frames[0][original_mask == 0]))
            # Temporal expansion must not erase bare scenery after the text ends.
            self.assertEqual(np.count_nonzero(worker.track_mask(self.background, track, 0.5)), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)

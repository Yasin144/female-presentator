"""Caption backplate geometry/cleanup checks on synthetic pixels only.

No OCR, external services, subprocesses, or full lesson renders are involved.
"""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('caption_panel_worker', ROOT/'caption-eraser-worker.py')
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)
FONT = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 36)


def fixture(colour=(255, 214, 20), shape='rounded', text_colour=(245, 245, 245)):
    yy, xx = np.indices((360, 640))
    scene = np.stack((35+xx%19, 90+yy%23, 55+(xx+yy)%17), axis=2).astype(np.uint8)
    image = Image.fromarray(cv2.cvtColor(scene, cv2.COLOR_BGR2RGB))
    drawing = ImageDraw.Draw(image)
    origin = (250, 271)
    word = 'Animal'
    left, top, right, bottom = drawing.textbbox(origin, word, font=FONT)
    font_height = bottom-top
    panel = [left-50, top-25, right+50, bottom+25]
    panel_image = Image.new('L', image.size, 0)
    panel_draw = ImageDraw.Draw(panel_image)
    if shape == 'rounded':
        drawing.rounded_rectangle(panel, radius=20, fill=colour)
        panel_draw.rounded_rectangle(panel, radius=20, fill=255)
    elif shape == 'ellipse':
        drawing.ellipse(panel, fill=colour)
        panel_draw.ellipse(panel, fill=255)
    elif shape == 'oversized':
        drawing.rectangle([30, 170, 620, 355], fill=colour)
    # A nearby matching-colour badge must not be absorbed into the caption card.
    logo = [550, 295, 632, 343]
    drawing.rounded_rectangle(logo, radius=10, fill=colour)
    drawing.text((558, 307), 'TV', font=ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 20), fill=(20,20,20))
    drawing.text(origin, word, font=FONT, fill=text_colour, stroke_width=2, stroke_fill=(5,5,5))
    frame = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
    detection = dict(box=[left,top,right-left,bottom-top], text=word, sample=0, time=1.0,
                     words=[dict(text=word, box=[left,top,right-left,bottom-top])], outlinedLetters=6)
    padding = round(font_height*.28)
    track = dict(box=[left-padding,top-padding,right-left+padding*2,bottom-top+padding*2],
                 height=font_height, detections=[detection], times=[1.0], padding=padding,
                 outlined=True, captionSamples={0}, protected=[logo])
    return frame, scene, np.array(panel_image)>0, panel, logo, detection, track


class PanelTests(unittest.TestCase):
    def test_wide_pill_margins_are_removed_and_scene_and_logo_preserved(self):
        frame, scene, panel_mask, panel, logo, detection, track = fixture()
        original_box = track['box'].copy()
        self.assertGreater(panel[0]+50-original_box[0], 0)
        self.assertGreater(original_box[0], panel[0], 'Fixture no longer reproduces clipped panel margins.')
        with tempfile.TemporaryDirectory(prefix='caption-panel-') as directory:
            source = Path(directory)/'source.png'
            worker.save_png(source, frame)
            samples = [dict(index=0,time=1.0,source=str(source))]
            styled = worker.choose_styles([track], samples)
            self.assertEqual(len(styled), 1)
            x,y,w,h = track['box']
            self.assertLessEqual(x, panel[0]-2)
            self.assertGreaterEqual(x+w, panel[2]+3)
            self.assertLessEqual(y, panel[1]-2)
            self.assertGreaterEqual(y+h, panel[3]+3)
            mask = worker.track_mask(frame, track, 1.0)
            full_mask = np.zeros(frame.shape[:2], np.uint8)
            full_mask[y:y+h,x:x+w] = mask
            self.assertTrue(np.all(full_mask[panel_mask] > 0), 'A caption card edge or glyph hole was not masked.')
            cleaned = frame.copy()
            worker.clean_frame(cleaned,[track],1.0,samples,worker.FrameCache(samples),.25)
            hsv = cv2.cvtColor(cleaned,cv2.COLOR_BGR2HSV)
            yellow = (hsv[:,:,0]>=15)&(hsv[:,:,0]<=40)&(hsv[:,:,1]>160)&(hsv[:,:,2]>200)
            self.assertEqual(int(np.count_nonzero(yellow&panel_mask)),0,'Original yellow card leaked back into its interior.')
            self.assertTrue(np.array_equal(cleaned[full_mask==0],frame[full_mask==0]))
            left,top,right,bottom=logo
            self.assertTrue(np.array_equal(cleaned[top:bottom+1,left:right+1],frame[top:bottom+1,left:right+1]))
            # Expanding the box must not enlarge the glyph-only word-area mask
            # into a guessed full-width band.
            self.assertEqual(int(np.count_nonzero(full_mask[:200])),0)

    def test_colour_and_neutral_panels_have_complete_native_integer_bounds(self):
        for colour in [(255,214,20),(225,30,45),(100,55,215),(45,45,45),(225,225,225)]:
            with self.subTest(colour=colour):
                frame,_,panel_mask,panel,_,detection,track=fixture(colour)
                bounds=worker.discover_caption_backplate_bounds(frame,detection,track['height'])
                self.assertTrue(bounds,'A solid panel colour was not discovered.')
                worker.expand_caption_track_bounds(track,bounds,frame.shape[:2])
                x,y,w,h=track['box']
                mask=worker.caption_backplate_mask(frame[y:y+h,x:x+w],[detection],(x,y),track['height'])
                full=np.zeros(frame.shape[:2],np.uint8)
                full[y:y+h,x:x+w]=mask
                self.assertTrue(np.all(full[panel_mask]>0))
                json.dumps(bounds)
                json.dumps(track['box'])

    def test_uniform_scene_is_not_a_caption_box(self):
        frame,_,_,_,_,detection,track=fixture()
        # No visible box boundary exists inside this local search window.
        uniform=np.full_like(frame,(20,214,255))
        self.assertEqual(worker.discover_caption_backplate_bounds(uniform,detection,track['height']),[])
        x,y,w,h=track['box']
        mask=worker.caption_backplate_mask(uniform[y:y+h,x:x+w],[detection],(x,y),track['height'])
        self.assertEqual(int(np.count_nonzero(mask)),0)

    def test_oval_and_oversized_scenery_are_not_box_backplates(self):
        for shape in ['ellipse','oversized']:
            with self.subTest(shape=shape):
                frame,_,_,_,_,detection,track=fixture(shape=shape)
                self.assertEqual(worker.discover_caption_backplate_bounds(frame,detection,track['height']),[])


if __name__=='__main__':
    unittest.main(verbosity=2)

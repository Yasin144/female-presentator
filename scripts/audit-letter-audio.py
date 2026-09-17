"""Unprompted local audio audit; keep raw recognition instead of filling gaps."""
import json
import sys
from pathlib import Path
from faster_whisper import WhisperModel

cache = Path('D:/AppData/hf-cache/huggingface/hub/models--Systran--faster-whisper-small/snapshots')
model_path = next(p for p in cache.iterdir() if (p / 'model.bin').exists())
model = WhisperModel(str(model_path), device='cpu', compute_type='int8', cpu_threads=6)
for filename in sys.argv[1:]:
    print(json.dumps({'file': filename}), flush=True)
    segments, info = model.transcribe(filename, language='en', beam_size=5,
        condition_on_previous_text=False, word_timestamps=True, vad_filter=False,
        temperature=0, initial_prompt=None)
    for s in segments:
        print(json.dumps({'start': s.start, 'end': s.end, 'text': s.text,
            'words': [{'text': w.word, 'start': w.start, 'end': w.end,
                       'probability': w.probability} for w in (s.words or [])]}), flush=True)

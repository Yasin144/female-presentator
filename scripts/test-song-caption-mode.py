"""Exercise the actual decoder settings without loading an ASR model."""
import ast
from pathlib import Path
from types import SimpleNamespace
from collections import Counter
import re
import unittest

source = Path(__file__).resolve().parents[1] / 'whisper-transcribe-caption.py'
tree = ast.parse(source.read_text(encoding='utf-8-sig'))
names = {'clean', 'is_repetition_loop', 'run_whisper_with_model'}
functions = ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names], type_ignores=[])

class SongModeTest(unittest.TestCase):
    def test_song_keeps_word_times_and_disables_speech_gate(self):
        for song in (False, True):
            scope = {'re': re, 'Counter': Counter, 'song_mode': song}
            exec(compile(functions, str(source), 'exec'), scope)
            class Model:
                def transcribe(self, audio, **kwargs):
                    self.options = kwargs
                    word = SimpleNamespace(word='Hello', start=2.0, end=6.0)
                    segment = SimpleNamespace(text='Hello my friend', start=2.0, end=6.0, no_speech_prob=0.01, avg_logprob=-0.1, words=[word])
                    return iter([segment]), SimpleNamespace(duration=10, language='en')
            model = Model()
            _, _, _, words = scope['run_whisper_with_model'](model, 'test.wav', 'en')
            self.assertEqual(model.options['vad_filter'], not song)
            self.assertTrue(model.options['word_timestamps'])
            self.assertFalse(model.options['condition_on_previous_text'])
            self.assertEqual(words[0]['start'], 2.0)
            self.assertEqual(words[0]['end'], 6.0)

if __name__ == '__main__':
    unittest.main()

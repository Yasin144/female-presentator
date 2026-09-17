import io
import ast
import json
from pathlib import Path
import sys
import unittest
import wave
from array import array
import tempfile
import threading
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from alphabet_tts import cached_letter, isolated_letter, letter_sequence, join_letters, extract_letter, pause_boundary, make_verified_letter, LetterClarityError


def recording():
    result = io.BytesIO()
    with wave.open(result, 'wb') as wav:
        wav.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
        wav.writeframes(b'\xd0\x07' * 48000)
    return result.getvalue()


def words(*text):
    return [{'word': word, 'start': i * .5, 'end': i * .5 + .3}
            for i, word in enumerate(text)]


class AlphabetSpeech(unittest.TestCase):
    def test_short_alphabet_guides_have_a_lower_generation_limit(self):
        source = Path(__file__).resolve().parents[1] / 'anjali-chatterbox-server.py'
        tree = ast.parse(source.read_text(encoding='utf-8-sig'))
        function = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == '_capped_t3_inference')
        limits = threading.local()
        scope = {'_generation_limits': limits, '_orig_t3_inf': lambda **kwargs: kwargs['max_new_tokens']}
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), 'exec'), scope)
        self.assertEqual(scope['_capped_t3_inference'](max_new_tokens=1000), 350)
        limits.max_tokens = 150
        self.assertEqual(scope['_capped_t3_inference'](max_new_tokens=1000), 150)
        self.assertEqual(scope['_capped_t3_inference'](max_new_tokens=80), 80)

    def test_server_routes_letter_requests_through_checked_audio_before_normal_cache(self):
        source = Path(__file__).resolve().parents[1] / 'anjali-chatterbox-server.py'
        tree = ast.parse(source.read_text(encoding='utf-8-sig'))
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'synthesize')
        calls = []
        def cached(letter, voice, reference, root, generate, report):
            calls.append((letter, voice))
            return recording()
        scope = dict(CURRENT_VOICE='sc3', VOICE_MAP={'sc3': 'reference.wav'},
            isolated_letter=isolated_letter, letter_sequence=letter_sequence,
            join_letters=join_letters, cached_letter=cached, DISK_CACHE_DIR='cache',
            _set_progress=lambda *args, **kwargs: None)
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), 'exec'), scope)
        self.assertEqual(scope['synthesize']('E.', 'sc3'), recording())
        scope['synthesize']('A, E, I.', 'sc3')
        self.assertEqual(calls, [('E', 'sc3'), ('A', 'sc3'), ('E', 'sc3'), ('I', 'sc3')])

    def test_audio_pause_corrects_an_early_word_timestamp(self):
        samples = array('h', [2000] * 19200 + [0] * 3200 + [2000] * 9600)
        self.assertAlmostEqual(pause_boundary(samples.tobytes(), 1, 16000, 1.02, 1.45), 1.38, places=3)
        # A momentary zero crossing is not a separation between words.
        clicks = array('h', [2000] * 1600 + [0] * 80 + [2000] * 1600)
        self.assertIsNone(pause_boundary(clicks.tobytes(), 1, 16000, 0, .20))

    def test_long_carrier_pause_is_not_lost_to_early_asr_timestamp(self):
        data = io.BytesIO()
        with wave.open(data, 'wb') as wav:
            wav.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
            wav.writeframes(array('h', [4000] * 19200 + [0] * 9600 + [3000] * 6400).tobytes())
        heard = words('The', 'letter', 'E')
        heard[1].update(start=.2, end=1.1)
        heard[2].update(start=1.1, end=2.1)
        clipped = extract_letter(data.getvalue(), 'E', 'The letter', heard)
        with wave.open(io.BytesIO(clipped), 'rb') as wav:
            samples = array('h', wav.readframes(wav.getnframes()))
            self.assertNotIn(4000, samples)
            self.assertIn(3000, samples)

    def test_only_checked_audio_is_cached_and_voice_reference_changes_invalidate_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            reference = Path(tmp) / 'voice.wav'
            reference.write_bytes(b'first reference')
            calls = []
            def generate(text, attempt):
                calls.append(text)
                return recording()
            with patch('alphabet_tts._RECOGNIZE', side_effect=[words('The', 'letter', 'E'), words('E')]):
                first = cached_letter('E', 'sc3', reference, Path(tmp) / 'cache', generate)
            with patch('alphabet_tts._RECOGNIZE', side_effect=AssertionError('Cache should be reused')):
                self.assertEqual(cached_letter('E', 'sc3', reference, Path(tmp) / 'cache', generate), first)
            self.assertEqual(len(calls), 1)
            reference.write_bytes(b'new reference')
            with patch('alphabet_tts._RECOGNIZE', return_value=words('wrong')):
                with self.assertRaises(LetterClarityError):
                    cached_letter('E', 'sc3', reference, Path(tmp) / 'cache', generate)
            self.assertEqual(len(list((Path(tmp) / 'cache').rglob('*.wav'))), 1)
            self.assertEqual(len(calls), 4)
            phases = sorted(json.loads(p.read_text())['phase']
                            for p in (Path(tmp) / 'cache').rglob('*.json'))
            self.assertEqual(phases, ['needs_retry', 'ready'])

    def test_letter_lists_are_checked_in_order_with_real_pauses(self):
        self.assertEqual(letter_sequence('A, E, I, O, U.'), list('AEIOU'))
        self.assertIsNone(letter_sequence('I am here'))
        self.assertIsNone(letter_sequence('A dog'))
        requests = []
        audio = join_letters(['A', 'E'], lambda letter: (requests.append(letter) or recording()))
        with wave.open(io.BytesIO(audio), 'rb') as wav:
            self.assertEqual(wav.getnframes() / wav.getframerate(), 6.7)
        self.assertEqual(requests, ['A', 'E'])

    def test_only_isolated_letter_requests_enter_special_mode(self):
        for letter in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ':
            self.assertEqual(isolated_letter(letter + '.'), letter)
        for text in ('I am here.', 'A dog.', 'eleven dogs', 'AB', '1', ''):
            self.assertIsNone(isolated_letter(text))

    def test_crop_excludes_guide_and_preserves_letter_with_padding(self):
        result = extract_letter(recording(), 'E', 'The letter', words('The', 'letter', 'E'))
        with wave.open(io.BytesIO(result), 'rb') as wav:
            self.assertAlmostEqual(wav.getnframes() / wav.getframerate(), .595, places=3)
            self.assertEqual(wav.readframes(1280), bytes(2560))

    def test_wrong_letters_and_extra_narration_are_rejected(self):
        for heard in (words('The', 'letter', 'P'), words('The', 'letter', 'E', 'hello'),
                      words('The', 'letter'), words('Something', 'E')):
            with self.assertRaises(LetterClarityError):
                extract_letter(recording(), 'E', 'The letter', heard)

    def test_silence_and_clipping_cannot_pass_on_hallucinated_transcripts(self):
        for sample in (0, 32767):
            data = io.BytesIO()
            with wave.open(data, 'wb') as wav:
                wav.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
                wav.writeframes(array('h', [sample] * 48000).tobytes())
            with self.assertRaisesRegex(LetterClarityError, 'silent, too quiet, or distorted'):
                extract_letter(data.getvalue(), 'E', 'The letter', words('The', 'letter', 'E'))

    def test_invalid_word_times_are_rejected(self):
        for start, end in ((float('nan'), 1.5), (1.1, float('inf')), (.2, 1.5), (1, 8), (1, 1.02)):
            heard = words('The', 'letter', 'E')
            heard[-1].update(start=start, end=end)
            with self.assertRaises(LetterClarityError):
                extract_letter(recording(), 'E', 'The letter', heard)

    def test_zed_not_zee_and_double_you_are_checked(self):
        extract_letter(recording(), 'Z', 'The letter', words('The', 'letter', 'zed'))
        extract_letter(recording(), 'W', 'The letter', words('The', 'letter', 'double', 'you'))
        with self.assertRaises(LetterClarityError):
            extract_letter(recording(), 'Z', 'The letter', words('The', 'letter', 'zee'))

    def test_cropped_audio_is_independently_checked_and_retried(self):
        attempts = []
        recognized = iter([words('The', 'letter', 'E'), words('P'),
                           words('This', 'is', 'the', 'letter', 'E'), words('E')])
        audio = make_verified_letter('E', lambda text, n: (attempts.append(n) or recording()),
                                     lambda data: next(recognized))
        self.assertEqual(attempts, [0, 1])
        self.assertTrue(audio.startswith(b'RIFF'))

    def test_bad_audio_cannot_escape_bounded_recovery(self):
        attempts = []
        with self.assertRaisesRegex(LetterClarityError, 'after 3 attempts'):
            make_verified_letter('E', lambda text, n: (attempts.append(n) or recording()),
                                 lambda data: words('not', 'a', 'letter'))
        self.assertEqual(attempts, [0, 1, 2])

    def test_transient_generation_timeout_retries_without_publishing_audio(self):
        attempts = []
        def generate(text, attempt):
            attempts.append(attempt)
            if attempt == 0:
                raise TimeoutError('Temporary generation timeout')
            return recording()
        heard = iter([words('This', 'is', 'the', 'letter', 'E'), words('E')])
        result = make_verified_letter('E', generate, lambda data: next(heard))
        self.assertTrue(result.startswith(b'RIFF'))
        self.assertEqual(attempts, [0, 1])


if __name__ == '__main__':
    unittest.main()

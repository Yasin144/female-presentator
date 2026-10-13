"""Verify decoder configuration without loading a model or running speech jobs."""
import ast
import pathlib
import unittest
import math
import re


def load_functions(names, **context):
    source = pathlib.Path(__file__).resolve().parents[1] / 'whisper-transcribe-caption.py'
    tree = ast.parse(source.read_text(encoding='utf-8'))
    names = set(names) | {'valid_caption_word_timeline', 'caption_segments_from_words',
                          'uncovered_audio_ranges', 'repair_remaining_audio_gaps'}
    context.update(math=math, re=re)
    functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    exec(compile(ast.Module(body=functions, type_ignores=[]), str(source), 'exec'), context)
    return context


class LocalCaptionTimelineTest(unittest.TestCase):
    def test_recovery_speech_mask_rejects_music_words_without_shifting_real_words(self):
        context = load_functions(['filter_recovery_speech'], _speech_activity_cache={'fixture': [(4.7, 6.3), (7.3, 8.1)]})
        words = [{'word': 'Thanks', 'start': 0, 'end': 2}, {'word': 'InfoKids', 'start': 4.8, 'end': 6.2},
                 {'word': '10', 'start': 7.4, 'end': 7.9}]
        self.assertEqual(context['filter_recovery_speech']('fixture', words), words[1:])
        bad = [{'word': 'InfoKids', 'start': 0, 'end': 6.2},
               {'word': 'silent', 'start': 0, 'end': 0},
               {'word': 'invalid', 'start': float('nan'), 'end': 6}]
        self.assertEqual(context['filter_recovery_speech']('fixture', bad), [])

    def test_opening_repair_requires_matching_audio_passes_and_keeps_later_words(self):
        decoded = [{'word': 'InfoKids', 'start': 4.8, 'end': 6.2}]
        context = load_functions(['verify_opening_speech'], auto_recovery=True, song_mode=False, recovery_warnings=[],
                       filter_recovery_speech=lambda _, words: words,
                       audio_duration_seconds=lambda _: 20, clean=lambda text: text.strip(),
                       run_whisper_with_model=lambda *args, **kwargs: ('InfoKids', 'en', [], decoded))
        context['is_repetition_loop'] = lambda _: False
        def decode(*args, **kwargs):
            words = decoded if kwargs['clip_timestamps'].startswith('0,') else [
                {'word': '10', 'start': 7.3, 'end': 7.9}]
            return '', 'en', [], words
        context['run_whisper_with_model'] = decode
        later = {'word': 'Lesson', 'start': 8.5, 'end': 9}
        current = ('Info 10 Lesson', 'en', [], [{'word': 'Info', 'start': 4.1, 'end': 5.5},
                   {'word': '10', 'start': 5.8, 'end': 6.7}, later])
        result = context['verify_opening_speech'](None, 'fixture', 'en', current)
        self.assertEqual(result[0], 'InfoKids 10 Lesson')
        self.assertEqual(result[3][-1], later)
        self.assertEqual(result[3][0]['start'], 4.8)
        self.assertEqual(result[3][1]['start'], 7.3)
        self.assertEqual(result[2][0]['end'], 6.2)
        self.assertEqual(result[2][1]['start'], 7.3)
        calls = iter([decoded, [{'word': 'Different', 'start': 4.8, 'end': 6.2}]])
        context['run_whisper_with_model'] = lambda *args, **kwargs: ('', 'en', [], next(calls))
        self.assertEqual(context['verify_opening_speech'](None, 'fixture', 'en', current), current)
        # Two consistent clips can both skip a genuine short intro word.
        context['run_whisper_with_model'] = lambda *args, **kwargs: ('', 'en', [], decoded[:1])
        self.assertEqual(context['verify_opening_speech'](None, 'fixture', 'en', current), current)
        self.assertIn('omitted previously detected speech', context['recovery_warnings'][-1])

    def test_recovery_rejects_overlap_and_preserves_valid_words_on_failure(self):
        context = load_functions(['uncovered_audio_ranges', 'repair_remaining_audio_gaps'],
                       auto_recovery=True, recovery_warnings=[], audio_duration_seconds=lambda _: 5,
                       filter_recovery_speech=lambda _, words: words,
                       song_mode=False, is_repetition_loop=lambda _: False,
                       clean=lambda text: text.strip(), re=re)
        current = ('Hello world', 'en', [], [
            {'word': 'Hello', 'start': 0, 'end': 1},
            {'word': 'world', 'start': 4, 'end': 5}])
        context['run_whisper_with_model'] = lambda *args, **kwargs: ('example sentence', 'en', [], [
            {'word': 'example', 'start': 2, 'end': 3},
            {'word': 'sentence', 'start': 2.5, 'end': 3.5}])
        self.assertEqual(context['repair_remaining_audio_gaps'](None, 'fixture', 'en', current), current)
        self.assertIn('overlapping word timing', context['recovery_warnings'][-1])
        def failed(*args, **kwargs):
            raise RuntimeError('decoder failed')
        context['run_whisper_with_model'] = failed
        self.assertEqual(context['repair_remaining_audio_gaps'](None, 'fixture', 'en', current), current)
        self.assertIn('Existing captions were retained', context['recovery_warnings'][-1])

    def test_gap_recovery_keeps_genuine_repeated_words_and_phrase_gaps(self):
        recovered = [{'word': 'yes', 'start': 2, 'end': 2.12},
                     {'word': 'yes', 'start': 2.2, 'end': 2.35}]
        context = load_functions(['uncovered_audio_ranges', 'repair_remaining_audio_gaps'],
            auto_recovery=True, recovery_warnings=[], audio_duration_seconds=lambda _: 5,
            filter_recovery_speech=lambda _, words: words, song_mode=False,
            is_repetition_loop=lambda _: False, clean=lambda text: text.strip(),
            run_whisper_with_model=lambda *args, **kwargs: ('yes yes', 'en', [], recovered))
        current = ('Hello world', 'en', [], [{'word': 'Hello', 'start': 0, 'end': 1},
                                           {'word': 'world', 'start': 4, 'end': 5}])
        result = context['repair_remaining_audio_gaps'](None, 'fixture', 'en', current)
        self.assertEqual(result[0], 'Hello yes yes world')
        self.assertEqual(result[3][1:3], recovered)
        self.assertEqual(result[2][0]['end'], 1)
        self.assertEqual(result[2][1]['start'], 2)
        self.assertEqual(result[2][1]['end'], 2.35)
        self.assertEqual(result[2][2]['start'], 4)

    def test_opening_agreement_cannot_collapse_repeated_words(self):
        decoded = [{'word': 'yes', 'start': 2, 'end': 2.2}]
        context = load_functions(['verify_opening_speech'], auto_recovery=True, song_mode=False,
            recovery_warnings=[], filter_recovery_speech=lambda _, words: words,
            audio_duration_seconds=lambda _: 20, clean=lambda text: text.strip(),
            run_whisper_with_model=lambda *args, **kwargs: ('yes', 'en', [], decoded))
        current = ('yes yes Lesson', 'en', [], [decoded[0],
            {'word': 'yes', 'start': 2.3, 'end': 2.5},
            {'word': 'Lesson', 'start': 8.5, 'end': 9}])
        self.assertEqual(context['verify_opening_speech'](None, 'fixture', 'en', current), current)
        self.assertIn('omitted previously detected speech', context['recovery_warnings'][-1])

    def test_optional_coverage_retry_cannot_replace_original_with_more_hallucinated_words(self):
        context = load_functions(['retry_sparse_with_child_speech_mode'],
            auto_recovery=True, song_mode=False, recovery_warnings=[],
            filter_recovery_speech=lambda _, words: words,
            is_repetition_loop=lambda _: False)
        current = ('Hello', 'en', [], [{'word': 'Hello', 'start': 1, 'end': 2}])
        candidate = ('Thanks for watching', 'en', [], [
            {'word': 'Thanks', 'start': 0, 'end': .5},
            {'word': 'for', 'start': .5, 'end': .7},
            {'word': 'watching', 'start': .7, 'end': 1}])
        context['run_whisper_with_model'] = lambda *args, **kwargs: candidate
        self.assertEqual(context['retry_sparse_with_child_speech_mode'](None, 'fixture', 'en', current), current)
        def failed(*args, **kwargs):
            raise RuntimeError('model failed')
        context['run_whisper_with_model'] = failed
        self.assertEqual(context['retry_sparse_with_child_speech_mode'](None, 'fixture', 'en', current), current)
        self.assertIn('Existing captions were retained', context['recovery_warnings'][-1])

    def test_complete_transcript_uses_focused_gap_checks_instead_of_full_decode(self):
        context = load_functions(['retry_sparse_with_child_speech_mode'],
            auto_recovery=True, song_mode=False, recovery_warnings=[],
            is_repetition_loop=lambda _: False)
        current = ('One two three four', 'en', [], [
            {'word': 'One', 'start': 0, 'end': 1},
            {'word': 'two', 'start': 1, 'end': 2},
            {'word': 'three', 'start': 14, 'end': 15},
            {'word': 'four', 'start': 15, 'end': 16}])
        def unexpected(*args, **kwargs):
            self.fail('A useful transcript should not be fully decoded again')
        context['run_whisper_with_model'] = unexpected
        self.assertEqual(context['retry_sparse_with_child_speech_mode'](None, 'fixture', 'en', current), current)

    def test_timing_validation_rejects_invalid_intervals(self):
        context = load_functions([])
        validate = context['valid_caption_word_timeline']
        self.assertTrue(validate([{'word': 'Hi', 'start': 0, 'end': 1}], 1))
        for start, end in [(0, 0), (-1, .5), (0, float('inf')), (float('nan'), 1)]:
            self.assertFalse(validate([{'word': 'Hi', 'start': start, 'end': end}], 1))
        self.assertFalse(validate([{'word': 'Hi', 'start': 0, 'end': 1},
                                   {'word': 'there', 'start': .8, 'end': 2}], 2))

    def test_decoder_keeps_silent_gaps_in_the_original_audio(self):
        source = pathlib.Path(__file__).resolve().parents[1] / 'whisper-transcribe-caption.py'
        tree = ast.parse(source.read_text(encoding='utf-8'))
        decoder = next(node for node in tree.body if isinstance(node, ast.FunctionDef)
                       and node.name == 'run_whisper_with_model')
        call = next(node for node in ast.walk(decoder) if isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Attribute) and node.func.attr == 'transcribe')
        keywords = {keyword.arg: keyword.value for keyword in call.keywords}
        self.assertIs(ast.literal_eval(keywords['vad_filter']), False)
        self.assertIs(ast.literal_eval(keywords['word_timestamps']), True)
        self.assertIn('clip_timestamps', keywords)
        # Audio-preserving decoding must still filter hallucinated repetitions.
        self.assertTrue(any(isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                            and node.func.id == 'is_repetition_loop' for node in ast.walk(decoder)))


if __name__ == '__main__':
    unittest.main()

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
                          'uncovered_audio_ranges', 'repair_remaining_audio_gaps',
                          'caption_speech_ranges', 'caption_range_has_speech',
                          'caption_word_match_key', 'caption_word_passes_agree', 'suspicious_caption_audio_ranges',
                          'caption_preserves_word_sequence', 'caption_restore_original_orthography',
                          'repair_covered_audio_speech'}
    context.setdefault('_speech_activity_cache', {'fixture': [(0, 10000)]})
    context.update(math=math, re=re)
    functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    exec(compile(ast.Module(body=functions, type_ignores=[]), str(source), 'exec'), context)
    return context


class LocalCaptionTimelineTest(unittest.TestCase):
    def covered_narration_fixture(self):
        # Timing/text from the user's failed Time to Listen export. The
        # stretched "spring" hid a missing sentence from ordinary gap repair.
        original_rows = [
            ('InfoKids.', 4.50, 6.01), ('Time', 8.58, 9.09), ('to', 9.09, 9.33),
            ('listen.', 9.33, 9.82), ('It', 11.01, 12.24), ('was', 12.24, 13.46),
            ('spring', 13.46, 18.44), ('season', 18.44, 18.87), ('and', 18.87, 19.92),
            ('the', 19.92, 20.03), ('garden', 20.03, 20.35), ('looked', 20.35, 20.67),
            ('beautiful,', 20.67, 21.53), ('Colorful', 21.53, 22.94), ('flowers', 22.94, 23.48),
            ('were', 23.48, 23.76), ('blooming', 23.76, 24.05), ('everywhere,', 24.05, 24.83),
            ('Butterflies', 26.42, 27.14)]
        confirmed_rows = [
            ('Time', 7.98, 9.12), ('to', 9.12, 9.38), ('listen!', 9.38, 9.94),
            ('One', 10.52, 11.66), ('pleasant', 11.66, 11.96), ('morning', 11.96, 12.42),
            ('Ria', 12.94, 13.08), ('went', 13.08, 13.30), ('to', 13.30, 13.50),
            ('a', 13.50, 13.64), ('garden', 13.64, 13.92), ('near', 13.92, 14.16),
            ('her', 14.16, 14.36), ('house.', 14.36, 14.78), ('It', 17.18, 18.00),
            ('was', 18.00, 18.14), ('spring', 18.14, 18.46), ('season,', 18.46, 18.90),
            ('and', 19.32, 19.98), ('the', 19.98, 20.08), ('garden', 20.08, 20.40),
            ('looked', 20.40, 20.72), ('beautiful.', 20.72, 21.36), ('Colorful', 22.40, 23.10),
            ('flowers', 23.10, 23.50), ('were', 23.50, 23.78), ('blooming', 23.78, 24.10),
            ('everywhere.', 24.10, 24.84)]
        words = lambda rows: [{'word': word, 'start': start, 'end': end} for word, start, end in rows]
        original, decoded = words(original_rows), words(confirmed_rows)
        current = (' '.join(w['word'] for w in original), 'en', [], original)
        return current, decoded

    def covered_recovery_context(self, decoder, **context):
        return load_functions([], auto_recovery=True, song_mode=False, recovery_warnings=[],
            audio_duration_seconds=lambda _: 35, clean=lambda text: text.strip(),
            filter_recovery_speech=lambda _, words: words, is_repetition_loop=lambda _: False,
            run_whisper_with_model=decoder, **context)

    def test_missing_sentence_under_broad_word_is_recovered_with_real_phrase_gaps(self):
        current, decoded = self.covered_narration_fixture()
        calls = []
        def decode(*args, **kwargs):
            calls.append(kwargs)
            return ' '.join(w['word'] for w in decoded), 'en', [], decoded
        context = self.covered_recovery_context(decode)
        result = context['repair_covered_audio_speech'](None, 'fixture', 'en', current)
        self.assertIn('One pleasant morning Ria went to a garden near her house.', result[0])
        self.assertEqual(result[3], current[3][:1] + decoded + current[3][-1:])
        self.assertEqual(len(calls), 2)
        self.assertEqual([call['lenient'] for call in calls], [False, True])
        start, end = map(float, calls[0]['clip_timestamps'].split(','))
        self.assertLessEqual(start, 10.52)
        self.assertGreater(end, 24.84)
        self.assertLessEqual(end - start, 24)
        self.assertEqual(next(w['start'] for w in result[3] if w['word'] == 'spring'), 18.14)
        self.assertTrue(context['valid_caption_word_timeline'](result[3], 35))
        house = next(seg for seg in result[2] if 'house.' in seg['text'])
        spring = next(seg for seg in result[2] if 'spring' in seg['text'])
        self.assertEqual(house['end'], 14.78)
        self.assertEqual(spring['start'], 17.18)

    def test_covered_recovery_keeps_every_original_word_and_requires_complete_agreement(self):
        current, decoded = self.covered_narration_fixture()
        for change in ('missing_original', 'different_second', 'shifted_second', 'missing_word_timing'):
            with self.subTest(change=change):
                candidate = [dict(w) for w in decoded]
                if change == 'missing_original':
                    candidate = [w for w in candidate if w['word'] != 'was']
                def decode(*args, **kwargs):
                    words = [dict(w) for w in candidate]
                    if kwargs['lenient'] and change == 'different_second':
                        words[3]['word'] = 'Two'
                    if kwargs['lenient'] and change == 'shifted_second':
                        words[3]['start'] += .3
                    text = ' '.join(w['word'] for w in words)
                    if change == 'missing_word_timing':
                        text += ' missing'
                    return text, 'en', [], words
                context = self.covered_recovery_context(decode)
                self.assertEqual(context['repair_covered_audio_speech'](None, 'fixture', 'en', current), current)
                self.assertIn('Existing captions were retained', context['recovery_warnings'][-1])

    def test_continuous_long_narration_has_bounded_recheck_windows(self):
        words = [{'word': str(index), 'start': round(index * .4, 2),
                  'end': round((index + 1) * .4, 2)} for index in range(300)]
        words[100]['end'] += 2
        for word in words[101:]:
            word['start'] += 2
            word['end'] += 2
        context = load_functions([])
        ranges = context['suspicious_caption_audio_ranges'](words, 122)
        self.assertEqual(len(ranges), 1)
        self.assertLessEqual(ranges[0][0], words[100]['start'])
        self.assertGreaterEqual(ranges[0][1], words[100]['end'])
        self.assertLessEqual(ranges[0][1] - ranges[0][0], 24)
        self.assertGreater(ranges[0][0], 0)
        self.assertLess(ranges[0][1], 122)

    def test_real_recheck_colourful_variant_recovers_sentence_and_preserves_original_spelling(self):
        current, decoded = self.covered_narration_fixture()
        original_color = next(w for w in current[3] if w['word'] == 'Colorful')
        original_color['word'] = 'colorful'
        candidate = [dict(w) for w in decoded]
        next(w for w in candidate if w['word'] == 'Colorful')['word'] = 'Colourful'
        context = self.covered_recovery_context(lambda *args, **kwargs:
            (' '.join(w['word'] for w in candidate), 'en', [], candidate))
        result = context['repair_covered_audio_speech'](None, 'fixture', 'en', current)
        self.assertIn('One pleasant morning Ria went to a garden near her house.', result[0])
        self.assertIn('colorful flowers', result[0])
        self.assertNotIn('Colourful', result[0])
        corrected = next(w for w in result[3] if w['word'] == 'colorful')
        self.assertEqual((corrected['start'], corrected['end']), (22.40, 23.10))
        self.assertEqual(result[3][0], current[3][0])
        self.assertEqual(result[3][-1], current[3][-1])

    def test_spelling_variants_never_fuzzy_match_short_words_names_or_repeated_occurrences(self):
        context = load_functions([])
        word = lambda text: {'word': text, 'start': 1, 'end': 1.1}
        preserves = context['caption_preserves_word_sequence']
        self.assertTrue(preserves([word('colorful'), word('colors')],
                                  [word('Colourful,'), word('colours.')]))
        for original, candidate in ((['a'], ['garden']), (['to'], ['too']),
                                    (['Ria'], ['Rhea']), (['color'], ['collar']),
                                    (['color', 'color'], ['colour']),
                                    (['to', 'color'], ['colour', 'to'])):
            with self.subTest(original=original, candidate=candidate):
                self.assertFalse(preserves(list(map(word, original)), list(map(word, candidate))))
        first = [word('Colorful')]
        second = [word('Colourful')]
        self.assertTrue(context['caption_word_passes_agree'](first, second))
        original = [word('color'), word('Colorful')]
        candidate = [dict(word('colour,'), start=1, end=1.2),
                     dict(word('Colourful.'), start=1.2, end=1.4)]
        restored = context['caption_restore_original_orthography'](original, candidate)
        self.assertEqual([w['word'] for w in restored], ['color,', 'Colorful.'])
        self.assertEqual([(w['start'], w['end']) for w in restored], [(1, 1.2), (1.2, 1.4)])
        self.assertEqual([w['word'] for w in candidate], ['colour,', 'Colourful.'])

    def test_covered_recovery_rejects_unconfirmed_speech_and_preserves_original_on_failure(self):
        current, decoded = self.covered_narration_fixture()
        context = self.covered_recovery_context(lambda *args, **kwargs:
            (' '.join(w['word'] for w in decoded), 'en', [], decoded))
        context['filter_recovery_speech'] = lambda _, words: words[:-1]
        self.assertEqual(context['repair_covered_audio_speech'](None, 'fixture', 'en', current), current)
        def unavailable(*args, **kwargs):
            raise RuntimeError('optional VAD unavailable')
        context['caption_range_has_speech'] = unavailable
        self.assertEqual(context['repair_covered_audio_speech'](None, 'fixture', 'en', current), current)
        self.assertIn('failed. Existing captions were retained', context['recovery_warnings'][-1])

    def test_collapsed_and_overlapping_late_narration_is_rechecked_without_moving_outside_anchors(self):
        for timings in (((30, 30), (30, 30), (30, 30)),
                        ((30, 30.01), (30.01, 30.02), (30.02, 30.03)),
                        ((30, 31), (30.8, 31.2), (31.2, 31.6))):
            with self.subTest(timings=timings):
                original = [{'word': 'Before', 'start': 10, 'end': 10.4}] + [
                    {'word': word, 'start': start, 'end': end}
                    for word, (start, end) in zip(('Read', 'these', 'words.'), timings)] + [
                    {'word': 'After', 'start': 45, 'end': 45.4}]
                current = ('Before Read these words. After', 'en', [], original)
                decoded = [{'word': 'Please', 'start': 29.4, 'end': 29.6},
                           {'word': 'Read', 'start': 30, 'end': 30.2},
                           {'word': 'these', 'start': 30.2, 'end': 30.4},
                           {'word': 'words.', 'start': 30.4, 'end': 30.6}]
                context = self.covered_recovery_context(lambda *args, **kwargs:
                    ('Please Read these words.', 'en', [], decoded))
                context['audio_duration_seconds'] = lambda _: 50
                result = context['repair_covered_audio_speech'](None, 'fixture', 'en', current)
                self.assertEqual(result[3], original[:1] + decoded + original[-1:])
                self.assertTrue(context['valid_caption_word_timeline'](result[3], 50))

    def test_short_missing_utterance_is_recovered_but_silent_short_gaps_skip_decoding(self):
        decoded = [{'word': 'Try', 'start': .65, 'end': .85},
                   {'word': 'it.', 'start': .9, 'end': 1.15}]
        calls = []
        def decode(*args, **kwargs):
            calls.append(kwargs)
            return 'Try it.', 'en', [], decoded
        context = self.covered_recovery_context(decode,
            _speech_activity_cache={'fixture': [(.6, 1.25)]})
        context['audio_duration_seconds'] = lambda _: 2.4
        original = [{'word': 'Hello', 'start': 0, 'end': .3},
                    {'word': 'world', 'start': 2.1, 'end': 2.4}]
        current = ('Hello world', 'en', [], original)
        result = context['repair_remaining_audio_gaps'](None, 'fixture', 'en', current)
        self.assertEqual(result[3], original[:1] + decoded + original[-1:])
        self.assertEqual(result[0], 'Hello Try it. world')
        self.assertEqual(len(calls), 2)
        context['_speech_activity_cache'] = {'fixture': []}
        calls.clear()
        self.assertEqual(context['repair_remaining_audio_gaps'](None, 'fixture', 'en', current), current)
        self.assertEqual(calls, [])

    def test_gap_recovery_rejects_partial_sentence_or_collapsed_repeated_confirmation(self):
        original = [{'word': 'Hello', 'start': 0, 'end': .3},
                    {'word': 'world', 'start': 2.1, 'end': 2.4}]
        current = ('Hello world', 'en', [], original)
        words = [{'word': 'yes', 'start': .6, 'end': .8},
                 {'word': 'yes', 'start': .9, 'end': 1.1}]
        context = self.covered_recovery_context(lambda *args, **kwargs:
            ('yes', 'en', [], words[:1] if kwargs['lenient'] else words))
        context['audio_duration_seconds'] = lambda _: 2.4
        self.assertEqual(context['repair_remaining_audio_gaps'](None, 'fixture', 'en', current), current)
        self.assertIn('audio checks disagreed', context['recovery_warnings'][-1])

    def test_recovery_disabled_does_not_decode_or_change_caption_timing(self):
        current, _ = self.covered_narration_fixture()
        def unexpected(*args, **kwargs):
            self.fail('Disabled recovery must not run optional audio decoding')
        context = self.covered_recovery_context(unexpected)
        context['auto_recovery'] = False
        self.assertEqual(context['repair_covered_audio_speech'](None, 'fixture', 'en', current), current)
        self.assertEqual(context['repair_remaining_audio_gaps'](None, 'fixture', 'en', current), current)

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

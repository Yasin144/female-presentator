"""Local caption scenario matrix using scripted decoders, without model or audio jobs."""
import contextlib
import copy
import importlib.util
import io
import math
import os
import pathlib
import random
import types
import tempfile
import wave
import unittest
from collections import Counter


_helper_path = pathlib.Path(__file__).with_name('test-caption-local-timeline.py')
_helper_spec = importlib.util.spec_from_file_location('local_caption_timeline_helpers', _helper_path)
_helpers = importlib.util.module_from_spec(_helper_spec)
_helper_spec.loader.exec_module(_helpers)
load_functions = _helpers.load_functions


def word(token='hello', start=1.0, end=1.2):
    return {'word': token, 'start': start, 'end': end}


def transcript(words, text=None):
    return (' '.join(str(item.get('word', '')) for item in words) if text is None else text,
            'en', [], copy.deepcopy(words))


class ScriptedDecoder:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = []

    def __call__(self, *args, **kwargs):
        self.calls.append(copy.deepcopy(kwargs))
        if not self.responses:
            raise AssertionError('Unexpected additional decoding pass')
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return copy.deepcopy(response)


class WaveFixture:
    def __init__(self, duration):
        self.duration = duration

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def getnframes(self):
        return round(self.duration * 16000)

    def getframerate(self):
        return 16000


def scenario_context(decoder=None, duration=20, speech=None, **overrides):
    context = load_functions(
        ['verify_opening_speech', 'retry_sparse_with_child_speech_mode',
         'filter_recovery_speech', 'is_repetition_loop', 'clean'],
        auto_recovery=True, song_mode=False, recovery_warnings=[], Counter=Counter,
        audio_duration_seconds=lambda _: duration,
        wave=types.SimpleNamespace(open=lambda *_: WaveFixture(duration)),
        run_whisper_with_model=decoder or ScriptedDecoder(),
        _speech_activity_cache={'fixture': [(0, duration)] if speech is None else speech})
    context.update(overrides)
    return context


class LocalScenarioTest(unittest.TestCase):
    def test_exact_silence_scan_keeps_quiet_speech_and_checks_every_chunk(self):
        context = load_functions(['caption_audio_is_silent'], wave=wave)
        silent = context['caption_audio_is_silent']
        cases = [(b'\x00\x00' * 100, 2, True), (b'\x01\x00' * 100, 2, False),
                 (b'\xff\xff' * 100, 2, False), (b'\x00\x00' * 65536 + b'\x01\x00', 2, False),
                 (b'', 2, False), (b'\x80' * 100, 1, False)]
        with tempfile.TemporaryDirectory() as directory:
            for index, (samples, width, expected) in enumerate(cases):
                with self.subTest(case=index):
                    source = pathlib.Path(directory) / (str(index) + '.wav')
                    with wave.open(str(source), 'wb') as audio:
                        audio.setnchannels(1)
                        audio.setsampwidth(width)
                        audio.setframerate(16000)
                        audio.writeframes(samples)
                    self.assertEqual(silent(str(source)), expected)
            self.assertFalse(silent(str(pathlib.Path(directory) / 'missing.wav')))

    def setUp(self):
        self.output = contextlib.redirect_stdout(io.StringIO())
        self.output.__enter__()

    def tearDown(self):
        self.output.__exit__(None, None, None)

    def invoke_unchanged(self, context, function, current, **kwargs):
        snapshot = copy.deepcopy(current)
        result = context[function](None, 'fixture', 'en', current, **kwargs)
        self.assertEqual(result, current)
        self.assertEqual(current, snapshot, 'Recovery must not mutate its original input')
        return result

    def test_timeline_accepts_numeric_strings_and_contiguous_endpoints(self):
        context = scenario_context()
        self.assertTrue(context['valid_caption_word_timeline']([
            word('one', '0', '0.25'), word('two', '.25', '1')], 1))

    def test_timeline_duration_rounding_allowance_is_bounded(self):
        validate = scenario_context()['valid_caption_word_timeline']
        self.assertTrue(validate([word(end=1.01)], 1))
        self.assertFalse(validate([word(end=1.010001)], 1))

    def test_primary_timing_retry_rechecks_collapsed_word_from_two_physical_audio_reads(self):
        original = [word('Before.', 10, 10.4), word('Read', 30, 30),
                    word('these', 30, 30), word('words.', 30, 30),
                    word('After.', 45, 45.4)]
        corrected = [word('Read', 29.8, 30.1), word('these', 30.1, 30.3),
                     word('words.', 30.3, 30.6)]
        calls = []
        context = scenario_context(duration=50)
        def decode(*args, **kwargs):
            calls.append((args[3:], kwargs))
            return transcript(corrected)
        context['read_caption_audio_range'] = decode
        current = transcript(original)
        snapshot = copy.deepcopy(current)
        result = context['repair_primary_caption_timing'](None, 'fixture', 'en', current)
        self.assertEqual(result[3], original[:1] + corrected + original[-1:])
        self.assertEqual(current, snapshot)
        self.assertTrue(context['valid_caption_word_timeline'](result[3], 50))
        self.assertEqual(len(calls), 2)
        self.assertNotEqual(calls[0][0], calls[1][0])
        self.assertEqual([call[1]['lenient'] for call in calls], [False, True])

    def test_primary_timing_retry_can_fix_separate_invalid_phrases_without_moving_outside_words(self):
        original = [word('First.', 10, 10), word('Middle.', 30, 30.3),
                    word('Last.', 50, 50)]
        context = scenario_context(duration=60)
        calls = []
        def decode(*args, **kwargs):
            calls.append((args, kwargs))
            return transcript([word('First.', 10, 10.3)] if args[3] < 20 else [word('Last.', 50, 50.3)])
        context['read_caption_audio_range'] = decode
        result = context['repair_primary_caption_timing'](None, 'fixture', 'en', transcript(original))
        self.assertEqual(result[3], [word('First.', 10, 10.3), original[1], word('Last.', 50, 50.3)])
        self.assertEqual(len(calls), 4)
        self.assertTrue(context['valid_caption_word_timeline'](result[3], 60))

    def test_primary_timing_retry_rereads_time_to_recall_crossing_context_before_replacing(self):
        original = [word('Before.', 22, 22.4), word('Polar', 29.98, 29.98),
                    word('bears', 29.98, 30.4), word('live', 37.8, 38.2),
                    word('near', 38.47, 38.8), word('ice.', 39, 39.3),
                    word('After.', 45, 45.3)]
        core = [word('Polar', 29.8, 30.1), word('bears', 30.1, 30.4),
                word('live', 37.8, 38.2)]
        context_word = word('near', 38.4, 38.7)
        calls = []
        context = scenario_context(duration=50,
            suspicious_caption_audio_ranges=lambda *_: [(23.39, 38.47)])
        def decode(*args, **kwargs):
            calls.append((args[3], args[4], kwargs['lenient']))
            if len(calls) == 1:
                return transcript(core)
            return transcript(core + [context_word])
        context['read_caption_audio_range'] = decode
        result = context['repair_primary_caption_timing'](None, 'fixture', 'en', transcript(original))
        self.assertEqual(result[3], original[:1] + core + [context_word] + original[5:])
        self.assertEqual(len(calls), 4, 'Both reads must physically include the newly owned context word')
        self.assertGreater(calls[2][1], context_word['end'])
        self.assertEqual([call[2] for call in calls], [False, True, False, True])
        self.assertTrue(context['valid_caption_word_timeline'](result[3], 50))

    def test_primary_timing_retry_context_expansion_does_not_accept_changed_neighbors(self):
        original = [word('Before.', 20, 20.3), word('Polar', 29.98, 29.98),
                    word('bear', 30, 30.3), word('near', 34, 34.3), word('After.', 40, 40.3)]
        core = [word('Polar', 29.8, 30.1), word('bear', 30.1, 30.3)]
        for name, extra in {'changed': 'clear', 'unrecognized': 'additional'}.items():
            with self.subTest(name=name):
                context = scenario_context(duration=45,
                    suspicious_caption_audio_ranges=lambda *_: [(23.39, 34)])
                context['read_caption_audio_range'] = ScriptedDecoder(
                    transcript(core), transcript(core + [word(extra, 33.9, 34.2)]))
                self.invoke_unchanged(context, 'repair_primary_caption_timing', transcript(original))

    def test_primary_timing_retry_context_expansion_rejects_ambiguous_repeated_phrase(self):
        original = [word('Polar', 5, 5.3), word('bear', 5.3, 5.6),
                    word('Polar', 29.98, 29.98), word('bear', 30, 30.3),
                    word('After.', 40, 40.3)]
        candidate = [word('Polar', 23.3, 23.6), word('bear', 30, 30.3)]
        context = scenario_context(duration=45,
            suspicious_caption_audio_ranges=lambda *_: [(23.39, 34)])
        context['read_caption_audio_range'] = ScriptedDecoder(transcript(candidate), transcript(candidate))
        self.invoke_unchanged(context, 'repair_primary_caption_timing', transcript(original))

    def test_primary_timing_retry_context_expands_left_right_and_both_edges(self):
        original = [word('Before.', 20, 20.3), word('These', 23.1, 23.3),
                    word('Polar', 29.98, 29.98), word('bears', 30, 30.3),
                    word('play', 34, 34.3), word('After.', 40, 40.3)]
        core = [word('Polar', 29.8, 30.1), word('bears', 30.1, 30.3)]
        for left, right in ((True, False), (False, True), (True, True)):
            with self.subTest(left=left, right=right):
                candidate = ([word('These', 23.3, 23.5)] if left else []) + core
                candidate += [word('play', 33.9, 34.2)] if right else []
                context = scenario_context(duration=45,
                    suspicious_caption_audio_ranges=lambda *_: [(23.39, 34)])
                decoder = ScriptedDecoder(transcript(core), transcript(candidate),
                                          transcript(candidate), transcript(candidate))
                context['read_caption_audio_range'] = decoder
                current = transcript(original)
                snapshot = copy.deepcopy(current)
                result = context['repair_primary_caption_timing'](None, 'fixture', 'en', current)
                expected = original[:1 if left else 2] + candidate + original[5 if right else 4:]
                self.assertEqual(result[3], expected)
                self.assertEqual(len(decoder.calls), 4)
                self.assertEqual(current, snapshot)

    def test_primary_timing_retry_expands_ownership_until_unchanged_external_anchors_fit(self):
        original = [word('Before.', 20, 20.3), word('These', 22.9, 23.3),
                    word('large', 23.3, 23.39), word('Polar', 29.98, 29.98),
                    word('bears', 30, 30.3), word('After.', 40, 40.3)]
        core = [word('Polar', 29.8, 30.1), word('bears', 30.1, 30.3)]
        candidate = [word('These', 23.14, 23.25), word('large', 23.25, 23.5)] + core
        context = scenario_context(duration=45,
            suspicious_caption_audio_ranges=lambda *_: [(23.39, 34)])
        context['read_caption_audio_range'] = ScriptedDecoder(
            transcript(core), transcript(candidate), transcript(candidate), transcript(candidate))
        result = context['repair_primary_caption_timing'](None, 'fixture', 'en', transcript(original))
        self.assertEqual(result[3], original[:1] + candidate + original[-1:])

    def test_primary_timing_retry_boundary_context_keeps_strict_two_read_validation(self):
        original = [word('Before.', 20, 20.3), word('Polar', 29.98, 29.98),
                    word('bear', 30, 30.3), word('near', 34, 34.3), word('After.', 40, 40.3)]
        core = [word('Polar', 29.8, 30.1), word('bear', 30.1, 30.3)]
        candidate = core + [word('near', 33.9, 34.2)]
        variants = {
            'missing_neighbor': core,
            'changed_neighbor': core + [word('clear', 33.9, 34.2)],
            'zero_duration_neighbor': core + [word('near', 34, 34)],
            'overlapping_neighbor': [core[0], dict(core[1], end=34), word('near', 33.9, 34.2)],
            'shifted_neighbor': core + [word('near', 34.2, 34.5)],
            'extra_unrecognized_word': candidate + [word('hidden', 34.2, 34.4)],
            'missing_recognized_timing': transcript(candidate, 'Polar bear near hidden'),
            'read_error': RuntimeError('second widened read failed'),
        }
        for name, variant in variants.items():
            with self.subTest(name=name):
                second = variant if isinstance(variant, (tuple, Exception)) else transcript(variant)
                context = scenario_context(duration=45,
                    suspicious_caption_audio_ranges=lambda *_: [(23.39, 34)])
                context['read_caption_audio_range'] = ScriptedDecoder(
                    transcript(core), transcript(candidate), transcript(candidate), second)
                self.invoke_unchanged(context, 'repair_primary_caption_timing', transcript(original))

    def test_primary_timing_retry_does_not_expand_more_than_24_seconds_or_retry_forever(self):
        original = [word('Before.', 1, 1.3), word('Polar', 29.98, 29.98),
                    word('bear', 30, 30.3), word('near', 34, 45), word('After.', 48, 48.3)]
        core = [word('Polar', 29.8, 30.1), word('bear', 30.1, 30.3)]
        candidate = core + [word('near', 33.9, 34.2)]
        context = scenario_context(duration=50,
            suspicious_caption_audio_ranges=lambda *_: [(20, 34)])
        decoder = ScriptedDecoder(transcript(core), transcript(candidate))
        context['read_caption_audio_range'] = decoder
        self.invoke_unchanged(context, 'repair_primary_caption_timing', transcript(original))
        self.assertEqual(len(decoder.calls), 2)

    def test_primary_timing_retry_never_uses_one_pass_for_new_boundary_context(self):
        original = [word('Before.', 20, 20.3), word('Polar', 29.98, 29.98),
                    word('bear', 30, 30.3), word('near', 34, 34.3), word('After.', 40, 40.3)]
        core = [word('Polar', 29.8, 30.1), word('bear', 30.1, 30.3)]
        candidate = core + [word('near', 33.9, 34.2)]
        context = scenario_context(duration=45,
            suspicious_caption_audio_ranges=lambda *_: [(23.39, 34)])
        decoder = ScriptedDecoder(*(response for _ in range(4)
                                    for response in (transcript(core), transcript(candidate))))
        context['read_caption_audio_range'] = decoder
        self.invoke_unchanged(context, 'repair_primary_caption_timing', transcript(original))
        self.assertLessEqual(len(decoder.calls), 8)

    def test_primary_timing_retry_does_not_erase_time_to_recall_conflicting_recognition(self):
        # Exact relevant tokens/times from the failed recording. Both focused
        # reads omit a primary token; boundary repair alone cannot prove it false.
        original = [word('homes.', 22.74, 23.14), word('Fish', 23.64, 23.92),
                    word('deserts', 29.66, 29.98), word('Polar', 29.98, 29.98),
                    word('animals', 29.98, 30.4), word('sand.', 32.36, 32.82),
                    word('Polar', 33.8, 34.14), word('animals', 34.14, 34.52),
                    word('snow.', 37.42, 37.72), word('We', 39.88, 40.56)]
        first = [word('Fish', 23.39, 23.91), word('Desert', 29.65, 29.97),
                 word('animals', 29.97, 30.41), word('sand.', 32.35, 32.67),
                 word('Polar', 33.47, 34.15), word('animals', 34.15, 34.49),
                 word('snow.', 37.41, 37.67)]
        second = [word('Fish', 23.14, 23.88), word('Desert', 29.64, 29.96),
                  word('animals', 29.96, 30.42), word('sand.', 32.36, 32.66),
                  word('Polar', 33.46, 34.14), word('animals', 34.14, 34.48),
                  word('snow.', 37.42, 37.66)]
        context = scenario_context(duration=50,
            suspicious_caption_audio_ranges=lambda *_: [(23.39, 38.47)])
        context['read_caption_audio_range'] = ScriptedDecoder(transcript(first), transcript(second))
        self.invoke_unchanged(context, 'repair_primary_caption_timing', transcript(original))
        self.assertTrue(context['recovery_warnings'])

    def test_primary_timing_retry_applies_24_second_cap_to_both_physical_reads(self):
        original = [word('Polar', 29.98, 29.98)]
        decoder = ScriptedDecoder()
        context = scenario_context(duration=50,
            suspicious_caption_audio_ranges=lambda *_: [(20, 44)])
        context['read_caption_audio_range'] = decoder
        self.invoke_unchanged(context, 'repair_primary_caption_timing', transcript(original))
        self.assertEqual(decoder.calls, [])

    def fresh_primary_fixture(self):
        original = [word('Their', 21.66, 21.8), word('homes.', 22.74, 23.14),
                    word('trees.', 28.74, 29.12), word('deserts', 29.66, 29.98),
                    word('Polar', 29.98, 29.98), word('animals', 29.98, 30.4),
                    word('sand.', 32.36, 32.82), word('Polar', 33.8, 34.14),
                    word('animals', 34.14, 34.52), word('snow.', 37.42, 37.72),
                    word('We', 39.88, 40.56), word('protect.', 40.74, 41.18)]
        fresh = original[:3] + [word('Desert', 29.64, 29.96)] + original[5:]
        return original, fresh, fresh[2:5]

    def test_fresh_complete_recognition_can_replace_unconfirmed_collapsed_primary_phrase(self):
        original, fresh, block = self.fresh_primary_fixture()
        context = scenario_context(duration=50)
        decoder = ScriptedDecoder(transcript(fresh))
        focused = ScriptedDecoder(transcript(block), transcript(block))
        context['run_whisper_with_model'] = decoder
        context['read_caption_audio_range'] = focused
        current = transcript(original)
        snapshot = copy.deepcopy(current)
        result = context['retry_primary_caption_transcript'](None, 'fixture', 'en', current, [(23.39, 38.47)])
        self.assertEqual(result[3], fresh)
        self.assertEqual(result[3][:2], original[:2])
        self.assertEqual(result[3][-2:], original[-2:])
        self.assertEqual(len(decoder.calls), 1)
        self.assertEqual(decoder.calls[0]['chunk_length'], 20)
        self.assertEqual(len(focused.calls), 2)
        self.assertEqual(current, snapshot)
        context['require_valid_caption_result'](result[0], result[2], result[3], 50)

    def test_failed_timing_only_repair_can_select_a_fully_confirmed_fresh_transcript(self):
        original, fresh, block = self.fresh_primary_fixture()
        core = fresh[2:-2]
        first = [dict(core[0], start=23.39)] + core[1:]
        second = [dict(core[0], start=23.14)] + core[1:]
        context = scenario_context(duration=50,
            suspicious_caption_audio_ranges=lambda *_: [(23.39, 38.47)])
        context['run_whisper_with_model'] = ScriptedDecoder(transcript(fresh))
        focused = ScriptedDecoder(transcript(first), transcript(second),
                                  transcript(block), transcript(block))
        context['read_caption_audio_range'] = focused
        result = context['repair_primary_caption_timing'](None, 'fixture', 'en', transcript(original))
        self.assertEqual(result[3], fresh)
        self.assertEqual(len(focused.calls), 4)
        self.assertIn('fresh 20s-chunk', context['recovery_warnings'][-1])

    def test_fresh_recognition_does_not_decode_again_when_complete_retry_is_invalid(self):
        original, fresh, block = self.fresh_primary_fixture()
        context = scenario_context(duration=50)
        decoder = ScriptedDecoder(transcript(original))
        context['run_whisper_with_model'] = decoder
        context['read_caption_audio_range'] = ScriptedDecoder(transcript(block), transcript(block))
        result = context['retry_primary_caption_transcript'](None, 'fixture', 'en', transcript(original), [(23.39, 38.47)])
        self.assertEqual(result[3], original)
        self.assertEqual([call['chunk_length'] for call in decoder.calls], [20])

    def test_fresh_recognition_preserves_exact_outside_words_and_timestamps(self):
        original, fresh, block = self.fresh_primary_fixture()
        moved = copy.deepcopy(fresh)
        moved[0]['start'] -= .5
        moved[0]['end'] -= .5
        moved[-1]['start'] += .5
        moved[-1]['end'] += .5
        context = scenario_context(duration=50)
        context['run_whisper_with_model'] = ScriptedDecoder(transcript(moved))
        context['read_caption_audio_range'] = ScriptedDecoder(transcript(block), transcript(block))
        result = context['retry_primary_caption_transcript'](None, 'fixture', 'en', transcript(original), [(23.39, 38.47)])
        self.assertEqual(result[3], fresh)

    def test_fresh_recognition_rejects_lost_changed_repeated_or_retimed_outside_words(self):
        original, fresh, _ = self.fresh_primary_fixture()
        variants = {
            'lost_prefix': fresh[1:], 'lost_suffix': fresh[:-1],
            'changed_prefix': [dict(fresh[0], word='Other')] + fresh[1:],
            'extra_prefix_repeat': fresh[:1] + fresh,
            'retimed_join_anchor': fresh[:2] + [dict(fresh[2], start=28.3, end=28.7)] + fresh[3:],
            'changed_suffix': fresh[:-1] + [dict(fresh[-1], word='different')],
            'incomplete_text': transcript(fresh, ' '.join(w['word'] for w in fresh) + ' missing'),
            'empty_core': original[:2] + original[-2:],
        }
        for name, candidate in variants.items():
            with self.subTest(name=name):
                response = candidate if isinstance(candidate, tuple) else transcript(candidate)
                context = scenario_context(duration=50)
                context['run_whisper_with_model'] = ScriptedDecoder(response, response)
                context['read_caption_audio_range'] = ScriptedDecoder()
                current = transcript(original)
                self.assertEqual(context['retry_primary_caption_transcript'](
                    None, 'fixture', 'en', current, [(23.39, 38.47)]), current)

    def test_fresh_recognition_requires_complete_unambiguous_independent_phrase_and_anchors(self):
        original, fresh, block = self.fresh_primary_fixture()
        variants = {
            'missing_left_anchor': block[1:], 'missing_right_anchor': block[:-1],
            'missing_word': block[:1] + block[2:],
            'extra_word': block[:1] + [word('hidden', 29.3, 29.5)] + block[1:],
            'changed_word': block[:1] + [dict(block[1], word='birds')] + block[2:],
            'collapsed_word': block[:1] + [dict(block[1], end=block[1]['start'])] + block[2:],
            'shifted_word': block[:1] + [dict(block[1], start=29.3, end=29.6)] + block[2:],
            'incomplete_text': transcript(block, ' '.join(w['word'] for w in block) + ' missing'),
            'different_primary_polar': block[:2] + [word('Polar', 29.97, 30)] + block[2:],
            'decode_error': RuntimeError('focused read failed'),
        }
        for name, candidate in variants.items():
            with self.subTest(name=name):
                response = candidate if isinstance(candidate, (tuple, Exception)) else transcript(candidate)
                context = scenario_context(duration=50)
                context['run_whisper_with_model'] = ScriptedDecoder(transcript(fresh), transcript(fresh))
                context['read_caption_audio_range'] = ScriptedDecoder(
                    transcript(block), response, transcript(block), response)
                current = transcript(original)
                self.assertEqual(context['retry_primary_caption_transcript'](
                    None, 'fixture', 'en', current, [(23.39, 38.47)]), current)

    def test_fresh_recognition_rejects_unowned_extra_audio_crossing_phrase_boundaries(self):
        original, fresh, block = self.fresh_primary_fixture()
        for extras in ([word('hidden', 28.5, 28.75)] + block,
                       block + [word('hidden', 30.39, 30.8)]):
            context = scenario_context(duration=50)
            context['run_whisper_with_model'] = ScriptedDecoder(transcript(fresh), transcript(fresh))
            context['read_caption_audio_range'] = ScriptedDecoder(
                transcript(extras), transcript(extras), transcript(extras), transcript(extras))
            current = transcript(original)
            self.assertEqual(context['retry_primary_caption_transcript'](
                None, 'fixture', 'en', current, [(23.39, 38.47)]), current)

    def test_fresh_recognition_respects_speech_mask_and_bounded_scope(self):
        original, fresh, block = self.fresh_primary_fixture()
        for overrides, ranges in (({'song_mode': True}, [(23.39, 38.47)]),
                                  ({}, [(1, 30)]), ({}, [(23.39, 38.47), (45, 49)]),
                                  ({'speech': []}, [(23.39, 38.47)])):
            context = scenario_context(duration=50, **overrides)
            context['run_whisper_with_model'] = ScriptedDecoder(transcript(fresh), transcript(fresh))
            context['read_caption_audio_range'] = ScriptedDecoder(
                transcript(block), transcript(block), transcript(block), transcript(block))
            current = transcript(original)
            self.assertEqual(context['retry_primary_caption_transcript'](
                None, 'fixture', 'en', current, ranges), current)

    def test_fresh_recognition_changes_only_minimal_lexical_or_invalid_core(self):
        original, fresh, block = self.fresh_primary_fixture()
        candidate = copy.deepcopy(fresh)
        candidate[0]['start'] -= .4
        candidate[5]['start'] += .04
        candidate[5]['end'] += .04
        candidate[6]['start'] += .04
        context = scenario_context(duration=50)
        context['run_whisper_with_model'] = ScriptedDecoder(transcript(candidate))
        calls = []
        def read(*args, **kwargs):
            calls.append((args[3], args[4]))
            return transcript(block)
        context['read_caption_audio_range'] = read
        result = context['retry_primary_caption_transcript'](
            None, 'fixture', 'en', transcript(original), [(23.39, 38.47)])
        self.assertEqual(result[3], fresh)
        self.assertEqual(result[3][4:], original[5:])
        self.assertEqual(result[3][6], original[7], 'The real second Polar word must remain unchanged')
        self.assertEqual(len(calls), 2)
        self.assertGreater(calls[0][0], 27)
        self.assertLess(calls[1][1], 32)

    def test_fresh_recognition_includes_same_spelling_invalid_words_in_confirmed_core(self):
        original = [word('Before', 29.3, 29.6), word('Polar', 29.98, 29.98),
                    word('animals', 30.4, 30.8), word('After', 32, 32.3)]
        fresh = original[:1] + [word('Polar', 29.98, 30.2)] + original[2:]
        context = scenario_context(duration=40)
        context['run_whisper_with_model'] = ScriptedDecoder(transcript(fresh))
        context['read_caption_audio_range'] = ScriptedDecoder(transcript(fresh[:3]), transcript(fresh[:3]))
        result = context['retry_primary_caption_transcript'](
            None, 'fixture', 'en', transcript(original), [(29.7, 31)])
        self.assertEqual(result[3], fresh)

    def test_fresh_recognition_includes_both_original_overlapping_words_in_confirmed_core(self):
        original = [word('Before', 29, 29.3), word('Polar', 29.5, 30.1),
                    word('animals', 30, 30.4), word('After', 31, 31.3)]
        fresh = original[:1] + [word('Polar', 29.5, 30), word('animals', 30, 30.4)] + original[3:]
        context = scenario_context(duration=40)
        context['run_whisper_with_model'] = ScriptedDecoder(transcript(fresh))
        context['read_caption_audio_range'] = ScriptedDecoder(transcript(fresh), transcript(fresh))
        result = context['retry_primary_caption_transcript'](
            None, 'fixture', 'en', transcript(original), [(29.4, 30.5)])
        self.assertEqual(result[3], fresh)

    def test_fresh_recognition_rejects_first_confirmation_failure_or_repeated_whole_block(self):
        original, fresh, block = self.fresh_primary_fixture()
        earlier = [dict(item, start=item['start'] - 2, end=item['end'] - 2) for item in block]
        variants = [RuntimeError('first confirmation failed'), transcript(earlier + block)]
        for first in variants:
            with self.subTest(first=first):
                context = scenario_context(duration=50)
                context['run_whisper_with_model'] = ScriptedDecoder(transcript(fresh))
                context['read_caption_audio_range'] = ScriptedDecoder(first, transcript(block))
                current = transcript(original)
                self.assertEqual(context['retry_primary_caption_transcript'](
                    None, 'fixture', 'en', current, [(23.39, 38.47)]), current)

    def test_fresh_recognition_applies_exact_24_second_cap_to_wider_physical_confirmation(self):
        for extra, accepted in ((0, True), (.000001, False)):
            with self.subTest(extra=extra):
                original = [word('Before', 5, 5.3), word('wrong', 10, 10),
                            word('near', 26.8, 27 + extra), word('After', 29, 29.3)]
                fresh = original[:1] + [word('Hello', 10, 10.3)] + original[2:]
                context = scenario_context(duration=40)
                context['run_whisper_with_model'] = ScriptedDecoder(transcript(fresh))
                calls = []
                def read(*args, **kwargs):
                    calls.append((args[3], args[4]))
                    return transcript(fresh[:3])
                context['read_caption_audio_range'] = read
                current = transcript(original)
                result = context['retry_primary_caption_transcript'](
                    None, 'fixture', 'en', current, [(9, 11)])
                self.assertEqual(result[3], fresh if accepted else original)
                self.assertEqual(len(calls), 2 if accepted else 0)
                if accepted:
                    self.assertEqual(calls[1][1] - calls[1][0], 24)

    def test_fresh_recognition_emits_second_independently_confirmed_physical_core_times(self):
        original, fresh, block = self.fresh_primary_fixture()
        fresh[3] = word('Desert', 29.78, 29.96)
        first = [word('trees.', 28.73, 29.15), word('Desert', 29.51, 29.97),
                 word('animals', 29.97, 30.45)]
        second = [word('trees.', 28.74, 29.16), word('Desert', 29.6, 29.96),
                  word('animals', 29.96, 30.46)]
        context = scenario_context(duration=50)
        context['run_whisper_with_model'] = ScriptedDecoder(transcript(fresh))
        context['read_caption_audio_range'] = ScriptedDecoder(transcript(first), transcript(second))
        result = context['retry_primary_caption_transcript'](
            None, 'fixture', 'en', transcript(original), [(23.39, 38.47)])
        expected = fresh[:3] + [word('Desert', 29.6, 29.96)] + fresh[4:]
        self.assertEqual(result[3], expected)
        self.assertEqual(result[3][4:], original[5:])
        self.assertEqual(result[3][6], original[7])

    def test_fresh_physical_core_keeps_quarter_second_pair_and_original_anchor_limits(self):
        original, fresh, block = self.fresh_primary_fixture()
        fresh[3] = word('Desert', 29.78, 29.96)
        first = [word('trees.', 28.73, 29.15), word('Desert', 29.51, 29.97),
                 word('animals', 29.97, 30.45)]
        second = [word('trees.', 28.74, 29.16), word('Desert', 29.6, 29.96),
                  word('animals', 29.96, 30.46)]
        variants = {
            'second_vs_fresh': (first, second[:1] + [word('Desert', 29.5, 29.96)] + second[2:]),
            'first_vs_second': (first[:1] + [word('Desert', 29.3, 29.97)] + first[2:], second),
            'first_anchor': ([word('trees.', 28.4, 29.15)] + first[1:], second),
            'second_anchor': (first, [word('trees.', 28.4, 29.16)] + second[1:]),
            'selected_original_join': (first[:1] + [word('Desert', 29.51, 30.0),
                                               word('animals', 30, 30.45)],
                                       second[:1] + [word('Desert', 29.6, 30.0),
                                                     word('animals', 30, 30.46)]),
        }
        for name, (one, two) in variants.items():
            with self.subTest(name=name):
                context = scenario_context(duration=50)
                context['run_whisper_with_model'] = ScriptedDecoder(transcript(fresh))
                context['read_caption_audio_range'] = ScriptedDecoder(transcript(one), transcript(two))
                current = transcript(original)
                self.assertEqual(context['retry_primary_caption_transcript'](
                    None, 'fixture', 'en', current, [(23.39, 38.47)]), current)

    def test_primary_timing_retry_requires_complete_independent_words_and_timing(self):
        original = [word('yes', 30, 30), word('yes', 30, 30), word('please.', 30, 30)]
        corrected = [word('yes', 29.5, 29.7), word('yes', 29.8, 30), word('please.', 30.1, 30.4)]
        variants = {
            'missing_repeat': transcript(corrected[1:]),
            'changed_word': transcript([dict(corrected[0], word='no')] + corrected[1:]),
            'shifted': transcript([dict(item, start=item['start'] + .3, end=item['end'] + .3)
                                   for item in corrected]),
            'overlap': transcript([corrected[0], dict(corrected[1], start=29.6), corrected[2]]),
            'incomplete_word_timing': transcript(corrected, 'yes yes please missing'),
            'outside_window': transcript([word('yes', 23, 23.2)] + corrected[1:]),
            'decoder_failure': RuntimeError('focused decoder failed'),
        }
        for name, second in variants.items():
            with self.subTest(name=name):
                context = scenario_context(duration=50)
                decoder = ScriptedDecoder(transcript(corrected), second)
                context['read_caption_audio_range'] = decoder
                self.invoke_unchanged(context, 'repair_primary_caption_timing', transcript(original))
                self.assertTrue(context['recovery_warnings'])

    def test_primary_timing_retry_preserves_good_timelines_and_respects_disabled_recovery(self):
        good = transcript([word('Good.', 1, 1.3)])
        context = scenario_context(duration=3)
        def unexpected(*args, **kwargs):
            self.fail('A good timeline or disabled recovery must not be decoded again')
        context['read_caption_audio_range'] = unexpected
        self.invoke_unchanged(context, 'repair_primary_caption_timing', good)
        context['auto_recovery'] = False
        self.invoke_unchanged(context, 'repair_primary_caption_timing', transcript([word('Bad.', 1, 1)]))

    def test_primary_timing_retry_cannot_erase_recognized_words_without_timestamps(self):
        context = scenario_context(duration=50)
        corrected = [word('Hello', 30, 30.2), word('world.', 30.2, 30.5)]
        decoder = ScriptedDecoder(transcript(corrected), transcript(corrected))
        context['read_caption_audio_range'] = decoder
        current = transcript([word('Hello', 30, 30), word('world.', 30, 30)], 'Hello hidden world.')
        self.invoke_unchanged(context, 'repair_primary_caption_timing', current)
        self.assertEqual(decoder.calls, [])
        self.assertIn('hidden', current[0])
        with self.assertRaises(ValueError):
            context['require_valid_caption_result'](current[0], current[2], current[3], 50)

    def test_focused_audio_read_uses_exact_source_frames_and_cleans_temporary_clip(self):
        for fail in (False, True):
            with self.subTest(fail=fail), tempfile.TemporaryDirectory() as directory:
                source = pathlib.Path(directory) / 'source.wav'
                samples = b'\x01\x00' * 32000
                with wave.open(str(source), 'wb') as audio:
                    audio.setnchannels(1)
                    audio.setsampwidth(2)
                    audio.setframerate(16000)
                    audio.writeframes(samples)
                captured = []
                def decode(model, filename, lang, **kwargs):
                    captured.append(filename)
                    with wave.open(filename, 'rb') as audio:
                        self.assertEqual(audio.readframes(audio.getnframes()), samples[1975 * 2:7309 * 2])
                    if fail:
                        raise RuntimeError('decoder failed')
                    return transcript([word('Real', .05, .1)])
                context = scenario_context(run_whisper_with_model=decode)
                context.update(wave=wave, tempfile=tempfile, os=os)
                if fail:
                    with self.assertRaises(RuntimeError):
                        context['read_caption_audio_range'](None, str(source), 'en', .12345, .45678)
                else:
                    result = context['read_caption_audio_range'](None, str(source), 'en', .12345, .45678)
                    self.assertEqual(result[3], [word('Real', 1975 / 16000 + .05, 1975 / 16000 + .1)])
                self.assertEqual(len(captured), 1)
                self.assertFalse(os.path.exists(captured[0]))

    def test_final_worker_gate_rejects_invalid_timestamps_and_incomplete_recognized_speech(self):
        context = scenario_context(duration=2)
        validate = context['require_valid_caption_result']
        for name, words in _invalid_timelines.items():
            if name == 'empty':
                continue
            with self.subTest(name=name), self.assertRaises(ValueError) as caught:
                validate('hello', [], words, 2)
            self.assertEqual(caught.exception.code, 'CAPTION_LOCAL_RESULT_INVALID')
            self.assertIn('audio', str(caught.exception))
        with self.assertRaises(ValueError):
            validate('hello missing', [], [word('hello', 1, 1.2)], 2)
        with self.assertRaises(ValueError):
            validate('hello', [{'text': 'hello', 'start': 1, 'end': 1}], [], 2)
        with self.assertRaises(ValueError):
            validate('hello', [], [word('hello', '1', '1.2')], 2)
        for duration in (0, -1, math.nan, math.inf, '2', True):
            with self.subTest(duration=duration), self.assertRaises(ValueError):
                validate('hello', [], [word('hello', 1, 1.2)], duration)
        validate('hello', [{'text': 'hello', 'start': 1, 'end': 1.2}], [word('hello', 1, 1.2)], 2)
        validate('', [], [], 2)

    def test_final_payload_coverage_uses_exact_app_normalization_not_spoken_spelling_aliases(self):
        validate = scenario_context()['require_valid_caption_result']
        for text, token in (('colour', 'color'), ('Straße', 'Strasse'), ('कि', 'कु')):
            with self.subTest(text=text), self.assertRaises(ValueError) as caught:
                validate(text, [], [word(token, 1, 1.2)], 2)
            self.assertEqual(caught.exception.code, 'CAPTION_LOCAL_RESULT_INVALID')
        for text, token in (('CAFÉ!', 'cafe\u0301'), ('４２', '42'), ('नमस्ते!', 'नमस्ते')):
            with self.subTest(text=text):
                validate(text, [], [word(token, 1, 1.2)], 2)

    def test_segments_preserve_sentence_pauses_and_eight_word_limit(self):
        context = scenario_context()
        words = [word(str(i), i * .125, (i + 1) * .125) for i in range(9)]
        words += [word('Stop!', 2, 2.2), word('Next', 2.2, 2.4)]
        original = copy.deepcopy(words)
        segments = context['caption_segments_from_words'](words)
        self.assertEqual([s['text'] for s in segments], ['0 1 2 3 4 5 6 7', '8', 'Stop!', 'Next'])
        self.assertEqual((segments[1]['start'], segments[1]['end']), (1, 1.125))
        self.assertEqual(words, original)

    def test_segments_exact_pause_threshold(self):
        context = scenario_context()
        self.assertEqual(len(context['caption_segments_from_words']([
            word('one', 0, .2), word('two', .5, .7)])), 2)
        self.assertEqual(len(context['caption_segments_from_words']([
            word('one', 0, .2), word('two', .499999, .7)])), 1)

    def test_speech_filter_keeps_quiet_short_word_and_rejects_broad_music_interval(self):
        context = scenario_context(speech=[(1.0, 1.08)])
        short, broad = word('yes', 1, 1.16), word('thanks', 0, 4)
        self.assertEqual(context['filter_recovery_speech']('fixture', [short, broad]), [short])

    def test_phrase_bounds_cover_real_recording_word_before_old_segment_start(self):
        words = [word('Do', 23.70, 24.02), word('you', 24.02, 24.16), word('think?', 24.16, 24.34)]
        segments = scenario_context()['caption_segments_from_words'](words)
        self.assertEqual(segments, [{'start': 23.70, 'end': 24.34, 'text': 'Do you think?'}])
        self.assertTrue(all(any(seg['start'] <= w['start'] < w['end'] <= seg['end'] for seg in segments) for w in words))

    def test_speech_filter_requires_half_of_long_word(self):
        candidate = word('singing', 1, 4)
        for end, accepted in ((2.49, False), (2.5, True)):
            with self.subTest(end=end):
                context = scenario_context(speech=[(1, end)])
                self.assertEqual(bool(context['filter_recovery_speech']('fixture', [candidate])), accepted)

    def test_speech_filter_retains_physical_timing_and_input_objects(self):
        words = [word('yes', 1, 1.1), word('later', 8, 8.2)]
        context = scenario_context(speech=[(1, 1.1), (8, 8.2)])
        snapshot = copy.deepcopy(words)
        self.assertEqual(context['filter_recovery_speech']('fixture', words), words)
        self.assertEqual(words, snapshot)

    def test_repetition_filter_separates_genuine_pair_and_hallucination_loop(self):
        repeat = scenario_context()['is_repetition_loop']
        self.assertFalse(repeat('yes yes'))
        self.assertFalse(repeat('we go home and we sleep'))
        self.assertTrue(repeat('yes yes yes'))
        self.assertTrue(repeat('la' * 20))

    def test_sequence_is_ordered_and_requires_each_repetition(self):
        preserve = scenario_context()['caption_preserves_word_sequence']
        self.assertTrue(preserve([word('yes'), word('yes')],
                                 [word('yes'), word('please'), word('yes')]))
        self.assertFalse(preserve([word('yes'), word('yes')], [word('yes')]))
        self.assertFalse(preserve([word('go'), word('home')], [word('home'), word('go')]))

    def test_restore_spelling_keeps_added_words_punctuation_and_decode_times(self):
        context = scenario_context()
        original = [word('color', 1, 1.2), word('Colorful', 2, 2.2)]
        candidate = [word('New', .7, .8), word('colour,', 1.1, 1.3),
                     word('Colourful.', 2.1, 2.3)]
        snapshot = copy.deepcopy(candidate)
        restored = context['caption_restore_original_orthography'](original, candidate)
        self.assertEqual([w['word'] for w in restored], ['New', 'color,', 'Colorful.'])
        self.assertEqual([(w['start'], w['end']) for w in restored],
                         [(w['start'], w['end']) for w in candidate])
        self.assertEqual(candidate, snapshot)

    def test_restore_missing_original_raises_instead_of_silently_dropping_it(self):
        with self.assertRaises(ValueError):
            scenario_context()['caption_restore_original_orthography'](
                [word('yes'), word('yes')], [word('yes')])

    def test_gaps_include_opening_internal_and_trailing_audio(self):
        context = scenario_context()
        words = [word('one', 2, 3), word('two', 5, 6)]
        self.assertEqual(context['uncovered_audio_ranges'](words, 8), [(0, 2), (3, 5), (6, 8)])
        self.assertEqual(context['uncovered_audio_ranges']([], 8), [(0, 8)])
        self.assertEqual(context['uncovered_audio_ranges'](words, 0), [])

    def test_gaps_exact_minimum_and_sorted_input(self):
        context = scenario_context()
        original = [word('two', 2, 3), word('one', 0, 1)]
        snapshot = copy.deepcopy(original)
        self.assertEqual(context['uncovered_audio_ranges'](original, 3), [(1, 2)])
        self.assertEqual(original, snapshot)
        self.assertEqual(context['uncovered_audio_ranges']([word('one', 0, 1), word('two', 1.999, 3)], 3), [])

    def test_gap_recovery_accepts_confirmed_unicode_and_repeated_words(self):
        for tokens in (('yes', 'yes'), ('你好', '朋友'), ('नमस्ते', 'दोस्त'), ('سلام', 'عالم')):
            with self.subTest(tokens=tokens):
                recovered = [word(tokens[0], 2, 2.2), word(tokens[1], 2.4, 2.6)]
                decoder = ScriptedDecoder(transcript(recovered), transcript(recovered))
                context = scenario_context(decoder, duration=5)
                current = transcript([word('Before', 0, 1), word('After', 4, 5)])
                snapshot = copy.deepcopy(current)
                result = context['repair_remaining_audio_gaps'](None, 'fixture', 'en', current)
                self.assertEqual(result[3], current[3][:1] + recovered + current[3][1:])
                self.assertEqual(current, snapshot)
                self.assertEqual([call['lenient'] for call in decoder.calls], [False, True])
                self.assertEqual([call['clip_timestamps'] for call in decoder.calls], ['0.250,4.750'] * 2)

    def test_gap_recovery_keeps_original_after_second_decode_exception(self):
        recovered = [word('new', 2, 2.2)]
        decoder = ScriptedDecoder(transcript(recovered), RuntimeError('decode unavailable'))
        context = scenario_context(decoder, duration=5)
        self.invoke_unchanged(context, 'repair_remaining_audio_gaps',
                              transcript([word('Before', 0, 1), word('After', 4, 5)]))
        self.assertIn('Existing captions were retained', context['recovery_warnings'][-1])

    def test_gap_recovery_silent_audio_never_decodes(self):
        decoder = ScriptedDecoder()
        context = scenario_context(decoder, duration=5, speech=[])
        self.invoke_unchanged(context, 'repair_remaining_audio_gaps',
                              transcript([word('Before', 0, 1), word('After', 4, 5)]))
        self.assertEqual(decoder.calls, [])

    def test_gap_recovery_rejects_unconfirmed_speech(self):
        recovered = [word('new', 2, 2.2)]
        decoder = ScriptedDecoder(transcript(recovered), transcript(recovered))
        context = scenario_context(decoder, duration=5, speech=[(1.1, 1.4)])
        self.invoke_unchanged(context, 'repair_remaining_audio_gaps',
                              transcript([word('Before', 0, 1), word('After', 4, 5)]))
        self.assertIn('could not confirm all speech', context['recovery_warnings'][-1])

    def test_gap_recovery_rejects_second_pass_overlap(self):
        first = [word('one', 2, 2.2), word('two', 2.2, 2.4)]
        second = [word('one', 2, 2.3), word('two', 2.2, 2.4)]
        decoder = ScriptedDecoder(transcript(first), transcript(second))
        context = scenario_context(decoder, duration=5)
        self.invoke_unchanged(context, 'repair_remaining_audio_gaps',
                              transcript([word('Before', 0, 1), word('After', 4, 5)]))

    def test_gap_recovery_requires_complete_first_text(self):
        recovered = [word('one', 2, 2.2)]
        decoder = ScriptedDecoder(transcript(recovered, 'one missing'), transcript(recovered))
        context = scenario_context(decoder, duration=5)
        self.invoke_unchanged(context, 'repair_remaining_audio_gaps',
                              transcript([word('Before', 0, 1), word('After', 4, 5)]))

    def test_gap_recovery_requires_complete_second_text(self):
        recovered = [word('one', 2, 2.2)]
        decoder = ScriptedDecoder(transcript(recovered), transcript(recovered, 'one missing'))
        context = scenario_context(decoder, duration=5)
        self.invoke_unchanged(context, 'repair_remaining_audio_gaps',
                              transcript([word('Before', 0, 1), word('After', 4, 5)]))

    def test_gap_recovery_discards_context_words_outside_gap_without_duplicate_anchors(self):
        recovered = [word('Before', 0, 1), word('new', 2, 2.2), word('After', 4, 5)]
        decoder = ScriptedDecoder(transcript(recovered), transcript(recovered))
        context = scenario_context(decoder, duration=5)
        current = transcript([word('Before', 0, 1), word('After', 4, 5)])
        result = context['repair_remaining_audio_gaps'](None, 'fixture', 'en', current)
        self.assertEqual([w['word'] for w in result[3]], ['Before', 'new', 'After'])

    def test_gap_recovery_rejects_words_straddling_gap_anchors(self):
        recovered = [word('new', .9, 1.1), word('another', 3.9, 4.1)]
        decoder = ScriptedDecoder(transcript(recovered), transcript(recovered))
        context = scenario_context(decoder, duration=5)
        self.invoke_unchanged(context, 'repair_remaining_audio_gaps',
                              transcript([word('Before', 0, 1), word('After', 4, 5)]))

    def test_gap_recovery_disabled_never_decodes(self):
        decoder = ScriptedDecoder()
        context = scenario_context(decoder, duration=5, auto_recovery=False)
        self.invoke_unchanged(context, 'repair_remaining_audio_gaps',
                              transcript([word('Before', 0, 1), word('After', 4, 5)]))
        self.assertEqual(decoder.calls, [])

    def test_gap_recovery_one_failed_gap_does_not_block_independent_recovery(self):
        words = [word('one', 0, 1), word('two', 4, 5), word('three', 8, 9)]
        recovered = [word('new', 6, 6.2)]
        decoder = ScriptedDecoder(RuntimeError('first clip failed'), transcript(recovered), transcript(recovered))
        context = scenario_context(decoder, duration=9)
        result = context['repair_remaining_audio_gaps'](None, 'fixture', 'en', transcript(words))
        self.assertEqual([w['word'] for w in result[3]], ['one', 'two', 'new', 'three'])
        self.assertTrue(context['recovery_warnings'])

    def test_covered_recovery_updates_collapsed_words_with_confirmed_physical_times(self):
        current = transcript([word('Before', 1, 1.2), word('Read', 10, 10),
                              word('this', 10, 10), word('After', 19, 19.2)])
        recovered = [word('Please', 9.5, 9.7), word('Read', 10, 10.2), word('this', 10.2, 10.4)]
        decoder = ScriptedDecoder(transcript(recovered), transcript(recovered))
        context = scenario_context(decoder)
        result = context['repair_covered_audio_speech'](None, 'fixture', 'en', current)
        self.assertEqual(result[3], current[3][:1] + recovered + current[3][-1:])
        self.assertTrue(context['valid_caption_word_timeline'](result[3], 20))

    def test_covered_recovery_silence_skips_decoder(self):
        decoder = ScriptedDecoder()
        context = scenario_context(decoder, speech=[])
        current = transcript([word('Before', 1, 1.2), word('Read', 10, 13), word('After', 19, 19.2)])
        self.invoke_unchanged(context, 'repair_covered_audio_speech', current)
        self.assertEqual(decoder.calls, [])

    def test_covered_recovery_overbroad_window_is_retained_without_decoding(self):
        decoder = ScriptedDecoder()
        context = scenario_context(decoder, duration=50)
        current = transcript([word('stretched', 1, 40)])
        self.invoke_unchanged(context, 'repair_covered_audio_speech', current)
        self.assertEqual(decoder.calls, [])
        self.assertIn('too broad', context['recovery_warnings'][-1])

    def test_covered_recovery_rejects_first_pass_outside_requested_clip(self):
        current = transcript([word('Before', 1, 1.2), word('stretched', 10, 13),
                              word('After', 19, 19.2)])
        first = [word('new', 3.9, 4.3), word('stretched', 10, 10.2)]
        second = [word('new', 4.1, 4.3), word('stretched', 10, 10.2)]
        decoder = ScriptedDecoder(transcript(first), transcript(second))
        context = scenario_context(decoder)
        self.invoke_unchanged(context, 'repair_covered_audio_speech', current)

    def test_covered_recovery_requires_complete_both_passes_and_preserves_every_original(self):
        current = transcript([word('Before', 1, 1.2), word('Read', 10, 13), word('After', 19, 19.2)])
        for recovered, text in (([word('different', 10, 10.2)], None),
                                ([word('Read', 10, 10.2)], 'Read missing')):
            with self.subTest(text=text):
                decoder = ScriptedDecoder(transcript(recovered, text), transcript(recovered, text))
                context = scenario_context(decoder)
                self.invoke_unchanged(context, 'repair_covered_audio_speech', current)
                self.assertIn('Existing captions were retained', context['recovery_warnings'][-1])

    def test_covered_recovery_song_mode_and_disabled_mode_do_not_redecode(self):
        current = transcript([word('Read', 10, 13)])
        for override in ({'song_mode': True}, {'auto_recovery': False}):
            with self.subTest(override=override):
                decoder = ScriptedDecoder()
                context = scenario_context(decoder, **override)
                self.invoke_unchanged(context, 'repair_covered_audio_speech', current)
                self.assertEqual(decoder.calls, [])

    def test_opening_preserves_later_anchor_and_uses_bounded_clips(self):
        current = transcript([word('hello', 1, 1.2), word('Lesson', 9, 9.2)])
        recovered = [word('hello', 1.1, 1.3)]
        decoder = ScriptedDecoder(transcript(recovered), transcript(recovered))
        context = scenario_context(decoder, duration=10)
        snapshot = copy.deepcopy(current)
        result = context['verify_opening_speech'](None, 'fixture', 'en', current)
        self.assertEqual(result[3], recovered + current[3][-1:])
        self.assertEqual(current, snapshot)
        self.assertEqual([call['clip_timestamps'] for call in decoder.calls], ['0,5.100', '0,5.350'])

    def test_opening_extension_cannot_erase_supported_original_whole_word(self):
        current = transcript([word('Info', 1, 1.2), word('Lesson', 9, 9.2)])
        recovered = [word('InfoKids', 1, 1.2)]
        decoder = ScriptedDecoder(transcript(recovered), transcript(recovered))
        context = scenario_context(decoder, duration=10)
        self.invoke_unchanged(context, 'verify_opening_speech', current)
        self.assertIn('omitted previously detected speech', context['recovery_warnings'][-1])

    def test_opening_original_cannot_match_substring_inside_different_word(self):
        current = transcript([word('red', 1, 1.2), word('Lesson', 9, 9.2)])
        recovered = [word('colored', 1, 1.2)]
        decoder = ScriptedDecoder(transcript(recovered), transcript(recovered))
        context = scenario_context(decoder, duration=10)
        self.invoke_unchanged(context, 'verify_opening_speech', current)
        self.assertIn('omitted previously detected speech', context['recovery_warnings'][-1])

    def test_opening_brand_token_can_split_into_whole_tokens_without_losing_letters(self):
        current = transcript([word('InfoKids', 1, 1.4), word('Lesson', 9, 9.2)])
        recovered = [word('Info', 1, 1.2), word('Kids', 1.2, 1.4)]
        decoder = ScriptedDecoder(transcript(recovered), transcript(recovered))
        context = scenario_context(decoder, duration=10)
        snapshot = copy.deepcopy(current)
        result = context['verify_opening_speech'](None, 'fixture', 'en', current)
        self.assertEqual(result[3], recovered + current[3][-1:])
        self.assertEqual(current, snapshot)

    def test_opening_rejects_different_hindi_vowel_marks_between_audio_passes(self):
        current = transcript([word('कि', 1, 1.2), word('Lesson', 9, 9.2)])
        decoder = ScriptedDecoder(transcript([word('कि', 1, 1.2)]),
                                  transcript([word('कु', 1, 1.2)]))
        context = scenario_context(decoder, duration=10)
        self.invoke_unchanged(context, 'verify_opening_speech', current)

    def test_opening_rejects_overlapping_first_pass_even_when_second_pass_is_valid(self):
        first = [word('hello', 1, 1.3), word('world', 1.2, 1.4)]
        second = [word('hello', 1, 1.2), word('world', 1.2, 1.4)]
        decoder = ScriptedDecoder(transcript(first), transcript(second))
        context = scenario_context(decoder, duration=10)
        current = transcript(second + [word('Lesson', 9, 9.2)])
        self.invoke_unchanged(context, 'verify_opening_speech', current)

    def test_opening_accepts_exact_quarter_second_boundary(self):
        first = [word('hello', .3, .4)]
        second = [word('hello', .55, .65)]
        decoder = ScriptedDecoder(transcript(first), transcript(second))
        context = scenario_context(decoder, duration=10)
        current = transcript(first + [word('Lesson', 9, 9.2)])
        result = context['verify_opening_speech'](None, 'fixture', 'en', current)
        self.assertEqual(result[3], second + current[3][-1:])

    def test_opening_repetitions_cannot_collapse_inside_one_larger_word(self):
        current = transcript([word('go', 1, 1.1), word('go', 1.2, 1.3), word('Lesson', 9, 9.2)])
        recovered = [word('gogo', 1, 1.3)]
        decoder = ScriptedDecoder(transcript(recovered), transcript(recovered))
        context = scenario_context(decoder, duration=10)
        self.invoke_unchanged(context, 'verify_opening_speech', current)

    def test_opening_empty_decode_preserves_current(self):
        decoder = ScriptedDecoder(transcript([]), transcript([]))
        context = scenario_context(decoder, duration=10)
        self.invoke_unchanged(context, 'verify_opening_speech',
                              transcript([word('hello', 1, 1.2), word('Lesson', 9, 9.2)]))
        self.assertTrue(context['recovery_warnings'])

    def test_opening_straddled_default_boundary_does_not_decode(self):
        decoder = ScriptedDecoder()
        context = scenario_context(decoder)
        self.invoke_unchanged(context, 'verify_opening_speech', transcript([word('long', 11, 13)]))
        self.assertEqual(decoder.calls, [])

    def test_opening_both_clips_stay_inside_short_audio(self):
        recovered = [word('hello', 1, 1.2)]
        decoder = ScriptedDecoder(transcript(recovered), transcript(recovered))
        context = scenario_context(decoder, duration=2)
        result = context['verify_opening_speech'](None, 'fixture', 'en', transcript(recovered))
        self.assertEqual(result[3], recovered)
        self.assertEqual([call['clip_timestamps'] for call in decoder.calls], ['0,2.000'] * 2)

    def test_opening_decode_exception_is_warning_and_original_retained(self):
        context = scenario_context(ScriptedDecoder(RuntimeError('model failed')), duration=10)
        self.invoke_unchanged(context, 'verify_opening_speech',
                              transcript([word('hello', 1, 1.2), word('Lesson', 9, 9.2)]))
        self.assertIn('verification failed', context['recovery_warnings'][-1])

    def test_sparse_retry_accepts_complete_supported_words_and_keeps_original_anchors(self):
        recovered = [word('hello', 1, 1.2), word('new', 2, 2.2), word('speech', 3, 3.2)]
        decoder = ScriptedDecoder(transcript(recovered))
        context = scenario_context(decoder, duration=5)
        result = context['retry_sparse_with_child_speech_mode'](None, 'fixture', 'en', transcript(recovered[:1]))
        self.assertEqual(result[3], recovered)
        self.assertEqual(len(decoder.calls), 1)
        self.assertEqual(decoder.calls[0], {'lenient': True})

    def test_sparse_retry_requires_unique_anchors_for_repeated_original_words(self):
        current = transcript([word('yes', 1, 1.1), word('yes', 1.2, 1.3)])
        recovered = [word('yes', 1.1, 1.2), word('new', 2, 2.2), word('speech', 3, 3.2)]
        decoder = ScriptedDecoder(transcript(recovered))
        context = scenario_context(decoder, duration=5)
        self.invoke_unchanged(context, 'retry_sparse_with_child_speech_mode', current)

    def test_sparse_retry_cannot_change_hindi_vowel_marks_on_matching_anchors(self):
        current = transcript([word('\u0915\u0932', 1, 1.4), word('\u0905\u092c', 2, 2.4)])
        recovered = [word('\u0915\u093e\u0932', 1, 1.4), word('\u0914\u0930', 1.5, 1.7), word('\u0905\u092c', 2, 2.4)]
        context = scenario_context(ScriptedDecoder(transcript(recovered)), duration=5)
        self.invoke_unchanged(context, 'retry_sparse_with_child_speech_mode', current)

    def test_sparse_retry_requires_complete_text_timeline(self):
        recovered = [word('hello', 1, 1.2), word('new', 2, 2.2)]
        context = scenario_context(ScriptedDecoder(transcript(recovered, 'hello new missing')), duration=5)
        self.invoke_unchanged(context, 'retry_sparse_with_child_speech_mode', transcript(recovered[:1]))

    def test_sparse_retry_rejects_unconfirmed_new_words(self):
        recovered = [word('hello', 1, 1.2), word('new', 2, 2.2)]
        context = scenario_context(ScriptedDecoder(transcript(recovered)), duration=5, speech=[(1, 1.2)])
        self.invoke_unchanged(context, 'retry_sparse_with_child_speech_mode', transcript(recovered[:1]))

    def test_sparse_retry_complete_caption_skips_full_decode(self):
        decoder = ScriptedDecoder()
        context = scenario_context(decoder, duration=20)
        current = transcript([word('one', 1, 1.2), word('two', 2, 2.2),
                              word('three', 3, 3.2), word('four', 18, 18.2)])
        self.invoke_unchanged(context, 'retry_sparse_with_child_speech_mode', current)
        self.assertEqual(decoder.calls, [])

    def decoder_context(self, segments, **overrides):
        calls = []
        def transcribe(*args, **kwargs):
            calls.append(kwargs)
            return iter(segments), types.SimpleNamespace(duration=60, language='en')
        context = load_functions(['run_whisper_with_model', 'is_repetition_loop', 'clean'],
                                 song_mode=False, decoder_hint='', Counter=Counter)
        context.update(overrides)
        return context, types.SimpleNamespace(transcribe=transcribe), calls

    def decoder_segment(self, text='hello', start=1, end=1.2, no_speech=0, logprob=0, words=None):
        return types.SimpleNamespace(text=text, start=start, end=end, no_speech_prob=no_speech,
                                     avg_logprob=logprob,
                                     words=[types.SimpleNamespace(word=' hello ', start=start, end=end)]
                                     if words is None else words)

    def test_decoder_audio_timeline_options_and_prompt_are_forwarded(self):
        context, model, calls = self.decoder_context([self.decoder_segment()], decoder_hint='Quiet child narration')
        result = context['run_whisper_with_model'](model, 'fixture', 'en', clip_timestamps='3.000,9.000')
        self.assertEqual(result[3], [word('hello', 1, 1.2)])
        options = calls[0]
        self.assertEqual(options['clip_timestamps'], '3.000,9.000')
        self.assertEqual(options['initial_prompt'], 'Quiet child narration')
        self.assertIs(options['vad_filter'], False)
        self.assertIs(options['word_timestamps'], True)
        self.assertIs(options['condition_on_previous_text'], False)
        self.assertEqual(options['chunk_length'], 30)

    def test_decoder_song_mode_uses_short_windows_and_keeps_lyrics_repeats(self):
        segment = self.decoder_segment(text='yes yes yes')
        context, model, calls = self.decoder_context([segment], song_mode=True)
        result = context['run_whisper_with_model'](model, 'fixture', 'en')
        self.assertEqual(result[0], 'yes yes yes')
        self.assertEqual(calls[0]['chunk_length'], 10)
        self.assertEqual(calls[0]['no_speech_threshold'], .85)

    def test_decoder_repetition_hallucination_is_removed_without_shifting_later_speech(self):
        segments = [self.decoder_segment(text='yes yes yes', start=1, end=2),
                    self.decoder_segment(text='hello', start=30, end=30.2)]
        context, model, _ = self.decoder_context(segments)
        result = context['run_whisper_with_model'](model, 'fixture', 'en')
        self.assertEqual(result[0], 'hello')
        self.assertEqual(result[3], [word('hello', 30, 30.2)])

    def test_decoder_cleaned_noise_only_segment_does_not_emit_caption(self):
        context, model, _ = self.decoder_context([self.decoder_segment(text='[music] (noise)')])
        self.assertEqual(context['run_whisper_with_model'](model, 'fixture', 'en'), ('', 'en', [], []))

    def test_decoder_missing_word_timestamps_does_not_fabricate_them(self):
        context, model, _ = self.decoder_context([self.decoder_segment(words=[])])
        result = context['run_whisper_with_model'](model, 'fixture', 'en')
        self.assertEqual(result[0], 'hello')
        self.assertEqual(result[3], [])

    def test_decoder_strips_empty_word_tokens_and_preserves_numeric_unicode_tokens(self):
        tokens = [types.SimpleNamespace(word=' ', start=1, end=1.1),
                  types.SimpleNamespace(word=' 42 ', start=2.123, end=2.456),
                  types.SimpleNamespace(word=' 你好 ', start=3, end=3.2)]
        context, model, _ = self.decoder_context([self.decoder_segment(text='42 你好', words=tokens)])
        result = context['run_whisper_with_model'](model, 'fixture', 'en')
        self.assertEqual(result[3], [word('42', 2.123, 2.456), word('你好', 3, 3.2)])

    def test_decoder_preserves_subcentisecond_word_intervals_without_collapsing_them(self):
        context, model, _ = self.decoder_context([self.decoder_segment(start=1.1234, end=1.1235)])
        result = context['run_whisper_with_model'](model, 'fixture', 'en')
        self.assertEqual(result[3], [word('hello', 1.1234, 1.1235)])
        self.assertTrue(context['valid_caption_word_timeline'](result[3], 60))


_invalid_timelines = {
    'empty': [],
    'missing_start': [{'word': 'hi', 'end': 1}],
    'missing_end': [{'word': 'hi', 'start': 0}],
    'missing_word': [{'start': 0, 'end': 1}],
    'empty_word': [word('', 0, 1)],
    'whitespace_word': [word(' \t ', 0, 1)],
    'null_word': [word(None, 0, 1)],
    'null_start': [word(start=None)],
    'null_end': [word(end=None)],
    'text_start': [word(start='invalid')],
    'text_end': [word(end='invalid')],
    'negative_start': [word(start=-.001, end=.1)],
    'zero_length': [word(start=1, end=1)],
    'inverted': [word(start=2, end=1)],
    'nan_start': [word(start=math.nan)],
    'nan_end': [word(end=math.nan)],
    'infinite_start': [word(start=math.inf)],
    'infinite_end': [word(end=math.inf)],
    'negative_infinite': [word(start=-math.inf)],
    'boolean_start': [word(start=False)],
    'boolean_end': [word(start=0, end=True)],
    'overlap': [word('one', 0, .5), word('two', .49, 1)],
    'reversed_order': [word('one', 1, 1.2), word('two', 0, .5)],
    'nondictionary': ['bad'],
    'null_entry': [None],
    'beyond_duration': [word(start=1, end=2.02)],
}


def _timeline_case(words):
    def test(self):
        self.assertFalse(scenario_context()['valid_caption_word_timeline'](copy.deepcopy(words), 2))
    return test


for _name, _words in _invalid_timelines.items():
    setattr(LocalScenarioTest, 'test_timeline_rejects_' + _name, _timeline_case(_words))


_agreement_cases = {
    'exact': ([word()], [word()], True),
    'case_punctuation': ([word('Hello!')], [word('hello')], True),
    'orthography_color': ([word('color')], [word('colour,')], True),
    'orthography_colors': ([word('colors')], [word('colours')], True),
    'orthography_colored': ([word('colored')], [word('coloured')], True),
    'orthography_coloring': ([word('coloring')], [word('colouring')], True),
    'orthography_colorful': ([word('Colorful')], [word('Colourful.')], True),
    'genuine_pair': ([word('yes', 1, 1.1), word('yes', 1.2, 1.3)],
                     [word('yes', 1, 1.1), word('yes', 1.2, 1.3)], True),
    'missing_repeat': ([word('yes'), word('yes')], [word('yes')], False),
    'added_word': ([word()], [word(), word('new')], False),
    'different_word': ([word('cat')], [word('catalog')], False),
    'different_name': ([word('Ria')], [word('Rhea')], False),
    'short_word': ([word('to')], [word('too')], False),
    'substring': ([word('a')], [word('garden')], False),
    'unicode_chinese': ([word('你好')], [word('你好')], True),
    'unicode_arabic': ([word('سلام')], [word('سلام')], True),
    'unicode_hindi': ([word('नमस्ते')], [word('नमस्ते')], True),
    'canonical_accent': ([word('café')], [word('cafe\u0301')], True),
    'distinct_accent': ([word('café')], [word('cafe')], False),
    'fullwidth_digits': ([word('42')], [word('４２')], True),
    'hindi_vowel_difference': ([word('कि')], [word('कु')], False),
    'exact_quarter_boundary': ([word('hi', .3, .4)], [word('hi', .55, .65)], True),
    'beyond_quarter_start': ([word()], [word(start=1.250001)], False),
    'beyond_quarter_end': ([word()], [word(end=1.450001)], False),
    'inverted_equal': ([word(start=2, end=1)], [word(start=2, end=1)], False),
    'zero_length_equal': ([word(start=1, end=1)], [word(start=1, end=1)], False),
    'overlap_second': ([word('one', 1, 1.2), word('two', 1.2, 1.4)],
                       [word('one', 1, 1.3), word('two', 1.2, 1.4)], False),
    'nan': ([word(start=math.nan)], [word(start=math.nan)], False),
    'infinite': ([word(end=math.inf)], [word(end=math.inf)], False),
    'missing_start': ([{'word': 'hello', 'end': 1}], [word()], False),
    'missing_word': ([{'start': 1, 'end': 1.2}], [word()], False),
    'nonnumeric': ([word(start='bad')], [word()], False),
    'empty_both': ([], [], False),
    'empty_first': ([], [word()], False),
    'empty_second': ([word()], [], False),
}


def _agreement_case(first, second, expected):
    def test(self):
        context = scenario_context()
        before_first, before_second = copy.deepcopy(first), copy.deepcopy(second)
        self.assertEqual(context['caption_word_passes_agree'](first, second), expected)
        self.assertEqual(first, before_first)
        self.assertEqual(second, before_second)
    return test


for _name, (_first, _second, _expected) in _agreement_cases.items():
    setattr(LocalScenarioTest, 'test_agreement_' + _name, _agreement_case(_first, _second, _expected))


_confidence_cases = {
    'opening_strict_speech_limit': (1, False, .85, 0, True),
    'opening_strict_above_speech_limit': (1, False, .850001, 0, False),
    'late_strict_speech_limit': (30, False, .60, 0, True),
    'late_strict_above_speech_limit': (30, False, .600001, 0, False),
    'opening_lenient_speech_limit': (1, True, .95, 0, True),
    'opening_lenient_above_speech_limit': (1, True, .950001, 0, False),
    'late_lenient_speech_limit': (30, True, .85, 0, True),
    'late_lenient_above_speech_limit': (30, True, .850001, 0, False),
    'opening_strict_logprob_limit': (1, False, 0, -1.5, True),
    'opening_strict_below_logprob_limit': (1, False, 0, -1.500001, False),
    'late_strict_logprob_limit': (30, False, 0, -1, True),
    'late_strict_below_logprob_limit': (30, False, 0, -1.000001, False),
    'opening_lenient_logprob_limit': (1, True, 0, -2, True),
    'opening_lenient_below_logprob_limit': (1, True, 0, -2.000001, False),
    'late_lenient_logprob_limit': (30, True, 0, -1.6, True),
    'late_lenient_below_logprob_limit': (30, True, 0, -1.600001, False),
    'just_before_opening_boundary': (19.999, False, .8, -1.4, True),
    'at_opening_boundary': (20, False, .8, -1.4, False),
}


def _confidence_case(start, lenient, speech_probability, logprob, expected):
    def test(self):
        segment = self.decoder_segment(start=start, end=start + .2,
                                       no_speech=speech_probability, logprob=logprob)
        context, model, _ = self.decoder_context([segment])
        result = context['run_whisper_with_model'](model, 'fixture', 'en', lenient=lenient)
        self.assertEqual(bool(result[3]), expected)
        if expected:
            self.assertEqual(result[3][0]['start'], start)
            self.assertEqual(result[0], 'hello')
        else:
            self.assertEqual(result, ('', 'en', [], []))
    return test


for _name, _arguments in _confidence_cases.items():
    setattr(LocalScenarioTest, 'test_decoder_' + _name, _confidence_case(*_arguments))


def _stress_case(index):
    def test(self):
        rng = random.Random(18473 + index)
        family = index % 6
        count = rng.randint(2, 12)
        words = [word(('yes' if i % 3 == 0 else 'word' + str(i)), i * .5 + 1, i * .5 + 1.2)
                 for i in range(count)]
        context = scenario_context()
        if family == 0:
            candidate = [dict(w, word=w['word'].upper() + ',') for w in words]
            self.assertTrue(context['caption_word_passes_agree'](words, candidate))
            self.assertTrue(context['caption_preserves_word_sequence'](words, candidate))
        elif family == 1:
            candidate = copy.deepcopy(words)
            at = rng.randrange(count)
            candidate[at]['start'] += .251
            candidate[at]['end'] += .251
            self.assertFalse(context['caption_word_passes_agree'](words, candidate))
        elif family == 2:
            gap_end = count * .5 + 3
            recovered = [dict(w, start=w['start'] + 1, end=w['end'] + 1) for w in words]
            original = transcript([word('Before', 0, 1), word('After', gap_end, gap_end + 1)])
            decoder = ScriptedDecoder(transcript(recovered), transcript(recovered))
            context = scenario_context(decoder, duration=gap_end + 1)
            snapshot = copy.deepcopy(original)
            result = context['repair_remaining_audio_gaps'](None, 'fixture', 'en', original)
            self.assertEqual(result[3], original[3][:1] + recovered + original[3][1:])
            self.assertEqual(original, snapshot)
            self.assertTrue(context['valid_caption_word_timeline'](result[3], gap_end + 1))
            self.assertEqual(len(decoder.calls), 2)
        elif family == 3:
            gap_end = count * .5 + 3
            recovered = [dict(w, start=w['start'] + 1, end=w['end'] + 1) for w in words]
            second = copy.deepcopy(recovered)
            second[rng.randrange(count)]['word'] = 'changed'
            original = transcript([word('Before', 0, 1), word('After', gap_end, gap_end + 1)])
            decoder = ScriptedDecoder(transcript(recovered), transcript(second))
            context = scenario_context(decoder, duration=gap_end + 1)
            self.invoke_unchanged(context, 'repair_remaining_audio_gaps', original)
            self.assertTrue(context['recovery_warnings'])
            self.assertEqual(len(decoder.calls), 2)
        elif family == 4:
            original = [word('color', 1, 1.2), word('color', 1.5, 1.7)]
            candidate = [word('colour,', 1.1, 1.3), word('and', 1.35, 1.4), word('colour.', 1.6, 1.8)]
            snapshot = copy.deepcopy(candidate)
            result = context['caption_restore_original_orthography'](original, candidate)
            self.assertEqual([w['word'] for w in result], ['color,', 'and', 'color.'])
            self.assertEqual(candidate, snapshot)
            self.assertTrue(context['caption_preserves_word_sequence'](original, result))
        else:
            location = rng.randint(15, 70)
            original = [word('Before', location - 12, location - 11.5),
                        word('stretched', location, location + 2),
                        word('After', location + 12, location + 12.5)]
            ranges = context['suspicious_caption_audio_ranges'](original, location + 20)
            self.assertEqual(len(ranges), 1)
            left, right = ranges[0]
            self.assertGreaterEqual(left, 0)
            self.assertLessEqual(left, location)
            self.assertGreaterEqual(right, location + 2)
            self.assertLessEqual(right, location + 20)
            self.assertLessEqual(right - left, 24)
            self.assertLess(original[0]['end'], left)
            self.assertGreater(original[-1]['start'], right)
    return test


for _index in range(120):
    setattr(LocalScenarioTest, 'test_stress_' + str(_index).zfill(3), _stress_case(_index))


if __name__ == '__main__':
    unittest.main()

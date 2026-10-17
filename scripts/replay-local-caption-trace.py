"""Record real Local timing-repair reads without changing decoder results."""

import argparse
import ast
import json
import os
import runpy
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--worker', required=True)
    parser.add_argument('--audio', required=True)
    parser.add_argument('--trace', required=True)
    parser.add_argument('--language', default='auto')
    parser.add_argument('--primary-chunk-length', type=int, choices=(10, 20, 24))
    args = parser.parse_args()
    worker = str(Path(args.worker).resolve())
    audio = str(Path(args.audio).resolve())
    trace_path = Path(args.trace).resolve()
    if not Path(worker).is_file() or not Path(audio).is_file():
        parser.error('Provide an existing worker and WAV file.')
    trace_path.parent.mkdir(parents=True, exist_ok=True)
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    document = {'worker': worker, 'audio': audio,
                'primaryChunkLength': args.primary_chunk_length, 'calls': []}
    active = {}
    names = {'run_whisper_with_model', 'read_caption_audio_range',
             'repair_primary_caption_timing', 'retry_primary_caption_transcript'}

    def save():
        with trace_path.open('w', encoding='utf-8') as target:
            json.dump(document, target, indent=2, ensure_ascii=True)
            target.write('\n')

    def observe(frame, event, value):
        if frame.f_code.co_filename != worker or frame.f_code.co_name not in names:
            return
        key = id(frame)
        if event == 'call':
            record = {'function': frame.f_code.co_name,
                      'arguments': {name: frame.f_locals[name]
                                    for name in ('audio_path', 'lang', 'start', 'end', 'lenient',
                                                 'chunk_length', 'ranges')
                                    if name in frame.f_locals}}
            if frame.f_code.co_name in {'repair_primary_caption_timing', 'retry_primary_caption_transcript'}:
                record['original'] = frame.f_locals.get('current')
            document['calls'].append(record)
            active[key] = record
            document['warnings'] = frame.f_globals.get('recovery_warnings', [])
        elif event == 'return' and key in active:
            active.pop(key)['result'] = value
            save()

    previous_argv = sys.argv
    previous_profile = sys.getprofile()
    code = 0
    sys.argv = [worker, audio, args.language, 'local-trace', 'speech', '', 'recover']
    try:
        save()
        sys.setprofile(observe)
        if args.primary_chunk_length is None:
            result = runpy.run_path(worker, run_name='__main__')
        else:
            # Change decoding context only; never rewrite recognized words or times.
            tree = ast.parse(Path(worker).read_text(encoding='utf-8'), filename=worker)
            matches = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                       and node.name == 'run_whisper_with_model']
            if len(matches) != 1:
                raise ValueError('The worker decoding function is ambiguous.')
            function = matches[0]
            names_with_defaults = [arg.arg for arg in function.args.args[-len(function.args.defaults):]]
            position = names_with_defaults.index('chunk_length')
            function.args.defaults[position] = ast.copy_location(
                ast.Constant(args.primary_chunk_length), function.args.defaults[position])
            result = {'__name__': '__main__', '__file__': worker}
            exec(compile(ast.fix_missing_locations(tree), worker, 'exec'), result)
        document['result'] = {name: result.get(name) for name in ('text', 'lang', 'segs', 'words')}
    except SystemExit as error:
        code = error.code if isinstance(error.code, int) else 1
    finally:
        sys.setprofile(previous_profile)
        sys.argv = previous_argv
        document['exitCode'] = code
        save()
        print('Local timing trace: ' + str(trace_path), flush=True)
    return code


if __name__ == '__main__':
    sys.exit(main())

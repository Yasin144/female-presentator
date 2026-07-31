"""
Slower Rhythmic Nursery Rhyme Generator with Automatic Instrumental BGM
- Generates each lyric line at a comfortable, relaxed speed (-20% rate, 82 BPM)
- Automatic instrumental background music (no_vocals.wav - no interfering reference singer)
- HD mastering (48kHz, 320kbps, -14 LUFS, presence & air EQ)
"""

import asyncio
import edge_tts
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

# ── Config ──────────────────────────────────────────────────────────────────
ROOT       = Path(__file__).resolve().parent
BGM_PATH   = ROOT / 'generated-media' / 'rhyme-reference-stems' / 'htdemucs' / 'little-jack-horner-reference-30s' / 'no_vocals.wav'
OUT_PATH   = ROOT / 'temp' / 'hickory-slow-bgm-hd.mp3'
FFMPEG     = 'ffmpeg'

VOICE      = 'en-GB-MaisieNeural'
RATE       = '-20%'       # Slower, gentle nursery rhyme pace
PITCH      = '+10Hz'      # Sweet young girl voice

BPM        = 82           # Slower, relaxed nursery rhyme tempo
BEAT       = 60 / BPM     # seconds per beat
TOTAL_DUR  = 30           # total song seconds

LINES = [
    ("Hickory dickory dock",        4),
    ("The mouse ran up the clock",  4),
    ("The clock struck one",        3),
    ("The mouse ran down",          3),
    ("Hickory dickory dock",        4),
    ("",                            2),
    ("Hickory dickory dock",        4),
    ("The mouse ran up the clock",  4),
    ("The clock struck one",        3),
    ("The mouse ran down",          3),
    ("Hickory dickory dock",        4),
]

BGM_LEVEL  = 0.30   # Automatic background music level (30%)
VOCAL_VOL  = 1.25   # Vocal level

def run_ff(args, label):
    r = subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error'] + args)
    if r.returncode != 0:
        raise RuntimeError(f'FFmpeg failed at: {label}')

async def synth_line(text: str, out_wav: Path):
    communicate = edge_tts.Communicate(text, VOICE, rate=RATE, pitch=PITCH)
    await communicate.save(str(out_wav))

def get_duration(wav: Path) -> float:
    r = subprocess.run(
        [FFMPEG, '-hide_banner', '-i', str(wav), '-f', 'null', '-'],
        capture_output=True, text=True
    )
    for line in r.stderr.splitlines():
        if 'Duration' in line:
            t = line.split('Duration:')[1].split(',')[0].strip()
            h, m, s = t.split(':')
            return int(h)*3600 + int(m)*60 + float(s)
    return 0.0

def pad_to_duration(src: Path, dst: Path, target_sec: float):
    current = get_duration(src)
    pad = max(0, target_sec - current)
    run_ff([
        '-y', '-i', str(src),
        '-af', f'apad=pad_dur={pad:.3f}',
        '-t', f'{target_sec:.3f}',
        '-ar', '48000', '-ac', '1',
        str(dst)
    ], f'pad {src.name}')

async def main():
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix='rhyme-slow-') as tmp:
        tmp = Path(tmp)
        padded_files = []

        for idx, (text, beats) in enumerate(LINES):
            target_sec = beats * BEAT
            padded_wav = tmp / f'line_{idx:02d}_padded.wav'

            if not text.strip():
                run_ff([
                    '-y', '-f', 'lavfi', '-i', f'anullsrc=r=48000:cl=mono',
                    '-t', f'{target_sec:.3f}',
                    str(padded_wav)
                ], f'silence line {idx}')
                padded_files.append(padded_wav)
                continue

            raw_wav = tmp / f'line_{idx:02d}_raw.wav'
            await synth_line(text, raw_wav)

            dur = get_duration(raw_wav)
            if dur > target_sec:
                ratio = min(1.15, dur / target_sec)
                stretched = tmp / f'line_{idx:02d}_str.wav'
                run_ff([
                    '-y', '-i', str(raw_wav),
                    '-af', f'atempo={ratio:.3f}',
                    '-ar', '48000', '-ac', '1',
                    str(stretched)
                ], f'stretch line {idx}')
                raw_wav = stretched

            pad_to_duration(raw_wav, padded_wav, target_sec)
            padded_files.append(padded_wav)

        concat_list = tmp / 'concat.txt'
        with open(concat_list, 'w', encoding='utf-8') as f:
            for p in padded_files:
                f.write(f"file '{p}'\n")

        vocal_raw = tmp / 'vocal_concat.wav'
        run_ff([
            '-y', '-f', 'concat', '-safe', '0', '-i', str(concat_list),
            '-ar', '48000', '-ac', '1',
            str(vocal_raw)
        ], 'concatenate vocal lines')

        vocal_stereo = tmp / 'vocal_stereo.wav'
        hd_vocal_eq = (
            'highpass=f=85,'
            'equalizer=f=280:t=q:w=1.2:g=-3.5,'
            'equalizer=f=3500:t=h:w=1.0:g=5.0,'
            'equalizer=f=10500:t=h:w=1.0:g=3.5,'
            'acompressor=threshold=-18dB:ratio=2.8:attack=10:release=100,'
            f'volume={VOCAL_VOL}'
        )
        run_ff([
            '-y', '-i', str(vocal_raw),
            '-af', hd_vocal_eq,
            '-ar', '48000', '-ac', '2',
            str(vocal_stereo)
        ], 'apply HD vocal EQ')

        # Mix with automatic instrumental BGM
        complex_filter = (
            f'[0:a]volume=1.0[v];'
            f'[1:a]volume={BGM_LEVEL},equalizer=f=3000:t=q:w=1:g=-2.5[b];'
            f'[v][b]amix=inputs=2:duration=first:dropout_transition=0.5,'
            f'atrim=0:{TOTAL_DUR},'
            f'afade=t=in:st=0:d=0.5,'
            f'afade=t=out:st={TOTAL_DUR-1.5}:d=1.5,'
            f'loudnorm=I=-14:TP=-1.0:LRA=7[out]'
        )

        final_mp3 = str(OUT_PATH)
        run_ff([
            '-y',
            '-i', str(vocal_stereo),
            '-i', str(BGM_PATH),
            '-filter_complex', complex_filter,
            '-map', '[out]',
            '-ar', '48000', '-c:a', 'libmp3lame', '-b:a', '320k', '-q:a', '0',
            final_mp3
        ], 'final HD mix with automatic instrumental BGM')

        print(f'✅ Done: {final_mp3}')

if __name__ == '__main__':
    asyncio.run(main())

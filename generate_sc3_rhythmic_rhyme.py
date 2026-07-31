"""
Rhythmic Rhyme Generator using SC3 Voice Only
- Uses sc3 voice clone model via sc3-singing-server (port 8431)
- Varied pronunciation rhythm per line (4-beat, 3-beat, 2-beat varied cadence)
- Automatic clean instrumental BGM mix
- HD Audio Mastering (48kHz, 320kbps, -14 LUFS, air & presence EQ)
- Does NOT alter or disturb the main sing song engine
"""

import asyncio
import base64
import edge_tts
import json
import os
import subprocess
import urllib.request
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BGM_PATH = ROOT / 'generated-media' / 'rhyme-reference-stems' / 'htdemucs' / 'little-jack-horner-reference-30s' / 'no_vocals.wav'
OUT_PATH = ROOT / 'temp' / 'hickory-sc3-rhythmic-hd.mp3'
FFMPEG = 'ffmpeg'

# Varied rhythm pattern for the rhyme lines: (text, beats, rate_modifier, pitch_mod)
# Varying rate and beats per phrase creates natural pronunciation rhythm variation
RHYTHM_LINES = [
    ("Hickory dickory dock,",       4, "-18%", "+5Hz"),
    ("The mouse ran up the clock!", 4, "-12%", "+8Hz"),
    ("The clock struck one,",       3, "-22%", "+0Hz"),
    ("The mouse ran down...",       3, "-15%", "-4Hz"),
    ("Hickory dickory dock!",       4, "-18%", "+3Hz"),
    ("",                            2, "-0%",  "+0Hz"), # rhythmic pause
    ("Hickory dickory dock,",       4, "-18%", "+5Hz"),
    ("The mouse ran up the clock!", 4, "-10%", "+10Hz"),
    ("The clock struck one,",       3, "-24%", "+0Hz"),
    ("The mouse ran down...",       3, "-15%", "-4Hz"),
    ("Hickory dickory dock!",       4, "-20%", "+0Hz"),
]

BPM = 84
BEAT = 60 / BPM
TOTAL_DUR = 30

def run_ff(args, label):
    r = subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error'] + args)
    if r.returncode != 0:
        raise RuntimeError(f'FFmpeg failed at: {label}')

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

async def synth_guide_line(text: str, rate: str, pitch: str, out_wav: Path):
    communicate = edge_tts.Communicate(text, 'en-GB-MaisieNeural', rate=rate, pitch=pitch)
    await communicate.save(str(out_wav))

def convert_to_sc3_voice(input_wav: Path, output_wav: Path):
    """Convert guide vocal line to sc3 reference voice via sc3-singing-server (port 8431)."""
    with open(input_wav, 'rb') as f:
        audio_b64 = base64.b64encode(f.read()).decode('ascii')

    payload = {
        'songBase64': audio_b64,
        'voice': 'sc3',
        'saveToDownloads': False
    }

    body = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(
        'http://127.0.0.1:8431/api/convert-song',
        data=body,
        headers={'Content-Type': 'application/json'}
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        res = json.loads(resp.read())

    if not res.get('ok') or not res.get('audioBase64'):
        raise RuntimeError(f"sc3 voice conversion failed: {res.get('error')}")

    out_bytes = base64.b64decode(res['audioBase64'])
    with open(output_wav, 'wb') as f:
        f.write(out_bytes)

async def main():
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix='sc3-rhythm-') as tmp:
        tmp = Path(tmp)
        padded_files = []

        for idx, (text, beats, rate_mod, pitch_mod) in enumerate(RHYTHM_LINES):
            target_sec = beats * BEAT
            padded_wav = tmp / f'line_{idx:02d}_padded.wav'

            if not text.strip():
                run_ff([
                    '-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono',
                    '-t', f'{target_sec:.3f}',
                    str(padded_wav)
                ], f'silence line {idx}')
                padded_files.append(padded_wav)
                continue

            guide_wav = tmp / f'line_{idx:02d}_guide.wav'
            sc3_line_wav = tmp / f'line_{idx:02d}_sc3.wav'

            await synth_guide_line(text, rate_mod, pitch_mod, guide_wav)
            
            # Convert to sc3 voice clone
            convert_to_sc3_voice(guide_wav, sc3_line_wav)

            dur = get_duration(sc3_line_wav)
            if dur > target_sec:
                ratio = min(1.15, dur / target_sec)
                stretched = tmp / f'line_{idx:02d}_str.wav'
                run_ff([
                    '-y', '-i', str(sc3_line_wav),
                    '-af', f'atempo={ratio:.3f}',
                    '-ar', '48000', '-ac', '1',
                    str(stretched)
                ], f'stretch line {idx}')
                sc3_line_wav = stretched

            cur_dur = get_duration(sc3_line_wav)
            pad = max(0, target_sec - cur_dur)
            run_ff([
                '-y', '-i', str(sc3_line_wav),
                '-af', f'apad=pad_dur={pad:.3f}',
                '-t', f'{target_sec:.3f}',
                '-ar', '48000', '-ac', '1',
                str(padded_wav)
            ], f'pad line {idx}')
            padded_files.append(padded_wav)

        # Concatenate all sc3 voice lines into one rhythmic track
        concat_list = tmp / 'concat.txt'
        with open(concat_list, 'w', encoding='utf-8') as f:
            for p in padded_files:
                f.write(f"file '{p}'\n")

        vocal_raw = tmp / 'vocal_sc3_concat.wav'
        run_ff([
            '-y', '-f', 'concat', '-safe', '0', '-i', str(concat_list),
            '-ar', '48000', '-ac', '1',
            str(vocal_raw)
        ], 'concatenate sc3 vocal lines')

        vocal_stereo = tmp / 'vocal_sc3_stereo.wav'
        hd_vocal_eq = (
            'highpass=f=85,'
            'equalizer=f=280:t=q:w=1.2:g=-3.5,'
            'equalizer=f=3500:t=h:w=1.0:g=5.0,'
            'equalizer=f=10500:t=h:w=1.0:g=3.5,'
            'acompressor=threshold=-18dB:ratio=2.8:attack=10:release=100,'
            'volume=1.3'
        )
        run_ff([
            '-y', '-i', str(vocal_raw),
            '-af', hd_vocal_eq,
            '-ar', '48000', '-ac', '2',
            str(vocal_stereo)
        ], 'apply HD vocal EQ')

        # Mix sc3 rhythmic vocal with clean instrumental BGM
        complex_filter = (
            f'[0:a]volume=1.0[v];'
            f'[1:a]volume=0.28,equalizer=f=3000:t=q:w=1:g=-2.5[b];'
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
        ], 'final sc3 HD mix with automatic BGM')

        print(f'✅ Done: {final_mp3}')

if __name__ == '__main__':
    asyncio.run(main())

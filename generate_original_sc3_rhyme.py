"""
Original SC3 Voice Rhyme Generator
- Uses original SC3 reference voice (voice-reference-sc3.wav)
- Relaxed, slower nursery rhyme rhythm (0.88x speed / atempo=0.88)
- Automatic instrumental nursery BGM mix
- HD audio mastering (48kHz, 320kbps, -14 LUFS, presence & air EQ)
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
REF_VOICE = ROOT / 'voice-reference-sc3.wav'
OUT_PATH = ROOT / 'temp' / 'hickory-original-sc3-slow-bgm.mp3'
FFMPEG = 'ffmpeg'

LYRICS = (
    "Hickory dickory dock. "
    "The mouse ran up the clock. "
    "The clock struck one, the mouse ran down. "
    "Hickory dickory dock! "
    "Hickory dickory dock. "
    "The mouse ran up the clock. "
    "The clock struck one, the mouse ran down. "
    "Hickory dickory dock!"
)

TOTAL_DUR = 30

def run_ff(args, label):
    r = subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error'] + args)
    if r.returncode != 0:
        raise RuntimeError(f'FFmpeg failed at: {label}')

async def synth_guide_vocal(out_wav: Path):
    # Guide synthesis at relaxed pace
    communicate = edge_tts.Communicate(LYRICS, 'en-GB-MaisieNeural', rate='-18%', pitch='+5Hz')
    await communicate.save(str(out_wav))

def convert_to_original_sc3(input_wav: Path, output_wav: Path):
    """Convert via sc3-singing-server using original SC3 voice model."""
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
        raise RuntimeError(f"Original SC3 conversion failed: {res.get('error')}")

    out_bytes = base64.b64decode(res['audioBase64'])
    with open(output_wav, 'wb') as f:
        f.write(out_bytes)

async def main():
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix='orig-sc3-') as tmp:
        tmp = Path(tmp)
        guide_wav = tmp / 'guide.wav'
        sc3_converted = tmp / 'sc3_converted.wav'
        sc3_slowed = tmp / 'sc3_slowed.wav'

        print("1. Synthesising guide vocal...")
        await synth_guide_vocal(guide_wav)

        print("2. Converting to Original SC3 Voice...")
        convert_to_sc3_voice_ok = False
        try:
            convert_to_original_sc3(guide_wav, sc3_converted)
            convert_to_sc3_voice_ok = True
        except Exception as e:
            print(f"Server conversion fallback: {e}")
            sc3_converted = guide_wav

        # Slow down vocal for relaxed nursery rhyme rhythm (0.88x speed)
        print("3. Applying relaxed slower nursery rhythm (0.88x speed)...")
        run_ff([
            '-y', '-i', str(sc3_converted),
            '-af', 'atempo=0.88,highpass=f=85,equalizer=f=280:t=q:w=1.2:g=-3.0,equalizer=f=3500:t=h:w=1.0:g=4.5,equalizer=f=10500:t=h:w=1.0:g=3.5,acompressor=threshold=-18dB:ratio=2.5:attack=10:release=100,volume=1.35',
            '-ar', '48000', '-ac', '2',
            str(sc3_slowed)
        ], 'slow down and HD EQ vocal')

        # Mix Original SC3 vocal with instrumental BGM
        print("4. Mixing with instrumental BGM & HD mastering...")
        complex_filter = (
            f'[0:a]volume=1.0[v];'
            f'[1:a]volume=0.30,equalizer=f=3000:t=q:w=1:g=-3.0[b];'
            f'[v][b]amix=inputs=2:duration=first:dropout_transition=0.5,'
            f'atrim=0:{TOTAL_DUR},'
            f'afade=t=in:st=0:d=0.4,'
            f'afade=t=out:st={TOTAL_DUR-1.5}:d=1.5,'
            f'loudnorm=I=-14:TP=-1.0:LRA=7[out]'
        )

        final_mp3 = str(OUT_PATH)
        run_ff([
            '-y',
            '-i', str(sc3_slowed),
            '-i', str(BGM_PATH),
            '-filter_complex', complex_filter,
            '-map', '[out]',
            '-ar', '48000', '-c:a', 'libmp3lame', '-b:a', '320k', '-q:a', '0',
            final_mp3
        ], 'final mix')

        print(f'✅ Done: {final_mp3}')

if __name__ == '__main__':
    asyncio.run(main())

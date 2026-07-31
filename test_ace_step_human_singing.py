"""
Generate Authentic Realistic Human Female Nursery Rhyme using ACE-Step AI Engine
- Uses ACE-Step 1.5 AI music & singing model
- Authentic human female singer vocal with natural vibrato, breath control, & phrasing
- Relaxed nursery rhyme tempo (84 BPM) with full stereo instrumental BGM
"""

import os
import sys
import json
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(r'D:\voice')
MODEL_DIR = ROOT / 'AI_Models' / 'sc3-singing'
ACE_DIR = MODEL_DIR / 'acestep.vst3'
RELEASE_DIR = ACE_DIR / 'build' / 'Release'

ACE_LM = RELEASE_DIR / 'ace-lm.exe'
ACE_SYNTH = RELEASE_DIR / 'ace-synth.exe'

LM_MODEL = ACE_DIR / 'models' / 'acestep-5Hz-lm-0.6B-Q8_0.gguf'
EMBEDDING = ACE_DIR / 'models' / 'Qwen3-Embedding-0.6B-Q8_0.gguf'
DIT_MODEL = ACE_DIR / 'models' / 'acestep-v15-turbo-Q8_0.gguf'
VAE_MODEL = ACE_DIR / 'models' / 'vae-BF16.gguf'

REFERENCE_30S = ROOT / 'generated-media' / 'rhyme-reference' / 'little-jack-horner-reference-30s.wav'
OUT_MP3 = ROOT / 'temp' / 'hickory-human-female-singing.mp3'

LYRICS = "[Verse]\nHickory dickory dock\nThe mouse ran up the clock\nThe clock struck one\nThe mouse ran down\nHickory dickory dock"

CAPTION = (
    "hd crystal-clear voice, studio-mastered vocal, ultra-clean high-fidelity 48kHz audio, "
    "premium preschool nursery rhyme, naturally expressive young female singer, warm realistic human vocal, "
    "joyful child-friendly performance, crystal-clear English pronunciation, memorable playful melody, "
    "soft piano, glockenspiel, ukulele and gentle drums, wide clean stereo instrumental, polished commercial children song"
)

def run(cmd, label):
    print(f"[ACE-Step] {label}...")
    r = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True)
    if r.returncode != 0:
        print(f"Error output: {r.stderr[-1000:]}")
        raise RuntimeError(f"{label} failed with exit code {r.returncode}")
    return r.stdout

def main():
    OUT_MP3.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix='ace-human-') as tmp:
        tmp_dir = Path(tmp)
        req_json = tmp_dir / 'rhyme.json'
        req0_json = tmp_dir / 'rhyme0.json'
        out_wav = tmp_dir / 'rhyme00.wav'

        payload = {
            "caption": CAPTION,
            "lyrics": LYRICS,
            "duration": 30,
            "bpm": 84,
            "keyscale": "C major",
            "timesignature": "4",
            "vocal_language": "en",
            "batch_size": 1,
            "seed": 42,
            "use_cot_caption": False,
            "inference_steps": 8,
            "guidance_scale": 0.0,
            "shift": 3.0,
            "audio_cover_strength": 0.25
        }

        req_json.write_text(json.dumps(payload, indent=2), encoding='utf-8')

        # Step 1: Run Language Model to plan melody & lyrics alignment
        run([
            str(ACE_LM),
            '--request', str(req_json),
            '--lm', str(LM_MODEL),
            '--max-seq', '4096',
            '--no-fa'
        ], "Composing human lyric & melody plan")

        if not req0_json.exists():
            raise RuntimeError("ACE-LM did not generate rhyme0.json request")

        # Step 2: Run DiT Synthesizer to render human vocal + instrumental audio
        synth_args = [
            str(ACE_SYNTH),
            '--request', str(req0_json),
            '--embedding', str(EMBEDDING),
            '--dit', str(DIT_MODEL),
            '--vae', str(VAE_MODEL),
            '--src-audio', str(REFERENCE_30S),
            '--wav',
            '--no-fa',
            '--vae-chunk', '128',
            '--vae-overlap', '32'
        ]

        run(synth_args, "Rendering human female singing audio")

        if not out_wav.exists():
            raise RuntimeError("ACE-Synth did not generate output WAV")

        # Step 3: HD Mastering & loudness normalization
        master_filter = (
            'highpass=f=85,'
            'equalizer=f=280:t=q:w=1.2:g=-3.0,'
            'equalizer=f=3500:t=h:w=1.0:g=4.5,'
            'equalizer=f=10500:t=h:w=1.0:g=3.5,'
            'acompressor=threshold=-18dB:ratio=2.5:attack=10:release=100,'
            'loudnorm=I=-14:TP=-1.0:LRA=7'
        )

        run([
            'ffmpeg', '-y',
            '-i', str(out_wav),
            '-af', master_filter,
            '-ar', '48000', '-c:a', 'libmp3lame', '-b:a', '320k', '-q:a', '0',
            str(OUT_MP3)
        ], "Mastering 48kHz 320kbps HD MP3")

        print(f"✅ Success! Generated authentic human female singing song: {OUT_MP3}")

if __name__ == '__main__':
    main()

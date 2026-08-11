"""
High-Quality Singing Nursery Rhyme Generator
- Uses SSML prosody markup for note-by-note melodic pitch variation
- Each word gets its own musical pitch like a real singer
- Crystal-clear young female voice (en-US-AriaNeural)
- Maximum HD mastering: 48kHz, 320kbps, -14 LUFS
"""

import asyncio
import edge_tts
import os
import subprocess
import tempfile
from pathlib import Path

ROOT     = Path(__file__).resolve().parent
OUT_PATH = ROOT / 'temp' / 'hickory-singing-hq.mp3'
FFMPEG   = 'ffmpeg'

# Best sweet young US female voice — most musical / expressive
VOICE    = 'en-US-AriaNeural'

TOTAL_DUR = 30  # seconds

# ── SSML with per-word melodic pitch variation ────────────────────────────────
# Hickory Dickory Dock melody uses a simple 3-note descending pattern
# Pitch in semitones relative to baseline: +5st = high, 0st = mid, -4st = low
SSML = """<speak>
  <prosody rate="-18%" volume="+10%">

    <prosody pitch="+6st">Hickory</prosody><prosody pitch="+4st"> dickory</prosody><prosody pitch="-2st"> dock,</prosody>
    <break time="550ms"/>
    <prosody pitch="+3st">The mouse ran</prosody> <prosody pitch="+6st">up</prosody> <prosody pitch="+1st">the</prosody> <prosody pitch="-3st">clock,</prosody>
    <break time="550ms"/>
    <prosody pitch="+2st">The clock</prosody> <prosody pitch="+5st">struck</prosody> <prosody pitch="-2st">one,</prosody>
    <break time="450ms"/>
    <prosody pitch="+1st">The mouse ran</prosody> <prosody pitch="-4st">down,</prosody>
    <break time="450ms"/>
    <prosody pitch="+6st">Hickory</prosody><prosody pitch="+4st"> dickory</prosody><prosody pitch="-6st"> dock.</prosody>
    <break time="800ms"/>

    <prosody pitch="+6st">Hickory</prosody><prosody pitch="+4st"> dickory</prosody><prosody pitch="-2st"> dock,</prosody>
    <break time="550ms"/>
    <prosody pitch="+3st">The mouse ran</prosody> <prosody pitch="+6st">up</prosody> <prosody pitch="+1st">the</prosody> <prosody pitch="-3st">clock,</prosody>
    <break time="550ms"/>
    <prosody pitch="+2st">The clock</prosody> <prosody pitch="+5st">struck</prosody> <prosody pitch="-2st">one,</prosody>
    <break time="450ms"/>
    <prosody pitch="+1st">The mouse ran</prosody> <prosody pitch="-4st">down,</prosody>
    <break time="450ms"/>
    <prosody pitch="+6st">Hickory</prosody><prosody pitch="+4st"> dickory</prosody><prosody pitch="-6st"> dock.</prosody>

  </prosody>
</speak>"""


def run_ff(args, label):
    r = subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error'] + args)
    if r.returncode != 0:
        raise RuntimeError(f'FFmpeg failed: {label}')


async def main():
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix='rhyme-hq-') as tmp:
        tmp = Path(tmp)
        raw_wav = tmp / 'singing_raw.wav'
        eq_wav  = tmp / 'singing_eq.wav'

        print('🎤 Synthesising with melodic SSML pitch variation...')
        communicate = edge_tts.Communicate(SSML, VOICE)
        await communicate.save(str(raw_wav))
        print(f'   Raw WAV: {os.path.getsize(raw_wav)//1024} KB')

        # HD vocal EQ: remove mud, boost presence + air, compress, loudnorm
        hd_filter = (
            'highpass=f=85,'
            'equalizer=f=280:t=q:w=1.2:g=-4.0,'     # cut boxiness
            'equalizer=f=1200:t=q:w=1.0:g=2.5,'      # boost warmth/body
            'equalizer=f=3500:t=h:w=1.0:g=5.5,'      # presence / consonants
            'equalizer=f=10500:t=h:w=1.0:g=4.0,'     # HD air sparkle
            'acompressor=threshold=-18dB:ratio=2.5:attack=8:release=80,'
            f'atrim=0:{TOTAL_DUR},'
            'afade=t=in:st=0:d=0.4,'
            f'afade=t=out:st={TOTAL_DUR-1.2}:d=1.2,'
            'loudnorm=I=-14:TP=-1.0:LRA=7'
        )

        print('🔊 Applying HD mastering chain...')
        run_ff([
            '-y', '-i', str(raw_wav),
            '-af', hd_filter,
            '-ar', '48000', '-ac', '2',
            '-c:a', 'libmp3lame', '-b:a', '320k', '-q:a', '0',
            str(OUT_PATH)
        ], 'HD master')

        print(f'\n✅ Done: {OUT_PATH}')
        print(f'   Size: {os.path.getsize(OUT_PATH)//1024} KB')


if __name__ == '__main__':
    asyncio.run(main())

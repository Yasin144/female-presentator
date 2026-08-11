import urllib.request
import json
import os
import subprocess
from pathlib import Path

LINES = [
    ('Hickory dickory dock',        4),
    ('The mouse ran up the clock',  4),
    ('The clock struck one',        3),
    ('The mouse ran down',          3),
    ('Hickory dickory dock',        4),
    ('',                            2),
    ('Hickory dickory dock',        4),
    ('The mouse ran up the clock',  4),
    ('The clock struck one',        3),
    ('The mouse ran down',          3),
    ('Hickory dickory dock',        4),
]

BPM  = 96
BEAT = 60 / BPM

def get_dur(wav):
    r = subprocess.run(['ffmpeg', '-hide_banner', '-i', wav, '-f', 'null', '-'], capture_output=True, text=True)
    for l in r.stderr.splitlines():
        if 'Duration' in l:
            t = l.split('Duration:')[1].split(',')[0].strip()
            h, m, s = t.split(':')
            return int(h)*3600 + int(m)*60 + float(s)
    return 0.0

parts = []
for idx, (text, beats) in enumerate(LINES):
    target = beats * BEAT
    out_wav = f'D:/voice/temp/cb_line_{idx:02d}.wav'
    pad_wav = f'D:/voice/temp/cb_pad_{idx:02d}.wav'

    if not text.strip():
        subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
            '-f', 'lavfi', '-i', f'anullsrc=r=24000:cl=mono',
            '-t', f'{target:.3f}', out_wav])
        parts.append(out_wav)
        print(f'[{idx+1:02d}] <silence> {target:.2f}s')
        continue

    payload = {'text': text, 'exaggeration': 0.30, 'cfg_weight': 0.55, 'temperature': 0.65}
    req = urllib.request.Request('http://127.0.0.1:8426/api/narrate',
        data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=90) as r:
        raw = r.read()
    with open(out_wav, 'wb') as f:
        f.write(raw)
    dur = get_dur(out_wav)
    pad = max(0, target - dur)
    subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
        '-i', out_wav, '-af', f'apad=pad_dur={pad:.3f}', '-t', f'{target:.3f}',
        '-ar', '48000', '-ac', '2', pad_wav])
    parts.append(pad_wav)
    print(f'[{idx+1:02d}] OK: {text} ({dur:.2f}s -> {target:.2f}s)')

# Concat
lst = 'D:/voice/temp/cb_concat.txt'
with open(lst, 'w', encoding='utf-8') as f:
    for p in parts:
        f.write(f"file '{p}'\n")

concat = 'D:/voice/temp/cb_concat.wav'
subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', lst, '-ar', '48000', '-ac', '2', concat])

# HD master
hd = (
    'highpass=f=85,'
    'equalizer=f=280:t=q:w=1.2:g=-3.5,'
    'equalizer=f=3500:t=h:w=1.0:g=5.0,'
    'equalizer=f=10500:t=h:w=1.0:g=4.0,'
    'acompressor=threshold=-18dB:ratio=2.5:attack=8:release=80,'
    'afade=t=in:st=0:d=0.4,'
    'afade=t=out:st=28.8:d=1.2,'
    'loudnorm=I=-14:TP=-1.0:LRA=7'
)
out_mp3 = 'D:/voice/temp/hickory-chatterbox-hq.mp3'
subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
    '-i', concat, '-af', hd,
    '-ar', '48000', '-c:a', 'libmp3lame', '-b:a', '320k', '-q:a', '0', out_mp3])
print(f'DONE: {out_mp3} ({os.path.getsize(out_mp3)//1024} KB)')

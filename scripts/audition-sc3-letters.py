"""Generate explicit letter-name audition clips through the local SC3 server."""
import ast
import json
import sys
import urllib.request
import wave
from pathlib import Path

root = Path(__file__).resolve().parents[1]
tree = ast.parse((root / 'anjali-chatterbox-server.py').read_text(encoding='utf-8-sig'))
assignment = next(n for n in tree.body if isinstance(n, ast.Assign) and
    any(isinstance(t, ast.Name) and t.id == 'INDIAN_ENGLISH_LETTER_NAMES' for t in n.targets))
names = ast.literal_eval(assignment.value)
folder = root / 'temp' / 'vowels5-audit' / ('sc3-letter-candidate' if '--candidate' in sys.argv else 'sc3-letter-audition')
folder.mkdir(parents=True, exist_ok=True)
for letter in (sys.argv[1] if len(sys.argv) > 1 else 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'):
    target = folder / (letter + '.wav')
    if target.exists():
        print(f'{letter}: existing audition', flush=True)
        continue
    # Send the new spelling explicitly when the old server is still running.
    payload = json.dumps({'text': names[letter] + '.', 'voice': 'sc3',
        'generationOptions': {'temperature': 0.5, 'exaggeration': 0.3,
                              'cfg_weight': 0.5,
                              'regenerationKey': 'letter-audition-v2'}}).encode()
    request = urllib.request.Request('http://127.0.0.1:8426/api/narrate', payload,
        {'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=240) as response:
        target.write_bytes(response.read())
    with wave.open(str(target), 'rb') as wav:
        seconds = wav.getnframes() / wav.getframerate()
    print(f'{letter}: {names[letter]} ({seconds:.2f}s)', flush=True)

clips = []
for letter in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ':
    path = folder / (letter + '.wav')
    if not path.exists():
        continue
    with wave.open(str(path), 'rb') as wav:
        params = wav.getparams()
        clips.append((letter, wav.readframes(wav.getnframes())))
if clips:
    with wave.open(str(folder / 'alphabet-audition.wav'), 'wb') as joined:
        joined.setparams(params)
        for letter, data in clips:
            joined.writeframes(data)
            joined.writeframes(bytes(int(params.framerate * 0.7) * params.nchannels * params.sampwidth))

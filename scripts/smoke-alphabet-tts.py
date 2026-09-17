"""Exercise checked alphabet synthesis against the currently running local SC3."""
import json
from pathlib import Path
import sys
import urllib.request
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from alphabet_tts import make_verified_letter, LocalLetterRecognizer

folder = Path(__file__).resolve().parents[1] / 'temp' / 'alphabet-verified'
folder.mkdir(parents=True, exist_ok=True)
recognizer = LocalLetterRecognizer()

def recognize(data):
    result = recognizer(data)
    print('Recognized: ' + ' '.join(w['word'] for w in result), flush=True)
    return result

for letter in [arg for arg in sys.argv[1:] if not arg.startswith('--')]:
    def generate(text, attempt):
        if '--recheck' in sys.argv:
            return (folder / f'{letter}-guide-{attempt}.wav').read_bytes()
        payload = json.dumps({'text': text, 'voice': 'sc3', 'generationOptions': {
            'temperature': (.45, .5, .6)[attempt], 'exaggeration': .3, 'cfg_weight': .5,
            'regenerationKey': 'verified-carrier-pause-v3-' + letter + '-' + str(attempt)}}).encode()
        request = urllib.request.Request('http://127.0.0.1:8426/api/narrate', payload,
                                         {'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=240) as response:
            audio = response.read()
        (folder / f'{letter}-guide-{attempt}.wav').write_bytes(audio)
        return audio
    try:
        audio = make_verified_letter(letter, generate, recognize, lambda msg: print(msg, flush=True))
        (folder / f'{letter}-checked.wav').write_bytes(audio)
        print(f'PASS: {letter}', flush=True)
    except Exception as error:
        print(f'FAIL: {letter}: {error}', flush=True)
        raise

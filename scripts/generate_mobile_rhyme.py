import os
import sys
import json
import asyncio
import subprocess
import edge_tts

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "Missing json payload argument"}))
        return

    req_file = sys.argv[1]
    with open(req_file, 'r', encoding='utf-8') as f:
        payload = json.load(f)

    raw_text = str(payload.get('lyrics') or payload.get('text') or payload.get('prompt') or '').strip()
    if not raw_text:
        raw_text = "Twinkle twinkle little star, how I wonder what you are."

    voice = str(payload.get('singerVoice') or payload.get('voice') or 'en-US-AnaNeural')
    pitch = str(payload.get('pitch') or '+2Hz')
    target_duration = max(5, min(30, int(payload.get('duration') or 30)))
    bgm_level = int(payload.get('bgmLevel') if payload.get('bgmLevel') is not None else 50)
    bgm_vol = f"{max(0.25, min(0.9, (bgm_level / 100.0) * 0.85)):.2f}"

    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    # Use instrumental-only BGM (vocals removed) so no reference voice interferes
    bgm_path = os.path.join(root_dir, 'generated-media', 'rhyme-reference-stems', 'htdemucs', 'little-jack-horner-reference-30s', 'no_vocals.wav')
    if not os.path.exists(bgm_path):
        bgm_path = os.path.join(root_dir, 'generated-media', 'rhyme-reference', 'little-jack-horner-reference-30s.wav')

    temp_dir = os.path.join(root_dir, 'temp')
    os.makedirs(temp_dir, exist_ok=True)

    stamp = int(payload.get('stamp') or 12345678)
    tmp_vocal = os.path.join(temp_dir, f'_vocal_{stamp}.wav')
    final_mp3 = os.path.join(temp_dir, f'_song_{stamp}.mp3')

    # Step 1: edge-tts with slower rate (-20%) for comfortable nursery rhyme pace
    async def synthesize():
        communicate = edge_tts.Communicate(raw_text, voice, rate='-20%', pitch=pitch)
        await communicate.save(tmp_vocal)

    asyncio.run(synthesize())

    if not os.path.exists(tmp_vocal) or os.path.getsize(tmp_vocal) == 0:
        print(json.dumps({"ok": False, "error": "TTS synthesis failed"}))
        return

    # Step 2: FFmpeg mix with BGM (HD Crystal-Clear Vocal Mastering)
    complex_filter = (
        f"[0:a]highpass=f=85,equalizer=f=280:t=q:w=1.2:g=-3.5,equalizer=f=3500:t=h:w=1.0:g=4.5,equalizer=f=10500:t=h:w=1.0:g=3.5,acompressor=threshold=-18dB:ratio=2.8:attack=10:release=100,volume=1.25,apad=pad_len=48000*30[vocal];"
        f"[1:a]volume={bgm_vol},equalizer=f=3000:t=q:w=1:g=-2.5[bgm];"
        f"[vocal][bgm]amix=inputs=2:duration=longest:dropout_transition=0.5,atrim=0:{target_duration},afade=t=out:st={target_duration - 1}:d=1,loudnorm=I=-14:TP=-1.0:LRA=7[out]"
    )

    cmd = [
        'ffmpeg', '-y',
        '-i', tmp_vocal,
        '-i', bgm_path,
        '-filter_complex', complex_filter,
        '-map', '[out]',
        '-ar', '48000',
        '-c:a', 'libmp3lame',
        '-b:a', '320k',
        '-q:a', '0',
        final_mp3
    ]

    subprocess.run(cmd, capture_output=True, check=True)

    if os.path.exists(final_mp3) and os.path.getsize(final_mp3) > 0:
        print(json.dumps({"ok": True, "finalMp3": final_mp3, "tmpVocal": tmp_vocal}))
    else:
        print(json.dumps({"ok": False, "error": "FFmpeg audio mix failed"}))

if __name__ == '__main__':
    main()

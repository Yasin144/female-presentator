import os
import subprocess
import json

def process_hd_audio(input_file, output_file):
    print(f"[*] Processing {input_file} -> {output_file}...")
    
    # HD Audio Mastering Filter Chain:
    # 1. highpass=f=85 : Cut low sub-thumps below 85Hz
    # 2. equalizer=f=280:t=q:w=1.2:g=-3.5 : Notch out boxiness/mud
    # 3. equalizer=f=3500:t=h:w=1.0:g=4.5 : Boost presence for crisp vocal articulation
    # 4. equalizer=f=10500:t=h:w=1.0:g=3.5 : Add HD air/sparkle top-end
    # 5. acompressor=threshold=-18dB:ratio=2.8:attack=10:release=100 : Smooth out vocal dynamics
    # 6. loudnorm=I=-14:TP=-1.0:LRA=7 : Normalize loudness to -14 LUFS broadcast standard
    
    hd_filter = (
        "highpass=f=85,"
        "equalizer=f=280:t=q:w=1.2:g=-3.5,"
        "equalizer=f=3500:t=h:w=1.0:g=4.5,"
        "equalizer=f=10500:t=h:w=1.0:g=3.5,"
        "acompressor=threshold=-18dB:ratio=2.8:attack=10:release=100,"
        "loudnorm=I=-14:TP=-1.0:LRA=7"
    )

    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", input_file,
        "-af", hd_filter,
        "-ar", "48000",
        "-ac", "2",
        "-codec:a", "libmp3lame",
        "-b:a", "320k",
        "-q:a", "0",
        output_file
    ]

    subprocess.run(cmd, check=True)
    print(f"[+] Successfully generated HD audio: {output_file} (Size: {os.path.getsize(output_file)} bytes)")

if __name__ == "__main__":
    src = r"C:\Users\patan\Desktop\Hickory-dickory-dock-The-mouse-ran-up-the-clo-30sec-complete-song.mp3"
    dst = r"D:\voice\temp\Hickory-dickory-dock-HD-Crystal-Clear-Mastered.mp3"
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    process_hd_audio(src, dst)

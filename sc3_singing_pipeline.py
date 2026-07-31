import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REFERENCE_VOICE = ROOT / "voice-reference-sc3.wav"
SINGING_PYTHON = ROOT / ".singing-venv" / "Scripts" / "python.exe"


def run(command, label):
    print(f"[sc3 singing] {label}", flush=True)
    completed = subprocess.run(command, cwd=str(ROOT), text=True)
    if completed.returncode != 0:
        raise RuntimeError(f"{label} failed with exit code {completed.returncode}.")


def convert_to_wav(input_path, output_path):
    run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(input_path),
        "-af", "highpass=f=85,equalizer=f=280:t=q:w=1.2:g=-3.5,equalizer=f=3500:t=h:w=1.0:g=4.5,equalizer=f=10500:t=h:w=1.0:g=3.5",
        "-ar", "48000",
        "-ac", "2",
        str(output_path),
    ], "Preparing song audio for HD voice conversion")


def main():
    parser = argparse.ArgumentParser(description="Convert the uploaded audio directly to the sc3 voice.")
    parser.add_argument("--input", required=True, help="Input song path")
    parser.add_argument("--model-dir", default="", help="Singing model directory")
    parser.add_argument("--output", required=True, help="Output MP3 path")
    parser.add_argument("--device", default="cpu", help="Device for OpenVoice/Demucs")
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve()
    device = args.device or "cpu"

    if not input_path.exists():
        raise FileNotFoundError(f"Input song not found: {input_path}")
    if not SINGING_PYTHON.exists():
        raise FileNotFoundError(f"Singing venv not installed: {SINGING_PYTHON}")
    if not REFERENCE_VOICE.exists():
        raise FileNotFoundError(f"sc3 reference voice not found: {REFERENCE_VOICE}")

    with tempfile.TemporaryDirectory(prefix="sc3-sing-pipeline-") as tmp:
        work = Path(tmp)
        prepared_audio = work / "input.wav"
        converted_audio = work / "sc3-voice.wav"

        convert_to_wav(input_path, prepared_audio)

        run([
            str(SINGING_PYTHON), "-m", "openvoice_cli", "single",
            "-i", str(prepared_audio),
            "-r", str(REFERENCE_VOICE),
            "-o", str(converted_audio),
            "-d", device,
        ], "Converting uploaded audio to sc3 voice")

        output_path.parent.mkdir(parents=True, exist_ok=True)
        run([
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(converted_audio),
            "-af", "loudnorm=I=-14:TP=-1.0:LRA=7",
            "-codec:a", "libmp3lame",
            "-b:a", "320k",
            "-q:a", "0",
            str(output_path),
        ], "Writing 320kbps HD Crystal-Clear MP3 output (-14 LUFS)")

    if not output_path.exists() or output_path.stat().st_size <= 0:
        raise RuntimeError("The sc3 singing model did not create an output MP3.")

    print(f"[sc3 singing] Ready: {output_path}", flush=True)


if __name__ == "__main__":
    main()

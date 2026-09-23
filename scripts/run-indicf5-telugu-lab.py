"""One-shot isolated IndicF5 Telugu generation using the approved SC3 reference."""
import argparse
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
import torchaudio
import importlib.util
from safetensors.torch import load_file


ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "AI_Models" / "indicf5-lab"
REFERENCE = ROOT / "voice-reference-sc3-chapter9-short.wav"
OUTPUT = ROOT / "temp" / "indicf5-telugu-sc3-sample.wav"
REFERENCE_TEXT = (
    "Ask how heavy that backpack is or how tall the boy is. "
    "We are using measurement to figure out physical dimensions. "
    "Measurement applies to abstract concepts too."
)
TELUGU_TEXT = "తెలుగు భాష చాలా మధురమైనది"


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", default=str(REFERENCE))
    parser.add_argument("--reference-text", default=REFERENCE_TEXT)
    parser.add_argument("--text", default=TELUGU_TEXT)
    parser.add_argument("--output", default=str(OUTPUT))
    parser.add_argument("--suite", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    torch.set_num_threads(max(1, min(12, (torch.get_num_threads() or 1))))
    spec = importlib.util.spec_from_file_location("indicf5_local_model", MODEL_DIR / "model.py")
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    config = module.INF5Config(name_or_path=str(MODEL_DIR), speed=1.0, remove_sil=True)
    model = module.INF5Model(config)
    saved = load_file(str(MODEL_DIR / "model.safetensors"), device="cpu")
    # The publisher saved a torch.compile wrapper. CPU inference uses the same
    # parameters without that wrapper, so normalize only that mechanical prefix.
    state = {
        key.replace("ema_model._orig_mod.", "ema_model.", 1): value
        for key, value in saved.items()
        if key.startswith("ema_model.")
    }
    incompatible = model.load_state_dict(state, strict=False)
    print(f"WEIGHTS_MISSING={len(incompatible.missing_keys)}")
    print(f"WEIGHTS_UNEXPECTED={len(incompatible.unexpected_keys)}")
    if incompatible.missing_keys:
        print("MISSING_EXAMPLE=" + ",".join(incompatible.missing_keys[:5]))
    if incompatible.unexpected_keys:
        print("UNEXPECTED_EXAMPLE=" + ",".join(incompatible.unexpected_keys[:5]))
    model.eval()
    # Torchaudio 2.11 delegates file reading to TorchCodec, whose Windows wheel
    # requires shared FFmpeg DLLs. SoundFile reads our PCM WAV directly and
    # avoids adding a system dependency to this isolated experiment.
    def soundfile_load(path):
        samples, rate = sf.read(path, always_2d=True, dtype="float32")
        return torch.from_numpy(samples.T.copy()), rate

    torchaudio.load = soundfile_load
    jobs = [("sentence", args.text)]
    if args.suite:
        jobs = [
            ("vowels", "అచ్చులు: అ, ఆ, ఇ, ఈ, ఉ, ఊ, ఋ, ఎ, ఏ, ఐ, ఒ, ఓ, ఔ."),
            ("counting", "ఒకటి, రెండు, మూడు, నాలుగు, ఐదు, ఆరు, ఏడు, ఎనిమిది, తొమ్మిది, పది."),
        ]
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    for label, text in jobs:
        audio = model(text, ref_audio_path=args.reference, ref_text=args.reference_text)
        if audio.dtype == np.int16:
            audio = audio.astype(np.float32) / 32768.0
        job_output = output.with_name(f"{output.stem}-{label}{output.suffix}") if args.suite else output
        sf.write(job_output, np.asarray(audio, dtype=np.float32), 24000)
        print(f"INDICF5_SAMPLE={job_output}")
        print(f"SAMPLES={len(audio)}")


if __name__ == "__main__":
    main()

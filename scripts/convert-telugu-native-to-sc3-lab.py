"""Isolated SC3 timbre conversion for a pre-validated Telugu WAV."""
import base64
import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "temp" / "indicf5-native-reference-telugu.wav"
OUTPUT = ROOT / "temp" / "indicf5-native-reference-telugu-sc3.mp3"


def main() -> None:
    spec = importlib.util.spec_from_file_location("sc3_singing_lab", ROOT / "sc3-singing-server.py")
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    result = module._run_direct_model({
        "filePath": str(SOURCE),
        "voice": "sc3",
        "tonePreservation": 0.65,
        "outputFileName": OUTPUT.name,
        "saveToDownloads": False,
    })
    if not result.get("ok") or not result.get("audioBase64"):
        raise RuntimeError(result.get("error") or "SC3 conversion produced no audio")
    OUTPUT.write_bytes(base64.b64decode(result["audioBase64"]))
    print(f"SC3_TELUGU_SAMPLE={OUTPUT}")


if __name__ == "__main__":
    main()

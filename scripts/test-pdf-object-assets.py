"""Verify the bundled counting cutouts, optionally against read-only source renders.

Run: .imagegen-venv/Scripts/python.exe scripts/test-pdf-object-assets.py --check-source
This imports Pillow only; it does not load a model or modify any asset/PDF.
"""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[1]
FINGERPRINT = "dd93e8325ce5eb4987e70ff85fc82bc9"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check-source", action="store_true")
    parser.add_argument("--source-dir", type=Path, default=ROOT / "tmp/pdfs/nursery-pages")
    args = parser.parse_args()
    directory = ROOT / "assets/pdf-counting" / FINGERPRINT
    manifest = json.loads((directory / "manifest.json").read_text())
    assert manifest["fingerprint"] == FINGERPRINT
    assert set(manifest["pages"]) == {str(page) for page in range(26, 36)}
    total = 0
    total_bytes = 0
    for page_number in range(26, 36):
        page = manifest["pages"][str(page_number)]
        expected = page_number - 15
        assert page["verified"] is True, f"Page {page_number} is not approved"
        assert not page.get("errors"), f"Page {page_number} has preparation errors"
        assert page["count"] == expected and len(page["objects"]) == expected
        source = Image.open(args.source_dir / f"page-{page_number}.png").convert("RGB") if args.check_source else None
        for index, entry in enumerate(page["objects"], 1):
            assert entry["number"] == index
            assert entry["src"] == f"page-{page_number}/{index}.png"
            filename = directory / entry["src"]
            with Image.open(filename) as cutout:
                assert cutout.mode == "RGBA", f"Missing alpha in {filename}"
                assert cutout.size == (entry["width"], entry["height"])
                alpha = cutout.getchannel("A")
                assert alpha.getextrema() == (0, 255), f"Empty or opaque rectangular asset: {filename}"
                assert alpha.getbbox() is not None
                if source:
                    x, y, w, h = entry["sourceBounds"]
                    left, top = round(x * source.width), round(y * source.height)
                    assert round(w * source.width) == cutout.width and round(h * source.height) == cutout.height
                    original = source.crop((left, top, left + cutout.width, top + cutout.height))
                    assert ImageChops.difference(original, cutout.convert("RGB")).getbbox() is None, f"Changed original artwork pixels: {filename}"
            if entry.get("sha256"):
                assert hashlib.sha256(filename.read_bytes()).hexdigest() == entry["sha256"]
            total += 1
            total_bytes += filename.stat().st_size
        print(f"Page {page_number}: {expected} approved original-pixel alpha cutouts")
    assert total == 155
    print(json.dumps({"objects": total, "pngBytes": total_bytes, "sourcePixelsChecked": args.check_source}))


if __name__ == "__main__":
    main()

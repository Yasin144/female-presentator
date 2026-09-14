"""Read-only checks for the complete realistic PDF counting pictures.

Run: .imagegen-venv/Scripts/python.exe -I scripts/test-pdf-realistic-v2-assets.py
Uses Pillow only; never changes images, manifests, lessons, or app runtime.
The original PDF-cutout validator remains separate and unchanged.
"""

import hashlib
import json
import re
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
FINGERPRINT = "dd93e8325ce5eb4987e70ff85fc82bc9"
NOUNS = ("dogs", "books", "candies", "birds", "bananas", "butterflies", "gifts", "ants", "leaves", "stars")
ASSET_DIR = ROOT / "assets/pdf-counting/realistic-v2"
MANIFEST_DIR = ROOT / "assets/pdf-counting" / FINGERPRINT


def padded_xywh(bounds, width, height):
    left, top, right, bottom = bounds
    left, top = max(0, left - 2), max(0, top - 2)
    right, bottom = min(width, right + 2), min(height, bottom + 2)
    return [left, top, right - left, bottom - top]


def main():
    metadata = json.loads((ASSET_DIR / "asset-metadata.json").read_text(encoding="utf-8"))
    assets = metadata["assets"]
    assert len(assets) == 10, "Expected ten complete realistic pictures"
    assert {entry["noun"] for entry in assets} == set(NOUNS), "Unexpected or missing object categories"
    assert {path.name for path in ASSET_DIR.glob("*.png")} == {f"{noun}.png" for noun in NOUNS}
    indexed = {entry["noun"]: entry for entry in assets}
    checked = {}
    total_bytes = 0

    for noun in NOUNS:
        entry = indexed[noun]
        filename = ASSET_DIR / f"{noun}.png"
        file_bytes = filename.read_bytes()
        digest = hashlib.sha256(file_bytes).hexdigest()
        assert re.fullmatch(r"[0-9a-f]{64}", entry["sha256"]), f"Invalid SHA256 metadata for {noun}"
        assert digest == entry["sha256"], f"PNG bytes changed for {noun}"
        assert len(file_bytes) == entry["bytes"], f"PNG length differs from metadata for {noun}"
        assert entry["alpha"] is True and entry["visibleAlphaThreshold"] == 16

        with Image.open(filename) as picture:
            assert picture.format == "PNG", f"Not a PNG: {noun}"
            assert picture.mode == "RGBA", f"Real RGBA transparency is required: {noun}"
            assert picture.size == (1254, 1254), f"Unexpected generated image dimensions: {noun}"
            assert picture.size == (entry["width"], entry["height"]), f"PNG dimensions differ from metadata: {noun}"
            alpha = picture.getchannel("A")
            assert alpha.getextrema() == (0, 255), f"Empty or opaque rectangular image: {noun}"
            assert list(alpha.getextrema()) == entry["alphaExtrema"]
            alpha_bounds = alpha.getbbox()
            assert alpha_bounds is not None
            assert list(alpha_bounds) == entry["alphaBounds"], f"Nonzero alpha bounds changed: {noun}"
            assert padded_xywh(alpha_bounds, picture.width, picture.height) == entry["contentBounds"]

            histogram = alpha.histogram()
            visible_pixels = sum(histogram[16:])
            pixel_count = picture.width * picture.height
            assert visible_pixels >= pixel_count * .01, f"No meaningful visible object: {noun}"
            assert histogram[0] >= pixel_count * .05, f"Insufficient real transparent background: {noun}"
            visible = alpha.point(lambda value: 255 if value >= 16 else 0)
            visible_bounds = visible.getbbox()
            assert visible_bounds is not None
            left, top, right, bottom = visible_bounds
            assert left > 0 and top > 0 and right < picture.width and bottom < picture.height, (
                f"Visible alpha >=16 touches an image edge: {noun}"
            )
            assert right - left >= 64 and bottom - top >= 64, f"Visible content bounds are too small: {noun}"
            crop = padded_xywh(visible_bounds, picture.width, picture.height)
            assert crop == entry["visibleContentBounds"], f"Reviewed visible content crop differs from pixels: {noun}"
            x, y, width, height = crop
            assert x >= 0 and y >= 0 and width > 0 and height > 0
            assert x + width <= picture.width and y + height <= picture.height
            checked[noun] = {"sha256": digest, "width": picture.width, "height": picture.height, "contentBounds": crop}
        total_bytes += len(file_bytes)

    manifest = json.loads((MANIFEST_DIR / "manifest-realistic-v2.json").read_text(encoding="utf-8"))
    assert manifest["schemaVersion"] == 2 and manifest["assetStyle"] == "photorealistic"
    assert manifest["fingerprint"] == FINGERPRINT
    assert set(manifest["pages"]) == {str(page) for page in range(26, 36)}
    total_instances = 0
    for page_number, noun in zip(range(26, 36), NOUNS):
        profile = manifest["pages"][str(page_number)]
        expected_count = page_number - 15
        assert profile["verified"] is True, f"Page {page_number} has not been reviewed"
        assert profile["noun"] == noun and profile["count"] == expected_count
        assert len(profile["objects"]) == expected_count, f"Incorrect object count on page {page_number}"
        expected_asset = checked[noun]
        for number, entry in enumerate(profile["objects"], 1):
            assert entry["number"] == number, f"Incorrect count order on page {page_number}"
            assert entry["src"] == f"../realistic-v2/{noun}.png", f"Wrong category image on page {page_number}"
            assert (MANIFEST_DIR / entry["src"]).resolve() == (ASSET_DIR / f"{noun}.png").resolve()
            for field in ("width", "height", "contentBounds", "sha256"):
                assert entry[field] == expected_asset[field], f"Manifest {field} mismatch on page {page_number}, object {number}"
            total_instances += 1
        print(f"Page {page_number}: {expected_count} {noun}; reviewed RGBA picture, SHA256 and visible crop match")

    assert total_instances == 155
    print(json.dumps({
        "realisticAssets": len(checked), "manifestInstances": total_instances,
        "pngDimensions": "1254x1254", "pngBytes": total_bytes,
        "visibleAlphaThreshold": 16, "visibleEdgesClear": True,
        "metadataAndHashesMatch": True, "readOnly": True
    }))


if __name__ == "__main__":
    main()

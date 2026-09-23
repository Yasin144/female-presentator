"""Build transparent place-value pictures from the user-supplied LKG PDF renders.

Run after rendering PDF pages 38, 40 and 42 at the standard 975x1287 size.
The committed PNG outputs let the local presenter work without reopening the
source PDF or using an online image service.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "tmp" / "pdfs" / "lkg-21-50"
OUTPUT = ROOT / "assets" / "pdf-counting" / "lkg-place-value"

ASSETS = {
    "basket-ten.png": ("page-38.png", (126, 119, 247, 211)),
    "loop-ten.png": ("page-40.png", (120, 230, 217, 326)),
    "garland-ten.png": ("page-42.png", (110, 240, 210, 330)),
    "one-ball.png": ("page-38.png", (392, 118, 432, 160)),
}


def transparent_crop(source: Path, box: tuple[int, int, int, int]) -> Image.Image:
    image = Image.open(source).convert("RGBA").crop(box)
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            red, green, blue, alpha = pixels[x, y]
            distance = max(0, 255 - min(red, green, blue))
            new_alpha = 0 if distance < 7 else min(alpha, distance * 8)
            pixels[x, y] = (red, green, blue, new_alpha)
    bounds = image.getbbox()
    if not bounds:
        raise RuntimeError(f"No visible artwork in {source.name} crop {box}")
    image = image.crop(bounds)
    padded = Image.new("RGBA", (image.width + 12, image.height + 12), (0, 0, 0, 0))
    padded.alpha_composite(image, (6, 6))
    return padded


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for name, (page, box) in ASSETS.items():
        result = transparent_crop(SOURCE / page, box)
        result.save(OUTPUT / name, optimize=True)
        print(f"{name}: {result.width}x{result.height}")


if __name__ == "__main__":
    main()

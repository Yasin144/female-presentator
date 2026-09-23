from collections import deque
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "tmp" / "pdfs" / "lkg-counting" / "embedded"
TARGET = ROOT / "assets" / "pdf-counting" / "lkg-textbook"
FILES = {
    "vases": "page-25-2.jp2",
    "cars": "page-26-2.jp2",
    "bags": "page-27-2.jp2",
    "flowers": "page-28-28.jp2",
    "tops": "page-29-2.jp2",
    "kites": "page-30-29.jp2",
    "hats": "page-31-2.jp2",
}

TARGET.mkdir(parents=True, exist_ok=True)
for noun, filename in FILES.items():
    image = Image.open(SOURCE / filename).convert("RGBA")
    width, height = image.size
    pixels = image.load()
    background = set()
    queue = deque()
    for x in range(width):
        queue.extend(((x, 0), (x, height - 1)))
    for y in range(height):
        queue.extend(((0, y), (width - 1, y)))
    while queue:
        x, y = queue.popleft()
        if (x, y) in background:
            continue
        red, green, blue, _ = pixels[x, y]
        if max(red, green, blue) > 18:
            continue
        background.add((x, y))
        if x: queue.append((x - 1, y))
        if x + 1 < width: queue.append((x + 1, y))
        if y: queue.append((x, y - 1))
        if y + 1 < height: queue.append((x, y + 1))
    alpha = Image.new("L", image.size, 255)
    alpha_pixels = alpha.load()
    for x, y in background:
        alpha_pixels[x, y] = 0
    image.putalpha(alpha)
    bounds = alpha.getbbox()
    if not bounds:
        raise RuntimeError(f"No visible content in {filename}")
    image = image.crop(bounds)
    image.save(TARGET / f"{noun}.png", optimize=True)
    print(noun, image.size)

tiles = []
for noun in FILES:
    object_image = Image.open(TARGET / f"{noun}.png").convert("RGBA")
    object_image.thumbnail((220, 180))
    tile = Image.new("RGBA", (240, 220), (235, 239, 245, 255))
    tile.alpha_composite(object_image, ((240 - object_image.width) // 2, 28))
    tiles.append(tile.convert("RGB"))
sheet = Image.new("RGB", (240 * len(tiles), 220), "white")
for index, tile in enumerate(tiles):
    sheet.paste(tile, (240 * index, 0))
sheet.save(ROOT / "tmp" / "pdfs" / "lkg-counting" / "cutout-qa.png")

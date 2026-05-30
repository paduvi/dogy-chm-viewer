#!/usr/bin/env python3
"""Build build/icon.icns from resources/dog_logo.jpg.

Steps:
  1. Open the source image.
  2. Scale to 1024×1024 (the largest icns size) with a white background.
  3. Draw "CHM" centred at the bottom, using SF Rounded / system bold font.
  4. Export the required icon sizes into a temporary .iconset directory.
  5. Run `iconutil` to produce the final .icns file.
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).parent.parent
SRC = ROOT / "resources" / "dog_logo.jpg"
OUT_ICNS = ROOT / "build" / "icon.icns"
ICONSET = ROOT / "build" / "icon.iconset"

BASE = 1024  # working canvas size


def find_font(size: int) -> ImageFont.FreeTypeFont:
    """Prefer SF Rounded Bold; fall back through system fonts to Pillow default."""
    candidates = [
        # macOS system fonts (SF family)
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/SFNSRounded.ttf",
        "/System/Library/Fonts/Supplemental/Arial Rounded MT Bold.ttf",
        "/Library/Fonts/Arial Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def build_base_image() -> Image.Image:
    """Open source, scale to BASE×BASE, draw CHM label — no background added."""
    src = Image.open(SRC).convert("RGBA")

    # Scale source to fill the canvas exactly (no border, no background).
    canvas = Image.new("RGBA", (BASE, BASE), (0, 0, 0, 0))
    src_resized = src.resize((BASE, BASE), Image.LANCZOS)
    canvas.paste(src_resized, (0, 0), src_resized)

    draw = ImageDraw.Draw(canvas)

    # ── "CHM" label — inside the logo, shifted ~10% higher than bottom ───────
    font_size = 140          # ~14% of canvas — readable at 256 px, clean at 512+
    font = find_font(font_size)

    text = "CHM"
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]

    x = (BASE - text_w) // 2
    y = int(BASE * 0.83)     # 77% down

    # Label: warm dark-brown to complement the dog illustration palette.
    draw.text((x, y), text, font=font, fill=(70, 40, 20, 255))

    return canvas.convert("RGB")


SIZES = {
    # (filename, pixels) — macOS iconset spec
    "icon_16x16.png":       16,
    "icon_16x16@2x.png":    32,
    "icon_32x32.png":       32,
    "icon_32x32@2x.png":    64,
    "icon_128x128.png":    128,
    "icon_128x128@2x.png": 256,
    "icon_256x256.png":    256,
    "icon_256x256@2x.png": 512,
    "icon_512x512.png":    512,
    "icon_512x512@2x.png":1024,
}


def main():
    print("Building base 1024×1024 image …")
    base_img = build_base_image()

    ICONSET.mkdir(parents=True, exist_ok=True)

    print("Exporting icon sizes …")
    for filename, px in SIZES.items():
        resized = base_img.resize((px, px), Image.LANCZOS)
        resized.save(ICONSET / filename, format="PNG")
        print(f"  {filename} ({px}×{px})")

    print(f"Running iconutil → {OUT_ICNS} …")
    result = subprocess.run(
        ["iconutil", "-c", "icns", str(ICONSET), "-o", str(OUT_ICNS)],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print("iconutil error:", result.stderr, file=sys.stderr)
        sys.exit(1)

    # Clean up the temporary iconset directory.
    shutil.rmtree(ICONSET)

    size_kb = OUT_ICNS.stat().st_size // 1024
    print(f"\n✅  {OUT_ICNS}  ({size_kb} KB)")


if __name__ == "__main__":
    main()

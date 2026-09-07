"""Paint the light room from the dark one.

    python tools/openspace_light.py

The two themes share one room: the dark Higgsfield illustration is the master, and background-light.png is the same
drawing repainted for daylight, pixel for pixel. Every line, desk, chair and tile therefore sits at exactly the same
place in both themes, and one scene description (anchors, walk graph) serves both. The mapping keeps the dark outlines,
lifts every fill on a single lightness curve (so the shading stays coherent), gives the floor a warm tint and the walls
a cool grey one, and keeps the cyan screens and the orange cables as they are. The area outside the room becomes the
flat colour of the light canvas (scene-light.json "bg").
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "pulsar" / "static" / "openspace"
OUTSIDE = (0xE1, 0xE5, 0xEC)          # canvas colour around the room in the light theme (scene-light.json "bg")


def hls_to_rgb(h: np.ndarray, l: np.ndarray, s: np.ndarray) -> np.ndarray:
    c = (1 - np.abs(2 * l - 1)) * s
    x = c * (1 - np.abs((h * 6) % 2 - 1))
    m = l - c / 2
    sector = (h * 6).astype(int) % 6
    table = [(c, x, 0), (x, c, 0), (0, c, x), (0, x, c), (x, 0, c), (c, 0, x)]
    out = np.zeros(l.shape + (3,))
    for i, (r, g, b) in enumerate(table):
        sel = sector == i
        for ch, v in enumerate((r, g, b)):
            out[..., ch] = np.where(sel, v + m, out[..., ch])
    return np.clip(out, 0, 1)


def repaint(dark: Image.Image) -> Image.Image:
    im = np.array(dark.convert("RGB")).astype(float) / 255
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    mx, mn = im.max(axis=2), im.min(axis=2)
    L = (mx + mn) / 2
    S = np.where(mx == mn, 0, (mx - mn) / (1 - np.abs(2 * L - 1) + 1e-9))
    d = mx - mn + 1e-9
    H = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) / 6
    H = np.where(mx == mn, 0, H)

    screen = (S > 0.30) & (L > 0.38) & (H > 0.40) & (H < 0.55)      # cyan screens and neon
    orange = (H < 0.12) & (S > 0.35) & (L > 0.2)                      # cables, warning lamps
    floor = (L > 0.085) & (L < 0.135) & (H > 0.42) & (H < 0.56)       # the floor tiles
    outline = L < 0.045

    t = np.clip((L - 0.05) / 0.25, 0, 1)
    L2 = 0.34 + 0.62 * t ** 0.8                                       # fills: one monotonic curve
    L2 = np.where(L > 0.30, np.clip(0.96 + (L - 0.30) * 0.1, 0, 0.99), L2)
    H2 = np.full_like(L, 220 / 360)
    S2 = np.full_like(L, 0.07)
    H2 = np.where(floor, 32 / 360, H2)
    S2 = np.where(floor, 0.16, S2)
    L2 = np.where(floor, 0.62 + (L - 0.085) * 1.2, L2)
    L2 = np.where(outline, 0.20, L2)
    S2 = np.where(outline, 0.10, S2)
    for keep in (screen, orange):
        H2 = np.where(keep, H, H2)
        S2 = np.where(keep, S, S2)
    L2 = np.where(screen, np.clip(L * 1.15, 0, 0.9), L2)
    L2 = np.where(orange, L, L2)
    out = hls_to_rgb(H2, L2, S2)

    # outside the room: the flat dark colour touching the image corners
    flat = (np.abs(im * 255 - np.array([0x20, 0x39, 0x3D])).sum(axis=2) < 24)
    labels, _ = ndimage.label(flat)
    h, w = flat.shape
    corners = {labels[0, 0], labels[0, w - 1], labels[h - 1, 0], labels[h - 1, w - 1]} - {0}
    outside = np.isin(labels, list(corners))
    for ch in range(3):
        out[..., ch] = np.where(outside, OUTSIDE[ch] / 255, out[..., ch])
    return Image.fromarray((out * 255).round().astype(np.uint8))


def main() -> int:
    dark = Image.open(OUT / "background-dark.png")
    light = repaint(dark)
    light.save(OUT / "background-light.png", optimize=True)
    print("background-light.png written,", light.size)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

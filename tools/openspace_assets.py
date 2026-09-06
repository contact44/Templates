"""Build the open-space game assets from the Higgsfield artwork.

    python tools/openspace_assets.py [--check]

Inputs
  tools/openspace-src/<name>.png            characters (front view, transparent background)
  pulsar/static/openspace/background-*.png  the two rooms
  pulsar/static/openspace/scene-*.json      anchors, walk graph, occluder polygons (image pixels)

Outputs (pulsar/static/openspace/)
  sheet-<name>.png   pixel-art sprite sheet: front view | back view, feet on the last row
  chars.json         sheet metadata (frame size, where the legs start)
  fg-<theme>-<n>.png furniture cut out of the room, drawn over a robot standing behind it
  scene-*.json       updated in place with the cut-out placement
--check also writes scratch overlays showing anchors, graph and occluders on each room.
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "tools" / "openspace-src"
OUT = ROOT / "pulsar" / "static" / "openspace"
CHARACTERS = ["andromede", "orion", "sirius"]
HEIGHT = 38          # sprite height in scene pixels (1 sprite px = 1 logical px = 3 canvas px)
COLORS = 14          # palette size per character


def dump(obj) -> str:
    """JSON with one line per anchor, node, edge and occluder (easier to edit by hand)."""
    lines = ["{"]
    keys = list(obj.keys())
    for i, key in enumerate(keys):
        val = obj[key]
        comma = "," if i < len(keys) - 1 else ""
        if key == "anchors":
            body = ",\n".join(f'    "{k}": {json.dumps(v)}' for k, v in val.items())
            lines.append(f'  "{key}": {{\n{body}\n  }}{comma}')
        elif key in ("nodes", "edges", "occluders"):
            body = ",\n".join("    " + json.dumps(v) for v in val)
            lines.append(f'  "{key}": [\n{body}\n  ]{comma}')
        else:
            lines.append(f'  "{key}": {json.dumps(val)}{comma}')
    lines.append("}")
    return "\n".join(lines) + "\n"


def dist(a, b) -> float:
    return sum((x - y) ** 2 for x, y in zip(a[:3], b[:3])) ** 0.5


def luminance(c) -> float:
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def is_skin(c) -> bool:
    r, g, b = c[:3]
    return r > 150 and r > g > b and (r - b) > 40


def pixelate(src: Image.Image) -> Image.Image:
    """Crop, downscale with a box filter and quantise: the Higgsfield character as a small pixel-art sprite."""
    src = src.convert("RGBA")
    bbox = src.getchannel("A").point(lambda a: 255 if a > 40 else 0).getbbox()
    src = src.crop(bbox)
    w = max(12, round(src.width * HEIGHT / src.height))
    small = src.resize((w, HEIGHT), Image.BOX)
    alpha = small.getchannel("A").point(lambda a: 255 if a > 110 else 0)
    rgb = small.convert("RGB").quantize(colors=COLORS, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGB")
    out = Image.new("RGBA", small.size, (0, 0, 0, 0))
    out.paste(rgb, (0, 0), alpha)
    return out


def classify(px, w, h):
    """Dominant hair, skin and suit colours, the row where the chin ends and the row where the legs start."""
    opaque = [(x, y, px[x, y]) for y in range(h) for x in range(w) if px[x, y][3] > 0]
    top_rows = [c for x, y, c in opaque if y < h * 0.16 and luminance(c) >= 36 and not is_skin(c)]
    hair = Counter(c[:3] for c in top_rows).most_common(1)[0][0]
    skin_rows = [y for x, y, c in opaque if y < h * 0.45 and is_skin(c)]
    chin = max(skin_rows) if skin_rows else int(h * 0.3)
    torso = [c for x, y, c in opaque if chin + 2 <= y < h * 0.75 and luminance(c) >= 36 and not is_skin(c) and dist(c, hair) > 30]
    suit = Counter(c[:3] for c in torso).most_common(1)[0][0]
    # legs start where the silhouette splits (transparent column in the middle) or at 72% of the height
    mid = w // 2
    legs = None
    for y in range(h - 1, int(h * 0.55), -1):
        if all(px[x, y][3] == 0 for x in range(mid - 1, mid + 1)):
            legs = y
        elif legs is not None:
            break
    if legs is None or legs > h * 0.85:
        legs = round(h * 0.72)
    return {"hair": hair, "skin": None, "suit": suit, "chin": chin, "legs": legs}


def back_view(front: Image.Image, info) -> Image.Image:
    """Mirror the front view and paint what the back shows: hair instead of the face, a closed jacket."""
    back = front.transpose(Image.FLIP_LEFT_RIGHT)
    px = back.load()
    w, h = back.size
    hair, suit, chin, legs = info["hair"], info["suit"], info["chin"], info["legs"]
    hair_dark = tuple(max(0, int(c * 0.8)) for c in hair)
    suit_dark = tuple(max(0, int(c * 0.85)) for c in suit)
    for y in range(h):
        for x in range(w):
            c = px[x, y]
            if c[3] == 0 or luminance(c) < 36:
                continue  # transparent or outline
            if y <= chin:
                if dist(c, hair) > 30:
                    px[x, y] = (hair_dark if x < w * 0.35 else hair) + (255,)
            elif chin + 1 < y < legs:
                if not is_skin(c) and dist(c, suit) > 55:
                    px[x, y] = (suit_dark if x < w * 0.3 else suit) + (255,)
    # a faint seam down the middle of the jacket
    for y in range(chin + 4, legs - 1):
        c = px[w // 2, y]
        if c[3] and dist(c, suit) < 55:
            px[w // 2, y] = suit_dark + (255,)
    return back


def build_sheets() -> dict:
    meta = {}
    for name in CHARACTERS:
        front = pixelate(Image.open(SRC / f"{name}.png"))
        info = classify(front.load(), *front.size)
        back = back_view(front, info)
        w, h = front.size
        sheet = Image.new("RGBA", (w * 2, h), (0, 0, 0, 0))
        sheet.paste(front, (0, 0))
        sheet.paste(back, (w, 0))
        sheet.save(OUT / f"sheet-{name}.png")
        meta[name] = {"sheet": f"sheet-{name}.png", "w": w, "h": h, "legs": info["legs"], "chin": info["chin"]}
    (OUT / "chars.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    return meta


def cut_occluders(theme: str) -> dict:
    scene_path = OUT / f"scene-{theme}.json"
    scene = json.loads(scene_path.read_text(encoding="utf-8"))
    room = Image.open(OUT / f"background-{theme}.png").convert("RGBA")
    for occ in scene.get("occluders", []):
        pts = [tuple(p) for p in occ["poly"]]
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        x0, y0, x1, y1 = min(xs), min(ys), max(xs) + 1, max(ys) + 1
        mask = Image.new("L", room.size, 0)
        ImageDraw.Draw(mask).polygon(pts, fill=255)
        piece = Image.new("RGBA", room.size, (0, 0, 0, 0))
        piece.paste(room, (0, 0), mask)
        piece = piece.crop((x0, y0, x1, y1))
        piece.save(OUT / f"fg-{theme}-{occ['name']}.png")
        occ.update({"image": f"fg-{theme}-{occ['name']}.png", "x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0})
    scene_path.write_text(dump(scene), encoding="utf-8")
    return scene


def check(theme: str, scene: dict, meta: dict, scratch: Path) -> None:
    room = Image.open(OUT / f"background-{theme}.png").convert("RGBA")
    d = ImageDraw.Draw(room)
    k = scene["image"]["w"] / 380  # image px per logical px
    for occ in scene.get("occluders", []):
        d.polygon([tuple(p) for p in occ["poly"]], outline=(255, 80, 80, 255))
        d.line([tuple(p) for p in occ["depth"]], fill=(255, 200, 0, 255), width=3)
    nodes = scene["nodes"]
    for a, b in scene["edges"]:
        d.line([tuple(nodes[a]), tuple(nodes[b])], fill=(80, 255, 120, 255), width=3)
    for i, (x, y) in enumerate(nodes):
        d.ellipse([x - 7, y - 7, x + 7, y + 7], fill=(80, 255, 120, 255))
        d.text((x + 9, y - 7), str(i), fill=(255, 255, 255, 255))
    pieces = [(occ, Image.open(OUT / occ["image"]).convert("RGBA")) for occ in scene.get("occluders", [])]

    def depth_of(occ, x):
        (x1, y1), (x2, y2) = occ["depth"]
        return y1 if x2 == x1 else y1 + (y2 - y1) * (x - x1) / (x2 - x1)

    for i, (aid, a) in enumerate(scene["anchors"].items()):
        name = CHARACTERS[i % 3]
        m = meta[name]
        w, h = round(m["w"] * k), round(m["h"] * k)
        sheet = Image.open(OUT / m["sheet"]).convert("RGBA")
        frame = sheet.crop((m["w"], 0, m["w"] * 2, m["h"])) if a["face"] in ("ul", "ur") else sheet.crop((0, 0, m["w"], m["h"]))
        if a["face"] in ("ur", "dl"):
            frame = frame.transpose(Image.FLIP_LEFT_RIGHT)
        frame = frame.resize((w, h), Image.NEAREST)
        room.paste(frame, (a["x"] - w // 2, a["y"] - h), frame)
        for occ, piece in pieces:  # furniture in front of this robot is drawn back over it
            if a["y"] < depth_of(occ, a["x"]):
                room.paste(piece, (occ["x"], occ["y"]), piece)
        d.ellipse([a["x"] - 4, a["y"] - 4, a["x"] + 4, a["y"] + 4], fill=(255, 60, 60, 255))
        d.text((a["x"] + 6, a["y"] - 6), aid, fill=(255, 255, 255, 255))
        if a.get("label"):
            d.rectangle([a["lx"] - 30, a["ly"] - 6, a["lx"] + 30, a["ly"] + 6], fill=(20, 40, 160, 255))
    room.save(scratch / f"scene_check_{theme}.png")


def main(argv: list[str]) -> int:
    meta = build_sheets()
    scenes = {t: cut_occluders(t) for t in ("light", "dark")}
    print("sheets:", {n: (m["w"], m["h"], "legs", m["legs"]) for n, m in meta.items()})
    if "--check" in argv:
        scratch = Path(argv[argv.index("--check") + 1]) if len(argv) > argv.index("--check") + 1 else ROOT
        for t, s in scenes.items():
            check(t, s, meta, scratch)
        # zoomed sheets
        for n, m in meta.items():
            Image.open(OUT / m["sheet"]).resize((m["w"] * 12, m["h"] * 6), Image.NEAREST).save(scratch / f"sheet_zoom_{n}.png")
        print("overlays written to", scratch)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

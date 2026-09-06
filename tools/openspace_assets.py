"""Build the open-space game assets from the Higgsfield artwork.

    python tools/openspace_assets.py [--check <dir>]

Inputs
  tools/openspace-src/<name>.txt            one character: palette + six poses as text (front, front34, profile,
                                            back34, back, seated), cut from the Higgsfield turnaround sheets
  tools/openspace-src/<name>.png            the original front view (portraits are cut from it)
  pulsar/static/openspace/background-*.png  the two rooms
  pulsar/static/openspace/scene-*.json      anchors, walk graph, occluder polygons (image pixels)

Outputs (pulsar/static/openspace/)
  sheet-<name>.png   sprite sheet, the six poses side by side, feet on the last row of each pose
  chars.json         sheet metadata (where each pose is in the sheet, its size)
  avatar-<name>.png  96 px portrait for the team list
  chair-light-<n>.png office chairs drawn for the light room (the dark room has its own)
  fg-<theme>-<n>.png furniture cut out of the room, drawn over a robot standing behind it
  scene-*.json       updated in place with the placement of the cut-outs and chairs
--check <dir> also writes overlays showing anchors, graph and occluders on each room.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "tools" / "openspace-src"
OUT = ROOT / "pulsar" / "static" / "openspace"
CHARACTERS = ["andromede", "orion", "sirius"]
POSES = ["front", "front34", "profile", "back34", "back", "seated"]
DIGITS = "0123456789abcdef"


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
        elif key in ("nodes", "edges", "occluders", "chairs"):
            body = ",\n".join("    " + json.dumps(v) for v in val)
            lines.append(f'  "{key}": [\n{body}\n  ]{comma}')
        else:
            lines.append(f'  "{key}": {json.dumps(val)}{comma}')
    lines.append("}")
    return "\n".join(lines) + "\n"


# ---- characters --------------------------------------------------------------------------------------------------

def read_sprite_text(path: Path) -> tuple[list[tuple[int, int, int]], dict[str, Image.Image]]:
    """Parse the text form of a character: PAL line, then FRAME <name> <w> <h> and h rows of palette digits ('.' = transparent)."""
    palette: list[tuple[int, int, int]] = []
    frames: dict[str, Image.Image] = {}
    current = None
    rows: list[str] = []

    def flush():
        if current is None:
            return
        name, w, h = current
        img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        px = img.load()
        for y, row in enumerate(rows[:h]):
            for x, ch in enumerate(row[:w]):
                if ch in DIGITS:
                    px[x, y] = palette[DIGITS.index(ch)] + (255,)
        frames[name] = img

    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("PAL "):
            palette = [tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) for h in line.split()[1:]]
        elif line.startswith("FRAME "):
            flush()
            _, name, w, h = line.split()
            current, rows = (name, int(w), int(h)), []
        elif line.startswith(("NAME ", "END")):
            continue
        elif current is not None:
            rows.append(line)
    flush()
    return palette, frames


def build_sheets() -> dict:
    meta = {}
    for name in CHARACTERS:
        _, frames = read_sprite_text(SRC / f"{name}.txt")
        height = max(f.height for f in frames.values())
        width = sum(f.width + 1 for f in frames.values()) - 1
        sheet = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        placed, x = {}, 0
        for pose in POSES:
            img = frames[pose]
            sheet.paste(img, (x, height - img.height))          # feet on the last row of the sheet
            placed[pose] = {"x": x, "w": img.width, "h": img.height}
            x += img.width + 1
        sheet.save(OUT / f"sheet-{name}.png")
        meta[name] = {"sheet": f"sheet-{name}.png", "h": height, "frames": placed}
        build_avatar(name)
    (OUT / "chars.json").write_text(json.dumps(meta, indent=1) + "\n", encoding="utf-8")
    return meta


def build_avatar(name: str) -> None:
    """Head and shoulders of the original front view, 96 px square, for the team list."""
    src = Image.open(SRC / f"{name}.png").convert("RGBA")
    src = src.crop(src.getchannel("A").getbbox())
    side = int(src.height * 0.42)
    left = max(0, src.width // 2 - side // 2)
    face = src.crop((left, 0, left + side, side))
    out = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    out.paste(face, (0, 0), face)
    out.resize((96, 96), Image.LANCZOS).save(OUT / f"avatar-{name}.png")


# ---- rooms ----------------------------------------------------------------------------------------------------------

CHAIR = [  # office chair seen from behind, 3/4, on the room's 4 px pixel grid (18 x 25 cells)
    "......kkkkkkk.....",
    "....kkbbbbbbbkk...",
    "...kbbbbbbbbbbbk..",
    "...kbaaaaaaaaabk..",
    "...kbaaaaaaaaabk..",
    "...kbaaaaaaaaabk..",
    "...kbaaaaaaaaabk..",
    "...kbaaaaaaaaabk..",
    "...kbaaaaaaaaabk..",
    "...kbaaaaaaaaabk..",
    "...kbaaaaaaaaabk..",
    "...kbbaaaaaaabbk..",
    "..kkbbbbbbbbbbbkk.",
    ".kcccbbbbbbbbbcccdk",
    ".kcccccccccccccccdk",
    "..kkcccccccccccdkk.",
    ".....kkkddddkkk....",
    "........kssk.......",
    "........kssk.......",
    "........kssk.......",
    "......kkkssskkk....",
    "...kkkssskssksskkk.",
    "..kssskk.kssk.ksssk",
    "..kkkk...kkkk..kkkk",
    "...................",
]
CHAIR_COLORS = {"k": (12, 18, 40), "b": (43, 60, 105), "a": (29, 42, 74), "c": (36, 51, 90), "d": (24, 35, 64), "s": (70, 82, 104)}


def draw_chair(cell: int = 4) -> Image.Image:
    w, h = len(CHAIR[0]), len(CHAIR)
    img = Image.new("RGBA", (w * cell, h * cell), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for y, row in enumerate(CHAIR):
        for x, ch in enumerate(row):
            if ch in CHAIR_COLORS:
                d.rectangle([x * cell, y * cell, (x + 1) * cell - 1, (y + 1) * cell - 1], fill=CHAIR_COLORS[ch] + (255,))
    return img


def cut_occluders(theme: str) -> dict:
    scene_path = OUT / f"scene-{theme}.json"
    scene = json.loads(scene_path.read_text(encoding="utf-8"))
    room = Image.open(OUT / f"background-{theme}.png").convert("RGBA")
    for occ in scene.get("occluders", []):
        if occ.get("chair"):                       # a chair drawn here, not cut from the room
            img = draw_chair()
            img.save(OUT / f"chair-{theme}-{occ['name']}.png")
            cx, base = occ["chair"]
            x0, y0 = cx - img.width // 2, base - img.height
            occ.update({"image": f"chair-{theme}-{occ['name']}.png", "x": x0, "y": y0, "w": img.width, "h": img.height,
                        "depth": [[x0, base - 6], [x0 + img.width, base - 6]]})
            continue
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
        if occ.get("poly"):
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
        pose = "seated" if a.get("pose") == "desk" else ("back34" if a["face"] in ("ul", "ur") else "front34")
        fr = m["frames"][pose]
        sheet = Image.open(OUT / m["sheet"]).convert("RGBA")
        frame = sheet.crop((fr["x"], m["h"] - fr["h"], fr["x"] + fr["w"], m["h"]))
        if a["face"] in ("ur", "dr"):
            frame = frame.transpose(Image.FLIP_LEFT_RIGHT)
        w, h = round(fr["w"] * k), round(fr["h"] * k)
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
    print("sheets:", {n: {p: (f["w"], f["h"]) for p, f in m["frames"].items()} for n, m in meta.items()})
    if "--check" in argv:
        scratch = Path(argv[argv.index("--check") + 1]) if len(argv) > argv.index("--check") + 1 else ROOT
        for t, s in scenes.items():
            check(t, s, meta, scratch)
        for n, m in meta.items():
            Image.open(OUT / m["sheet"]).resize((m["h"] * 0 + Image.open(OUT / m["sheet"]).width * 6, m["h"] * 6), Image.NEAREST).save(scratch / f"sheet_zoom_{n}.png")
        print("overlays written to", scratch)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

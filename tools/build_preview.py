"""Build the static preview of Samsung Pulsar, one HTML file ready for GitHub Pages.

    python tools/build_preview.py [--out docs/preview]

The platform itself is a Python server: it reads a database, runs scenarios in the background and holds the
vault, so it cannot run on GitHub Pages (which only serves files). What this builds is a preview: the real
interface, rendered once with demonstration data, frozen into a single page whose forms are disabled. The open
space at the top stays alive, because the engine takes its data from `pulsar/static/preview.js`, a simulation
running in the visitor's browser instead of `/api/live`.

Everything is inlined (stylesheet, engine, simulation, rooms, sprites, portraits), so the result is one file
with no other asset to publish and no path to configure.
"""

from __future__ import annotations

import base64
import re
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

STATIC = ROOT / "pulsar" / "static"
SELMS_TRIAL = ("selms_extraction_v2", "SELMS+ extraction (trial)")

# the screens of the preview: the page to render, and the label shown above it
PAGES = [
    ("/", "Dashboard, the open space", "the live view, simulated in this page"),
    ("/", "Dashboard, the figures", None),
    ("/scenarios", "Scenarios", None),
    ("/scenarios/new", "Deposit a scenario, after “Check”", None),
    ("/scenarios/selms_extraction", "Scenario page, monthly SELMS+ extraction", None),
    ("/settings", "Settings", None),
    ("/runs", "History", None),
]


def data_uri(path: Path) -> str:
    kind = "image/svg+xml" if path.suffix == ".svg" else f"image/{path.suffix.lstrip('.')}"
    return f"data:{kind};base64," + base64.b64encode(path.read_bytes()).decode()


def freeze(html: str, drop_openspace: bool, keep_openspace_only: bool) -> str:
    """Keep the page body, disable everything that would need a server."""
    inner = re.search(r'<main class="page">(.*?)</main>', html, re.S).group(1)
    if keep_openspace_only:
        panel = re.search(r'<section class="panel openspace-panel">.*?</section>', inner, re.S).group(0)
        head = re.search(r"<div class=\"page-head\">.*?</div>\s*</div>", inner, re.S)
        inner = (head.group(0) if head else "") + panel
    elif drop_openspace:
        inner = re.sub(r'<section class="panel openspace-panel">.*?</section>', "", inner, count=1, flags=re.S)
    inner = re.sub(r'href="/(?!#)[^"]*"', "", inner)                      # links lead nowhere in one page
    inner = re.sub(r"<form[^>]*>", '<div class="form-static">', inner)     # forms would post to a server
    inner = inner.replace("</form>", "</div>")
    inner = inner.replace("<button ", "<button disabled ")
    inner = re.sub(r'\s*<div class="flash (?:ok|err)"[^>]*>.*?</div>', "", inner, count=1, flags=re.S)
    inner = re.sub(r'"/static/([\w\-./]+)"', lambda m: '"' + data_uri(STATIC / m.group(1)) + '"', inner)
    return '<div class="page">' + inner + "</div>"


def build(out_dir: Path) -> Path:
    from fastapi.testclient import TestClient

    from pulsar.app import create_app
    from pulsar.config import Settings

    workspace = out_dir.parent / ".preview-workspace"
    settings = Settings.from_env()
    settings = type(settings)(workspace=workspace.resolve(), scenarios_dir=(ROOT / "scenarios").resolve(),
                              host=settings.host, port=settings.port, timezone=settings.timezone, demo=True)
    app = create_app(settings, start_scheduler=False)

    with TestClient(app) as client:
        deposit = client.post("/scenarios/deposit", data={
            "code": (ROOT / "scenarios" / "selms_extraction.py").read_text(encoding="utf-8")
                    .replace('KEY = "selms_extraction"', f'KEY = "{SELMS_TRIAL[0]}"')
                    .replace('NAME = "Monthly SELMS+ extraction"', f'NAME = "{SELMS_TRIAL[1]}"'),
            "note": "", "action": "check", "replacing": ""})
        sections = []
        for i, (path, label, note) in enumerate(PAGES):
            page = deposit.text if path == "/scenarios/new" else client.get(path).text
            body = freeze(page, drop_openspace=(i == 1), keep_openspace_only=(i == 0))
            title = f'{label} <span class="mono">localhost:8765{path}</span>' + (f" ({note})" if note else "")
            sections.append(f'<section class="snap"><div class="snap-label">{title}</div>{body}</section>')

    style = (STATIC / "app.css").read_text(encoding="utf-8") + PREVIEW_CSS
    engine = (STATIC / "openspace.js").read_text(encoding="utf-8")
    simulation = (STATIC / "preview.js").read_text(encoding="utf-8")

    config = app.state.platform.openspace_config()
    for theme in ("light", "dark"):
        if config.get(theme):
            config[theme]["background"] = data_uri(STATIC / "openspace" / Path(config[theme]["background"]).name)
            for occluder in config[theme]["scene"].get("occluders", []):
                occluder["image"] = data_uri(STATIC / "openspace" / Path(occluder["image"]).name)
    for character in config["characters"]:
        character["sheet"] = data_uri(STATIC / "openspace" / Path(character["sheet"]).name)
    config["avatars"] = [data_uri(STATIC / "openspace" / Path(a).name) for a in config["avatars"]]

    import json

    page = PAGE_TEMPLATE.format(
        style=style, engine=engine, simulation=simulation, config=json.dumps(config),
        sections="\n".join(sections), date=datetime.now().strftime("%d %B %Y"))
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / "index.html"
    target.write_text(page, encoding="utf-8")
    (out_dir / ".nojekyll").write_text("", encoding="utf-8")   # GitHub Pages must serve the file as it is
    return target


PREVIEW_CSS = """
/* the preview stacks the screens of the platform on one page */
body{background:var(--paper)}
.snap{margin:0 0 40px}
.snap-label{position:sticky;top:0;z-index:5;background:var(--card);border-bottom:1px solid var(--line);padding:.5rem 28px;font-weight:600;font-size:.9rem}
.snap-label .mono{color:var(--muted);font-weight:400}
.intro{max-width:1180px;margin:0 auto;padding:22px 28px 8px;color:var(--ink-2);font-size:.92rem}
.intro h1{font-size:1.5rem;color:var(--ink);margin-bottom:.3rem}
.form-static{display:contents}
.snap a{text-decoration:none;cursor:default}
@media (max-width:900px){.snap-label{padding:.5rem 16px}.intro{padding:16px 16px 4px}}
"""

PAGE_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Samsung Pulsar, preview</title>
<script>(function(){{try{{var t=localStorage.getItem("pulsar-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t);}}catch(e){{}}}})();</script>
<style>
{style}
</style>
</head>
<body>
<div class="intro"><h1>Samsung Pulsar, preview</h1>
The platform as it stands on {date}, with demonstration data. The open space at the top is alive: the robots
Andromede, Orion and Sirius take the scenarios in turn, walk to the station of each action and sit back at their
desk, and a notice pops up at the bottom right when a run finishes. Those runs are simulated inside this page.
The screens below are the real interface rendered once, with the buttons disabled. Running the platform for real
takes a Python process on a workstation: see the README of the repository.</div>
{sections}
<script>
{engine}
</script>
<script>
{simulation}
</script>
<script>
window.pulsarScene = Openspace.start({{
  canvas: document.getElementById("openspace"),
  team: document.getElementById("team"),
  queue: document.getElementById("queue"),
  config: {config},
  poll: window.PulsarPreview.poll,
  interval: 500
}});
// the team strip links each robot to its run: there is no run page here, so the links stay inert
document.addEventListener("click", function (e) {{ if (e.target.closest("a")) e.preventDefault(); }});
</script>
</body>
</html>
"""


def main(argv: list[str]) -> int:
    out = Path(argv[argv.index("--out") + 1]) if "--out" in argv else ROOT / "docs" / "preview"
    target = build(out.resolve())
    print(f"{target} written, {target.stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

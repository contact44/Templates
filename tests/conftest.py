import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from greffier.config import Settings  # noqa: E402


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    robots = tmp_path / "robots"
    robots.mkdir()
    (robots / "ok_bot.py").write_text(
        '''
KEY = "ok_bot"
NAME = "Robot OK"
DESCRIPTION = "Traite n éléments."
SCHEDULE = "*/5 * * * *"
PARAMS = [
    {"name": "n", "label": "Nombre", "type": "int", "default": 3},
    {"name": "fail_one", "label": "Un échec", "type": "bool", "default": False},
    {"name": "mode", "label": "Mode", "type": "choice", "choices": ["a", "b"], "default": "a"},
]

def run(ctx):
    for i in range(ctx.params["n"]):
        ctx.item_done()
    if ctx.params["fail_one"]:
        ctx.item_failed("élément cassé")
    ctx.metric("mode", ctx.params["mode"])
''',
        encoding="utf-8",
    )
    (robots / "crash_bot.py").write_text(
        '''
KEY = "crash_bot"
NAME = "Robot qui plante"
def run(ctx):
    ctx.info("avant le crash")
    raise ValueError("boum")
''',
        encoding="utf-8",
    )
    (robots / "broken_file.py").write_text("NAME = 'pas de KEY'\n", encoding="utf-8")
    (robots / "_ignored.py").write_text("KEY = 'ignored'\ndef run(ctx): pass\n", encoding="utf-8")
    return Settings(workspace=tmp_path / "ws", robots_dir=robots, timezone="Europe/Paris")

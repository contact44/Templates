import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from astree.config import Settings  # noqa: E402

OK_BOT = '''
KEY = "ok_bot"
NAME = "Scénario OK"
DESCRIPTION = "Traite n éléments."
SCHEDULE = "*/5 * * * *"
PARAMS = [
    {"name": "n", "label": "Nombre", "type": "int", "default": 3},
    {"name": "fail_one", "label": "Un échec", "type": "bool", "default": False},
    {"name": "mode", "label": "Mode", "type": "choice", "choices": ["a", "b"], "default": "a"},
]

def run(ctx):
    with ctx.step("web.consulter", "source"):
        pass
    for i in ctx.step("doc.lire", "lot", range(ctx.params["n"])):
        ctx.item_done()
    if ctx.params["fail_one"]:
        ctx.item_failed("élément cassé")
    ctx.metric("mode", ctx.params["mode"])
'''


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    builtin = tmp_path / "scenarios"
    builtin.mkdir()
    (builtin / "ok_bot.py").write_text(OK_BOT, encoding="utf-8")
    (builtin / "crash_bot.py").write_text('''
KEY = "crash_bot"
NAME = "Scénario qui plante"
def run(ctx):
    ctx.info("avant le crash")
    with ctx.step("verifier", "contrôle"):
        raise ValueError("boum")
''', encoding="utf-8")
    (builtin / "secret_bot.py").write_text('''
KEY = "secret_bot"
NAME = "Scénario avec identifiant"
SCHEDULE = None
def run(ctx):
    cred = ctx.credentials("selms")
    ctx.info(f"connexion de {cred.username} avec {cred.password}")
    raise RuntimeError("échec avec " + cred.password)
''', encoding="utf-8")
    (builtin / "broken_file.py").write_text("NAME = 'pas de KEY'\n", encoding="utf-8")
    (builtin / "_ignored.py").write_text("KEY = 'ignored'\ndef run(ctx): pass\n", encoding="utf-8")
    return Settings(workspace=tmp_path / "ws", scenarios_dir=builtin, timezone="Europe/Paris")

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from pulsar.config import Settings  # noqa: E402

OK_BOT = '''
KEY = "ok_bot"
NAME = "OK scenario"
DESCRIPTION = "Processes n items."
SCHEDULE = "*/5 * * * *"
PARAMS = [
    {"name": "n", "label": "Count", "type": "int", "default": 3},
    {"name": "fail_one", "label": "One failure", "type": "bool", "default": False},
    {"name": "mode", "label": "Mode", "type": "choice", "choices": ["a", "b"], "default": "a"},
]

def run(ctx):
    with ctx.step("web.browse", "source"):
        pass
    for i in ctx.step("doc.read", "batch", range(ctx.params["n"])):
        ctx.item_done()
    if ctx.params["fail_one"]:
        ctx.item_failed("broken item")
    ctx.metric("mode", ctx.params["mode"])
'''


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    builtin = tmp_path / "scenarios"
    builtin.mkdir()
    (builtin / "ok_bot.py").write_text(OK_BOT, encoding="utf-8")
    (builtin / "crash_bot.py").write_text('''
KEY = "crash_bot"
NAME = "Crashing scenario"
def run(ctx):
    ctx.info("before the crash")
    with ctx.step("verify", "check"):
        raise ValueError("boom")
''', encoding="utf-8")
    (builtin / "secret_bot.py").write_text('''
KEY = "secret_bot"
NAME = "Scenario with a credential"
SCHEDULE = None
def run(ctx):
    cred = ctx.credentials("selms")
    ctx.info(f"signing in as {cred.username} with {cred.password}")
    raise RuntimeError("failed with " + cred.password)
''', encoding="utf-8")
    (builtin / "broken_file.py").write_text("NAME = 'no KEY'\n", encoding="utf-8")
    (builtin / "_ignored.py").write_text("KEY = 'ignored'\ndef run(ctx): pass\n", encoding="utf-8")
    return Settings(workspace=tmp_path / "ws", scenarios_dir=builtin, timezone="Europe/Paris")

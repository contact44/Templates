import time
from datetime import timedelta

from fastapi.testclient import TestClient

from astree import db as dbm
from astree.app import Platform, create_app
from astree.registry import Registry, inspect_source
from astree.scheduler import validate_cron
from astree.stats import dashboard, day_bars, sparkline
from astree.vault import Vault, mask

DEPOSIT = '''
KEY = "depose"
NAME = "Scénario déposé"
SCHEDULE = "0 7 28 * *"
import urllib.request
def run(ctx):
    with ctx.step("web.consulter", "SELMS+"):
        pass
    ctx.step("archiver")
'''


def test_registry_discovers_builtin_and_deposited(settings):
    settings.deposited_dir.mkdir(parents=True)
    (settings.deposited_dir / "depose.py").write_text(DEPOSIT, encoding="utf-8")
    (settings.deposited_dir / "dup.py").write_text('KEY = "ok_bot"\ndef run(ctx): pass\n', encoding="utf-8")
    reg = Registry(settings.scenarios_dir, settings.deposited_dir).reload()
    assert set(reg.scenarios) == {"ok_bot", "crash_bot", "secret_bot", "depose"}
    assert reg.get("depose").source == "deposited" and reg.get("depose").actions == ["web.consulter", "archiver"]
    assert "broken_file.py" in reg.errors and "dup.py" in reg.errors and "_ignored.py" not in reg.errors


def test_inspect_source_reports_every_check(settings):
    reg = Registry(settings.scenarios_dir).reload()
    keys = reg.keys_by_source()
    bad = inspect_source("def run(ctx:\n", settings.workspace / "tmp", keys)
    assert not bad.valid and "syntaxe" in bad.checks[0].text.lower()
    no_key = inspect_source("NAME = 'x'\ndef run(ctx): pass\n", settings.workspace / "tmp", keys)
    assert not no_key.valid and "KEY" in no_key.checks[1].text
    clash = inspect_source('KEY = "ok_bot"\ndef run(ctx): pass\n', settings.workspace / "tmp", keys)
    assert not clash.valid
    good = inspect_source(DEPOSIT, settings.workspace / "tmp", keys)
    assert good.valid and good.key == "depose" and good.actions == ["web.consulter", "archiver"]
    texts = " ".join(c.text for c in good.checks)
    assert "urllib" in texts and "Planification" in texts
    same = inspect_source(DEPOSIT, settings.workspace / "tmp", {**keys, "depose": "deposited"}, replacing="depose")
    assert same.valid and any("Nouvelle version" in c.text for c in same.checks)


def test_runner_records_steps_counters_and_errors(settings):
    platform = Platform(settings)
    run = platform.runner.execute(platform.db.create_run("ok_bot", "cli"))
    assert run["status"] == dbm.STATUS_SUCCESS and run["items"] == 3 and run["metrics"] == {"mode": "a"}
    steps = platform.db.steps(run["id"])
    assert [s["kind"] for s in steps] == ["web.consulter", "doc.lire"] and all(s["status"] == "success" for s in steps)
    platform.db.save_config("ok_bot", True, None, {"n": 2, "fail_one": True, "mode": "b"})
    run = platform.runner.execute(platform.db.create_run("ok_bot", "cli"))
    assert run["status"] == dbm.STATUS_WARNING and run["items"] == 2 and run["errors"] == 1
    run = platform.runner.execute(platform.db.create_run("crash_bot", "cli"))
    assert run["status"] == dbm.STATUS_ERROR and "boum" in run["message"]
    assert platform.db.steps(run["id"])[0]["status"] == "error"
    assert "trace" in [l["level"] for l in platform.db.logs(run["id"])]
    platform.db.close()


def test_credentials_come_from_the_vault_and_never_reach_the_journal(settings):
    platform = Platform(settings)
    run = platform.runner.execute(platform.db.create_run("secret_bot", "cli"))
    assert run["status"] == dbm.STATUS_ERROR and "absent du coffre" in run["message"]
    platform.db.save_credential("selms", "cm@samsung", "compte générique")
    platform.vault.set_password("selms", "S3cret!Pass")
    run = platform.runner.execute(platform.db.create_run("secret_bot", "cli"))
    journal = " ".join(l["message"] for l in platform.db.logs(run["id"])) + " " + run["message"]
    assert "cm@samsung" in journal and "S3cret!Pass" not in journal and "•••••" in journal
    platform.db.close()


def test_vault_file_backend_encrypts_on_disk(settings):
    vault = Vault(settings.workspace)
    vault.backend = "file"
    vault.set_password("selms", "motdepasse")
    assert vault.get_password("selms") == "motdepasse"
    raw = (settings.workspace / "vault.bin").read_bytes()
    assert b"motdepasse" not in raw
    vault.delete_password("selms")
    assert vault.get_password("selms") is None
    assert mask("mot de passe motdepasse", ["motdepasse"]) == "mot de passe •••••"


def test_team_runs_queued_work_on_named_robots(settings):
    platform = Platform(settings)
    platform.team.start()
    assert platform.team.names == ["Vega", "Altaïr", "Deneb"]
    run_id = platform.team.enqueue("ok_bot", "manual")
    assert platform.team.enqueue("ok_bot", "manual") is None  # already queued or running
    for _ in range(100):
        run = platform.db.run(run_id)
        if run["status"] in dbm.FINAL_STATUSES:
            break
        time.sleep(0.05)
    assert run["status"] == dbm.STATUS_SUCCESS and run["worker"] in (0, 1, 2)
    platform.team.rename(["Un", "Deux"])
    assert platform.team.names == ["Un", "Deux"]
    platform.stop()


def test_stale_runs_are_closed_on_start(settings):
    platform = Platform(settings)
    platform.db.create_run("ok_bot", "manual")
    rid = platform.db.create_run("ok_bot", "manual")
    platform.db.start_run(rid, 0)
    assert platform.db.mark_stale_runs() == 2
    assert platform.db.queued_runs() == []
    platform.db.close()


def test_validate_cron():
    assert validate_cron("0 7 28 * *", "Europe/Paris") is None
    assert validate_cron("pas du cron", "Europe/Paris")


def test_stats_geometry(settings):
    platform = Platform(settings)
    now = dbm.utcnow()
    for day, status in ((0, "success"), (0, "error"), (1, "warning"), (20, "success")):
        rid = platform.db.create_run("ok_bot", "demo", queued_at=now - timedelta(days=day, minutes=5))
        platform.db.start_run(rid, 1, started_at=now - timedelta(days=day, minutes=5))
        platform.db.finish_run(rid, status, items=5, finished_at=now - timedelta(days=day))
    bars = day_bars(platform.db.runs_since(now - timedelta(days=13)), "Europe/Paris")
    assert len(bars["columns"]) == 14 and bars["columns"][-1]["success"] == 1 and bars["columns"][-1]["error"] == 1
    d = dashboard(platform.db, platform.registry, platform.scheduler, platform.team, "Europe/Paris")
    assert d["today"]["runs"] == 2 and d["week"]["runs"] == 3 and d["week"]["rate"] == 33 and len(d["team"]) == 3
    platform.db.close()
    assert sparkline([100, 300, 200])["points"].count(",") == 3


def test_http_pages_deposit_and_settings(settings):
    app = create_app(settings, start_scheduler=False)
    with TestClient(app) as client:
        assert client.get("/health").json()["team"] == ["Vega", "Altaïr", "Deneb"]
        for path in ("/", "/scenarios", "/scenarios/nouveau", "/scenarios/ok_bot", "/openspace", "/parametres", "/runs", "/api/live", "/api/dashboard"):
            assert client.get(path).status_code == 200, path
        assert client.get("/scenarios/nope").status_code == 404
        assert client.get("/atelier", follow_redirects=False).status_code == 307

        # deposit: check, then save, then a second version, then restore
        r = client.post("/scenarios/deposer", data={"code": DEPOSIT, "action": "check"})
        assert r.status_code == 200 and "prêt à enregistrer" in r.text
        r = client.post("/scenarios/deposer", data={"code": DEPOSIT, "action": "save", "note": "première"}, follow_redirects=False)
        assert r.status_code == 303 and r.headers["location"].startswith("/scenarios/depose")
        platform = app.state.platform
        assert platform.registry.get("depose").source == "deposited" and platform.db.current_version("depose") == 1
        v2 = DEPOSIT.replace("Scénario déposé", "Scénario déposé v2")
        client.post("/scenarios/deposer", data={"code": v2, "action": "save", "replacing": "depose"}, follow_redirects=False)
        assert platform.db.current_version("depose") == 2 and platform.registry.get("depose").name == "Scénario déposé v2"
        client.post("/scenarios/depose/versions/1/restaurer", follow_redirects=False)
        assert platform.db.current_version("depose") == 3 and platform.registry.get("depose").name == "Scénario déposé"
        r = client.post("/scenarios/deposer", data={"code": "def run(ctx:\n", "action": "save"})
        assert r.status_code == 200 and "à corriger" in r.text
        r = client.post("/scenarios/deposer", data={"code": DEPOSIT.replace('"depose"', '"ok_bot"'), "action": "check"})
        assert "déjà utilisée" in r.text

        # configuration
        r = client.post("/scenarios/ok_bot/config", data={"enabled": "on", "schedule": "0 7 28 * *", "n": "5", "mode": "b"}, follow_redirects=False)
        assert "ok=" in r.headers["location"] and platform.db.get_config("ok_bot")["params"]["n"] == 5
        assert "err=" in client.post("/scenarios/ok_bot/config", data={"schedule": "nope"}, follow_redirects=False).headers["location"]

        # team and credentials
        client.post("/parametres/equipe", data=[("names", "Vega"), ("names", "Altaïr"), ("names", "Deneb"), ("names", "")], follow_redirects=False)
        assert platform.team.names == ["Vega", "Altaïr", "Deneb"]
        r = client.post("/parametres/identifiants", data={"name": "SELMS", "username": "cm@samsung", "password": "pw", "note": "générique"}, follow_redirects=False)
        assert "ok=" in r.headers["location"] and platform.db.credential("selms")["username"] == "cm@samsung" and platform.vault.get_password("selms") == "pw"
        client.post("/parametres/identifiants", data={"name": "selms", "username": "cm2@samsung", "password": ""}, follow_redirects=False)
        assert platform.db.credential("selms")["username"] == "cm2@samsung" and platform.vault.get_password("selms") == "pw"
        page = client.get("/parametres").text
        assert "cm2@samsung" in page
        client.post("/parametres/identifiants/selms/supprimer", follow_redirects=False)
        assert platform.db.credential("selms") is None

        rid = platform.db.create_run("ok_bot", "cli")
        platform.runner.execute(rid)
        page = client.get(f"/runs/{rid}")
        assert page.status_code == 200 and "Journal" in page.text and "web.consulter" in page.text


def test_demo_mode_seeds_and_runs_inline(settings):
    settings.demo = True
    app = create_app(settings, start_scheduler=True)
    with TestClient(app) as client:
        assert app.state.platform.db.count_runs() > 0
        assert "Aperçu en ligne" in client.get("/").text
        r = client.post("/scenarios/ok_bot/run", follow_redirects=False)
        assert r.headers["location"].startswith("/runs/")
        live = client.get("/api/live").json()
        assert len(live["team"]) == 3 and live["scenarios"][0]["key"]

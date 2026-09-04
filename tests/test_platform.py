from datetime import timedelta

from fastapi.testclient import TestClient

from greffier import db as dbm
from greffier.app import Platform, create_app
from greffier.registry import Registry
from greffier.scheduler import validate_cron
from greffier.stats import dashboard, day_bars, sparkline


def test_registry_discovers_valid_robots_and_reports_broken_files(settings):
    reg = Registry(settings.robots_dir).reload()
    assert set(reg.robots) == {"ok_bot", "crash_bot"}
    assert "broken_file.py" in reg.errors
    assert "_ignored.py" not in reg.errors


def test_param_coercion_collects_errors(settings):
    reg = Registry(settings.robots_dir).reload()
    spec = reg.get("ok_bot")
    assert spec.coerce_params({"n": "7", "fail_one": "on", "mode": "b"}) == {"n": 7, "fail_one": True, "mode": "b"}
    assert spec.coerce_params({}) == {"n": 3, "fail_one": False, "mode": "a"}
    try:
        spec.coerce_params({"n": "abc", "mode": "z"})
    except ValueError as e:
        assert "Nombre" in str(e) and "Mode" in str(e)
    else:
        raise AssertionError("expected ValueError")


def test_runner_records_success_warning_and_error(settings):
    platform = Platform(settings)
    run_id = platform.runner.execute("ok_bot", trigger="cli")
    run = platform.db.run(run_id)
    assert run["status"] == dbm.STATUS_SUCCESS and run["items"] == 3 and run["metrics"] == {"mode": "a"}
    assert run["duration_ms"] is not None and run["finished_at"]

    platform.db.save_config("ok_bot", True, None, {"n": 2, "fail_one": True, "mode": "b"})
    run = platform.db.run(platform.runner.execute("ok_bot"))
    assert run["status"] == dbm.STATUS_WARNING and run["items"] == 2 and run["errors"] == 1

    run = platform.db.run(platform.runner.execute("crash_bot"))
    assert run["status"] == dbm.STATUS_ERROR and "boum" in run["message"]
    levels = [l["level"] for l in platform.db.logs(run["id"])]
    assert "error" in levels and "trace" in levels
    platform.db.close()


def test_stale_runs_are_closed_on_start(settings):
    platform = Platform(settings)
    platform.db.create_run("ok_bot", "manual")
    assert platform.db.mark_stale_runs() == 1
    assert platform.db.runs(status=dbm.STATUS_RUNNING) == []
    platform.db.close()


def test_validate_cron():
    assert validate_cron("*/15 8-19 * * 1-5", "Europe/Paris") is None
    assert validate_cron("pas du cron", "Europe/Paris")


def test_stats_geometry(settings):
    platform = Platform(settings)
    now = dbm.utcnow()
    for day, status in ((0, "success"), (0, "error"), (1, "warning"), (20, "success")):
        rid = platform.db.create_run("ok_bot", "demo", started_at=now - timedelta(days=day, minutes=5))
        platform.db.finish_run(rid, status, items=5, finished_at=now - timedelta(days=day))
    bars = day_bars(platform.db.runs_since(now - timedelta(days=13)), "Europe/Paris")
    assert len(bars["columns"]) == 14
    today = bars["columns"][-1]
    assert today["success"] == 1 and today["error"] == 1 and len(today["segments"]) == 2
    assert bars["columns"][-2]["warning"] == 1
    d = dashboard(platform.db, platform.registry, platform.scheduler, "Europe/Paris")
    assert d["today"]["runs"] == 2 and d["week"]["runs"] == 3 and d["week"]["rate"] == 33
    assert d["robots"][0]["key"] in {"ok_bot", "crash_bot"}
    platform.db.close()
    s = sparkline([100, 300, 200])
    assert s["last"] and s["points"].count(",") == 3
    assert sparkline([]) == {"points": "", "last": None, "area": ""}


def test_http_pages_and_config_flow(settings):
    app = create_app(settings, start_scheduler=False)
    with TestClient(app) as client:
        assert client.get("/health").json()["robots"] == 2
        for path in ("/", "/robots", "/robots/ok_bot", "/runs", "/api/dashboard", "/api/robots"):
            r = client.get(path)
            assert r.status_code == 200, path
        assert client.get("/robots/nope").status_code == 404

        r = client.post("/robots/ok_bot/config", data={"enabled": "on", "schedule": "0 7 * * 1", "n": "5", "mode": "b"}, follow_redirects=False)
        assert r.status_code == 303 and "ok=" in r.headers["location"]
        cfg = app.state.platform.db.get_config("ok_bot")
        assert cfg["schedule"] == "0 7 * * 1" and cfg["params"]["n"] == 5 and cfg["params"]["fail_one"] is False

        r = client.post("/robots/ok_bot/config", data={"schedule": "nope", "n": "5"}, follow_redirects=False)
        assert "err=" in r.headers["location"]
        r = client.post("/robots/ok_bot/config", data={"n": "abc"}, follow_redirects=False)
        assert "err=" in r.headers["location"]

        run_id = app.state.platform.runner.execute("ok_bot")
        page = client.get(f"/runs/{run_id}")
        assert page.status_code == 200 and "Journal" in page.text
        assert client.get("/runs/999").status_code == 404
        assert "Robot OK" in client.get("/runs?robot=ok_bot").text

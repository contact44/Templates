"""HTTP interface: dashboard, scenarios (deposit, versions, configuration), open space, settings, run history."""

from __future__ import annotations

import hashlib
import logging
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from . import stats
from .config import APP_NAME, DEPARTMENT, SHORT_NAME, Settings
from .db import Database
from .registry import ACTION_KINDS, Inspection, Registry, inspect_source
from .runner import Runner
from .scheduler import Scheduler, validate_cron
from .team import Team
from .vault import Vault

HERE = Path(__file__).resolve().parent
STATUS_LABELS = {"queued": "Queued", "running": "Running", "success": "Success", "warning": "With warnings", "error": "Failed"}
TRIGGER_LABELS = {"manual": "manual", "schedule": "scheduled", "cli": "command line", "demo": "demo"}
SOURCE_LABELS = {"builtin": "shipped with the code", "deposited": "deposited"}


def fmt_dt(value, tz: str) -> str:
    local = stats.to_local(value, tz)
    if local is None:
        return "—"
    if local.date() == datetime.now(local.tzinfo).date():
        return f"today {local:%H:%M}"
    return f"{local:%d %b %H:%M}"


def fmt_short(value, tz: str) -> str:
    local = stats.to_local(value, tz)
    if local is None:
        return ""
    return f"{local:%H:%M}" if local.date() == datetime.now(local.tzinfo).date() else f"{local:%d/%m %H:%M}"


def fmt_long_date(dt: datetime) -> str:
    return f"{dt:%A} {dt.day} {dt:%B %Y} · {dt:%H:%M}"


def fmt_ms(value) -> str:
    if value is None:
        return "—"
    ms = int(value)
    if ms < 1000:
        return f"{ms} ms"
    s = ms / 1000
    if s < 60:
        return f"{s:.1f} s" if s < 10 else f"{s:.0f} s"
    m, s = divmod(int(s), 60)
    if m < 60:
        return f"{m} min {s:02d} s"
    h, m = divmod(m, 60)
    return f"{h} h {m:02d}"


def fmt_int(value) -> str:
    return "—" if value is None else f"{int(value):,}"


class Platform:
    """Everything the routes need, built once per process."""

    def __init__(self, settings: Settings):
        self.settings = settings
        settings.deposited_dir.mkdir(parents=True, exist_ok=True)
        self.db = Database(settings.db_path)
        self.vault = Vault(settings.workspace)
        self.registry = Registry(settings.scenarios_dir, settings.deposited_dir).reload()
        self.runner = Runner(self.db, self.registry, settings.workspace, self.vault)
        self.team = Team(self.db, self.runner, inline=settings.demo)
        self.scheduler = Scheduler(self.db, self.registry, self.team, settings.timezone)
        if settings.demo and self.db.count_runs() == 0:
            from .demo import seed

            seed(self.db, self.registry, team_size=self.team.size)

    def start(self) -> None:
        stale = self.db.mark_stale_runs()
        if stale:
            logging.getLogger("pulsar").warning("%d interrupted run(s) marked as failed", stale)
        self.team.start()
        if not self.settings.demo:
            self.scheduler.start()

    def stop(self) -> None:
        self.scheduler.shutdown()
        self.team.stop()
        self.db.close()

    # -- scenario deposit -------------------------------------------------------------------

    def inspect(self, code: str, replacing: str | None = None) -> Inspection:
        return inspect_source(code, self.settings.workspace / "tmp", self.registry.keys_by_source(), replacing)

    def deposit(self, code: str, note: str | None = None, replacing: str | None = None) -> tuple[Inspection, int | None]:
        """Check the code; when valid, store it as the current version of its scenario and load it."""
        inspection = self.inspect(code, replacing)
        if not inspection.valid:
            return inspection, None
        key = inspection.key
        version = (self.db.current_version(key) or 0) + 1
        vdir = self.settings.versions_dir / key
        vdir.mkdir(parents=True, exist_ok=True)
        vpath = vdir / f"v{version}.py"
        vpath.write_text(code, encoding="utf-8")
        (self.settings.deposited_dir / f"{key}.py").write_text(code, encoding="utf-8")
        self.db.add_version(key, str(vpath), hashlib.sha256(code.encode("utf-8")).hexdigest(), note)
        self.registry.reload()
        self.scheduler.sync()
        return inspection, version

    def restore(self, key: str, version: int) -> int | None:
        v = self.db.version(key, version)
        if v is None or not Path(v["path"]).exists():
            return None
        code = Path(v["path"]).read_text(encoding="utf-8")
        _, new_version = self.deposit(code, note=f"Restored version {version}", replacing=key)
        return new_version

    def remove_deposited(self, key: str) -> bool:
        scenario = self.registry.get(key)
        if scenario is None or scenario.source != "deposited":
            return False
        current = self.settings.deposited_dir / f"{key}.py"
        if current.exists():
            current.unlink()
        self.registry.reload()
        self.scheduler.sync()
        return True


def create_app(settings: Settings | None = None, start_scheduler: bool = True) -> FastAPI:
    settings = settings or Settings.from_env()
    platform = Platform(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if start_scheduler:
            platform.start()
        yield
        platform.stop()

    app = FastAPI(title=APP_NAME, lifespan=lifespan, docs_url=None, redoc_url=None)
    app.state.platform = platform
    app.mount("/static", StaticFiles(directory=HERE / "static"), name="static")
    templates = Jinja2Templates(directory=HERE / "templates")
    tz = settings.timezone
    env = templates.env
    env.filters["dt"] = lambda v: fmt_dt(v, tz)
    env.filters["short"] = lambda v: fmt_short(v, tz)
    env.filters["ms"] = fmt_ms
    env.filters["n"] = fmt_int
    env.filters["status_label"] = lambda s: STATUS_LABELS.get(s, s or "—")
    env.filters["trigger_label"] = lambda s: TRIGGER_LABELS.get(s, s)
    env.filters["source_label"] = lambda s: SOURCE_LABELS.get(s, s)
    env.globals["app_name"] = APP_NAME
    env.globals["short_name"] = SHORT_NAME
    env.globals["department"] = DEPARTMENT
    env.globals["demo_mode"] = settings.demo
    env.globals["now_label"] = lambda: fmt_long_date(datetime.now(stats.ZoneInfo(tz)))
    env.globals["team_names"] = lambda: platform.team.names
    env.globals["action_kinds"] = ACTION_KINDS

    def render(request: Request, name: str, **ctx):
        ctx.setdefault("flash_ok", request.query_params.get("ok"))
        ctx.setdefault("flash_err", request.query_params.get("err"))
        ctx.setdefault("path", request.url.path)
        return templates.TemplateResponse(request, name, ctx)

    def redirect(path: str, ok: str | None = None, err: str | None = None) -> RedirectResponse:
        query = {k: v for k, v in (("ok", ok), ("err", err)) if v}
        return RedirectResponse(path + (("?" + urlencode(query)) if query else ""), status_code=303)

    def scenario_or_404(key: str):
        scenario = platform.registry.get(key)
        if scenario is None:
            raise HTTPException(404, "Unknown scenario")
        return scenario

    def names() -> dict:
        return {s.key: s.name for s in platform.registry}

    # -- dashboard ---------------------------------------------------------------------------

    @app.get("/", response_class=HTMLResponse)
    def dashboard(request: Request):
        return render(request, "dashboard.html", d=stats.dashboard(platform.db, platform.registry, platform.scheduler, platform.team, tz))

    # -- scenarios -----------------------------------------------------------------------------

    @app.get("/scenarios", response_class=HTMLResponse)
    def scenarios(request: Request):
        rows = []
        for s in platform.registry:
            rows.append({"spec": s, "enabled": platform.scheduler.is_enabled(s.key), "schedule": platform.scheduler.effective_schedule(s.key),
                         "next_run": platform.scheduler.next_run(s.key), "last": platform.db.last_run(s.key, finished_only=True),
                         "active": platform.db.active_run(s.key), "version": platform.db.current_version(s.key)})
        return render(request, "scenarios.html", rows=rows, load_errors=platform.registry.errors,
                      builtin_dir=platform.settings.scenarios_dir, deposited_dir=platform.settings.deposited_dir)

    @app.get("/scenarios/new", response_class=HTMLResponse)
    def scenario_new(request: Request, replacing: str | None = None):
        code = ""
        if replacing:
            code = scenario_or_404(replacing).path.read_text(encoding="utf-8")
        return render(request, "scenario_new.html", code=code, note="", inspection=None, replacing=replacing or "")

    @app.post("/scenarios/deposit", response_class=HTMLResponse)
    async def scenario_deposit(request: Request):
        form = await request.form()
        code = (form.get("code") or "")
        upload = form.get("file")
        if upload is not None and getattr(upload, "filename", ""):
            code = (await upload.read()).decode("utf-8", errors="replace")
        code = code.replace("\r\n", "\n")
        note = (form.get("note") or "").strip() or None
        replacing = (form.get("replacing") or "").strip() or None
        action = form.get("action") or "check"
        if not code.strip():
            return render(request, "scenario_new.html", code="", note=note or "", inspection=None, replacing=replacing or "",
                          flash_err="No code: paste the scenario or drop a .py file.")
        if action == "save":
            inspection, version = platform.deposit(code, note, replacing)
            if version:
                return redirect(f"/scenarios/{inspection.key}", ok=f"Version {version} saved and loaded.")
            return render(request, "scenario_new.html", code=code, note=note or "", inspection=inspection, replacing=replacing or "",
                          flash_err="The scenario was not saved: fix the items marked as errors.")
        inspection = platform.inspect(code, replacing)
        return render(request, "scenario_new.html", code=code, note=note or "", inspection=inspection, replacing=replacing or "")

    @app.get("/scenarios/{key}", response_class=HTMLResponse)
    def scenario_detail(request: Request, key: str):
        s = scenario_or_404(key)
        config = platform.db.get_config(key)
        params = {**s.defaults(), **(config["params"] if config else {})}
        week = platform.db.runs_since(stats.local_midnight_utc(tz, 6), key)
        return render(request, "scenario.html", scenario=s, params=params, enabled=platform.scheduler.is_enabled(key),
                      schedule=platform.scheduler.effective_schedule(key) or "", next_run=platform.scheduler.next_run(key),
                      runs=platform.db.runs(key, limit=25), active=platform.db.active_run(key), versions=platform.db.versions(key),
                      rate=stats._rate(week), avg_ms=stats._avg_ms(week), runs_7d=len(week), items_7d=sum(r["items"] for r in week),
                      total_runs=platform.db.count_runs(key), code=s.path.read_text(encoding="utf-8"))

    @app.post("/scenarios/{key}/config")
    async def scenario_config(request: Request, key: str):
        s = scenario_or_404(key)
        form = await request.form()
        enabled = form.get("enabled") == "on"
        schedule = (form.get("schedule") or "").strip() or None
        if schedule:
            err = validate_cron(schedule, tz)
            if err:
                return redirect(f"/scenarios/{key}", err=err)
        try:
            params = s.coerce_params({k: v for k, v in form.items()})
        except ValueError as e:
            return redirect(f"/scenarios/{key}", err=str(e))
        platform.db.save_config(key, enabled, schedule, params)
        platform.scheduler.sync()
        return redirect(f"/scenarios/{key}", ok="Configuration saved.")

    @app.post("/scenarios/{key}/run")
    def scenario_run(key: str, request: Request):
        s = scenario_or_404(key)
        run_id = platform.team.enqueue(key, "manual")
        back = request.headers.get("referer") or ""
        target = "/openspace" if back.endswith("/openspace") else f"/scenarios/{key}"
        if run_id is None:
            return redirect(target, err=f"{s.name} is already queued or running.")
        if settings.demo:
            return redirect(f"/runs/{run_id}", ok=f"{s.name} executed.")
        return redirect(target, ok=f"{s.name} handed to the team.")

    @app.post("/scenarios/{key}/versions/{version}/restore")
    def scenario_restore(key: str, version: int):
        scenario_or_404(key)
        new_version = platform.restore(key, version)
        if new_version is None:
            return redirect(f"/scenarios/{key}", err="Version not found.")
        return redirect(f"/scenarios/{key}", ok=f"Version {version} restored as version {new_version}.")

    @app.post("/scenarios/{key}/remove")
    def scenario_remove(key: str):
        if not platform.remove_deposited(key):
            return redirect(f"/scenarios/{key}", err="Only a deposited scenario can be removed; its versions are kept.")
        return redirect("/scenarios", ok=f"Scenario '{key}' removed. Its versions remain available for a new deposit.")

    @app.post("/scenarios/reload")
    def scenarios_reload():
        platform.registry.reload()
        platform.scheduler.sync()
        msg = f"{len(platform.registry)} scenario(s) loaded."
        if platform.registry.errors:
            msg += f" {len(platform.registry.errors)} file(s) with errors."
        return redirect("/scenarios", ok=msg)

    # -- open space ------------------------------------------------------------------------------

    @app.get("/openspace", response_class=HTMLResponse)
    def openspace(request: Request):
        return render(request, "openspace.html", scenarios=list(platform.registry), team=platform.team.names)

    # -- settings ---------------------------------------------------------------------------------

    @app.get("/settings", response_class=HTMLResponse)
    def settings_page(request: Request):
        return render(request, "settings.html", team=platform.team.names, credentials=platform.db.credentials(),
                      vault_backend=platform.vault.backend, vault_label=platform.vault.backend_label, settings=platform.settings)

    @app.post("/settings/team")
    async def settings_team(request: Request):
        form = await request.form()
        names_ = [v for k, v in form.multi_items() if k == "names"]
        try:
            platform.team.rename(names_)
        except ValueError as e:
            return redirect("/settings", err=str(e))
        msg = "Robot names saved."
        if len(platform.team.names) != len(platform.team._busy) and not settings.demo:
            msg += " The number of robots changes the next time the platform starts."
        return redirect("/settings", ok=msg)

    @app.post("/settings/credentials")
    async def settings_credential(request: Request):
        form = await request.form()
        name = (form.get("name") or "").strip().lower().replace(" ", "_")
        username = (form.get("username") or "").strip()
        password = form.get("password") or ""
        note = (form.get("note") or "").strip() or None
        if not name or not all(c.isalnum() or c in "_-." for c in name):
            return redirect("/settings", err="The credential name may only contain letters, digits, _ - and dots.")
        if not username:
            return redirect("/settings", err="The username is required.")
        existing = platform.db.credential(name)
        if not password and not existing:
            return redirect("/settings", err="A password is required for a new credential.")
        platform.db.save_credential(name, username, note)
        if password:
            platform.vault.set_password(name, password)
        return redirect("/settings", ok=f"Credential '{name}' saved" + ("" if password else " (password unchanged)") + ".")

    @app.post("/settings/credentials/{name}/delete")
    def settings_credential_delete(name: str):
        platform.db.delete_credential(name)
        platform.vault.delete_password(name)
        return redirect("/settings", ok=f"Credential '{name}' deleted.")

    # -- runs ---------------------------------------------------------------------------------------

    @app.get("/runs", response_class=HTMLResponse)
    def runs(request: Request, scenario: str | None = None, status: str | None = None, page: int = 1):
        per_page = 40
        page = max(1, page)
        rows = platform.db.runs(scenario or None, status or None, limit=per_page, offset=(page - 1) * per_page)
        total = platform.db.count_runs(scenario or None, status or None)
        return render(request, "runs.html", runs=rows, names=names(), scenario=scenario or "", status=status or "",
                      page=page, pages=max(1, -(-total // per_page)), total=total, statuses=STATUS_LABELS, team=platform.team.names)

    @app.get("/runs/{run_id}", response_class=HTMLResponse)
    def run_detail(request: Request, run_id: int):
        run = platform.db.run(run_id)
        if run is None:
            raise HTTPException(404, "Unknown run")
        return render(request, "run.html", run=run, scenario=platform.registry.get(run["scenario_key"]), logs=platform.db.logs(run_id),
                      steps=platform.db.steps(run_id), team=platform.team.names)

    # -- json ---------------------------------------------------------------------------------------

    @app.get("/api/live")
    def api_live():
        now = datetime.now(stats.ZoneInfo(tz))
        by_run = {w["run_id"]: w for w in platform.team.status() if w["run_id"]}
        scenarios_ = []
        for s in platform.registry:
            last = platform.db.last_run(s.key, finished_only=True)
            active = platform.db.active_run(s.key)
            live = platform.runner.progress.get(active["id"]) if active else None
            worker = by_run.get(active["id"]) if active else None
            enabled = platform.scheduler.is_enabled(s.key)
            state = "running" if (active and active["status"] == "running") else "queued" if active else "off" if not enabled else "idle"
            next_run = platform.scheduler.next_run(s.key)
            scenarios_.append({
                "key": s.key, "name": s.name, "enabled": enabled, "state": state,
                "items": live["items"] if live else 0, "errors": live["errors"] if live else 0,
                "step": live["step"] if live else None, "run_id": active["id"] if active else None,
                "worker": worker["name"] if worker else None,
                "last": {"id": last["id"], "status": last["status"], "finished_at": last["finished_at"], "items": last["items"],
                         "errors": last["errors"], "message": last["message"]} if last else None,
                "next_run": fmt_short(next_run, tz) if next_run else None,
            })
        nm = names()
        team = [{**w, "scenario_name": nm.get(w["scenario_key"]) if w["scenario_key"] else None} for w in platform.team.status()]
        events = [{"id": r["id"], "scenario_key": r["scenario_key"], "scenario_name": nm.get(r["scenario_key"], r["scenario_key"]),
                   "status": r["status"], "started": fmt_dt(r["started_at"], tz), "items": r["items"], "message": r["message"],
                   "worker": platform.team.names[r["worker"]] if r["worker"] is not None and r["worker"] < len(platform.team.names) else None}
                  for r in platform.db.runs(limit=8)]
        return JSONResponse({"now": now.isoformat(), "clock": now.strftime("%H:%M"), "scenarios": scenarios_, "team": team,
                             "queued": [{"id": r["id"], "scenario_name": nm.get(r["scenario_key"], r["scenario_key"])} for r in platform.team.queued()],
                             "events": events, "demo": settings.demo})

    @app.get("/api/dashboard")
    def api_dashboard():
        return JSONResponse(_jsonable(stats.dashboard(platform.db, platform.registry, platform.scheduler, platform.team, tz)))

    @app.get("/favicon.ico", include_in_schema=False)
    def favicon():
        return RedirectResponse("/static/favicon.svg")

    @app.get("/health")
    def health():
        return {"status": "ok", "scenarios": len(platform.registry), "team": platform.team.names}

    return app


def _jsonable(value):
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value

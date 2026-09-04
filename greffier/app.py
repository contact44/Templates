"""HTTP interface: dashboard, robot configuration, run history."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode

from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from . import stats
from .config import APP_NAME, Settings
from .db import Database
from .registry import Registry
from .runner import Runner
from .scheduler import Scheduler, validate_cron

HERE = Path(__file__).resolve().parent
STATUS_LABELS = {"running": "En cours", "success": "Réussi", "warning": "Avec réserves", "error": "Échec"}
TRIGGER_LABELS = {"manual": "manuel", "schedule": "planifié", "cli": "ligne de commande", "demo": "démo"}


def fmt_dt(value, tz: str) -> str:
    local = stats.to_local(value, tz)
    if local is None:
        return "—"
    today = datetime.now(local.tzinfo).date()
    if local.date() == today:
        return f"aujourd'hui {local:%H:%M}"
    return f"{local:%d/%m %H:%M}"


def fmt_short(value, tz: str) -> str:
    """HH:MM today, otherwise dd/mm HH:MM. Fits on a pixel nameplate."""
    local = stats.to_local(value, tz)
    if local is None:
        return ""
    return f"{local:%H:%M}" if local.date() == datetime.now(local.tzinfo).date() else f"{local:%d/%m %H:%M}"


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


FR_DAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
FR_MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]


def fmt_long_date(dt: datetime) -> str:
    return f"{FR_DAYS[dt.weekday()].capitalize()} {dt.day} {FR_MONTHS[dt.month - 1]} {dt.year} · {dt:%H:%M}"


def fmt_int(value) -> str:
    if value is None:
        return "—"
    return f"{int(value):,}".replace(",", " ")


class Platform:
    """Everything the routes need, built once per process."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.db = Database(settings.db_path)
        self.registry = Registry(settings.robots_dir).reload()
        self.runner = Runner(self.db, self.registry, settings.workspace)
        self.scheduler = Scheduler(self.db, self.registry, self.runner, settings.timezone)
        if settings.demo and self.db.count_runs() == 0:
            from .demo import seed

            seed(self.db, self.registry)

    def start(self) -> None:
        stale = self.db.mark_stale_runs()
        if stale:
            logging.getLogger("greffier").warning("%d exécution(s) interrompue(s) marquée(s) en échec", stale)
        if not self.settings.demo:
            self.scheduler.start()

    def stop(self) -> None:
        self.scheduler.shutdown()
        self.db.close()


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
    templates.env.filters["dt"] = lambda v: fmt_dt(v, tz)
    templates.env.filters["ms"] = fmt_ms
    templates.env.filters["n"] = fmt_int
    templates.env.filters["status_label"] = lambda s: STATUS_LABELS.get(s, s or "—")
    templates.env.filters["trigger_label"] = lambda s: TRIGGER_LABELS.get(s, s)
    templates.env.globals["app_name"] = APP_NAME
    templates.env.globals["demo_mode"] = settings.demo
    templates.env.globals["now_label"] = lambda: fmt_long_date(datetime.now(stats.ZoneInfo(tz)))

    def render(request: Request, name: str, **ctx):
        ctx.setdefault("flash_ok", request.query_params.get("ok"))
        ctx.setdefault("flash_err", request.query_params.get("err"))
        ctx.setdefault("path", request.url.path)
        return templates.TemplateResponse(request, name, ctx)

    def redirect(path: str, ok: str | None = None, err: str | None = None) -> RedirectResponse:
        query = {k: v for k, v in (("ok", ok), ("err", err)) if v}
        return RedirectResponse(path + (("?" + urlencode(query)) if query else ""), status_code=303)

    def robot_or_404(key: str):
        robot = platform.registry.get(key)
        if robot is None:
            raise HTTPException(404, "Robot inconnu")
        return robot

    # -- pages ---------------------------------------------------------------------

    @app.get("/", response_class=HTMLResponse)
    def dashboard(request: Request):
        data = stats.dashboard(platform.db, platform.registry, platform.scheduler, tz)
        return render(request, "dashboard.html", d=data)

    @app.get("/robots", response_class=HTMLResponse)
    def robots(request: Request):
        rows = []
        for robot in platform.registry:
            last = platform.db.last_run(robot.key)
            rows.append({
                "spec": robot,
                "enabled": platform.scheduler.is_enabled(robot.key),
                "schedule": platform.scheduler.effective_schedule(robot.key),
                "next_run": platform.scheduler.next_run(robot.key),
                "last": last,
                "running": platform.runner.is_running(robot.key),
            })
        return render(request, "robots.html", rows=rows, load_errors=platform.registry.errors,
                      robots_dir=platform.settings.robots_dir)

    @app.get("/robots/{key}", response_class=HTMLResponse)
    def robot_detail(request: Request, key: str):
        robot = robot_or_404(key)
        config = platform.db.get_config(key)
        params = {**robot.defaults(), **(config["params"] if config else {})}
        runs = platform.db.runs(key, limit=25)
        week = platform.db.runs_since(stats.local_midnight_utc(tz, 6), key)
        return render(
            request, "robot.html", robot=robot, params=params,
            enabled=platform.scheduler.is_enabled(key), schedule=platform.scheduler.effective_schedule(key) or "",
            next_run=platform.scheduler.next_run(key), runs=runs, running=platform.runner.is_running(key),
            rate=stats._rate(week), avg_ms=stats._avg_ms(week), runs_7d=len(week),
            items_7d=sum(r["items"] for r in week), total_runs=platform.db.count_runs(key),
        )

    @app.post("/robots/{key}/config")
    async def robot_config(request: Request, key: str):
        robot = robot_or_404(key)
        form = await request.form()
        enabled = form.get("enabled") == "on"
        schedule = (form.get("schedule") or "").strip() or None
        if schedule:
            err = validate_cron(schedule, tz)
            if err:
                return redirect(f"/robots/{key}", err=err)
        try:
            params = robot.coerce_params({k: v for k, v in form.items()})
        except ValueError as e:
            return redirect(f"/robots/{key}", err=str(e))
        platform.db.save_config(key, enabled, schedule, params)
        platform.scheduler.sync()
        return redirect(f"/robots/{key}", ok="Configuration enregistrée.")

    @app.post("/robots/{key}/run")
    def robot_run(key: str):
        robot = robot_or_404(key)
        if platform.runner.is_running(key):
            return redirect(f"/robots/{key}", err="Ce robot est déjà en cours d'exécution.")
        if settings.demo:  # no background scheduler in preview mode: run inline and show the result
            run_id = platform.runner.execute(key, trigger="manual")
            return redirect(f"/runs/{run_id}" if run_id else f"/robots/{key}", ok=f"{robot.name} exécuté.")
        platform.scheduler.trigger_now(key)
        return redirect(f"/robots/{key}", ok=f"{robot.name} lancé.")

    @app.post("/robots/reload")
    def robots_reload():
        platform.registry.reload()
        platform.scheduler.sync()
        n = len(platform.registry)
        msg = f"{n} robot(s) chargé(s)."
        if platform.registry.errors:
            msg += f" {len(platform.registry.errors)} fichier(s) en erreur."
        return redirect("/robots", ok=msg)

    @app.get("/runs", response_class=HTMLResponse)
    def runs(request: Request, robot: str | None = None, status: str | None = None, page: int = 1):
        per_page = 40
        page = max(1, page)
        rows = platform.db.runs(robot or None, status or None, limit=per_page, offset=(page - 1) * per_page)
        total = platform.db.count_runs(robot or None, status or None)
        names = {r.key: r.name for r in platform.registry}
        return render(request, "runs.html", runs=rows, names=names, robot=robot or "", status=status or "",
                      page=page, pages=max(1, -(-total // per_page)), total=total, statuses=STATUS_LABELS)

    @app.get("/runs/{run_id}", response_class=HTMLResponse)
    def run_detail(request: Request, run_id: int):
        run = platform.db.run(run_id)
        if run is None:
            raise HTTPException(404, "Exécution inconnue")
        robot = platform.registry.get(run["robot_key"])
        return render(request, "run.html", run=run, robot=robot, logs=platform.db.logs(run_id))

    @app.get("/atelier", response_class=HTMLResponse)
    def atelier(request: Request):
        return render(request, "atelier.html", robots=list(platform.registry))

    # -- json ----------------------------------------------------------------------

    @app.get("/api/live")
    def api_live():
        """State of every robot right now, for the workshop view. Polled every couple of seconds."""
        now = datetime.now(stats.ZoneInfo(tz))
        robots = []
        for robot in platform.registry:
            last = platform.db.last_run(robot.key)
            live = platform.runner.progress.get(robot.key)
            enabled = platform.scheduler.is_enabled(robot.key)
            if live:
                state = "running"
            elif not enabled:
                state = "off"
            else:
                state = "idle"
            next_run = platform.scheduler.next_run(robot.key)
            robots.append({
                "key": robot.key, "name": robot.name, "enabled": enabled, "state": state,
                "items": live["items"] if live else 0, "errors": live["errors"] if live else 0,
                "run_id": live["run_id"] if live else None,
                "last": {"id": last["id"], "status": last["status"], "finished_at": last["finished_at"],
                         "items": last["items"], "errors": last["errors"], "message": last["message"]} if last else None,
                "next_run": fmt_short(next_run, tz) if next_run else None,
            })
        names = {r.key: r.name for r in platform.registry}
        events = [{"id": r["id"], "robot_key": r["robot_key"], "robot_name": names.get(r["robot_key"], r["robot_key"]),
                   "status": r["status"], "started": fmt_dt(r["started_at"], tz), "items": r["items"], "message": r["message"]}
                  for r in platform.db.runs(limit=8)]
        return JSONResponse({"now": now.isoformat(), "clock": now.strftime("%H:%M"), "robots": robots, "events": events,
                             "demo": settings.demo})

    @app.get("/api/dashboard")
    def api_dashboard():
        data = stats.dashboard(platform.db, platform.registry, platform.scheduler, tz)
        return JSONResponse(_jsonable(data))

    @app.get("/api/robots")
    def api_robots():
        return [
            {"key": r.key, "name": r.name, "description": r.description,
             "enabled": platform.scheduler.is_enabled(r.key), "schedule": platform.scheduler.effective_schedule(r.key),
             "params": [p.__dict__ for p in r.params]}
            for r in platform.registry
        ]

    @app.get("/favicon.ico", include_in_schema=False)
    def favicon():
        return RedirectResponse("/static/favicon.svg")

    @app.get("/health")
    def health():
        return {"status": "ok", "robots": len(platform.registry)}

    return app


def _jsonable(value):
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value

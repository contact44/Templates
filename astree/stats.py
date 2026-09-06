"""Dashboard figures, computed from the runs table."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from statistics import mean
from zoneinfo import ZoneInfo

from . import db as dbm
from .db import Database
from .registry import Registry
from .scheduler import Scheduler
from .team import Team

SPARK_POINTS = 20
DAYS = 14


def to_local(value, tz: str) -> datetime | None:
    if value is None:
        return None
    dt = datetime.fromisoformat(value) if isinstance(value, str) else value
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(ZoneInfo(tz))


def local_midnight_utc(tz: str, days_ago: int = 0) -> datetime:
    now_local = datetime.now(ZoneInfo(tz))
    midnight = (now_local - timedelta(days=days_ago)).replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight.astimezone(timezone.utc).replace(tzinfo=None)


def _rate(runs: list[dict]) -> float | None:
    finished = [r for r in runs if r["status"] in dbm.FINAL_STATUSES]
    if not finished:
        return None
    return round(100 * sum(1 for r in finished if r["status"] == dbm.STATUS_SUCCESS) / len(finished))


def _avg_ms(runs: list[dict]) -> int | None:
    durations = [r["duration_ms"] for r in runs if r["duration_ms"] is not None]
    return int(mean(durations)) if durations else None


def sparkline(values: list[int], width: int = 120, height: int = 28, pad: int = 2) -> dict:
    if not values:
        return {"points": "", "last": None, "area": ""}
    lo, hi = min(values), max(values)
    span = (hi - lo) or 1
    step = (width - 2 * pad) / max(1, len(values) - 1)
    pts = [(round(pad + i * step, 1), round(pad + (height - 2 * pad) * (1 - (v - lo) / span), 1)) for i, v in enumerate(values)]
    points = " ".join(f"{x},{y}" for x, y in pts)
    return {"points": points, "last": pts[-1], "area": f"{pts[0][0]},{height} " + points + f" {pts[-1][0]},{height}", "width": width, "height": height}


def _rounded_top(x: float, y: float, w: float, h: float, r: float = 4) -> str:
    r = min(r, w / 2, h)
    return f"M{x},{y + h} V{y + r} Q{x},{y} {x + r},{y} H{x + w - r} Q{x + w},{y} {x + w},{y + r} V{y + h} Z"


def _nice_ticks(max_value: int) -> list[int]:
    if max_value <= 4:
        return list(range(1, max_value + 1))
    step = next((c for c in (1, 2, 5, 10, 20, 50, 100, 200, 500, 1000) if max_value / c <= 4), 1000)
    return list(range(step, max_value + 1, step))


def day_bars(runs: list[dict], tz: str, days: int = DAYS) -> dict:
    zone = ZoneInfo(tz)
    today = datetime.now(zone).date()
    buckets = {today - timedelta(days=i): {"success": 0, "warning": 0, "error": 0} for i in range(days - 1, -1, -1)}
    for r in runs:
        d = to_local(r["started_at"], tz).date()
        if d in buckets and r["status"] in buckets[d]:
            buckets[d][r["status"]] += 1
    width, height, pad_top, pad_bottom = 560, 140, 14, 22
    slot = width / days
    bar_w = min(24, slot * 0.6)
    max_total = max([sum(b.values()) for b in buckets.values()] + [1])
    scale = (height - pad_top - pad_bottom) / max_total
    gap = 2
    busiest = max(buckets.values(), key=lambda b: sum(b.values()))
    columns = []
    for i, (day, b) in enumerate(buckets.items()):
        x = i * slot + (slot - bar_w) / 2
        y = height - pad_bottom
        segments = []
        for status in ("success", "warning", "error"):
            n = b[status]
            if not n:
                continue
            h = n * scale
            y -= h
            segments.append({"status": status, "n": n, "x": round(x, 1), "y": round(y + gap / 2, 1), "h": round(max(0, h - gap), 1), "w": round(bar_w, 1)})
        if segments:
            s = segments[-1]
            s["path"] = _rounded_top(s["x"], s["y"], s["w"], s["h"])
        total = sum(b.values())
        columns.append({"date": day, "label": day.strftime("%d/%m") if (i % 2 == (days - 1) % 2) else "", "total": total,
                        "segments": segments, "show_value": bool(total) and (i == days - 1 or b is busiest),
                        "cx": round(x + bar_w / 2, 1), "x": round(x, 1), "w": round(bar_w, 1), **b})
    ticks = [{"value": t, "y": round(height - pad_bottom - t * scale, 1)} for t in _nice_ticks(max_total)]
    return {"columns": columns, "width": width, "height": height, "baseline": height - pad_bottom, "ticks": ticks, "max": max_total}


def dashboard(database: Database, registry: Registry, scheduler: Scheduler, team: Team, tz: str) -> dict:
    since_today = local_midnight_utc(tz)
    since_week = local_midnight_utc(tz, 6)
    since_days = local_midnight_utc(tz, DAYS - 1)
    period_runs = database.runs_since(since_days)
    week_runs = [r for r in period_runs if r["started_at"] >= dbm.iso(since_week)]
    today_runs = [r for r in period_runs if r["started_at"] >= dbm.iso(since_today)]
    names = {s.key: s.name for s in registry}

    scenarios = []
    for scenario in registry:
        r_week = [r for r in week_runs if r["scenario_key"] == scenario.key]
        last = database.last_run(scenario.key, finished_only=True)
        active = database.active_run(scenario.key)
        recent = database.runs(scenario.key, limit=SPARK_POINTS)
        durations = [r["duration_ms"] for r in reversed(recent) if r["duration_ms"] is not None]
        scenarios.append({
            "key": scenario.key, "name": scenario.name, "description": scenario.description, "source": scenario.source,
            "enabled": scheduler.is_enabled(scenario.key), "schedule": scheduler.effective_schedule(scenario.key),
            "next_run": to_local(scheduler.next_run(scenario.key), tz), "last": last,
            "last_status": last["status"] if last else None, "active": active, "running": active is not None,
            "runs_7d": len(r_week), "rate_7d": _rate(r_week), "avg_ms_7d": _avg_ms(r_week),
            "items_7d": sum(r["items"] for r in r_week), "spark": sparkline(durations),
        })

    failures = [r for r in database.runs(limit=60) if r["status"] in (dbm.STATUS_ERROR, dbm.STATUS_WARNING)][:6]

    def with_name(run: dict) -> dict:
        return {**run, "scenario_name": names.get(run["scenario_key"], run["scenario_key"])}

    workers = team.status()
    for w in workers:
        w["scenario_name"] = names.get(w["scenario_key"], w["scenario_key"]) if w["scenario_key"] else None

    return {
        "today": {"runs": len(today_runs), "success": sum(1 for r in today_runs if r["status"] == dbm.STATUS_SUCCESS),
                  "warning": sum(1 for r in today_runs if r["status"] == dbm.STATUS_WARNING),
                  "error": sum(1 for r in today_runs if r["status"] == dbm.STATUS_ERROR),
                  "running": sum(1 for r in today_runs if r["status"] in dbm.ACTIVE_STATUSES),
                  "items": sum(r["items"] for r in today_runs)},
        "week": {"runs": len(week_runs), "rate": _rate(week_runs), "avg_ms": _avg_ms(week_runs),
                 "items": sum(r["items"] for r in week_runs), "errors": sum(1 for r in week_runs if r["status"] == dbm.STATUS_ERROR)},
        "scenarios": scenarios, "scenarios_enabled": sum(1 for s in scenarios if s["enabled"]),
        "team": workers, "busy": sum(1 for w in workers if w["busy"]), "queued": [with_name(r) for r in team.queued()],
        "days": day_bars(period_runs, tz), "failures": [with_name(r) for r in failures],
        "recent": [with_name(r) for r in database.runs(limit=10)], "load_errors": registry.errors,
    }

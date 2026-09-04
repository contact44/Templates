"""Dashboard figures: everything the performance page shows, computed from the runs table."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from statistics import mean
from zoneinfo import ZoneInfo

from . import db as dbm
from .db import Database
from .registry import Registry
from .scheduler import Scheduler

SPARK_POINTS = 20
DAYS = 14


def to_local(value: str | datetime | None, tz: str) -> datetime | None:
    if value is None:
        return None
    dt = datetime.fromisoformat(value) if isinstance(value, str) else value
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(ZoneInfo(tz))


def local_midnight_utc(tz: str, days_ago: int = 0) -> datetime:
    """Naive UTC datetime of local midnight `days_ago` days back."""
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
    """Geometry for a small single-series line: points string plus the emphasized last point."""
    if not values:
        return {"points": "", "last": None, "area": ""}
    lo, hi = min(values), max(values)
    span = (hi - lo) or 1
    n = len(values)
    step = (width - 2 * pad) / max(1, n - 1)
    pts = []
    for i, v in enumerate(values):
        x = pad + i * step
        y = pad + (height - 2 * pad) * (1 - (v - lo) / span)
        pts.append((round(x, 1), round(y, 1)))
    points = " ".join(f"{x},{y}" for x, y in pts)
    area = f"{pts[0][0]},{height} " + points + f" {pts[-1][0]},{height}"
    return {"points": points, "last": pts[-1], "area": area, "width": width, "height": height}


def day_bars(runs: list[dict], tz: str, days: int = DAYS) -> dict:
    """Stacked columns per local day: success / warning / error counts and the SVG geometry."""
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
    plot_h = height - pad_top - pad_bottom
    scale = plot_h / max_total
    gap = 2
    columns = []
    busiest = max(buckets.values(), key=lambda b: sum(b.values()))
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
            segments[-1]["path"] = _rounded_top(segments[-1]["x"], segments[-1]["y"], segments[-1]["w"], segments[-1]["h"])
        total = sum(b.values())
        columns.append({
            "date": day, "label": day.strftime("%d/%m") if (i % 2 == (days - 1) % 2) else "",
            "weekday": day.strftime("%a"), "total": total, "segments": segments,
            "show_value": bool(total) and (i == days - 1 or b is busiest),
            "cx": round(x + bar_w / 2, 1), "x": round(x, 1), "w": round(bar_w, 1),
            **b,
        })
    ticks = []
    for t in _nice_ticks(max_total):
        ticks.append({"value": t, "y": round(height - pad_bottom - t * scale, 1)})
    return {"columns": columns, "width": width, "height": height, "baseline": height - pad_bottom, "ticks": ticks, "max": max_total}


def _rounded_top(x: float, y: float, w: float, h: float, r: float = 4) -> str:
    """SVG path for a rectangle with rounded top corners only (4px data-end, square baseline)."""
    r = min(r, w / 2, h)
    return (f"M{x},{y + h} V{y + r} Q{x},{y} {x + r},{y} H{x + w - r} "
            f"Q{x + w},{y} {x + w},{y + r} V{y + h} Z")


def _nice_ticks(max_value: int) -> list[int]:
    if max_value <= 4:
        return list(range(1, max_value + 1))
    step = 1
    for candidate in (1, 2, 5, 10, 20, 50, 100, 200, 500, 1000):
        if max_value / candidate <= 4:
            step = candidate
            break
    return list(range(step, max_value + 1, step))


def dashboard(database: Database, registry: Registry, scheduler: Scheduler, tz: str) -> dict:
    since_today = local_midnight_utc(tz)
    since_week = local_midnight_utc(tz, 6)
    since_days = local_midnight_utc(tz, DAYS - 1)
    period_runs = database.runs_since(since_days)
    week_runs = [r for r in period_runs if r["started_at"] >= dbm.iso(since_week)]
    today_runs = [r for r in period_runs if r["started_at"] >= dbm.iso(since_today)]

    robots = []
    for robot in registry:
        r_week = [r for r in week_runs if r["robot_key"] == robot.key]
        last = database.last_run(robot.key)
        recent = database.runs(robot.key, limit=SPARK_POINTS)
        durations = [r["duration_ms"] for r in reversed(recent) if r["duration_ms"] is not None]
        robots.append({
            "key": robot.key,
            "name": robot.name,
            "description": robot.description,
            "enabled": scheduler.is_enabled(robot.key),
            "schedule": scheduler.effective_schedule(robot.key),
            "next_run": to_local(scheduler.next_run(robot.key), tz),
            "last": last,
            "last_status": last["status"] if last else None,
            "last_at": to_local(last["started_at"], tz) if last else None,
            "runs_7d": len(r_week),
            "rate_7d": _rate(r_week),
            "avg_ms_7d": _avg_ms(r_week),
            "items_7d": sum(r["items"] for r in r_week),
            "spark": sparkline(durations),
            "running": scheduler.runner.is_running(robot.key),
        })

    failures = [r for r in database.runs(limit=60) if r["status"] in (dbm.STATUS_ERROR, dbm.STATUS_WARNING)][:6]
    names = {r.key: r.name for r in registry}

    def with_name(run: dict) -> dict:
        return {**run, "robot_name": names.get(run["robot_key"], run["robot_key"]), "started_local": to_local(run["started_at"], tz)}

    return {
        "today": {
            "runs": len(today_runs),
            "success": sum(1 for r in today_runs if r["status"] == dbm.STATUS_SUCCESS),
            "warning": sum(1 for r in today_runs if r["status"] == dbm.STATUS_WARNING),
            "error": sum(1 for r in today_runs if r["status"] == dbm.STATUS_ERROR),
            "running": sum(1 for r in today_runs if r["status"] == dbm.STATUS_RUNNING),
            "items": sum(r["items"] for r in today_runs),
        },
        "week": {
            "runs": len(week_runs),
            "rate": _rate(week_runs),
            "avg_ms": _avg_ms(week_runs),
            "items": sum(r["items"] for r in week_runs),
            "errors": sum(1 for r in week_runs if r["status"] == dbm.STATUS_ERROR),
        },
        "robots": robots,
        "robots_enabled": sum(1 for r in robots if r["enabled"]),
        "days": day_bars(period_runs, tz),
        "failures": [with_name(r) for r in failures],
        "recent": [with_name(r) for r in database.runs(limit=10)],
        "load_errors": registry.errors,
    }

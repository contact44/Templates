"""Demonstration data: 14 days of plausible runs, so the dashboard has something to show."""

from __future__ import annotations

import random
from datetime import timedelta

from . import db as dbm
from .db import Database
from .registry import Registry


def seed(database: Database, registry: Registry, seed: int = 7, reset: bool = False) -> int:
    rng = random.Random(seed)
    created = 0
    for robot in registry:
        if reset:
            database.delete_runs(robot.key)
        base_ms = rng.randint(800, 6000)
        for day in range(13, -1, -1):
            per_day = rng.randint(3, 9) if robot.schedule else rng.randint(0, 3)
            for _ in range(per_day):
                start = dbm.utcnow() - timedelta(days=day, hours=rng.randint(0, 11), minutes=rng.randint(0, 59))
                if start > dbm.utcnow():
                    continue
                roll = rng.random()
                status = dbm.STATUS_SUCCESS if roll < 0.86 else dbm.STATUS_WARNING if roll < 0.95 else dbm.STATUS_ERROR
                items = rng.randint(4, 40)
                errors = 0 if status == dbm.STATUS_SUCCESS else rng.randint(1, 4)
                duration = int(base_ms * rng.uniform(0.6, 1.7))
                end = start + timedelta(milliseconds=duration)
                run_id = database.create_run(robot.key, "demo", started_at=start)
                database.add_log(run_id, "info", f"Démarrage · {robot.name} · données de démonstration", ts=start)
                if status == dbm.STATUS_ERROR:
                    message = "TimeoutError: source indisponible (simulé)"
                    database.add_log(run_id, "error", message, ts=end)
                else:
                    message = f"{items} élément(s) traité(s)" + (f", {errors} en échec" if errors else "")
                    database.add_log(run_id, "info", f"Terminé · {message}", ts=end)
                database.finish_run(run_id, status, items=items, errors=errors, message=message,
                                    finished_at=end, duration_ms=duration)
                created += 1
    return created

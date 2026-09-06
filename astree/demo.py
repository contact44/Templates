"""Demonstration data: 14 days of plausible runs, so the dashboard has something to show."""

from __future__ import annotations

import random
from datetime import timedelta

from . import db as dbm
from .db import Database
from .registry import Registry

STEP_SETS = {
    "web.consulter": [("web.consulter", "Connexion"), ("web.consulter", "Filtre et export"), ("verifier", "Contrôle du fichier"), ("archiver", "Dépôt partagé")],
    "default": [("doc.lire", "Lecture"), ("verifier", "Contrôle"), ("archiver", "Classement")],
}


def seed(database: Database, registry: Registry, seed: int = 7, reset: bool = False, team_size: int = 3) -> int:
    rng = random.Random(seed)
    created = 0
    for scenario in registry:
        if reset:
            database.delete_runs(scenario.key)
        base_ms = rng.randint(1500, 9000)
        steps = STEP_SETS["web.consulter"] if "web.consulter" in scenario.actions else STEP_SETS["default"]
        for day in range(13, -1, -1):
            per_day = rng.randint(2, 6) if scenario.schedule and "demo" in scenario.key else (1 if rng.random() < 0.3 else 0)
            for _ in range(per_day):
                start = dbm.utcnow() - timedelta(days=day, hours=rng.randint(0, 11), minutes=rng.randint(0, 59))
                if start > dbm.utcnow():
                    continue
                roll = rng.random()
                status = dbm.STATUS_SUCCESS if roll < 0.86 else dbm.STATUS_WARNING if roll < 0.95 else dbm.STATUS_ERROR
                items = rng.randint(4, 160)
                errors = 0 if status == dbm.STATUS_SUCCESS else rng.randint(1, 4)
                duration = int(base_ms * rng.uniform(0.6, 1.7))
                end = start + timedelta(milliseconds=duration)
                run_id = database.create_run(scenario.key, "demo", queued_at=start)
                database.start_run(run_id, rng.randrange(team_size), started_at=start)
                database.add_log(run_id, "info", f"Démarrage · {scenario.name} · données de démonstration", ts=start)
                t = start
                for kind, label in steps:
                    sid = database.start_step(run_id, kind, label)
                    part = duration // len(steps)
                    database._exec("UPDATE run_steps SET started_at=?, finished_at=?, duration_ms=?, status='success' WHERE id=?",
                                   (dbm.iso(t), dbm.iso(t + timedelta(milliseconds=part)), part, sid))
                    t += timedelta(milliseconds=part)
                if status == dbm.STATUS_ERROR:
                    message = "TimeoutError: source indisponible (simulé)"
                    database.add_log(run_id, "error", message, ts=end)
                else:
                    message = f"{items} élément(s) traité(s)" + (f", {errors} en échec" if errors else "")
                    database.add_log(run_id, "info", f"Terminé · {message}", ts=end)
                database.finish_run(run_id, status, items=items, errors=errors, message=message, finished_at=end, duration_ms=duration)
                created += 1
    return created

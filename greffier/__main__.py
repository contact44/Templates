"""Command line: `greffier` (serve), `greffier run <key>`, `greffier demo-data`, `greffier list`."""

from __future__ import annotations

import argparse
import logging
import random
import sys
from datetime import timedelta

from . import db as dbm
from .config import APP_NAME, Settings


def cmd_serve(settings: Settings, args) -> int:
    import uvicorn

    from .app import create_app

    app = create_app(settings)
    print(f"{APP_NAME} · http://{settings.host}:{settings.port}  (workspace : {settings.workspace})")
    uvicorn.run(app, host=settings.host, port=settings.port, log_level="info" if args.verbose else "warning")
    return 0


def cmd_list(settings: Settings, args) -> int:
    from .registry import Registry

    reg = Registry(settings.robots_dir).reload()
    for r in reg:
        print(f"{r.key:<20} {r.name:<36} {r.schedule or 'à la demande'}")
    for name, err in reg.errors.items():
        print(f"[erreur] {name}: {err}", file=sys.stderr)
    return 1 if reg.errors and not reg.robots else 0


def cmd_run(settings: Settings, args) -> int:
    from .app import Platform

    platform = Platform(settings)
    try:
        run_id = platform.runner.execute(args.key, trigger="cli")
    except KeyError as e:
        print(e, file=sys.stderr)
        return 2
    run = platform.db.run(run_id) if run_id else None
    if run is None:
        print("Robot déjà en cours d'exécution.", file=sys.stderr)
        return 3
    print(f"#{run['id']} {run['status']} · {run['duration_ms']} ms · {run['message']}")
    platform.db.close()
    return 0 if run["status"] != dbm.STATUS_ERROR else 1


def cmd_demo_data(settings: Settings, args) -> int:
    """Fill the database with 14 days of plausible runs for every loaded robot, so the dashboard has something to show."""
    from .app import Platform

    platform = Platform(settings)
    rng = random.Random(args.seed)
    created = 0
    for robot in platform.registry:
        if args.reset:
            platform.db.delete_runs(robot.key)
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
                run_id = platform.db.create_run(robot.key, "demo", started_at=start)
                platform.db.add_log(run_id, "info", f"Démarrage · {robot.name} · données de démonstration", ts=start)
                if status == dbm.STATUS_ERROR:
                    platform.db.add_log(run_id, "error", "TimeoutError: source indisponible (simulé)", ts=start + timedelta(milliseconds=duration))
                    message = "TimeoutError: source indisponible (simulé)"
                else:
                    message = f"{items} élément(s) traité(s)" + (f", {errors} en échec" if errors else "")
                    platform.db.add_log(run_id, "info", f"Terminé · {message}", ts=start + timedelta(milliseconds=duration))
                platform.db.finish_run(run_id, status, items=items, errors=errors, message=message,
                                       finished_at=start + timedelta(milliseconds=duration))
                created += 1
    platform.db.close()
    print(f"{created} exécution(s) de démonstration créée(s) dans {settings.db_path}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="greffier", description=f"{APP_NAME} : plate-forme RPA locale")
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command")
    sub.add_parser("serve", help="démarrer l'interface (défaut)")
    sub.add_parser("list", help="lister les robots chargés")
    p_run = sub.add_parser("run", help="exécuter un robot une fois")
    p_run.add_argument("key")
    p_demo = sub.add_parser("demo-data", help="générer 14 jours d'exécutions fictives")
    p_demo.add_argument("--reset", action="store_true", help="supprimer l'historique existant des robots d'abord")
    p_demo.add_argument("--seed", type=int, default=7)
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING, format="%(asctime)s %(name)s %(message)s")
    settings = Settings.from_env()
    settings.workspace.mkdir(parents=True, exist_ok=True)
    commands = {"serve": cmd_serve, None: cmd_serve, "list": cmd_list, "run": cmd_run, "demo-data": cmd_demo_data}
    return commands[args.command](settings, args)


if __name__ == "__main__":
    sys.exit(main())

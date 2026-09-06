"""Command line: `pulsar` (serve), `pulsar list`, `pulsar run <key>`, `pulsar demo-data`."""

from __future__ import annotations

import argparse
import logging
import sys

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

    reg = Registry(settings.scenarios_dir, settings.deposited_dir).reload()
    for s in reg:
        print(f"{s.key:<24} {s.name:<40} {s.schedule or 'on demand':<16} {s.source}")
    for name, err in reg.errors.items():
        print(f"[error] {name}: {err}", file=sys.stderr)
    return 1 if reg.errors and not reg.scenarios else 0


def cmd_run(settings: Settings, args) -> int:
    from .app import Platform

    platform = Platform(settings)
    if platform.registry.get(args.key) is None:
        print(f"unknown scenario: {args.key}", file=sys.stderr)
        return 2
    run_id = platform.db.create_run(args.key, "cli")
    run = platform.runner.execute(run_id, worker=0)
    print(f"#{run['id']} {run['status']} · {run['duration_ms']} ms · {run['message']}")
    platform.db.close()
    return 0 if run["status"] != dbm.STATUS_ERROR else 1


def cmd_demo_data(settings: Settings, args) -> int:
    from .app import Platform
    from .demo import seed

    platform = Platform(settings)
    created = seed(platform.db, platform.registry, seed=args.seed, reset=args.reset, team_size=platform.team.size)
    platform.db.close()
    print(f"{created} demonstration run(s) created in {settings.db_path}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pulsar", description=f"{APP_NAME}: local RPA platform")
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command")
    sub.add_parser("serve", help="start the interface (default)")
    sub.add_parser("list", help="list the loaded scenarios")
    p_run = sub.add_parser("run", help="run a scenario once, on this terminal")
    p_run.add_argument("key")
    p_demo = sub.add_parser("demo-data", help="generate 14 days of fictitious runs")
    p_demo.add_argument("--reset", action="store_true")
    p_demo.add_argument("--seed", type=int, default=7)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING, format="%(asctime)s %(name)s %(message)s")
    settings = Settings.from_env()
    settings.workspace.mkdir(parents=True, exist_ok=True)
    return {"serve": cmd_serve, None: cmd_serve, "list": cmd_list, "run": cmd_run, "demo-data": cmd_demo_data}[args.command](settings, args)


if __name__ == "__main__":
    sys.exit(main())

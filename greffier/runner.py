"""Executes one robot and records everything it does."""

from __future__ import annotations

import logging
import threading
import time
import traceback
from pathlib import Path
from typing import Any

from . import db as dbm
from .db import Database
from .registry import Registry, RobotSpec

log = logging.getLogger("greffier.runner")


class RunContext:
    """What a robot receives. Everything it reports goes to the journal and the dashboard."""

    def __init__(self, run_id: int, robot: RobotSpec, params: dict, database: Database, workspace: Path,
                 on_progress=None):
        self.run_id = run_id
        self._on_progress = on_progress
        self.robot = robot
        self.params = params
        self.workspace = workspace
        self.output_dir = workspace / "sorties" / robot.key
        self.items = 0
        self.errors = 0
        self.metrics: dict[str, Any] = {}
        self._db = database

    # journal ----------------------------------------------------------------------
    def log(self, message: str, level: str = "info") -> None:
        self._db.add_log(self.run_id, level, str(message))
        log.info("[%s #%s] %s", self.robot.key, self.run_id, message)

    def info(self, message: str) -> None:
        self.log(message, "info")

    def warn(self, message: str) -> None:
        self.log(message, "warn")

    def error(self, message: str) -> None:
        self.log(message, "error")

    # counters ---------------------------------------------------------------------
    def item_done(self, n: int = 1) -> None:
        """One unit of work completed (an e-mail handled, a document produced...)."""
        self.items += n
        self._notify()

    def item_failed(self, message: str) -> None:
        """One unit of work that could not be completed. The run ends in 'warning' instead of 'success'."""
        self.errors += 1
        self.warn(message)
        self._notify()

    def _notify(self) -> None:
        if self._on_progress:
            self._on_progress(self)

    def metric(self, name: str, value: Any) -> None:
        self.metrics[name] = value

    # files ------------------------------------------------------------------------
    def output_path(self, filename: str) -> Path:
        self.output_dir.mkdir(parents=True, exist_ok=True)
        return self.output_dir / filename


class Runner:
    def __init__(self, database: Database, registry: Registry, workspace: Path):
        self.db = database
        self.registry = registry
        self.workspace = Path(workspace)
        self._locks: dict[str, threading.Lock] = {}
        self._locks_guard = threading.Lock()
        self.progress: dict[str, dict] = {}  # key -> live counters of the run in flight

    def _lock_for(self, key: str) -> threading.Lock:
        with self._locks_guard:
            return self._locks.setdefault(key, threading.Lock())

    def is_running(self, key: str) -> bool:
        return self._lock_for(key).locked()

    def execute(self, key: str, trigger: str = "manual") -> int | None:
        """Run a robot synchronously. Returns the run id, or None if the robot was already running."""
        robot = self.registry.get(key)
        if robot is None:
            raise KeyError(f"robot inconnu : {key}")
        lock = self._lock_for(key)
        if not lock.acquire(blocking=False):
            log.warning("[%s] déjà en cours, exécution ignorée (%s)", key, trigger)
            return None
        try:
            config = self.db.get_config(key)
            params = {**robot.defaults(), **(config["params"] if config else {})}
            run_id = self.db.create_run(key, trigger)
            ctx = RunContext(run_id, robot, params, self.db, self.workspace, on_progress=self._record_progress)
            self._record_progress(ctx)
            ctx.log(f"Démarrage · {robot.name} · déclenchement {trigger}")
            clock = time.perf_counter()
            try:
                robot.run(ctx)
            except Exception as e:
                ctx.error(f"{type(e).__name__}: {e}")
                ctx.log(traceback.format_exc().strip(), "trace")
                self.db.finish_run(run_id, dbm.STATUS_ERROR, items=ctx.items, errors=ctx.errors + 1,
                                   message=f"{type(e).__name__}: {e}", metrics=ctx.metrics,
                                   duration_ms=int((time.perf_counter() - clock) * 1000))
                return run_id
            status = dbm.STATUS_WARNING if ctx.errors else dbm.STATUS_SUCCESS
            summary = f"{ctx.items} élément(s) traité(s)" + (f", {ctx.errors} en échec" if ctx.errors else "")
            ctx.log(f"Terminé · {summary}")
            self.db.finish_run(run_id, status, items=ctx.items, errors=ctx.errors, message=summary, metrics=ctx.metrics,
                               duration_ms=int((time.perf_counter() - clock) * 1000))
            return run_id
        finally:
            self.progress.pop(key, None)
            lock.release()

    def _record_progress(self, ctx: RunContext) -> None:
        self.progress[ctx.robot.key] = {"run_id": ctx.run_id, "items": ctx.items, "errors": ctx.errors}

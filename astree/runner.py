"""Executes one scenario run and records everything it does: journal, counters, steps, metrics."""

from __future__ import annotations

import logging
import threading
import time
import traceback
from pathlib import Path
from typing import Any, Iterable

from . import db as dbm
from .db import Database
from .registry import Registry, ScenarioSpec
from .vault import Vault, mask

log = logging.getLogger("astree.runner")


class Credential:
    """A username/password pair from the vault. The password never appears in the journal."""

    def __init__(self, name: str, username: str, password: str | None):
        self.name, self.username, self.password = name, username, password

    def __repr__(self) -> str:
        return f"Credential({self.name!r}, username={self.username!r}, password='•••••')"


class _Step:
    """`with ctx.step(...)` or `for x in ctx.step(..., iterable)`: one declared action, timed and journaled."""

    def __init__(self, ctx: "RunContext", kind: str, label: str | None, iterable: Iterable | None):
        self.ctx, self.kind, self.label, self.iterable = ctx, kind, label, iterable
        self.id: int | None = None
        self.clock = 0.0

    def __enter__(self):
        self.id = self.ctx._db.start_step(self.ctx.run_id, self.kind, self.label)
        self.clock = time.perf_counter()
        self.ctx.current_step = {"id": self.id, "kind": self.kind, "label": self.label}
        self.ctx._notify()
        self.ctx.log(f"→ {self.kind}" + (f" · {self.label}" if self.label else ""), "step")
        return self

    def __exit__(self, exc_type, exc, tb):
        status = "error" if exc_type else "success"
        self.ctx._db.finish_step(self.id, status, int((time.perf_counter() - self.clock) * 1000))
        self.ctx.current_step = None
        self.ctx._notify()
        return False

    def __iter__(self):
        if self.iterable is None:
            raise TypeError("ctx.step(...) sans itérable ne s'utilise qu'avec « with »")
        with self:
            for item in self.iterable:
                yield item


class RunContext:
    """What a scenario receives."""

    def __init__(self, run_id: int, scenario: ScenarioSpec, params: dict, database: Database, workspace: Path,
                 vault: Vault | None = None, on_progress=None, stop_event: threading.Event | None = None):
        self.run_id = run_id
        self.scenario = scenario
        self.params = params
        self.workspace = workspace
        self.output_dir = workspace / "sorties" / scenario.key
        self.items = 0
        self.errors = 0
        self.metrics: dict[str, Any] = {}
        self.current_step: dict | None = None
        self._db = database
        self._vault = vault
        self._on_progress = on_progress
        self._secrets: list[str] = []
        self._stop = stop_event or threading.Event()

    # journal --------------------------------------------------------------------------
    def log(self, message: str, level: str = "info") -> None:
        text = mask(str(message), self._secrets)
        self._db.add_log(self.run_id, level, text)
        log.info("[%s #%s] %s", self.scenario.key, self.run_id, text)

    def info(self, message: str) -> None:
        self.log(message, "info")

    def warn(self, message: str) -> None:
        self.log(message, "warn")

    def error(self, message: str) -> None:
        self.log(message, "error")

    # counters -------------------------------------------------------------------------
    def item_done(self, n: int = 1) -> None:
        self.items += n
        self._notify()

    def item_failed(self, message: str) -> None:
        self.errors += 1
        self.warn(message)
        self._notify()

    def metric(self, name: str, value: Any) -> None:
        self.metrics[name] = value

    # actions ----------------------------------------------------------------------------
    def step(self, kind: str, label: str | None = None, iterable: Iterable | None = None) -> _Step:
        """Declare the action in progress. `with ctx.step("web.consulter", "SELMS+")` or `for x in ctx.step(kind, label, items)`."""
        return _Step(self, kind, label, iterable)

    def credentials(self, name: str) -> Credential:
        """Username and password stored in the vault under `name`. Raises KeyError when missing."""
        meta = self._db.credential(name)
        if meta is None:
            raise KeyError(f"identifiant « {name} » absent du coffre : ajoutez-le dans Paramètres › Identifiants")
        password = self._vault.get_password(name) if self._vault else None
        if password:
            self._secrets.append(password)
        return Credential(name, meta["username"], password)

    def should_stop(self) -> bool:
        return self._stop.is_set()

    # files ------------------------------------------------------------------------------
    def output_path(self, filename: str) -> Path:
        self.output_dir.mkdir(parents=True, exist_ok=True)
        return self.output_dir / filename

    def _notify(self) -> None:
        if self._on_progress:
            self._on_progress(self)


class Runner:
    def __init__(self, database: Database, registry: Registry, workspace: Path, vault: Vault | None = None):
        self.db = database
        self.registry = registry
        self.workspace = Path(workspace)
        self.vault = vault
        self.progress: dict[int, dict] = {}  # run_id -> live counters and current step

    def execute(self, run_id: int, worker: int | None = None) -> dict:
        """Run an already created (queued) run to completion on the calling thread. Returns the finished run."""
        run = self.db.run(run_id)
        if run is None:
            raise KeyError(f"exécution inconnue : {run_id}")
        scenario = self.registry.get(run["scenario_key"])
        self.db.start_run(run_id, worker)
        if scenario is None:
            self.db.finish_run(run_id, dbm.STATUS_ERROR, message=f"Scénario inconnu : {run['scenario_key']}")
            return self.db.run(run_id)
        config = self.db.get_config(scenario.key)
        params = {**scenario.defaults(), **(config["params"] if config else {})}
        ctx = RunContext(run_id, scenario, params, self.db, self.workspace, self.vault, on_progress=self._record)
        self._record(ctx)
        ctx.log(f"Démarrage · {scenario.name} · déclenchement {run['trigger']}")
        clock = time.perf_counter()
        try:
            try:
                scenario.run(ctx)
            except Exception as e:
                ctx.error(f"{type(e).__name__}: {e}")
                ctx.log(mask(traceback.format_exc().strip(), ctx._secrets), "trace")
                self.db.finish_run(run_id, dbm.STATUS_ERROR, items=ctx.items, errors=ctx.errors + 1,
                                   message=mask(f"{type(e).__name__}: {e}", ctx._secrets), metrics=ctx.metrics,
                                   duration_ms=int((time.perf_counter() - clock) * 1000))
                return self.db.run(run_id)
            status = dbm.STATUS_WARNING if ctx.errors else dbm.STATUS_SUCCESS
            summary = f"{ctx.items} élément(s) traité(s)" + (f", {ctx.errors} en échec" if ctx.errors else "")
            ctx.log(f"Terminé · {summary}")
            self.db.finish_run(run_id, status, items=ctx.items, errors=ctx.errors, message=summary, metrics=ctx.metrics,
                               duration_ms=int((time.perf_counter() - clock) * 1000))
            return self.db.run(run_id)
        finally:
            self.progress.pop(run_id, None)

    def _record(self, ctx: RunContext) -> None:
        self.progress[ctx.run_id] = {"run_id": ctx.run_id, "scenario_key": ctx.scenario.key, "items": ctx.items,
                                     "errors": ctx.errors, "step": ctx.current_step}

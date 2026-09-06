"""The team: a fixed number of named robots, each a worker thread that takes queued runs one at a time."""

from __future__ import annotations

import logging
import queue
import threading

from .config import DEFAULT_TEAM
from .db import Database
from .runner import Runner

log = logging.getLogger("pulsar.team")


class Team:
    def __init__(self, database: Database, runner: Runner, inline: bool = False):
        self.db = database
        self.runner = runner
        self.inline = inline  # preview mode: no threads, runs execute in the caller
        self._queue: queue.Queue[int] = queue.Queue()
        self._threads: list[threading.Thread] = []
        self._busy: dict[int, int | None] = {}  # worker index -> run id
        self._stop = threading.Event()

    # -- names -------------------------------------------------------------------------------

    @property
    def names(self) -> list[str]:
        names = self.db.get_setting("team_names")
        if not names:
            return list(DEFAULT_TEAM)
        return [str(n) for n in names]

    def rename(self, names: list[str]) -> None:
        clean = [n.strip() for n in names if n and n.strip()]
        if not clean:
            raise ValueError("At least one robot is required.")
        if len(clean) > 8:
            raise ValueError("Eight robots at most.")
        self.db.set_setting("team_names", clean)

    @property
    def size(self) -> int:
        return len(self.names)

    # -- lifecycle -----------------------------------------------------------------------------

    def start(self) -> None:
        if self.inline:
            return
        for i in range(self.size):
            self._busy[i] = None
            t = threading.Thread(target=self._loop, args=(i,), name=f"pulsar-worker-{i}", daemon=True)
            t.start()
            self._threads.append(t)
        for run in self.db.queued_runs():  # runs queued before a restart
            self._queue.put(run["id"])

    def stop(self) -> None:
        self._stop.set()

    def _loop(self, index: int) -> None:
        while not self._stop.is_set():
            try:
                run_id = self._queue.get(timeout=0.5)
            except queue.Empty:
                continue
            self._busy[index] = run_id
            try:
                self.runner.execute(run_id, worker=index)
            except Exception:
                log.exception("robot %s: unexpected error on run %s", index, run_id)
            finally:
                self._busy[index] = None
                self._queue.task_done()

    # -- work -----------------------------------------------------------------------------------

    def enqueue(self, scenario_key: str, trigger: str) -> int | None:
        """Queue a run for the first free robot. Returns None if the scenario is already queued or running."""
        if self.db.active_run(scenario_key):
            log.warning("[%s] already queued or running, request ignored (%s)", scenario_key, trigger)
            return None
        run_id = self.db.create_run(scenario_key, trigger)
        if self.inline:
            self._busy[0] = run_id
            try:
                self.runner.execute(run_id, worker=0)
            finally:
                self._busy[0] = None
            return run_id
        self._queue.put(run_id)
        return run_id

    def status(self) -> list[dict]:
        """One entry per robot: name, busy or free, and what it is doing."""
        out = []
        names = self.names
        for i, name in enumerate(names):
            run_id = self._busy.get(i)
            live = self.runner.progress.get(run_id) if run_id else None
            out.append({"index": i, "name": name, "busy": run_id is not None, "run_id": run_id,
                        "scenario_key": live["scenario_key"] if live else None,
                        "step": live["step"] if live else None, "items": live["items"] if live else 0,
                        "errors": live["errors"] if live else 0})
        return out

    def queued(self) -> list[dict]:
        return self.db.queued_runs()

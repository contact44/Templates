"""SQLite storage: robot configuration, runs, and per-run logs.

Timestamps are stored as naive ISO-8601 strings in UTC ("2026-09-04T10:52:04").
"""

from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

SCHEMA = """
CREATE TABLE IF NOT EXISTS robot_config (
    key         TEXT PRIMARY KEY,
    enabled     INTEGER NOT NULL DEFAULT 1,
    schedule    TEXT,
    params_json TEXT NOT NULL DEFAULT '{}',
    updated_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    robot_key    TEXT NOT NULL,
    trigger      TEXT NOT NULL,
    status       TEXT NOT NULL,
    started_at   TEXT NOT NULL,
    finished_at  TEXT,
    duration_ms  INTEGER,
    items        INTEGER NOT NULL DEFAULT 0,
    errors       INTEGER NOT NULL DEFAULT 0,
    message      TEXT,
    metrics_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS runs_robot_started ON runs(robot_key, started_at);
CREATE INDEX IF NOT EXISTS runs_started ON runs(started_at);
CREATE TABLE IF NOT EXISTS run_logs (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id  INTEGER NOT NULL,
    ts      TEXT NOT NULL,
    level   TEXT NOT NULL,
    message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS run_logs_run ON run_logs(run_id);
"""

STATUS_RUNNING = "running"
STATUS_SUCCESS = "success"
STATUS_WARNING = "warning"
STATUS_ERROR = "error"
FINAL_STATUSES = (STATUS_SUCCESS, STATUS_WARNING, STATUS_ERROR)


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)


def iso(dt: datetime) -> str:
    return dt.replace(microsecond=0).isoformat(timespec="seconds")


class Database:
    """Thin wrapper around one sqlite3 connection, guarded by a lock for use across threads."""

    def __init__(self, path: Path | str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(str(self.path), check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._conn.executescript(SCHEMA)

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    # -- low level -----------------------------------------------------------------

    def _q(self, sql: str, args: Iterable[Any] = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self._conn.execute(sql, tuple(args)).fetchall()

    def _one(self, sql: str, args: Iterable[Any] = ()) -> sqlite3.Row | None:
        with self._lock:
            return self._conn.execute(sql, tuple(args)).fetchone()

    def _exec(self, sql: str, args: Iterable[Any] = ()) -> int:
        with self._lock:
            cur = self._conn.execute(sql, tuple(args))
            return cur.lastrowid or 0

    # -- robot configuration -------------------------------------------------------

    def get_config(self, key: str) -> dict | None:
        row = self._one("SELECT * FROM robot_config WHERE key = ?", (key,))
        if row is None:
            return None
        return {
            "key": row["key"],
            "enabled": bool(row["enabled"]),
            "schedule": row["schedule"],
            "params": json.loads(row["params_json"]),
            "updated_at": row["updated_at"],
        }

    def save_config(self, key: str, enabled: bool, schedule: str | None, params: dict) -> None:
        self._exec(
            """INSERT INTO robot_config(key, enabled, schedule, params_json, updated_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(key) DO UPDATE SET enabled=excluded.enabled, schedule=excluded.schedule,
                   params_json=excluded.params_json, updated_at=excluded.updated_at""",
            (key, int(enabled), schedule or None, json.dumps(params, ensure_ascii=False), iso(utcnow())),
        )

    # -- runs ----------------------------------------------------------------------

    def create_run(self, robot_key: str, trigger: str, started_at: datetime | None = None) -> int:
        return self._exec(
            "INSERT INTO runs(robot_key, trigger, status, started_at) VALUES (?, ?, ?, ?)",
            (robot_key, trigger, STATUS_RUNNING, iso(started_at or utcnow())),
        )

    def finish_run(
        self,
        run_id: int,
        status: str,
        *,
        items: int = 0,
        errors: int = 0,
        message: str | None = None,
        metrics: dict | None = None,
        finished_at: datetime | None = None,
        duration_ms: int | None = None,
    ) -> None:
        row = self._one("SELECT started_at FROM runs WHERE id = ?", (run_id,))
        if row is None:
            raise KeyError(f"run {run_id} not found")
        end = finished_at or utcnow()
        start = datetime.fromisoformat(row["started_at"])
        if duration_ms is None:
            duration_ms = max(0, int((end - start).total_seconds() * 1000))
        self._exec(
            """UPDATE runs SET status=?, finished_at=?, duration_ms=?, items=?, errors=?, message=?, metrics_json=?
               WHERE id=?""",
            (status, iso(end), duration_ms, items, errors, message, json.dumps(metrics or {}, ensure_ascii=False), run_id),
        )

    def add_log(self, run_id: int, level: str, message: str, ts: datetime | None = None) -> None:
        self._exec(
            "INSERT INTO run_logs(run_id, ts, level, message) VALUES (?, ?, ?, ?)",
            (run_id, iso(ts or utcnow()), level, message),
        )

    def logs(self, run_id: int) -> list[dict]:
        return [dict(r) for r in self._q("SELECT ts, level, message FROM run_logs WHERE run_id=? ORDER BY id", (run_id,))]

    def run(self, run_id: int) -> dict | None:
        row = self._one("SELECT * FROM runs WHERE id=?", (run_id,))
        return self._row_to_run(row) if row else None

    def runs(self, robot_key: str | None = None, status: str | None = None, limit: int = 50, offset: int = 0) -> list[dict]:
        sql = "SELECT * FROM runs WHERE 1=1"
        args: list[Any] = []
        if robot_key:
            sql += " AND robot_key=?"
            args.append(robot_key)
        if status:
            sql += " AND status=?"
            args.append(status)
        sql += " ORDER BY id DESC LIMIT ? OFFSET ?"
        args += [limit, offset]
        return [self._row_to_run(r) for r in self._q(sql, args)]

    def count_runs(self, robot_key: str | None = None, status: str | None = None) -> int:
        sql = "SELECT COUNT(*) AS n FROM runs WHERE 1=1"
        args: list[Any] = []
        if robot_key:
            sql += " AND robot_key=?"
            args.append(robot_key)
        if status:
            sql += " AND status=?"
            args.append(status)
        row = self._one(sql, args)
        return int(row["n"]) if row else 0

    def last_run(self, robot_key: str) -> dict | None:
        row = self._one("SELECT * FROM runs WHERE robot_key=? ORDER BY id DESC LIMIT 1", (robot_key,))
        return self._row_to_run(row) if row else None

    def running_run(self, robot_key: str) -> dict | None:
        row = self._one("SELECT * FROM runs WHERE robot_key=? AND status=? ORDER BY id DESC LIMIT 1", (robot_key, STATUS_RUNNING))
        return self._row_to_run(row) if row else None

    def mark_stale_runs(self, message: str = "Interrompu : la plate-forme a redémarré pendant l'exécution.") -> int:
        rows = self._q("SELECT id FROM runs WHERE status=?", (STATUS_RUNNING,))
        for r in rows:
            self.finish_run(r["id"], STATUS_ERROR, message=message)
        return len(rows)

    def runs_since(self, since: datetime, robot_key: str | None = None) -> list[dict]:
        sql = "SELECT * FROM runs WHERE started_at >= ?"
        args: list[Any] = [iso(since)]
        if robot_key:
            sql += " AND robot_key=?"
            args.append(robot_key)
        sql += " ORDER BY id"
        return [self._row_to_run(r) for r in self._q(sql, args)]

    def delete_runs(self, robot_key: str | None = None) -> int:
        with self._lock:
            if robot_key:
                self._conn.execute("DELETE FROM run_logs WHERE run_id IN (SELECT id FROM runs WHERE robot_key=?)", (robot_key,))
                cur = self._conn.execute("DELETE FROM runs WHERE robot_key=?", (robot_key,))
            else:
                self._conn.execute("DELETE FROM run_logs")
                cur = self._conn.execute("DELETE FROM runs")
            return cur.rowcount

    @staticmethod
    def _row_to_run(row: sqlite3.Row) -> dict:
        d = dict(row)
        d["metrics"] = json.loads(d.pop("metrics_json") or "{}")
        return d

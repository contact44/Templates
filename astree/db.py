"""SQLite storage: scenario configuration and versions, runs, steps, logs, credentials metadata, settings.

Timestamps are naive ISO-8601 strings in UTC ("2026-09-28T05:00:00"). Passwords never go here (see vault.py).
"""

from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

SCHEMA = """
CREATE TABLE IF NOT EXISTS scenario_config (
    key         TEXT PRIMARY KEY,
    enabled     INTEGER NOT NULL DEFAULT 1,
    schedule    TEXT,
    params_json TEXT NOT NULL DEFAULT '{}',
    updated_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scenario_versions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    key        TEXT NOT NULL,
    version    INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    note       TEXT,
    path       TEXT NOT NULL,
    sha256     TEXT NOT NULL,
    UNIQUE(key, version)
);
CREATE TABLE IF NOT EXISTS runs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    scenario_key TEXT NOT NULL,
    worker       INTEGER,
    trigger      TEXT NOT NULL,
    status       TEXT NOT NULL,
    queued_at    TEXT NOT NULL,
    started_at   TEXT,
    finished_at  TEXT,
    duration_ms  INTEGER,
    items        INTEGER NOT NULL DEFAULT 0,
    errors       INTEGER NOT NULL DEFAULT 0,
    message      TEXT,
    metrics_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS runs_scenario ON runs(scenario_key, id);
CREATE INDEX IF NOT EXISTS runs_status ON runs(status);
CREATE TABLE IF NOT EXISTS run_logs (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id  INTEGER NOT NULL,
    ts      TEXT NOT NULL,
    level   TEXT NOT NULL,
    message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS run_logs_run ON run_logs(run_id);
CREATE TABLE IF NOT EXISTS run_steps (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id      INTEGER NOT NULL,
    kind        TEXT NOT NULL,
    label       TEXT,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    duration_ms INTEGER,
    status      TEXT NOT NULL DEFAULT 'running'
);
CREATE INDEX IF NOT EXISTS run_steps_run ON run_steps(run_id);
CREATE TABLE IF NOT EXISTS credentials (
    name       TEXT PRIMARY KEY,
    username   TEXT NOT NULL,
    note       TEXT,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

STATUS_QUEUED = "queued"
STATUS_RUNNING = "running"
STATUS_SUCCESS = "success"
STATUS_WARNING = "warning"
STATUS_ERROR = "error"
FINAL_STATUSES = (STATUS_SUCCESS, STATUS_WARNING, STATUS_ERROR)
ACTIVE_STATUSES = (STATUS_QUEUED, STATUS_RUNNING)


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)


def iso(dt: datetime) -> str:
    return dt.replace(microsecond=0).isoformat(timespec="seconds")


class Database:
    """One sqlite3 connection guarded by a lock, usable from the web thread and the worker threads."""

    def __init__(self, path: Path | str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(str(self.path), check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.executescript(SCHEMA)

    def close(self) -> None:
        with self._lock:
            self._conn.close()

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

    # -- settings ---------------------------------------------------------------------

    def get_setting(self, key: str, default: Any = None) -> Any:
        row = self._one("SELECT value FROM settings WHERE key=?", (key,))
        return json.loads(row["value"]) if row else default

    def set_setting(self, key: str, value: Any) -> None:
        self._exec("INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                   (key, json.dumps(value, ensure_ascii=False)))

    # -- scenario configuration --------------------------------------------------------

    def get_config(self, key: str) -> dict | None:
        row = self._one("SELECT * FROM scenario_config WHERE key = ?", (key,))
        if row is None:
            return None
        return {"key": row["key"], "enabled": bool(row["enabled"]), "schedule": row["schedule"],
                "params": json.loads(row["params_json"]), "updated_at": row["updated_at"]}

    def save_config(self, key: str, enabled: bool, schedule: str | None, params: dict) -> None:
        self._exec(
            """INSERT INTO scenario_config(key, enabled, schedule, params_json, updated_at) VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(key) DO UPDATE SET enabled=excluded.enabled, schedule=excluded.schedule,
                   params_json=excluded.params_json, updated_at=excluded.updated_at""",
            (key, int(enabled), schedule or None, json.dumps(params, ensure_ascii=False), iso(utcnow())))

    # -- scenario versions -------------------------------------------------------------

    def add_version(self, key: str, path: str, sha256: str, note: str | None = None) -> int:
        row = self._one("SELECT COALESCE(MAX(version), 0) AS v FROM scenario_versions WHERE key=?", (key,))
        version = int(row["v"]) + 1
        self._exec("INSERT INTO scenario_versions(key, version, created_at, note, path, sha256) VALUES (?, ?, ?, ?, ?, ?)",
                   (key, version, iso(utcnow()), note, path, sha256))
        return version

    def versions(self, key: str) -> list[dict]:
        return [dict(r) for r in self._q("SELECT * FROM scenario_versions WHERE key=? ORDER BY version DESC", (key,))]

    def version(self, key: str, version: int) -> dict | None:
        row = self._one("SELECT * FROM scenario_versions WHERE key=? AND version=?", (key, version))
        return dict(row) if row else None

    def current_version(self, key: str) -> int | None:
        row = self._one("SELECT MAX(version) AS v FROM scenario_versions WHERE key=?", (key,))
        return int(row["v"]) if row and row["v"] is not None else None

    # -- runs ----------------------------------------------------------------------------

    def create_run(self, scenario_key: str, trigger: str, status: str = STATUS_QUEUED, queued_at: datetime | None = None) -> int:
        return self._exec("INSERT INTO runs(scenario_key, trigger, status, queued_at) VALUES (?, ?, ?, ?)",
                          (scenario_key, trigger, status, iso(queued_at or utcnow())))

    def start_run(self, run_id: int, worker: int | None, started_at: datetime | None = None) -> None:
        self._exec("UPDATE runs SET status=?, worker=?, started_at=? WHERE id=?",
                   (STATUS_RUNNING, worker, iso(started_at or utcnow()), run_id))

    def finish_run(self, run_id: int, status: str, *, items: int = 0, errors: int = 0, message: str | None = None,
                   metrics: dict | None = None, finished_at: datetime | None = None, duration_ms: int | None = None) -> None:
        row = self._one("SELECT started_at, queued_at FROM runs WHERE id = ?", (run_id,))
        if row is None:
            raise KeyError(f"run {run_id} not found")
        end = finished_at or utcnow()
        if duration_ms is None:
            start = datetime.fromisoformat(row["started_at"] or row["queued_at"])
            duration_ms = max(0, int((end - start).total_seconds() * 1000))
        self._exec("""UPDATE runs SET status=?, finished_at=?, duration_ms=?, items=?, errors=?, message=?, metrics_json=? WHERE id=?""",
                   (status, iso(end), duration_ms, items, errors, message, json.dumps(metrics or {}, ensure_ascii=False), run_id))
        self._exec("UPDATE run_steps SET status=?, finished_at=COALESCE(finished_at, ?) WHERE run_id=? AND status='running'",
                   ("error" if status == STATUS_ERROR else "success", iso(end), run_id))

    def add_log(self, run_id: int, level: str, message: str, ts: datetime | None = None) -> None:
        self._exec("INSERT INTO run_logs(run_id, ts, level, message) VALUES (?, ?, ?, ?)", (run_id, iso(ts or utcnow()), level, message))

    def logs(self, run_id: int) -> list[dict]:
        return [dict(r) for r in self._q("SELECT ts, level, message FROM run_logs WHERE run_id=? ORDER BY id", (run_id,))]

    def start_step(self, run_id: int, kind: str, label: str | None) -> int:
        return self._exec("INSERT INTO run_steps(run_id, kind, label, started_at) VALUES (?, ?, ?, ?)", (run_id, kind, label, iso(utcnow())))

    def finish_step(self, step_id: int, status: str, duration_ms: int) -> None:
        self._exec("UPDATE run_steps SET status=?, finished_at=?, duration_ms=? WHERE id=?", (status, iso(utcnow()), duration_ms, step_id))

    def steps(self, run_id: int) -> list[dict]:
        return [dict(r) for r in self._q("SELECT * FROM run_steps WHERE run_id=? ORDER BY id", (run_id,))]

    def current_step(self, run_id: int) -> dict | None:
        row = self._one("SELECT * FROM run_steps WHERE run_id=? AND status='running' ORDER BY id DESC LIMIT 1", (run_id,))
        return dict(row) if row else None

    def run(self, run_id: int) -> dict | None:
        row = self._one("SELECT * FROM runs WHERE id=?", (run_id,))
        return self._row_to_run(row) if row else None

    def runs(self, scenario_key: str | None = None, status: str | None = None, limit: int = 50, offset: int = 0) -> list[dict]:
        sql, args = "SELECT * FROM runs WHERE 1=1", []
        if scenario_key:
            sql += " AND scenario_key=?"; args.append(scenario_key)
        if status:
            sql += " AND status=?"; args.append(status)
        sql += " ORDER BY id DESC LIMIT ? OFFSET ?"
        return [self._row_to_run(r) for r in self._q(sql, args + [limit, offset])]

    def count_runs(self, scenario_key: str | None = None, status: str | None = None) -> int:
        sql, args = "SELECT COUNT(*) AS n FROM runs WHERE 1=1", []
        if scenario_key:
            sql += " AND scenario_key=?"; args.append(scenario_key)
        if status:
            sql += " AND status=?"; args.append(status)
        row = self._one(sql, args)
        return int(row["n"]) if row else 0

    def last_run(self, scenario_key: str, finished_only: bool = False) -> dict | None:
        sql = "SELECT * FROM runs WHERE scenario_key=?" + (" AND status IN ('success','warning','error')" if finished_only else "") + " ORDER BY id DESC LIMIT 1"
        row = self._one(sql, (scenario_key,))
        return self._row_to_run(row) if row else None

    def active_run(self, scenario_key: str) -> dict | None:
        row = self._one("SELECT * FROM runs WHERE scenario_key=? AND status IN ('queued','running') ORDER BY id DESC LIMIT 1", (scenario_key,))
        return self._row_to_run(row) if row else None

    def queued_runs(self) -> list[dict]:
        return [self._row_to_run(r) for r in self._q("SELECT * FROM runs WHERE status='queued' ORDER BY id")]

    def mark_stale_runs(self, message: str = "Interrompu : la plate-forme a redémarré pendant l'exécution.") -> int:
        rows = self._q("SELECT id FROM runs WHERE status IN ('queued','running')")
        for r in rows:
            self.finish_run(r["id"], STATUS_ERROR, message=message)
        return len(rows)

    def runs_since(self, since: datetime, scenario_key: str | None = None) -> list[dict]:
        sql, args = "SELECT * FROM runs WHERE COALESCE(started_at, queued_at) >= ?", [iso(since)]
        if scenario_key:
            sql += " AND scenario_key=?"; args.append(scenario_key)
        return [self._row_to_run(r) for r in self._q(sql + " ORDER BY id", args)]

    def delete_runs(self, scenario_key: str | None = None) -> int:
        with self._lock:
            where, args = ("WHERE scenario_key=?", (scenario_key,)) if scenario_key else ("", ())
            self._conn.execute(f"DELETE FROM run_logs WHERE run_id IN (SELECT id FROM runs {where})", args)
            self._conn.execute(f"DELETE FROM run_steps WHERE run_id IN (SELECT id FROM runs {where})", args)
            return self._conn.execute(f"DELETE FROM runs {where}", args).rowcount

    # -- credentials metadata (the password itself lives in the vault) ---------------------

    def credentials(self) -> list[dict]:
        return [dict(r) for r in self._q("SELECT * FROM credentials ORDER BY name")]

    def credential(self, name: str) -> dict | None:
        row = self._one("SELECT * FROM credentials WHERE name=?", (name,))
        return dict(row) if row else None

    def save_credential(self, name: str, username: str, note: str | None) -> None:
        self._exec("""INSERT INTO credentials(name, username, note, updated_at) VALUES (?, ?, ?, ?)
                      ON CONFLICT(name) DO UPDATE SET username=excluded.username, note=excluded.note, updated_at=excluded.updated_at""",
                   (name, username, note, iso(utcnow())))

    def delete_credential(self, name: str) -> None:
        self._exec("DELETE FROM credentials WHERE name=?", (name,))

    @staticmethod
    def _row_to_run(row: sqlite3.Row) -> dict:
        d = dict(row)
        d["metrics"] = json.loads(d.pop("metrics_json") or "{}")
        d["started_at"] = d["started_at"] or d["queued_at"]
        return d

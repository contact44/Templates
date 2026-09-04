"""Cron scheduling inside the same process. One job per enabled robot with a schedule."""

from __future__ import annotations

import logging
from datetime import datetime

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger

from .db import Database
from .registry import Registry
from .runner import Runner

log = logging.getLogger("greffier.scheduler")


def validate_cron(expr: str, timezone: str) -> str | None:
    """Return an error message if the expression is not a valid 5-field cron, else None."""
    try:
        CronTrigger.from_crontab(expr, timezone=timezone)
    except (ValueError, TypeError) as e:
        return f"Expression cron invalide : {e}"
    return None


class Scheduler:
    def __init__(self, database: Database, registry: Registry, runner: Runner, timezone: str):
        self.db = database
        self.registry = registry
        self.runner = runner
        self.timezone = timezone
        self._sched = BackgroundScheduler(timezone=timezone, job_defaults={"coalesce": True, "max_instances": 1, "misfire_grace_time": 300})

    def start(self) -> None:
        self.sync()
        self._sched.start()

    def shutdown(self) -> None:
        if self._sched.running:
            self._sched.shutdown(wait=False)

    def effective_schedule(self, key: str) -> str | None:
        robot = self.registry.get(key)
        config = self.db.get_config(key)
        if config is not None:
            return config["schedule"]
        return robot.schedule if robot else None

    def is_enabled(self, key: str) -> bool:
        config = self.db.get_config(key)
        return True if config is None else config["enabled"]

    def sync(self) -> None:
        """Make the scheduler match the registry and the saved configuration."""
        wanted = set()
        for robot in self.registry:
            job_id = f"cron:{robot.key}"
            schedule = self.effective_schedule(robot.key)
            if self.is_enabled(robot.key) and schedule and validate_cron(schedule, self.timezone) is None:
                wanted.add(job_id)
                self._sched.add_job(
                    self.runner.execute, CronTrigger.from_crontab(schedule, timezone=self.timezone),
                    id=job_id, args=[robot.key, "schedule"], replace_existing=True, name=robot.name,
                )
        for job in self._sched.get_jobs():
            if job.id.startswith("cron:") and job.id not in wanted:
                job.remove()

    def trigger_now(self, key: str) -> None:
        self._sched.add_job(self.runner.execute, DateTrigger(), args=[key, "manual"], name=f"manuel:{key}")

    def next_run(self, key: str) -> datetime | None:
        job = self._sched.get_job(f"cron:{key}")
        return job.next_run_time if job else None

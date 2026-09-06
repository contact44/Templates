"""Cron scheduling inside the same process. One job per enabled scenario with a schedule; jobs hand runs to the team."""

from __future__ import annotations

import logging
from datetime import datetime

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from .db import Database
from .registry import Registry
from .team import Team

log = logging.getLogger("pulsar.scheduler")


def validate_cron(expr: str, timezone: str) -> str | None:
    try:
        CronTrigger.from_crontab(expr, timezone=timezone)
    except (ValueError, TypeError) as e:
        return f"Invalid cron expression: {e}"
    return None


class Scheduler:
    def __init__(self, database: Database, registry: Registry, team: Team, timezone: str):
        self.db = database
        self.registry = registry
        self.team = team
        self.timezone = timezone
        self._sched = BackgroundScheduler(timezone=timezone, job_defaults={"coalesce": True, "max_instances": 1, "misfire_grace_time": 3600})

    def start(self) -> None:
        self.sync()
        self._sched.start()

    def shutdown(self) -> None:
        if self._sched.running:
            self._sched.shutdown(wait=False)

    def effective_schedule(self, key: str) -> str | None:
        config = self.db.get_config(key)
        if config is not None:
            return config["schedule"]
        scenario = self.registry.get(key)
        return scenario.schedule if scenario else None

    def is_enabled(self, key: str) -> bool:
        config = self.db.get_config(key)
        if config is not None:
            return config["enabled"]
        scenario = self.registry.get(key)
        return scenario.enabled_by_default if scenario else False

    def sync(self) -> None:
        wanted = set()
        for scenario in self.registry:
            job_id = f"cron:{scenario.key}"
            schedule = self.effective_schedule(scenario.key)
            if self.is_enabled(scenario.key) and schedule and validate_cron(schedule, self.timezone) is None:
                wanted.add(job_id)
                self._sched.add_job(self.team.enqueue, CronTrigger.from_crontab(schedule, timezone=self.timezone),
                                    id=job_id, args=[scenario.key, "schedule"], replace_existing=True, name=scenario.name)
        for job in self._sched.get_jobs():
            if job.id.startswith("cron:") and job.id not in wanted:
                job.remove()

    def next_run(self, key: str) -> datetime | None:
        job = self._sched.get_job(f"cron:{key}")
        return job.next_run_time if job else None

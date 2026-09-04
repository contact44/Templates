"""Runtime settings. Everything is a path or a plain value; nothing is read from the network."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

APP_NAME = "Greffier"
ROOT = Path(__file__).resolve().parent.parent


@dataclass
class Settings:
    workspace: Path = field(default_factory=lambda: ROOT / "workspace")
    robots_dir: Path = field(default_factory=lambda: ROOT / "robots")
    host: str = "127.0.0.1"
    port: int = 8765
    timezone: str = "Europe/Paris"
    demo: bool = False  # preview mode: seeded demo data, no scheduler, runs execute inline

    @property
    def db_path(self) -> Path:
        return self.workspace / "greffier.db"

    @property
    def output_dir(self) -> Path:
        return self.workspace / "sorties"

    @classmethod
    def from_env(cls) -> "Settings":
        env = os.environ
        return cls(
            workspace=Path(env.get("GREFFIER_WORKSPACE", ROOT / "workspace")).resolve(),
            robots_dir=Path(env.get("GREFFIER_ROBOTS", ROOT / "robots")).resolve(),
            host=env.get("GREFFIER_HOST", "127.0.0.1"),
            port=int(env.get("GREFFIER_PORT", "8765")),
            timezone=env.get("GREFFIER_TZ", "Europe/Paris"),
            demo=env.get("GREFFIER_DEMO", "").lower() in ("1", "true", "on"),
        )

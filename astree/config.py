"""Runtime settings. Everything is a path or a plain value; nothing is read from the network."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

APP_NAME = "Astrée"
DEPARTMENT = "Direction juridique"
DEFAULT_TEAM = ["Vega", "Altaïr", "Deneb"]
ROOT = Path(__file__).resolve().parent.parent


@dataclass
class Settings:
    workspace: Path = field(default_factory=lambda: ROOT / "workspace")
    scenarios_dir: Path = field(default_factory=lambda: ROOT / "scenarios")  # scenarios shipped with the code
    host: str = "127.0.0.1"
    port: int = 8765
    timezone: str = "Europe/Paris"
    demo: bool = False  # preview mode: seeded demo data, no scheduler, runs execute inline

    @property
    def db_path(self) -> Path:
        return self.workspace / "astree.db"

    @property
    def deposited_dir(self) -> Path:
        """Scenarios deposited from the interface. Current version of each lives here as <key>.py."""
        return self.workspace / "scenarios"

    @property
    def versions_dir(self) -> Path:
        return self.workspace / "scenarios" / "versions"

    @property
    def output_dir(self) -> Path:
        return self.workspace / "sorties"

    @classmethod
    def from_env(cls) -> "Settings":
        env = os.environ
        return cls(
            workspace=Path(env.get("ASTREE_WORKSPACE", ROOT / "workspace")).resolve(),
            scenarios_dir=Path(env.get("ASTREE_SCENARIOS", ROOT / "scenarios")).resolve(),
            host=env.get("ASTREE_HOST", "127.0.0.1"),
            port=int(env.get("ASTREE_PORT", "8765")),
            timezone=env.get("ASTREE_TZ", "Europe/Paris"),
            demo=env.get("ASTREE_DEMO", "").lower() in ("1", "true", "on"),
        )

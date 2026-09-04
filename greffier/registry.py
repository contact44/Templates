"""Robot discovery. A robot is one Python file in the robots directory.

Contract (module-level names):

    KEY = "demo_ping"                 # unique, stable identifier (used in URLs and the database)
    NAME = "Robot de démonstration"   # display name
    DESCRIPTION = "..."               # one or two sentences
    SCHEDULE = "*/10 * * * *"         # default cron expression, or None for on-demand only
    PARAMS = [                        # optional, configurable from the interface
        {"name": "count", "label": "Nombre d'éléments", "type": "int", "default": 10, "help": "..."},
        {"name": "mode", "label": "Mode", "type": "choice", "choices": ["rapide", "complet"], "default": "rapide"},
    ]

    def run(ctx):                     # does the work; see greffier.runner.RunContext
        ...
"""

from __future__ import annotations

import importlib.util
import sys
from dataclasses import dataclass, field
from pathlib import Path
from types import ModuleType
from typing import Any, Callable

PARAM_TYPES = ("str", "int", "float", "bool", "text", "choice")


@dataclass
class ParamSpec:
    name: str
    label: str
    type: str = "str"
    default: Any = None
    help: str = ""
    choices: list[str] = field(default_factory=list)

    def coerce(self, raw: Any) -> Any:
        """Turn a form value (string or None) into the declared type. Raises ValueError with a readable message."""
        if self.type == "bool":
            if isinstance(raw, bool):
                return raw
            return str(raw).lower() in ("1", "true", "on", "oui", "yes")
        if raw is None or raw == "":
            return self.default
        if self.type == "int":
            try:
                return int(str(raw).strip())
            except ValueError:
                raise ValueError(f"« {self.label} » doit être un nombre entier.")
        if self.type == "float":
            try:
                return float(str(raw).strip().replace(",", "."))
            except ValueError:
                raise ValueError(f"« {self.label} » doit être un nombre.")
        if self.type == "choice":
            value = str(raw)
            if self.choices and value not in self.choices:
                raise ValueError(f"« {self.label} » doit être l'une des valeurs proposées.")
            return value
        return str(raw)


@dataclass
class RobotSpec:
    key: str
    name: str
    description: str
    schedule: str | None
    params: list[ParamSpec]
    run: Callable[[Any], Any]
    path: Path

    def defaults(self) -> dict:
        return {p.name: p.default for p in self.params}

    def coerce_params(self, raw: dict) -> dict:
        """Validate a whole form. Collects every error so the user sees them all at once."""
        values: dict = {}
        errors: list[str] = []
        for p in self.params:
            try:
                values[p.name] = p.coerce(raw.get(p.name))
            except ValueError as e:
                errors.append(str(e))
        if errors:
            raise ValueError(" ".join(errors))
        return values


class RobotLoadError(Exception):
    pass


def _load_module(path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(f"greffier_robot_{path.stem}", path)
    if spec is None or spec.loader is None:
        raise RobotLoadError(f"{path.name}: impossible de charger le module")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _spec_from_module(module: ModuleType, path: Path) -> RobotSpec:
    key = getattr(module, "KEY", None)
    run = getattr(module, "run", None)
    if not key or not isinstance(key, str):
        raise RobotLoadError(f"{path.name}: KEY manquant")
    if not callable(run):
        raise RobotLoadError(f"{path.name}: fonction run(ctx) manquante")
    params: list[ParamSpec] = []
    for raw in getattr(module, "PARAMS", []) or []:
        if "name" not in raw:
            raise RobotLoadError(f"{path.name}: un paramètre n'a pas de nom")
        ptype = raw.get("type", "str")
        if ptype not in PARAM_TYPES:
            raise RobotLoadError(f"{path.name}: type de paramètre inconnu « {ptype} »")
        params.append(
            ParamSpec(
                name=raw["name"],
                label=raw.get("label", raw["name"]),
                type=ptype,
                default=raw.get("default"),
                help=raw.get("help", ""),
                choices=list(raw.get("choices", [])),
            )
        )
    return RobotSpec(
        key=key,
        name=getattr(module, "NAME", key),
        description=getattr(module, "DESCRIPTION", ""),
        schedule=getattr(module, "SCHEDULE", None),
        params=params,
        run=run,
        path=path,
    )


class Registry:
    """Loads every robot file once; `reload()` picks up new or changed files."""

    def __init__(self, robots_dir: Path):
        self.robots_dir = Path(robots_dir)
        self.robots: dict[str, RobotSpec] = {}
        self.errors: dict[str, str] = {}

    def reload(self) -> "Registry":
        self.robots = {}
        self.errors = {}
        if not self.robots_dir.exists():
            return self
        for path in sorted(self.robots_dir.glob("*.py")):
            if path.name.startswith("_"):
                continue
            try:
                spec = _spec_from_module(_load_module(path), path)
            except Exception as e:  # a broken robot must not take the platform down
                self.errors[path.name] = f"{type(e).__name__}: {e}"
                continue
            if spec.key in self.robots:
                self.errors[path.name] = f"KEY « {spec.key} » déjà utilisée par {self.robots[spec.key].path.name}"
                continue
            self.robots[spec.key] = spec
        return self

    def get(self, key: str) -> RobotSpec | None:
        return self.robots.get(key)

    def __iter__(self):
        return iter(self.robots.values())

    def __len__(self) -> int:
        return len(self.robots)

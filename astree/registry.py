"""Scenario discovery and inspection. A scenario is one Python file.

Contract (module-level names):

    KEY = "extraction_selms"                # unique, stable identifier (URLs, database)
    NAME = "Extraction mensuelle SELMS+"    # display name
    DESCRIPTION = "..."                     # one or two sentences
    SCHEDULE = "0 7 28 * *"                 # default cron expression (local time), or None for on-demand only
    ENABLED_BY_DEFAULT = True               # optional; False for a scenario that must be switched on by hand
    PARAMS = [                              # optional, configurable from the interface
        {"name": "dossier", "label": "Dossier", "type": "str", "default": "factures", "help": "..."},
    ]

    def run(ctx):                           # the work; see astree.runner.RunContext
        ...

Scenarios come from two places: the `scenarios/` directory shipped with the code, and the workspace directory
where deposited scenarios are stored (current version as <key>.py).
"""

from __future__ import annotations

import ast
import hashlib
import importlib.util
import sys
from dataclasses import dataclass, field
from pathlib import Path
from types import ModuleType
from typing import Any, Callable

PARAM_TYPES = ("str", "int", "float", "bool", "text", "choice")
ACTION_KINDS = ("mail.lire", "mail.repondre", "doc.lire", "doc.remplir", "web.consulter", "verifier", "propose", "envoyer", "archiver", "attendre")
NETWORK_MODULES = {"requests", "httpx", "urllib", "urllib3", "playwright", "selenium", "smtplib", "imaplib", "ftplib", "socket", "paramiko", "aiohttp", "win32com", "msal", "docusign_esign"}
OUTBOUND_HINTS = ("smtplib", ".Send(", "send_mail", "sendmail", "envelopes.create", ".send(")


@dataclass
class ParamSpec:
    name: str
    label: str
    type: str = "str"
    default: Any = None
    help: str = ""
    choices: list[str] = field(default_factory=list)

    def coerce(self, raw: Any) -> Any:
        if self.type == "bool":
            return raw if isinstance(raw, bool) else str(raw).lower() in ("1", "true", "on", "oui", "yes")
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
class ScenarioSpec:
    key: str
    name: str
    description: str
    schedule: str | None
    params: list[ParamSpec]
    run: Callable[[Any], Any]
    path: Path
    source: str = "builtin"  # "builtin" (shipped in the code) or "deposited" (from the interface)
    enabled_by_default: bool = True
    actions: list[str] = field(default_factory=list)

    def defaults(self) -> dict:
        return {p.name: p.default for p in self.params}

    def coerce_params(self, raw: dict) -> dict:
        values, errors = {}, []
        for p in self.params:
            try:
                values[p.name] = p.coerce(raw.get(p.name))
            except ValueError as e:
                errors.append(str(e))
        if errors:
            raise ValueError(" ".join(errors))
        return values


class ScenarioLoadError(Exception):
    pass


def _load_module(path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(f"astree_scenario_{path.stem}_{abs(hash(str(path)))}", path)
    if spec is None or spec.loader is None:
        raise ScenarioLoadError(f"{path.name}: impossible de charger le module")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _spec_from_module(module: ModuleType, path: Path, source: str) -> ScenarioSpec:
    key = getattr(module, "KEY", None)
    run = getattr(module, "run", None)
    if not key or not isinstance(key, str):
        raise ScenarioLoadError(f"{path.name}: KEY manquant")
    if not all(c.isalnum() or c in "_-" for c in key):
        raise ScenarioLoadError(f"{path.name}: KEY « {key} » ne doit contenir que lettres, chiffres, _ et -")
    if not callable(run):
        raise ScenarioLoadError(f"{path.name}: fonction run(ctx) manquante")
    params: list[ParamSpec] = []
    for raw in getattr(module, "PARAMS", []) or []:
        if "name" not in raw:
            raise ScenarioLoadError(f"{path.name}: un paramètre n'a pas de nom")
        ptype = raw.get("type", "str")
        if ptype not in PARAM_TYPES:
            raise ScenarioLoadError(f"{path.name}: type de paramètre inconnu « {ptype} »")
        params.append(ParamSpec(name=raw["name"], label=raw.get("label", raw["name"]), type=ptype, default=raw.get("default"),
                                help=raw.get("help", ""), choices=list(raw.get("choices", []))))
    return ScenarioSpec(
        key=key, name=getattr(module, "NAME", key), description=getattr(module, "DESCRIPTION", ""),
        schedule=getattr(module, "SCHEDULE", None), params=params, run=run, path=path, source=source,
        enabled_by_default=bool(getattr(module, "ENABLED_BY_DEFAULT", True)),
        actions=declared_actions(path.read_text(encoding="utf-8")),
    )


def declared_actions(code: str) -> list[str]:
    """Action kinds passed as string literals to ctx.step(...) / ctx.propose(...), in source order."""
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return []
    found: list[tuple[int, int, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            if node.func.attr == "step" and node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str):
                found.append((node.lineno, node.col_offset, node.args[0].value))
            elif node.func.attr == "propose":
                found.append((node.lineno, node.col_offset, "propose"))
    kinds: list[str] = []
    for _, _, kind in sorted(found):
        if kind not in kinds:
            kinds.append(kind)
    return kinds


def imported_modules(code: str) -> list[str]:
    names: list[str] = []
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return names
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names += [a.name.split(".")[0] for a in node.names]
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.append(node.module.split(".")[0])
    return sorted(set(names))


@dataclass
class Check:
    ok: bool
    text: str
    level: str = "ok"  # ok | warn | error


@dataclass
class Inspection:
    checks: list[Check]
    key: str | None = None
    name: str | None = None
    schedule: str | None = None
    actions: list[str] = field(default_factory=list)
    imports: list[str] = field(default_factory=list)

    @property
    def valid(self) -> bool:
        return not any(c.level == "error" for c in self.checks)


def inspect_source(code: str, tmp_dir: Path, existing_keys: dict[str, str], replacing: str | None = None) -> Inspection:
    """Run the deposit checks on a piece of code without registering it."""
    checks: list[Check] = []
    try:
        compile(code, "<scenario>", "exec")
        checks.append(Check(True, "Syntaxe Python valide"))
    except SyntaxError as e:
        checks.append(Check(False, f"Erreur de syntaxe ligne {e.lineno} : {e.msg}", "error"))
        return Inspection(checks)
    tmp_dir.mkdir(parents=True, exist_ok=True)
    tmp = tmp_dir / f"_inspect_{hashlib.sha1(code.encode('utf-8')).hexdigest()[:10]}.py"
    tmp.write_text(code, encoding="utf-8")
    try:
        spec = _spec_from_module(_load_module(tmp), tmp, "deposited")
    except Exception as e:
        checks.append(Check(False, f"Contrat non respecté : {e}", "error"))
        return Inspection(checks)
    finally:
        try:
            tmp.unlink()
        except OSError:
            pass
    checks.append(Check(True, f"Contrat respecté : KEY « {spec.key} », NAME, run(ctx), {len(spec.params)} paramètre(s)"))
    owner = existing_keys.get(spec.key)
    if owner and spec.key != replacing:
        if owner == "builtin":
            checks.append(Check(False, f"Clé « {spec.key} » déjà utilisée par un scénario livré avec le code", "error"))
        else:
            checks.append(Check(True, f"Clé « {spec.key} » existante : le dépôt créera une nouvelle version", "warn"))
    elif spec.key == replacing:
        checks.append(Check(True, f"Nouvelle version du scénario « {spec.key} »"))
    else:
        checks.append(Check(True, f"Clé « {spec.key} » disponible"))
    if spec.schedule:
        from .scheduler import validate_cron

        err = validate_cron(spec.schedule, "Europe/Paris")
        checks.append(Check(err is None, f"Planification « {spec.schedule} »" + (f" : {err}" if err else " valide"), "error" if err else "ok"))
    else:
        checks.append(Check(True, "Aucune planification par défaut : à la demande"))
    actions = spec.actions
    unknown = [a for a in actions if a not in ACTION_KINDS]
    if actions:
        checks.append(Check(True, f"{len(actions)} action(s) déclarée(s) : {', '.join(actions)}"))
    else:
        checks.append(Check(True, "Aucune action déclarée avec ctx.step : le robot travaillera à son bureau", "warn"))
    if unknown:
        checks.append(Check(True, f"Action(s) hors catalogue : {', '.join(unknown)} (affichées comme travail au bureau)", "warn"))
    imports = imported_modules(code)
    net = [m for m in imports if m in NETWORK_MODULES]
    if net:
        checks.append(Check(True, f"Accès réseau ou système : {', '.join(net)}", "warn"))
    if any(h in code for h in OUTBOUND_HINTS) and "propose" not in actions:
        checks.append(Check(True, "Envoi sortant possible sans passer par ctx.propose : vérifiez qu'une validation humaine est prévue", "warn"))
    if "ctx.credentials(" in code:
        checks.append(Check(True, "Utilise des identifiants du coffre (ctx.credentials)"))
    return Inspection(checks, key=spec.key, name=spec.name, schedule=spec.schedule, actions=actions, imports=imports)


class Registry:
    """Loads every scenario file from the builtin directory and the deposited directory."""

    def __init__(self, builtin_dir: Path, deposited_dir: Path | None = None):
        self.builtin_dir = Path(builtin_dir)
        self.deposited_dir = Path(deposited_dir) if deposited_dir else None
        self.scenarios: dict[str, ScenarioSpec] = {}
        self.errors: dict[str, str] = {}

    def reload(self) -> "Registry":
        self.scenarios, self.errors = {}, {}
        for source, directory in (("builtin", self.builtin_dir), ("deposited", self.deposited_dir)):
            if not directory or not directory.exists():
                continue
            for path in sorted(directory.glob("*.py")):
                if path.name.startswith("_"):
                    continue
                try:
                    spec = _spec_from_module(_load_module(path), path, source)
                except Exception as e:  # a broken scenario must not take the platform down
                    self.errors[path.name] = f"{type(e).__name__}: {e}"
                    continue
                if spec.key in self.scenarios:
                    self.errors[path.name] = f"KEY « {spec.key} » déjà utilisée par {self.scenarios[spec.key].path.name}"
                    continue
                self.scenarios[spec.key] = spec
        return self

    def keys_by_source(self) -> dict[str, str]:
        return {k: s.source for k, s in self.scenarios.items()}

    def get(self, key: str) -> ScenarioSpec | None:
        return self.scenarios.get(key)

    def __iter__(self):
        return iter(self.scenarios.values())

    def __len__(self) -> int:
        return len(self.scenarios)

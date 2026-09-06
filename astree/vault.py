"""Credential vault. Usernames and notes live in the database; passwords live here.

On Windows the password goes to the Credential Manager through `keyring`. Where no system keyring is usable
(a server without desktop session, the preview host), it falls back to a file encrypted with a key kept next
to it; that protects against casual reading, not against someone who owns the machine, and the interface says so.
"""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path

SERVICE = "astree"


class Vault:
    def __init__(self, workspace: Path):
        self.workspace = Path(workspace)
        self.backend = "keyring"
        self._keyring = None
        try:
            import keyring
            from keyring.backends import fail, null

            kr = keyring.get_keyring()
            if isinstance(kr, (fail.Keyring, null.Keyring)) or getattr(kr, "priority", 0) < 1:
                raise RuntimeError("no usable keyring backend")
            self._keyring = keyring
        except Exception:
            self.backend = "file"

    @property
    def backend_label(self) -> str:
        if self.backend == "keyring":
            return "Gestionnaire d'identifiants du système (keyring)"
        return f"Fichier chiffré local · {self._file_path().name}"

    # -- public --------------------------------------------------------------------------

    def set_password(self, name: str, password: str) -> None:
        if self.backend == "keyring":
            self._keyring.set_password(SERVICE, name, password)
        else:
            data = self._read_file()
            data[name] = password
            self._write_file(data)

    def get_password(self, name: str) -> str | None:
        if self.backend == "keyring":
            return self._keyring.get_password(SERVICE, name)
        return self._read_file().get(name)

    def delete_password(self, name: str) -> None:
        if self.backend == "keyring":
            try:
                self._keyring.delete_password(SERVICE, name)
            except Exception:
                pass
        else:
            data = self._read_file()
            if data.pop(name, None) is not None:
                self._write_file(data)

    # -- file backend ------------------------------------------------------------------------

    def _file_path(self) -> Path:
        return self.workspace / "vault.bin"

    def _key(self) -> bytes:
        from cryptography.fernet import Fernet

        key_path = self.workspace / ".vault.key"
        if not key_path.exists():
            self.workspace.mkdir(parents=True, exist_ok=True)
            key_path.write_bytes(Fernet.generate_key())
            try:
                os.chmod(key_path, 0o600)
            except OSError:
                pass
        return key_path.read_bytes()

    def _read_file(self) -> dict:
        from cryptography.fernet import Fernet

        path = self._file_path()
        if not path.exists():
            return {}
        return json.loads(Fernet(self._key()).decrypt(path.read_bytes()).decode("utf-8"))

    def _write_file(self, data: dict) -> None:
        from cryptography.fernet import Fernet

        path = self._file_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(Fernet(self._key()).encrypt(json.dumps(data).encode("utf-8")))
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass


def mask(text: str, secrets: list[str]) -> str:
    """Replace every secret value in a log line with dots."""
    for s in secrets:
        if s and s in text:
            text = text.replace(s, "•••••")
    return text

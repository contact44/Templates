# PyInstaller recipe for Pulsar.exe: one file, no Python to install on the machine that runs it.
#     pyinstaller tools/pulsar.spec --noconfirm
# Run it on Windows to get a Windows executable (PyInstaller does not cross-build); the same recipe produces a
# Linux or macOS binary when run there, which is how it is tested.
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules

ROOT = Path(SPECPATH).parent

datas = [
    (str(ROOT / "pulsar" / "templates"), "pulsar/templates"),
    (str(ROOT / "pulsar" / "static"), "pulsar/static"),
    (str(ROOT / "scenarios"), "scenarios"),          # the shipped scenarios travel with the executable
]

# Imported by name at run time, so PyInstaller cannot see them in the code: the ASGI server's own machinery, the
# scheduler's trigger classes, and the credential vault's backends (Windows Credential Manager among them).
hiddenimports = (
    collect_submodules("uvicorn")
    + collect_submodules("apscheduler")
    + collect_submodules("keyring.backends")
    + ["tzdata", "encodings.idna"]
)

analysis = Analysis(
    [str(ROOT / "tools" / "pulsar_launcher.py")],
    pathex=[str(ROOT)],
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=["tkinter", "pytest", "playwright", "PIL"],   # not needed to serve the interface
    noarchive=False,
)
pyz = PYZ(analysis.pure)

exe = EXE(
    pyz,
    analysis.scripts,
    analysis.binaries,
    analysis.datas,
    [],
    name="Pulsar",
    icon=str(ROOT / "tools" / "pulsar.ico") if sys.platform == "win32" else None,
    console=True,          # the window shows the address and the errors; closing it stops the platform
    onefile=True,
    upx=False,
    version=None,
)

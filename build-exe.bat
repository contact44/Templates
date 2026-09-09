@echo off
rem Builds Pulsar.exe from this folder. Needs Python 3.11 or later; everything else is installed here.
rem The result is dist\Pulsar.exe, one file you can copy anywhere.
setlocal
cd /d "%~dp0"

python --version >nul 2>&1
if errorlevel 1 (
  echo Python was not found. Install Python 3.11 or later from https://www.python.org/downloads/
  echo and tick "Add python.exe to PATH", then run this file again.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo Preparing the build environment. This happens once.
  python -m venv .venv || goto :failed
)
.venv\Scripts\python.exe -m pip install --quiet --upgrade pip || goto :failed
.venv\Scripts\python.exe -m pip install --quiet -e . pyinstaller || goto :failed

echo Building Pulsar.exe, this takes a few minutes.
.venv\Scripts\python.exe -m PyInstaller tools\pulsar.spec --noconfirm --distpath dist --workpath build\pyinstaller || goto :failed

echo.
echo Done: dist\Pulsar.exe
echo Copy it wherever you like and double-click it. It creates a "Pulsar data" folder next to itself.
pause
exit /b 0

:failed
echo.
echo The build failed. Send the lines above to whoever set up the platform.
pause
exit /b 1

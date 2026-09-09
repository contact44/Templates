@echo off
rem Samsung Pulsar on this PC: prepares what is missing, then starts the platform and opens it in the browser.
rem Every run checks the installation, so a new version of the platform brings in what it needs by itself.
rem Nothing leaves the machine. Double-click this file.
setlocal
cd /d "%~dp0"

set PYTHON=python
%PYTHON% --version >nul 2>&1
if errorlevel 1 (
  echo Python was not found. Install Python 3.11 or later from https://www.python.org/downloads/
  echo and tick "Add python.exe to PATH" during the installation, then run this file again.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo Preparing Samsung Pulsar. This first time takes a few minutes.
  %PYTHON% -m venv .venv || goto :failed
  .venv\Scripts\python.exe -m pip install --quiet --upgrade pip || goto :failed
)

rem Always, not only the first time: a new version of the platform needs what it added since the last one, and
rem pip does nothing when everything is already there.
echo Checking the installation.
.venv\Scripts\python.exe -m pip install --quiet -e ".[rpa]" || goto :failed

echo Starting Samsung Pulsar on http://127.0.0.1:8765
start "Samsung Pulsar" .venv\Scripts\python.exe -m pulsar
ping -n 6 127.0.0.1 >nul
start "" http://127.0.0.1:8765
echo.
echo The platform runs in the window titled "Samsung Pulsar". Close that window to stop it.
timeout /t 8 >nul
exit /b 0

:failed
echo.
echo The preparation failed. Send the lines above to whoever set up the platform.
pause
exit /b 1

"""What Pulsar.exe runs: start the platform, open it in the browser, keep it running.

Double-clicking the executable has to feel like opening a piece of software, so this does by itself everything the
command line asks for: it picks the data folder, prepares it on the first start, takes a free port when 8765 is
busy, opens the browser once the server answers, and stays in its window until it is closed.

Inside a PyInstaller build, the code lives in a temporary folder that Windows wipes; the data must not. So the
workspace goes next to the executable, in a "Pulsar data" folder, unless PULSAR_WORKSPACE says otherwise.
"""

from __future__ import annotations

import os
import socket
import sys
import threading
import time
import webbrowser
from pathlib import Path


def frozen() -> bool:
    return getattr(sys, "frozen", False)


def beside_the_executable() -> Path:
    """The folder the user sees: where Pulsar.exe is, not the temporary folder it unpacks into."""
    return Path(sys.executable).resolve().parent if frozen() else Path(__file__).resolve().parent.parent


def bundled() -> Path:
    """Where the shipped files (templates, static, scenarios) are once unpacked."""
    return Path(getattr(sys, "_MEIPASS", beside_the_executable()))


def free_port(preferred: int) -> int:
    for port in [preferred] + list(range(preferred + 1, preferred + 20)):
        with socket.socket() as probe:
            if probe.connect_ex(("127.0.0.1", port)) != 0:
                return port
    return preferred


def wait_then_open(url: str, port: int) -> None:
    for _ in range(120):                      # up to 60 s: the first start builds the database
        time.sleep(0.5)
        with socket.socket() as probe:
            if probe.connect_ex(("127.0.0.1", port)) == 0:
                webbrowser.open(url)
                return


def main() -> int:
    home = beside_the_executable()
    workspace = Path(os.environ.get("PULSAR_WORKSPACE") or home / "Pulsar data")
    os.environ["PULSAR_WORKSPACE"] = str(workspace)
    os.environ.setdefault("PULSAR_SCENARIOS", str(bundled() / "scenarios"))

    from pulsar.config import APP_NAME, Settings

    settings = Settings.from_env()
    port = free_port(settings.port)
    if port != settings.port:
        os.environ["PULSAR_PORT"] = str(port)
        settings = Settings.from_env()
    url = f"http://127.0.0.1:{port}"

    def say(line: str = "") -> None:
        print(line, flush=True)      # unbuffered: the window shows the address before the server is even up

    first_start = not settings.db_path.exists()
    say(f"{APP_NAME}\n")
    say(f"  Address    {url}")
    say(f"  Data       {workspace}")
    say(f"  Scenarios  {settings.scenarios_dir}\n")

    from pulsar.app import create_app

    app = create_app(settings)
    if first_start:
        say("  First start: filling the dashboard with demonstration data, this takes a moment.")
        from pulsar.demo import seed

        platform = app.state.platform
        seed(platform.db, platform.registry, team_size=platform.team.size)

    say("  Opening the browser. Close this window to stop the platform.\n")
    threading.Thread(target=wait_then_open, args=(url, port), daemon=True).start()

    import uvicorn

    try:
        uvicorn.run(app, host=settings.host, port=port, log_level="warning")
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as error:                # a bare traceback in a window that closes helps nobody
        import traceback

        print("\nSamsung Pulsar could not start.\n")
        traceback.print_exc()
        print("\nSend the lines above to whoever set up the platform.")
        if frozen() and sys.platform == "win32":
            input("\nPress Enter to close this window. ")
        raise SystemExit(1)

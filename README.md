# Samsung Pulsar

Local RPA platform for a legal department: Python scenarios deposited from the interface, a named team of
robots that runs them in the background, a 2D open space to see who is working on what, and a performance
dashboard. One Python process, one SQLite database, one browser. No server, no cloud.

## Getting started

Double-click `start.bat` on Windows, or run `./start.sh` on macOS and Linux. The first run installs the platform
and everything the robots need to drive a browser and read an Excel file, which takes a few minutes; every later
run checks that installation in a couple of seconds, so a new version of the platform brings in what it needs by
simply being started, then opens http://127.0.0.1:8765 in the browser. Python 3.11 or later must be installed,
with "Add python.exe to PATH" ticked.

By hand, if you prefer:

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows   (Linux/macOS: source .venv/bin/activate)
pip install -e .[rpa]           # the platform, plus what the robots need to drive a browser
pulsar                          # http://127.0.0.1:8765
```

Other commands: `pulsar list` (loaded scenarios), `pulsar run <key>` (one run on the terminal),
`pulsar demo-data --reset`, `pulsar -v` (verbose logging).

Optional environment variables: `PULSAR_WORKSPACE` (data, default `./workspace`), `PULSAR_SCENARIOS`
(shipped scenarios, default `./scenarios`), `PULSAR_HOST`, `PULSAR_PORT`, `PULSAR_TZ` (default `Europe/Paris`).

## The tabs

- **Dashboard**: the team (who is busy, on what, at which action), runs today, success rate and average
  duration over 7 days, runs per day over 14 days, one card per scenario, the failures that need a look.
- **Scenarios**: list, deposit of a `.py` file or pasted code, automatic checks (syntax, contract, key,
  schedule, declared actions, network access, outbound sends), versions kept and restorable, enabling,
  cron schedule, parameters.
- **Open space**: the live pixel-art view, one desk per scenario, the name of the robot taking care of it
  and the current action. Clicking a desk runs the scenario.
- **Settings**: robot names (the number of robots = the number of simultaneous scenarios), locations,
  vault credentials.
- **History**: every run, filterable; each run has its action timeline and its journal.

## The team and the vault

The robots (Andromede, Orion, Sirius by default) are execution slots: a scheduled or manually launched
scenario enters a queue, the first free robot takes it and runs it to the end.

Credentials (Settings > Credentials) are named username / password pairs. The username is in the database;
the password goes to the system credential manager (Windows Credential Manager through `keyring`), or to an
encrypted file in the workspace when no system manager exists. A scenario reads them with
`ctx.credentials("selms")`; the password value is masked in the journal.

## Writing a scenario

```python
KEY = "selms_extraction"                 # stable identifier
NAME = "Monthly SELMS+ extraction"
DESCRIPTION = "One sentence."
SCHEDULE = "0 7 28 * *"                  # local cron, or None for on demand
ENABLED_BY_DEFAULT = False               # optional
PARAMS = [{"name": "folder", "label": "Drop folder", "type": "str", "default": "outputs/selms"}]

def run(ctx):
    cred = ctx.credentials("selms")                       # cred.username, cred.password
    with ctx.step("web.browse", "Signing in to SELMS+"):  # declared action: its text shows over the robot, timed
        ...
    for file in ctx.step("doc.read", "Reading the exports", files):
        ctx.task_done()                                    # one task = one precise action; ctx.task_failed("reason") gives "with warnings"
    ctx.metric("contracts", 142)
    path = ctx.output_path("export.xlsx")                  # workspace/outputs/<key>/
```

Action catalogue: `mail.read`, `mail.reply`, `doc.read`, `doc.fill`, `web.browse`, `verify`, `propose`,
`send`, `archive`, `wait`. An uncaught exception marks the run as failed, with the faulty action and the
trace in the journal.

## The SELMS+ scenario

`scenarios/selms_extraction.py` is the "SELMS+ Automation, Scheduled Excel Download" sheet of Legal Operations,
step by step. SELMS+ cannot be opened by its address alone, so the robot takes the same road as you do: the Knox
portal at `http://w1.samsung.net/portalapp/home`, then "SELMS+" in the top menu, which opens the application in a
new tab. From there: Confirm, Contract Mgmt. then My Contract, Request Date from 01/01/2016 to the end of the
current month with Closed = N, Search, Excel Download, then the file by email. The portal address and the name of
the link are parameters, so a menu that is renamed or a portal that moves is a field to edit, not code to change. It drives Microsoft
Edge through Playwright with a browser profile kept in the workspace, so the Samsung SSO session survives between
runs; the email leaves through Outlook on the machine. **SELMS+ needs Internet Explorer mode, and that decides how it is driven.** Edge shows SELMS+ in Internet
Explorer mode, and it turns that mode off whenever a browser is driven through remote debugging, which is how
Playwright and every Chrome-protocol tool work: under such a tool SELMS+ opens as a blank page. The way in is the
**Internet Explorer driver attached to Edge**, Microsoft's supported route for these sites, which drives the browser
through IE automation rather than remote debugging. That is the `edge_ie` setting of the scenario, and its default.

Every label the robot clicks is a parameter holding the spellings it may take, separated by `;` — SELMS+ answers
in the language of the account, so the same menu reads "Contract Mgmt." for one colleague and "Gestion de contrats"
for another. Put the wording you see on your screen first.

The **Stop after** parameter ends the run at a chosen point, successfully, with the screenshots of what was
reached: `portal`, `selms`, `confirm`, `my_contract`, `filters`, `search`. It is how the road is checked one
stretch at a time on the first runs, rather than all at once.

Two things to put in place once on the workstation:

1. Download **IEDriverServer** (32-bit) from the Selenium downloads page, put it somewhere stable such as
   `C:\Pulsar\IEDriverServer.exe`, and write that path in the scenario's parameters. Leave the parameter empty if
   you prefer to put the file on the PATH.
2. In the Internet Options of Windows, Security tab, either tick or untick "Enable Protected Mode" for all four
   zones, so that they agree. The scenario also asks the driver to ignore the zone and zoom settings, which covers
   most machines, but a driver that refuses to start is nearly always this.

Internet Explorer mode has no headless: the window is always shown and the session must stay open, so a scheduled
run needs the PC awake and signed in. The file itself never goes through the download bar, which IE mode cannot be
trusted with: the robot reads the address behind "Excel Download" and fetches it over HTTP with the session
cookies. The Playwright driver stays in the code, for the day SELMS+ leaves Internet Explorer mode.

`start.bat` installs what it needs. Enable the scenario and run it once by hand: the Edge window opens in Internet Explorer mode, and if SSO asks for a
sign-in you do it in that window, the robot waits and carries on. Every step leaves a screenshot in
`workspace/outputs/selms_extraction/`, which is where to look if the site has moved something. The scenario is
tested end to end on a stand-in of the four SELMS+ screens (`tests/fixtures/selms/`).

## Sharing it with the team

Pulsar is already a web server, so one machine can serve the whole department: run it on the workstation that
has access to the applications the robots drive, with

```bash
set PULSAR_HOST=0.0.0.0         # Windows   (Linux/macOS: export PULSAR_HOST=0.0.0.0)
pulsar
```

and colleagues open `http://<name-of-that-pc>:8765` from the internal network. Everyone then sees the same open
space, the same history and the same scenarios. That machine has to stay on for the schedules to fire, and the
credential vault stays on it: nothing is published outside.

This is the only way to share the platform itself. A static host such as GitHub Pages serves files and runs no
Python, so it can show the interface but cannot run a single scenario, reach an internal application, hold the
vault or fire a schedule. What it can host is the preview below.

## The online preview

The platform runs on a workstation, not on a web host: it holds a database, runs scenarios in the background and
reads the credential vault of the machine. What can be published is a preview, one HTML page with everything
inlined:

```bash
python tools/build_preview.py            # writes docs/preview/index.html
```

The page stacks the screens of the interface rendered with demonstration data, buttons disabled, and keeps the
open space alive: `pulsar/static/preview.js` plays a plausible day in the visitor's browser in place of the
server. `.github/workflows/preview.yml` rebuilds and publishes it on GitHub Pages on every push to `main`
(enable it once under Settings > Pages, source "GitHub Actions").

## Launching a run from GitHub

GitHub's own machines can run the tests and build the preview. They cannot run the SELMS+ scenario: it needs the
Samsung network, a Knox session and Internet Explorer mode, three things that only exist on the workstation. So
`.github/workflows/run-scenario.yml` runs on a **self-hosted runner** installed on that workstation. GitHub gives
the button and the log; the PC does the work, awake and signed in, exactly as when you double-click `start.bat`.

Nothing the run produces is uploaded: the Excel export and the screenshots are contract data and stay on the PC.
Registering a GitHub agent on a corporate machine is a decision to take before, not after. Setup and the full
picture are in `docs/05-GITHUB-ACTIONS.md`.

## Layout

```
pulsar/         core: app.py (routes), db.py, registry.py, runner.py, team.py, scheduler.py, vault.py, stats.py, templates/, static/
tools/          build_preview.py (the published page) and the open space artwork scripts
scenarios/      the scenarios shipped with the code (the SELMS+ Excel download)
workspace/      local data, outside git: pulsar.db, deposited scenarios and their versions, outputs/, vault
start.bat       one-click start on Windows; start.sh does the same on macOS and Linux
tests/          pytest
docs/           framing and decisions; docs/preview/ holds the published page
.github/        workflows: tests, the preview on GitHub Pages, a run launched on the workstation
```

## Tests

```bash
pytest
```

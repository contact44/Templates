# Samsung Pulsar

Local RPA platform for a legal department: Python scenarios deposited from the interface, a named team of
robots that runs them in the background, a 2D open space to see who is working on what, and a performance
dashboard. One Python process, one SQLite database, one browser. No server, no cloud.

## Getting started

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows   (Linux/macOS: source .venv/bin/activate)
pip install -e .[dev]
pulsar demo-data                # optional: 14 days of fictitious runs to populate the dashboard
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
    with ctx.step("web.browse", "SELMS+ · sign in"):      # declared action: shown in the open space, timed
        ...
    for file in ctx.step("doc.read", "Exports", files):
        ctx.item_done()                                    # or ctx.item_failed("reason") → "with warnings"
    ctx.metric("contracts", 142)
    path = ctx.output_path("export.xlsx")                  # workspace/outputs/<key>/
```

Action catalogue: `mail.read`, `mail.reply`, `doc.read`, `doc.fill`, `web.browse`, `verify`, `propose`,
`send`, `archive`, `wait`. An uncaught exception marks the run as failed, with the faulty action and the
trace in the journal.

## Layout

```
pulsar/         core: app.py (routes), db.py, registry.py, runner.py, team.py, scheduler.py, vault.py, stats.py, templates/, static/
scenarios/      scenarios shipped with the code (two demos + the SELMS+ extraction skeleton)
workspace/      local data, outside git: pulsar.db, deposited scenarios and their versions, outputs/, vault
tests/          pytest
docs/           framing and previews (in French)
```

## Tests

```bash
pytest
```

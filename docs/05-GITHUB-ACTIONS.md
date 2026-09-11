# GitHub and GitHub Actions

What GitHub can and cannot do for Pulsar, and how to set up the part that works.

## The short answer

GitHub Actions runs jobs on machines. The question is only ever *which* machine.

| | GitHub's machines (`ubuntu-latest`, `windows-latest`) | The workstation (self-hosted runner) |
|---|---|---|
| Run the test suite | Yes | Yes |
| Build the GitHub Pages preview | Yes | Yes |
| Reach `w1.samsung.net` and SELMS+ | **No** | Yes |
| Hold a Knox session | **No** | Yes |
| Open a site in Internet Explorer mode | **No** | Yes |
| Read the credential vault | **No** | Yes |

So the SELMS+ scenario cannot run in GitHub's cloud, and no amount of workflow writing changes that. It is not a
configuration problem: the three things the scenario needs — the Samsung intranet, a signed-in Knox session, and a
Windows desktop where Edge can open a page in Internet Explorer mode — are all properties of the workstation.

What a self-hosted runner buys is real, but it is not execution in the cloud. It is a **button on GitHub that fires
a run on the PC**: anyone in the department with access to the repository can launch the extraction and read the
log, without opening the dashboard or touching the machine. The work still happens on the PC, and the PC still has
to be awake and signed in.

## The three workflows

| File | Machine | What it does |
|---|---|---|
| `tests.yml` | GitHub | Runs the test suite on every push and pull request |
| `preview.yml` | GitHub | Builds the static preview and publishes it on GitHub Pages |
| `run-scenario.yml` | Workstation | Launches a scenario, from the Actions tab or on a schedule |

The first two need nothing: they work as soon as the repository is on GitHub. The third needs the setup below.

## Setting up the runner on the workstation

**1. Register the runner.** In the repository, Settings > Actions > Runners > New self-hosted runner, Windows. Follow
the commands GitHub shows to download and configure it. When it asks for labels, add `pulsar` — the workflow looks
for `self-hosted, windows, pulsar`.

**2. Start it interactively, not as a service.** GitHub offers to install the runner as a Windows service. Decline.
A service runs without a desktop, and Internet Explorer mode needs a real one: the scenario would fail on every run.
Start it by running `run.cmd` in an open session on the account that uses Pulsar. Put a shortcut to `run.cmd` in
`shell:startup` if you want it back after a reboot, and leave the session open.

**3. Use the right Windows account.** The vault password lives in the Windows Credential Manager of the account that
saved it. The runner must be the same account, or `ctx.credentials("selms")` comes back empty.

**4. Point the workflow at the existing workspace.** In the repository, Settings > Secrets and variables > Actions >
Variables, add `PULSAR_WORKSPACE` with the full path of the workspace the platform already uses, for example
`C:\Pulsar\workspace`. Without it the run would start on an empty database and an empty vault; the workflow stops
with that message rather than running on nothing. With it, a run launched from GitHub shows up in the History tab
next to the runs launched from the dashboard.

**5. Launch it.** Actions tab > "Run a scenario on the workstation" > Run workflow.

## What crosses the network, and what does not

The runner opens an outbound HTTPS connection to `github.com` and keeps it open, waiting for work. Nothing listens
for incoming connections, and no port is opened on the PC.

The run produces an Excel export and a screenshot per step. **None of it is uploaded.** The workflow deliberately
has no `upload-artifact` step: those files are contract data, and sending them to GitHub's servers would take
Samsung legal documents out of the department for the sake of a convenience. They stay in
`workspace\outputs\selms_extraction`. What reaches GitHub is the run's console output — the task labels and the
final status, which is what you need to know whether it worked.

This is worth saying out loud before the runner is installed, because it is the part a security review will ask
about: putting a GitHub agent on a corporate workstation is a governance decision, not a technical one. Ask before
registering it.

## When the build cannot reach the network

`preview.yml` rebuilds the page on GitHub's machine: it installs Python, pulls the dependencies and runs
`tools/build_preview.py`. On a corporate instance any of those three can be refused by the firewall.

There is a fallback that needs none of them. `docs/preview/index.html` is already built and committed, a single
self-contained file, so it can be served as it is. Replace `preview.yml` with `preview-static.yml`:

```yaml
name: Preview on GitHub Pages (no build)

on:
  push:
    branches: [main]
    paths: ["docs/preview/**"]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/upload-pages-artifact@v3
        with:
          path: docs/preview
      - id: deployment
        uses: actions/deploy-pages@v4
```

Two things to get right. Delete `preview.yml` when you add this one: both deploy to the same place, and run
together they cancel each other through the `pages` concurrency group. And keep `path: docs/preview` — GitHub's
"Static HTML" starter template says `path: '.'`, which would publish the whole repository, sources and the SELMS+
scenario with its portal addresses included.

What it costs: the page stops following the interface. Whoever changes the interface runs
`python tools/build_preview.py` on their machine and commits the result.

## Should the schedule live on GitHub?

Probably not. `run-scenario.yml` has its `schedule` block commented out on purpose. GitHub's cron is UTC, it drifts
with summer time, and GitHub delays scheduled jobs when its queues are busy — a run due at 07:00 can arrive an hour
late or not at all. The platform's own scheduler fires on the PC, in Paris time, on the minute. Keep the schedule
in the platform and use GitHub for the button.

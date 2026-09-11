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

## Should the schedule live on GitHub?

Probably not. `run-scenario.yml` has its `schedule` block commented out on purpose. GitHub's cron is UTC, it drifts
with summer time, and GitHub delays scheduled jobs when its queues are busy — a run due at 07:00 can arrive an hour
late or not at all. The platform's own scheduler fires on the PC, in Paris time, on the minute. Keep the schedule
in the platform and use GitHub for the button.

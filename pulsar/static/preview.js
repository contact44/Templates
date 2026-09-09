/* Samsung Pulsar - the simulation behind the static preview.
   The published preview is a single HTML page: there is no server to ask, so this file plays a plausible day
   in the life of the team in the browser and answers the open space exactly as /api/live would. Same shape,
   same field names; only the source of the data changes. */
window.PulsarPreview = (function () {
  "use strict";

  var TEAM = ["Andromede", "Orion", "Sirius"];
  // the scenarios shipped with the platform, with the sentence shown over the robot for each of their actions
  var SCENARIOS = [
    {key: "demo_inventory", name: "Folder inventory (demo)", steps: [
      {kind: "doc.read", label: "Listing the folder inbox"},
      {kind: "archive", label: "Writing the CSV inventory"}]},
    {key: "demo_load", name: "Simulated load (demo)", steps: [
      {kind: "mail.read", label: "Reading the demonstration mailbox"},
      {kind: "doc.read", label: "Processing the fictitious batch"},
      {kind: "archive", label: "Filing the results"}]},
    {key: "selms_extraction", name: "Monthly SELMS+ extraction", steps: [
      {kind: "web.browse", label: "Signing in to SELMS+"},
      {kind: "web.browse", label: "Filtering and exporting"},
      {kind: "verify", label: "Checking the file"},
      {kind: "archive", label: "Filing in the shared folder"}]}
  ];

  var runs = {}, events = [], nextRunId = 300, busy = {}, runningKeyOf = {};
  SCENARIOS.forEach(function (s) { runs[s.key] = {running: false, tasks: 0, errors: 0, endsAt: 0, nextStartAt: 0, step: 0, worker: null, runId: null, lastTask: 0}; });

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function hhmm(d) { return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function byKey(key) { return SCENARIOS.filter(function (s) { return s.key === key; })[0]; }
  function freeRobot() { for (var i = 0; i < TEAM.length; i++) if (!busy[i]) return i; return null; }

  function start(scenario, now, index) {
    var robot = freeRobot();
    if (robot === null) return;
    var r = runs[scenario.key];
    busy[robot] = true; runningKeyOf[robot] = scenario.key;
    r.running = true; r.worker = robot; r.runId = nextRunId++;
    r.tasks = 0; r.errors = 0; r.step = 0; r.lastTask = now;
    r.startedAt = now; r.endsAt = now + 9000 + Math.random() * 9000;
  }

  function finish(scenario, now) {
    var r = runs[scenario.key];
    var status = r.errors > 0 ? "warning" : (Math.random() < 0.85 ? "success" : "error");
    var message = status === "error" ? "TimeoutError: source unavailable (simulated)"
      : r.tasks + (r.tasks === 1 ? " task done" : " tasks done") + (r.errors ? ", " + r.errors + " failed" : "");
    events.unshift({id: r.runId, scenario_name: scenario.name, worker: TEAM[r.worker], status: status,
                    started: "today " + hhmm(new Date(now)), items: r.tasks, message: message});
    events = events.slice(0, 8);
    busy[r.worker] = false; runningKeyOf[r.worker] = null;
    r.running = false; r.worker = null; r.runId = null; r.tasks = 0; r.errors = 0;
  }

  function tick(now) {
    SCENARIOS.forEach(function (scenario, i) {
      var r = runs[scenario.key];
      if (r.running) {
        if (now - r.lastTask > 700) { r.lastTask = now; if (Math.random() < 0.06) r.errors++; else r.tasks++; }
        var done = 1 - (r.endsAt - now) / (r.endsAt - r.startedAt);
        r.step = Math.max(0, Math.min(scenario.steps.length - 1, Math.floor(scenario.steps.length * done)));
        if (now > r.endsAt) finish(scenario, now);
      } else if (now > r.nextStartAt) {
        var first = !r.nextStartAt;
        if (!first) start(scenario, now, i);
        r.nextStartAt = now + (first ? 1500 : 8000 + Math.random() * 10000) + i * 3000;
      }
    });
  }

  function poll() {
    var now = Date.now(), clock = new Date();
    tick(now);
    return Promise.resolve({
      now: clock.toISOString(), clock: hhmm(clock), demo: true, events: events, queued: [], scenarios: [],
      team: TEAM.map(function (name, i) {
        var key = runningKeyOf[i], r = key ? runs[key] : null, scenario = key ? byKey(key) : null;
        return {name: name, busy: !!busy[i], scenario_name: scenario ? scenario.name : null,
                step: r && r.running ? scenario.steps[r.step] : null,
                run_id: r ? r.runId : null, items: r ? r.tasks : 0, errors: r ? r.errors : 0};
      })
    });
  }

  return {poll: poll, team: TEAM, scenarios: SCENARIOS};
})();

/* Samsung Pulsar · open space — the team at work, drawn like a small isometric video game.
   No dependencies. The rooms and the characters come from the Higgsfield artwork (static/openspace/):
   - background-<theme>.png + scene-<theme>.json: the room, where each station is, the walk graph the robots follow,
     the furniture cut out as foreground pieces (drawn over a robot standing behind them)
   - sheet-<name>.png: one character in seven poses (front, 3/4 front, profile, 3/4 back, back, and seated on an
     office chair seen from the back or the front),
     animated here (walk, run, type, read, coffee, wait); the right-facing views are the left ones mirrored */
window.Openspace = (function () {
  "use strict";

  var SCALE = 3, W = 380;           // logical pixels: the scene is 380 wide, drawn at 3 canvas px per logical px
  var TICK = 60;                    // ms between simulation steps (~16 fps)
  var WALK = 1.5, RUN = 3.2;        // logical px per tick
  var C = { k: "#0B1220", w: "#FFFFFF", muted: "#8A96A8", neon: "#5EEAF0", green: "#4BE38A", red: "#E0503F", amber: "#E5A63C",
            blue: "#1428A0", plate: "#0F1E52", screen: "#0A1518", paper: "#F2F4F6", ink: "#6B7385", cup: "#E8E2D6" };
  var TIES = ["#4CC2FF", "#F0902F", "#3ED28A", "#C77DFF", "#FFD24C", "#FF6F91", "#7CE0FF", "#B7F26B"];

  // ---- 3x5 pixel font ---------------------------------------------------------------------------------------------
  var FONT = {
    A: "###|#.#|###|#.#|#.#", B: "##.|#.#|##.|#.#|##.", C: "###|#..|#..|#..|###", D: "##.|#.#|#.#|#.#|##.",
    E: "###|#..|##.|#..|###", F: "###|#..|##.|#..|#..", G: "###|#..|#.#|#.#|###", H: "#.#|#.#|###|#.#|#.#",
    I: "###|.#.|.#.|.#.|###", J: "..#|..#|..#|#.#|###", K: "#.#|#.#|##.|#.#|#.#", L: "#..|#..|#..|#..|###",
    M: "#.#|###|###|#.#|#.#", N: "##.|#.#|#.#|#.#|#.#", O: "###|#.#|#.#|#.#|###", P: "###|#.#|###|#..|#..",
    Q: "###|#.#|#.#|###|..#", R: "###|#.#|##.|#.#|#.#", S: "###|#..|###|..#|###", T: "###|.#.|.#.|.#.|.#.",
    U: "#.#|#.#|#.#|#.#|###", V: "#.#|#.#|#.#|#.#|.#.", W: "#.#|#.#|###|###|#.#", X: "#.#|#.#|.#.|#.#|#.#",
    Y: "#.#|#.#|.#.|.#.|.#.", Z: "###|..#|.#.|#..|###",
    "0": "###|#.#|#.#|#.#|###", "1": ".#.|##.|.#.|.#.|###", "2": "###|..#|###|#..|###", "3": "###|..#|###|..#|###",
    "4": "#.#|#.#|###|..#|..#", "5": "###|#..|###|..#|###", "6": "###|#..|###|#.#|###", "7": "###|..#|..#|..#|..#",
    "8": "###|#.#|###|#.#|###", "9": "###|#.#|###|..#|###",
    " ": "...|...|...|...|...", ".": "...|...|...|...|.#.", ":": "...|.#.|...|.#.|...", "-": "...|...|###|...|...",
    "+": "...|.#.|###|.#.|...", "/": "..#|..#|.#.|#..|#..", "#": "#.#|###|#.#|###|#.#", "?": "###|..#|.##|...|.#.",
    "!": ".#.|.#.|.#.|...|.#.", "'": ".#.|.#.|...|...|...", "(": ".#.|#..|#..|#..|.#.", ")": ".#.|..#|..#|..#|.#.", "_": "...|...|...|...|###"
  };
  function normalize(text) {
    return String(text || "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split("").map(function (ch) { return FONT[ch] ? ch : (ch === "·" ? "." : " "); }).join("");
  }
  function textWidth(text) { return normalize(text).length * 4 - 1; }
  function drawText(ctx, text, x, y, color, maxWidth) {
    var t = normalize(text);
    if (maxWidth) while (t.length && t.length * 4 - 1 > maxWidth) t = t.slice(0, -1);
    ctx.fillStyle = color;
    for (var i = 0; i < t.length; i++) {
      var rows = FONT[t[i]].split("|");
      for (var r = 0; r < 5; r++) for (var c = 0; c < 3; c++) if (rows[r][c] === "#") ctx.fillRect(x + i * 4 + c, y + r, 1, 1);
    }
  }
  function plate(ctx, text, x, y, fg, bg, maxWidth) {
    var t = normalize(text); if (maxWidth) while (t.length && t.length * 4 - 1 > maxWidth) t = t.slice(0, -1);
    var w = t.length * 4 - 1; ctx.fillStyle = bg; ctx.fillRect(x - 2, y - 2, w + 4, 9); drawText(ctx, t, x, y, fg); return w;
  }
  function drawSprite(ctx, rows, x, y, map) {
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      for (var c = 0; c < row.length; c++) { var col = map[row[c]]; if (row[c] === "." || !col) continue; ctx.fillStyle = col; ctx.fillRect(x + c, y + r, 1, 1); }
    }
  }
  var BUBBLE = ["..kkkkkkkkkk..", ".kwwwwwwwwwwk.", "kwwwwwwwwwwwwk", "kwwwwwwwwwwwwk", "kwwwwwwwwwwwwk", "kwwwwwwwwwwwwk", "kwwwwwwwwwwwwk", "kwwwwwwwwwwwwk", ".kwwwwwwwwwwk.", "..kkkkkkkkkk..", "....kk........", "....k........."];
  var ICONS = {
    success: ["......", ".....g", "....gg", "g..gg.", "gggg..", ".gg..."],
    warning: ["..aa..", "..aa..", "..aa..", "..aa..", "......", "..aa.."],
    error: ["r....r", ".r..r.", "..rr..", "..rr..", ".r..r.", "r....r"],
    question: ["#####.", "....#.", "..###.", "..#...", "......", "..#..."],
    zz: ["###.", "..#.", ".#..", "###."]
  };

  // ---- what each action looks like -----------------------------------------------------------------------------------
  var KIND_STATION = { "mail.read": "outlook", "mail.reply": "outlook", "web.browse": "selms", "propose": "docusign", "send": "docusign", "archive": "shared", "wait": "coffee" };
  var KIND_POSE = { "mail.read": "type", "mail.reply": "type", "doc.read": "read", "doc.fill": "type", "web.browse": "type", "verify": "read", "propose": "wait", "send": "type", "archive": "type", "wait": "coffee" };
  var FRONT_POSES = { read: true, coffee: true, wait: true };   // poses where the robot turns towards the viewer

  // ---- facing: "u" "d" "l" "r" or the diagonals "ul" "ur" "dl" "dr" ----------------------------------------------------
  function facing(dx, dy, previous) {
    var ax = Math.abs(dx), ay = Math.abs(dy);
    if (ax < 0.01 && ay < 0.01) return previous;
    if (ay < ax * 0.3) return dx < 0 ? "l" : "r";               // nearly horizontal: profile
    if (ax < ay * 0.3) return dy < 0 ? "u" : "d";               // nearly vertical: straight front or back
    return (dy < 0 ? "u" : "d") + (dx < 0 ? "l" : "r");          // the isometric diagonals: 3/4 views
  }
  function vertical(face) { return face[0] === "u" ? "u" : (face[0] === "d" ? "d" : ""); }
  function horizontal(face) { var c = face[face.length - 1]; return c === "l" || c === "r" ? c : "r"; }

  // ---- scene ---------------------------------------------------------------------------------------------------------
  function Scene(opts) {
    this.canvas = opts.canvas;
    this.ctx = this.canvas.getContext("2d");
    this.poll = opts.poll;
    this.interval = opts.interval || 2000;
    this.teamEl = opts.team;
    this.queueEl = opts.queue;
    this.config = opts.config || {};
    this.rooms = { light: null, dark: null };   // loaded rooms: {img, scene, pieces:[{img,x,y,w,h,line}], anchors, nodes, edges}
    this.sheets = [];                            // [{img, h, frames: {front, front34, profile, back34, back, seated: {x, w, h}}}]
    this.theme = detectTheme();
    this.room = null;
    this.frame = 0; this.lastTick = 0;
    this.robots = []; this.queued = []; this.events = []; this.particles = [];
    this.toasts = []; this.seenEvents = null;   // quest-style notices for finished runs, keyed on the run ids already shown
    this.clock = ""; this.demo = false; this.error = null;
    this.H = Math.round(W * 896 / 1200);
    var self = this;
    ["light", "dark"].forEach(function (t) { var cfg = self.config[t]; if (cfg && cfg.background && cfg.scene) self.loadRoom(t, cfg); });
    (this.config.characters || []).forEach(function (ch, i) {
      if (!ch || !ch.sheet) return;
      var img = new Image(); img.onload = function () { self.sheets[i] = { img: img, h: ch.h, frames: ch.frames || {} }; }; img.src = ch.sheet;
    });
    this.canvas.width = W * SCALE; this.canvas.height = this.H * SCALE;
    this.canvas.style.maxWidth = (W * SCALE) + "px";
    watchTheme(function () { self.theme = detectTheme(); self.applyTheme(); });
    this.applyTheme();
  }

  Scene.prototype.loadRoom = function (theme, cfg) {
    var self = this, sc = cfg.scene, k = W / (sc.image && sc.image.w || 1200);
    var room = { img: null, scene: sc, k: k, bg: sc.bg || null, anchors: {}, nodes: [], edges: sc.edges || [], pieces: [], pending: 1 };
    Object.keys(sc.anchors || {}).forEach(function (id) {
      var a = sc.anchors[id];
      room.anchors[id] = { x: a.x * k, y: a.y * k, face: a.face || "dr", label: a.label || "", lx: a.lx != null ? a.lx * k : null, ly: a.ly != null ? a.ly * k : null, pose: a.pose || "" };
    });
    room.nodes = (sc.nodes || []).map(function (p) { return { x: p[0] * k, y: p[1] * k }; });
    (sc.occluders || []).forEach(function (o) {
      if (!o.image) return;
      var piece = { img: null, x: o.x * k, y: o.y * k, w: o.w * k, h: o.h * k, line: (o.depth || [[o.x, o.y + o.h], [o.x + o.w, o.y + o.h]]).map(function (p) { return { x: p[0] * k, y: p[1] * k }; }) };
      room.pieces.push(piece); room.pending++;
      var img = new Image(); img.onload = function () { piece.img = img; room.pending--; self.applyTheme(); }; img.src = o.image;
    });
    var bg = new Image(); bg.onload = function () { room.img = bg; room.pending--; self.rooms[theme] = room; self.applyTheme(); }; bg.src = cfg.background;
  };

  function detectTheme() {
    var forced = document.documentElement.getAttribute("data-theme");
    if (forced === "dark" || forced === "light") return forced;
    return (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
  }
  function watchTheme(cb) {
    if (window.matchMedia) { var mq = window.matchMedia("(prefers-color-scheme: dark)"); if (mq.addEventListener) mq.addEventListener("change", cb); else if (mq.addListener) mq.addListener(cb); }
    if (window.MutationObserver) new MutationObserver(cb).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }

  Scene.prototype.applyTheme = function () {
    var room = this.rooms[this.theme] || this.rooms[this.theme === "dark" ? "light" : "dark"] || null, self = this;
    var changed = room !== this.room;
    this.room = room;
    var wrap = this.canvas.parentElement;
    if (wrap) wrap.style.background = room && room.bg ? room.bg : "#0B1418";
    var H = room && room.img ? Math.round(W * room.img.height / room.img.width) : this.H;
    if (H !== this.H) { this.H = H; this.canvas.height = H * SCALE; }
    if (changed) this.robots.forEach(function (r) { self.place(r, r.station); });
  };

  // ---- stations and paths -----------------------------------------------------------------------------------------------
  Scene.prototype.anchor = function (id, robot) {
    if (!this.room) return { x: W / 2, y: this.H * 0.7, face: "dr", label: "", pose: "" };
    var a = this.room.anchors[id];
    if (!a && id.indexOf("desk") === 0) a = this.room.anchors["desk" + (robot.index % 3)];
    return a || this.room.anchors.desk0 || { x: W / 2, y: this.H * 0.7, face: "dr", label: "", pose: "" };
  };
  Scene.prototype.stationFor = function (robot) {
    if (!robot.busy) return "desk" + robot.index;
    var kind = robot.step && robot.step.kind;
    return (kind && KIND_STATION[kind]) || ("desk" + robot.index);
  };
  Scene.prototype.place = function (r, station) {   // teleport (first appearance, theme change)
    var a = this.anchor(station, r);
    r.x = a.x; r.y = a.y; r.face = a.face; r.path = []; r.station = station; r.moving = false; r.target = a; r.seated = a.pose === "desk";
  };
  Scene.prototype.nearestNode = function (x, y) {
    var nodes = this.room.nodes, best = -1, bd = Infinity;
    for (var i = 0; i < nodes.length; i++) { var d = (nodes[i].x - x) * (nodes[i].x - x) + (nodes[i].y - y) * (nodes[i].y - y); if (d < bd) { bd = d; best = i; } }
    return best;
  };
  Scene.prototype.route = function (from, to) {   // Dijkstra over the walk graph
    var nodes = this.room.nodes, edges = this.room.edges, n = nodes.length;
    if (!n) return [];
    var a = this.nearestNode(from.x, from.y), b = this.nearestNode(to.x, to.y);
    var dist = [], prev = [], done = [];
    for (var i = 0; i < n; i++) { dist[i] = Infinity; prev[i] = -1; done[i] = false; }
    dist[a] = 0;
    for (var k = 0; k < n; k++) {
      var u = -1, du = Infinity;
      for (var j = 0; j < n; j++) if (!done[j] && dist[j] < du) { du = dist[j]; u = j; }
      if (u < 0 || u === b) break;
      done[u] = true;
      edges.forEach(function (e) {
        var v = e[0] === u ? e[1] : (e[1] === u ? e[0] : -1); if (v < 0) return;
        var w = Math.hypot(nodes[u].x - nodes[v].x, nodes[u].y - nodes[v].y);
        if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; }
      });
    }
    var path = [];
    for (var c = b; c >= 0; c = prev[c]) { path.unshift(nodes[c]); if (c === a) break; }
    // no need to walk to the first node if we are practically on it
    if (path.length && Math.hypot(path[0].x - from.x, path[0].y - from.y) < 6) path.shift();
    path.push({ x: to.x, y: to.y });
    return path;
  };
  Scene.prototype.send = function (r, station, run) {
    var a = this.anchor(station, r);
    r.station = station; r.target = a; r.running = !!run;
    r.path = this.room ? this.route({ x: r.x, y: r.y }, a) : [{ x: a.x, y: a.y }];
    r.moving = r.path.length > 0;
  };

  // ---- live data ----------------------------------------------------------------------------------------------------------
  Scene.prototype.update = function (data) {
    var now = Date.now(), self = this;
    this.clock = data.clock || ""; this.demo = !!data.demo; this.queued = data.queued || []; this.events = data.events || [];
    var known = this.seenEvents, first = known === null;
    if (first) known = this.seenEvents = {};
    this.events.forEach(function (ev) {
      if (!ev || ev.id == null || known[ev.id]) return;
      known[ev.id] = true;
      if (!first) self.toast(ev);
    });
    var team = data.team || [];
    team.forEach(function (w, idx) {
      var r = self.robots[idx];
      if (!r) {
        r = self.robots[idx] = { index: idx, name: w.name, x: 0, y: 0, face: "dr", path: [], moving: false, running: false, station: "desk" + idx, pose: "idle", busy: false,
                                 freshUntil: 0, fresh: null, runId: null, items: 0, phase: 0, lookUntil: 0, nextLook: now + 6000 + Math.random() * 12000 };
        self.place(r, "desk" + idx);
      }
      r.name = w.name;
      var wasBusy = r.busy, prevRun = r.runId;
      r.busy = !!w.busy; r.scenario = w.scenario_name || null; r.step = w.step || null; r.runId = w.run_id || null;
      if (w.busy && (w.items || 0) > r.items) self.spawnPaper(r);
      r.items = w.busy ? (w.items || 0) : 0;
      if (wasBusy && !r.busy && prevRun) {   // just finished: find the outcome in the events, turn round and show it
        var ev = null; for (var i = 0; i < self.events.length; i++) if (self.events[i].id === prevRun) { ev = self.events[i]; break; }
        r.fresh = ev ? ev.status : "success"; r.freshUntil = now + 6000;
        if (r.fresh === "error") self.spawnSmoke(r, 6);
      }
      var station = self.stationFor(r);
      if (station !== r.station) self.send(r, station, r.busy);
    });
    this.robots.length = Math.min(this.robots.length, team.length);
    this.renderDom();
  };

  var TOAST = {
    success: { title: "QUEST COMPLETE", color: C.green },
    warning: { title: "QUEST COMPLETE", color: C.amber, sub: "WITH WARNINGS" },
    error: { title: "QUEST FAILED", color: C.red }
  };
  Scene.prototype.toast = function (ev) {
    var kind = TOAST[ev.status] ? ev.status : "success", now = Date.now();
    var detail = (ev.worker ? ev.worker + " · " : "") + (ev.items != null ? ev.items + " item(s)" : "");
    if (kind === "error" && ev.message) detail = String(ev.message).slice(0, 34);
    this.toasts.push({ kind: kind, title: TOAST[kind].title + (TOAST[kind].sub ? " · " + TOAST[kind].sub : ""), name: ev.scenario_name || "Scenario", detail: detail, born: now, until: now + 7000 });
    if (this.toasts.length > 3) this.toasts.shift();
  };
  Scene.prototype.drawToasts = function () {
    var ctx = this.ctx, now = Date.now(), self = this;
    this.toasts = this.toasts.filter(function (t) { return t.until > now; });
    var y = this.H - 6;
    this.toasts.slice().reverse().forEach(function (t) {
      var w = Math.max(118, textWidth(t.title) + 22, textWidth(t.name) + 22, textWidth(t.detail) + 22), h = 27;
      var age = now - t.born, left = t.until - now;
      var slide = age < 250 ? Math.round((1 - age / 250) * (w + 8)) : (left < 250 ? Math.round((1 - left / 250) * (w + 8)) : 0);
      var x = W - 4 - w + slide;
      y -= h;
      ctx.fillStyle = "rgba(11,18,32,.94)"; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = TOAST[t.kind].color; ctx.fillRect(x, y, 3, h); ctx.fillRect(x + 3, y, w - 3, 1);
      var icon = ICONS[t.kind]; if (icon) drawSprite(ctx, icon, x + 7, y + 4, { g: C.green, a: C.amber, r: C.red });
      drawText(ctx, t.title, x + 16, y + 4, TOAST[t.kind].color, w - 20);
      drawText(ctx, t.name, x + 6, y + 12, C.w, w - 10);
      drawText(ctx, t.detail, x + 6, y + 19, C.muted, w - 10);
      // a little sparkle for a success, in the first second
      if (t.kind !== "error" && age < 900 && Math.floor(age / 150) % 2 === 0) { ctx.fillStyle = C.w; ctx.fillRect(x + w - 6, y + 3, 1, 1); ctx.fillRect(x + w - 9, y + 7, 1, 1); ctx.fillRect(x + w - 4, y + 9, 1, 1); }
      y -= 3;
    });
  };

  Scene.prototype.spawnPaper = function (r) { this.particles.push({ type: "paper", x: r.x + 3, y: r.y - 22, vx: 1.2 + Math.random() * 0.6, vy: -1.1, life: 14, t: 0 }); };
  Scene.prototype.spawnSmoke = function (r, n) { for (var k = 0; k < (n || 1); k++) this.particles.push({ type: "smoke", x: r.x - 2 + Math.random() * 5, y: r.y - 36, vx: (Math.random() - 0.5) * 0.4, vy: -0.4 - Math.random() * 0.3, life: 20 + Math.random() * 10, t: 0 }); };

  // ---- simulation step -----------------------------------------------------------------------------------------------------
  Scene.prototype.tick = function () {
    this.frame++;
    var self = this, now = Date.now(), f = this.frame;
    this.robots.forEach(function (r) {
      if (r.moving && r.path.length) {
        var speed = r.running ? RUN : WALK, left = speed;
        while (left > 0 && r.path.length) {
          var p = r.path[0], dx = p.x - r.x, dy = p.y - r.y, d = Math.hypot(dx, dy);
          if (d <= left) { r.x = p.x; r.y = p.y; r.path.shift(); left -= d; }
          else { r.x += dx / d * left; r.y += dy / d * left; left = 0; }
          if (d > 0.01) r.face = facing(dx, dy, r.face);
        }
        if (!r.path.length) { r.moving = false; r.face = r.target ? r.target.face : r.face; r.phase = 0; }
        else if (f % (r.running ? 2 : 4) === 0) r.phase = (r.phase + 1) % 4;
        r.pose = r.running ? "run" : "walk"; r.seated = false;
      } else {
        var kind = r.step && r.step.kind;
        r.pose = r.busy ? ((kind && KIND_POSE[kind]) || "type") : "idle";
        var anchorFace = r.target ? r.target.face : r.face;
        r.seated = !!(r.target && r.target.pose === "desk");
        var front = !r.seated && (FRONT_POSES[r.pose] || (r.fresh && r.freshUntil > now) || r.lookUntil > now);
        r.face = front ? "d" + horizontal(anchorFace) : anchorFace;
        if (!r.busy && r.lookUntil <= now && now > r.nextLook) { r.lookUntil = now + 1800 + Math.random() * 1200; r.nextLook = now + 9000 + Math.random() * 16000; }
      }
      if (r.fresh === "error" && r.freshUntil > now && f % 3 === 0) self.spawnSmoke(r, 1);
    });
    this.particles = this.particles.filter(function (p) { p.t++; p.x += p.vx; p.y += p.vy; return p.t < p.life; });
  };

  // ---- rendering -----------------------------------------------------------------------------------------------------------
  Scene.prototype.render = function () {
    var ctx = this.ctx, self = this, room = this.room;
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0); ctx.imageSmoothingEnabled = false;
    if (!room || !room.img) { ctx.fillStyle = "#0B1418"; ctx.fillRect(0, 0, W, this.H); drawText(ctx, "LOADING THE OPEN SPACE", 8, 8, C.muted); return; }
    ctx.drawImage(room.img, 0, 0, W, this.H);
    // painter's order: robots by their feet, furniture pieces by their front edge
    var items = this.robots.map(function (r) { return { kind: "robot", r: r }; });
    room.pieces.forEach(function (p) { if (p.img) items.push({ kind: "piece", p: p }); });
    items.sort(function (a, b) { return self.depth(a) - self.depth(b); });
    items.forEach(function (it) { if (it.kind === "robot") self.drawRobot(it.r); else ctx.drawImage(it.p.img, Math.round(it.p.x), Math.round(it.p.y), Math.round(it.p.w), Math.round(it.p.h)); });
    // particles
    this.particles.forEach(function (p) {
      if (p.type === "paper") { ctx.fillStyle = C.paper; ctx.fillRect(Math.round(p.x), Math.round(p.y), 3, 4); }
      else { ctx.fillStyle = "rgba(200,205,215," + (0.5 * (1 - p.t / p.life)).toFixed(2) + ")"; var rr = 1 + Math.floor(p.t / 7); ctx.fillRect(Math.round(p.x) - rr, Math.round(p.y) - rr, rr * 2, rr * 2); }
    });
    this.robots.forEach(function (r) { self.drawPlates(r); });
    // station labels
    Object.keys(room.anchors).forEach(function (id) {
      var a = room.anchors[id]; if (!a.label) return;
      var x = a.lx != null ? a.lx : a.x, y = a.ly != null ? a.ly - 2 : a.y + 4, w = textWidth(a.label);
      plate(ctx, a.label, Math.round(x - w / 2), Math.round(y), C.w, C.blue);
    });
    // HUD: sign, queue board, clock
    ctx.fillStyle = C.blue; ctx.fillRect(4, 4, 70, 19); drawText(ctx, "SAMSUNG PULSAR", 8, 7, C.w); drawText(ctx, "OPEN SPACE", 8, 14, "#BFD4F5");
    var cw = 34; ctx.fillStyle = C.k; ctx.fillRect(W - cw - 4, 4, cw, 12); ctx.fillStyle = C.screen; ctx.fillRect(W - cw - 3, 5, cw - 2, 10); drawText(ctx, this.clock || "--:--", W - cw, 7, C.neon);
    var busy = this.robots.filter(function (r) { return r.busy; }).length;
    var qtext = "QUEUE " + this.queued.length + "  BUSY " + busy + "  FREE " + (this.robots.length - busy);
    plate(ctx, qtext, W - cw - 10 - textWidth(qtext), 7, C.w, C.plate);
    if (this.demo) drawText(ctx, "DEMO", 8, 26, C.amber);
    if (this.error) drawText(ctx, "OFFLINE", W - 34, 20, C.red);
    this.drawToasts();
  };

  Scene.prototype.depth = function (it) {
    if (it.kind === "robot") return it.r.y;
    var l = it.p.line, x0 = Math.min(l[0].x, l[1].x), x1 = Math.max(l[0].x, l[1].x);
    // a piece is compared through its front edge: at the x of each robot it would be closest to; use the mid-point,
    // then nudge so that a robot exactly on the edge line counts as in front
    var self = this, y = (l[0].y + l[1].y) / 2;
    this.robots.forEach(function (r) { if (r.x >= x0 - 8 && r.x <= x1 + 8) { var t = x1 === x0 ? 0 : (r.x - l[0].x) / (l[1].x - l[0].x); var ly = l[0].y + (l[1].y - l[0].y) * Math.max(0, Math.min(1, t)); if (Math.abs(r.y - ly) < Math.abs(r.y - y)) y = ly; } });
    return y - 0.5;
  };

  function poseFor(r) {
    if (r.seated) return { name: vertical(r.face) === "d" ? "seated_front" : "seated_back", flip: horizontal(r.face) === "r" };
    var v = vertical(r.face), h = horizontal(r.face), diagonal = r.face.length === 2;
    if (!v) return { name: "profile", flip: h === "r" };
    if (diagonal) return { name: v === "u" ? "back34" : "front34", flip: h === "r" };
    return { name: v === "u" ? "back" : "front", flip: false };
  }
  Scene.prototype.drawRobot = function (r) {
    var ctx = this.ctx, f = this.frame, sheet = this.sheets[r.index % Math.max(1, this.sheets.length)];
    var x = Math.round(r.x), y = Math.round(r.y);
    ctx.fillStyle = "rgba(0,0,0,.32)"; ctx.fillRect(x - 5, y - 1, 10, 2);
    var pose = poseFor(r), fr = sheet && sheet.frames[pose.name];
    if (!fr) { ctx.fillStyle = C.blue; ctx.fillRect(x - 4, y - 20, 8, 20); return; }
    var w = fr.w, h = fr.h, sx = fr.x, sy = sheet.h - h, left = x - Math.floor(w / 2), top = y - h;
    var moving = r.pose === "walk" || r.pose === "run", stride = r.pose === "run" ? 2 : 1;
    var bob = moving ? ((r.phase === 1 || r.phase === 3) ? -stride : 0) : (r.pose === "type" ? (f % 10 < 2 ? 1 : 0) : 0);
    ctx.save();
    if (pose.flip) { ctx.translate(x * 2, 0); ctx.scale(-1, 1); }
    if (moving) {
      // head and torso, then each leg (a lifted leg is drawn one or two rows shorter: the foot leaves the ground)
      var legs = Math.round(h * 0.72), mid = Math.ceil(w / 2), lean = r.pose === "run" ? 1 : 0;
      var liftL = r.phase === 0 ? stride : 0, liftR = r.phase === 2 ? stride : 0;
      ctx.drawImage(sheet.img, sx, sy, w, legs, left + lean, top + bob, w, legs);
      ctx.drawImage(sheet.img, sx, sy + legs + liftL, mid, h - legs - liftL, left, top + bob + legs, mid, h - legs - liftL);
      ctx.drawImage(sheet.img, sx + mid, sy + legs + liftR, w - mid, h - legs - liftR, left + mid, top + bob + legs, w - mid, h - legs - liftR);
    } else {
      ctx.drawImage(sheet.img, sx, sy, w, h, left, top + bob, w, h);
    }
    ctx.restore();
    // what the robot holds
    var hy = top + Math.round(h * 0.42), back = vertical(r.face) === "u";
    if (r.pose === "read" && !r.seated) { var py = hy + (f % 8 < 4 ? 0 : 1); ctx.fillStyle = C.paper; ctx.fillRect(x - 4, py, 8, 9); ctx.fillStyle = C.ink; ctx.fillRect(x - 2, py + 2, 4, 1); ctx.fillRect(x - 2, py + 4, 4, 1); ctx.fillRect(x - 2, py + 6, 3, 1); }
    else if (r.pose === "coffee") { var cx = x + (horizontal(r.face) === "l" ? -6 : 3), cy = hy - (f % 16 < 4 ? 2 : 0); ctx.fillStyle = C.cup; ctx.fillRect(cx, cy, 4, 4); ctx.fillStyle = C.k; ctx.fillRect(cx + (horizontal(r.face) === "l" ? -1 : 4), cy + 1, 1, 2); if (f % 10 < 5) { ctx.fillStyle = "rgba(255,255,255,.5)"; ctx.fillRect(cx + 1, cy - 3, 1, 2); } }
    else if ((r.pose === "type" || (r.seated && r.busy)) && back && f % 4 < 2) { ctx.fillStyle = C.neon; ctx.fillRect(x - 3 + (f % 3), top + Math.round(h * 0.7), 1, 1); }
    else if (r.pose === "wait" && f % 14 < 8) drawSprite(ctx, ICONS.question, x + 12, top - 6, { "#": C.amber });
    if (r.pose === "idle" && !r.busy && r.lookUntil <= Date.now() && back && f % 60 < 8) drawSprite(ctx, ICONS.zz, x + 12, top - 4, { "#": C.muted });
  };

  Scene.prototype.drawPlates = function (r) {
    // like a game: the name floats over the head, the current action above it
    var ctx = this.ctx, x = Math.round(r.x), y = Math.round(r.y), sheet = this.sheets[r.index % Math.max(1, this.sheets.length)];
    var fr = sheet && sheet.frames[poseFor(r).name], top = y - (fr ? fr.h : 38);
    var name = r.name || ("ROBOT " + (r.index + 1)), nw = textWidth(name);
    plate(ctx, name, Math.max(2, Math.min(W - nw - 4, x - nw / 2)), top - 10, C.w, r.busy ? C.blue : C.plate);
    var text = r.busy ? ((r.step && r.step.kind) ? r.step.kind : "WORKING") : (r.moving ? "" : "AVAILABLE");
    if (r.busy && r.items) text += " " + r.items;
    if (text) { var w = textWidth(text); plate(ctx, text, Math.max(2, Math.min(W - w - 4, x - w / 2)), top - 19, r.busy ? C.neon : C.muted, "rgba(11,18,32,.92)"); }
    if (r.fresh && r.freshUntil > Date.now() && ICONS[r.fresh]) { drawSprite(ctx, BUBBLE, x + 8, top - 33, { k: C.k, w: C.w }); drawSprite(ctx, ICONS[r.fresh], x + 12, top - 31, { g: C.green, a: C.amber, r: C.red }); }
  };

  Scene.prototype.renderDom = function () {
    var self = this;
    if (this.teamEl) {
      this.teamEl.innerHTML = this.robots.map(function (r, i) {
        var s = r.busy ? esc(r.scenario || "") + (r.step ? " · " + esc(r.step.kind) + (r.step.label ? " · " + esc(r.step.label) : "") : "") + " · " + r.items + " item(s)" + (r.runId ? ' · <a href="/runs/' + r.runId + '">run #' + r.runId + "</a>" : "") : "available";
        var portrait = (self.config.avatars || [])[i % 3];
        var avatar = portrait ? '<img src="' + esc(portrait) + '" alt="">' : "<i></i>";
        return '<div class="member ' + (r.busy ? "busy" : "free") + '"><div class="avatar" style="--tie:' + TIES[i % TIES.length] + '">' + avatar + '</div><div><b>' + esc(r.name) + "</b><div class=\"muted\">" + s + "</div></div></div>";
      }).join("");
    }
    if (this.queueEl) {
      this.queueEl.innerHTML = this.queued.length ? '<span class="pill queued"><i class="dot"></i>' + this.queued.length + " queued: " + this.queued.map(function (q) { return esc(q.scenario_name); }).join(", ") + "</span>" : "";
    }
  };

  Scene.prototype.refresh = function () {
    var self = this;
    return Promise.resolve(this.poll()).then(function (data) { self.error = null; self.update(data); }).catch(function (err) { self.error = err; });
  };

  Scene.prototype.start = function () {
    var self = this;
    this.refresh();
    setInterval(function () { if (!document.hidden) self.refresh(); }, this.interval);
    function loop(ts) { if (ts - self.lastTick >= TICK) { self.lastTick = ts; self.tick(); self.render(); } requestAnimationFrame(loop); }
    requestAnimationFrame(loop);
    return this;
  };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  return { start: function (opts) { return new Scene(opts).start(); }, Scene: Scene, KIND_STATION: KIND_STATION };
})();

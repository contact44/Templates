/* Astrée · open space — pixel-art live view of the scenarios and the team. No dependencies, no assets: every sprite is drawn from strings. */
window.Atelier = (function () {
  "use strict";

  // ---- palette -------------------------------------------------------------------------------------------------
  var C = {
    k: "#0B1220", w: "#FFFFFF", y: "#F2C94C", r: "#C62828", g: "#1E8E5A", a: "#B8730F", c: "#1428A0", eye: "#6FD8EA", s: "#7D8797",
    t: "#1428A0", n: "#A37C55", m: "#7A5A3C", p: "#FFFFFF", ink: "#0B1220", q: "#1428A0", f1: "#E4EAF2", f2: "#DCE3ED", wall: "#F4F7FB",
    wall2: "#E6ECF5", board: "#1428A0", tray: "#5C6675", screen: "#0B1220"
  };
  var BODIES = [["#3aa6a0", "#237a75"], ["#e08a3c", "#a6612a"], ["#8b6fd6", "#5f47a3"], ["#4a86d8", "#2f5f9e"],
    ["#d86aa0", "#a34a76"], ["#8ab83c", "#5f822a"], ["#d6b34a", "#9c7f2c"], ["#5fb9d6", "#3a7f95"]];
  var OFF_BODY = ["#6f7774", "#4f5654"];
  var STATUS_COLOR = { success: C.g, warning: C.a, error: C.r, running: C.t, off: C.s, idle: C.eye };

  // ---- sprites (one char per pixel, "." = transparent) ---------------------------------------------------------
  var ROBOT = [
    "....ky....",
    "....kd....",
    ".kkkkkkkk.",
    "kbbbbbbbbk",
    "kbEEbbEEbk",
    "kbEEbbEEbk",
    "kbbbbbbbbk",
    "kbbddddbbk",
    ".kkkkkkkk.",
    ".kbbbbbbk.",
    "kbbbssbbbk",
    "kbbbbbbbbk",
    "kdbbbbbbdk",
    ".kkk..kkk."
  ];
  var ARM = ["kb", "kb", "kb", "kk"];
  var HAND_PEN = ["y", "k"];
  var DESK = [
    "nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn",
    "pppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppp",
    "mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm",
    "mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm",
    "mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm",
    "mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm",
    "mm......................................................................mm..",
    "mm......................................................................mm.."
  ];
  var MONITOR = [
    "kkkkkkkkkkkk",
    "kSSSSSSSSSSk",
    "kSSSSSSSSSSk",
    "kSSSSSSSSSSk",
    "kSSSSSSSSSSk",
    "kSSSSSSSSSSk",
    "kkkkkkkkkkkk",
    ".....kk.....",
    "...kkkkkk..."
  ];
  var TRAY = ["ttttttttt", "t.......t", "t.......t", "ttttttttt"];
  var PAPER = ["www", "www", "www", "www"];
  var BUBBLE = [
    "..kkkkkkkkkk..",
    ".kwwwwwwwwwwk.",
    "kwwwwwwwwwwwwk",
    "kwwwwwwwwwwwwk",
    "kwwwwwwwwwwwwk",
    "kwwwwwwwwwwwwk",
    "kwwwwwwwwwwwwk",
    "kwwwwwwwwwwwwk",
    ".kwwwwwwwwwwk.",
    "..kkkkkkkkkk..",
    "....kk........",
    "....k........."
  ];
  var ICONS = {
    success: ["......", ".....g", "....gg", "g..gg.", "gggg..", ".gg..."],
    warning: ["..aa..", "..aa..", "..aa..", "..aa..", "......", "..aa.."],
    error: ["r....r", ".r..r.", "..rr..", "..rr..", ".r..r.", "r....r"]
  };
  var PLUG = ["kkk", "k.k", "kkk", ".k.", ".k."];

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
    ".": "...|...|...|...|.#.", ":": "...|.#.|...|.#.|...", "-": "...|...|###|...|...", "/": "..#|..#|.#.|#..|#..",
    "%": "#.#|..#|.#.|#..|#.#", "!": ".#.|.#.|.#.|...|.#.", "#": ".#.|###|.#.|###|.#.", " ": "...|...|...|...|..."
  };
  var ACCENTS = { "É": "E", "È": "E", "Ê": "E", "Ë": "E", "À": "A", "Â": "A", "Ä": "A", "Ç": "C", "Ô": "O", "Ö": "O",
    "Û": "U", "Ù": "U", "Ü": "U", "Î": "I", "Ï": "I", "·": ".", "'": " ", "’": " ", "(": " ", ")": " ", ",": "." };

  function normalize(text) {
    return String(text || "").toUpperCase().split("").map(function (ch) { return ACCENTS[ch] || ch; })
      .filter(function (ch) { return FONT[ch]; }).join("");
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
  function drawSprite(ctx, rows, x, y, map) {
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      for (var c = 0; c < row.length; c++) {
        var ch = row[c];
        if (ch === ".") continue;
        var col = (map && map[ch]) || C[ch];
        if (!col) continue;
        ctx.fillStyle = col;
        ctx.fillRect(x + c, y + r, 1, 1);
      }
    }
  }

  // ---- scene ----------------------------------------------------------------------------------------------------------
  var STATION_W = 104, STATION_H = 100, WALL_H = 36, PAD = 12, SCALE = 3;
  var BUBBLE_MS = 8000;

  function layout(n) {
    var cols = n <= 0 ? 1 : n <= 2 ? n : n <= 4 ? 2 : 3;
    if (n > 9) cols = 4;
    var rows = Math.max(1, Math.ceil(n / cols));
    return { cols: cols, rows: rows, w: PAD * 2 + cols * STATION_W, h: WALL_H + rows * STATION_H + PAD };
  }

  function Scene(opts) {
    this.canvas = opts.canvas;
    this.ctx = this.canvas.getContext("2d");
    this.feed = opts.feed;
    this.status = opts.status;
    this.onRun = opts.onRun;
    this.poll = opts.poll;
    this.interval = opts.interval || 2000;
    this.robots = [];
    this.events = [];
    this.clock = "";
    this.demo = false;
    this.frame = 0;
    this.particles = [];
    this.seen = {};      // key -> { items, running, lastId, freshUntil, freshStatus }
    this.rects = [];     // hit-test rectangles for clicks
    this.lastTick = 0;
    this.error = null;
    var self = this;
    this.canvas.addEventListener("click", function (e) { self.click(e); });
  }

  Scene.prototype.resize = function () {
    var l = layout(this.robots.length);
    if (this.canvas.width !== l.w * SCALE || this.canvas.height !== l.h * SCALE) {
      this.canvas.width = l.w * SCALE;
      this.canvas.height = l.h * SCALE;
      this.canvas.style.maxWidth = (l.w * SCALE) + "px";
    }
    this.layout = l;
  };

  Scene.prototype.update = function (data) {
    var now = Date.now();
    this.clock = data.clock || "";
    this.demo = !!data.demo;
    this.events = data.events || [];
    var self = this;
    (data.scenarios || []).forEach(function (r, i) {
      var s = self.seen[r.key] || (self.seen[r.key] = { items: 0, running: false, lastId: r.last ? r.last.id : null, freshUntil: 0, freshStatus: null, first: true });
      var running = r.state === "running";
      if (running && r.items > s.items) {
        for (var k = 0; k < Math.min(4, r.items - s.items); k++) self.spawnPaper(i);
      }
      if (running && r.errors > (s.errors || 0)) self.spawnSpark(i);
      var queued = r.state === "queued";
      var finished = (!running && !queued && s.running) || (r.last && s.lastId !== r.last.id && !running && !queued);
      if (finished && r.last) {
        s.freshUntil = now + BUBBLE_MS;
        s.freshStatus = r.last.status;
        if (r.last.status === "error") self.spawnSmoke(i, 6);
      } else if (s.first && r.last && r.last.finished_at) {
        var age = Date.parse(data.now) - Date.parse(r.last.finished_at + "Z");
        if (age >= 0 && age < BUBBLE_MS) { s.freshUntil = now + (BUBBLE_MS - age); s.freshStatus = r.last.status; }
      }
      s.items = running ? r.items : 0;
      s.errors = running ? r.errors : 0;
      s.running = running;
      s.lastId = r.last ? r.last.id : null;
      s.first = false;
    });
    this.robots = data.scenarios || [];
    this.resize();
    this.renderDom();
  };

  Scene.prototype.stationAt = function (i) {
    var l = this.layout || layout(this.robots.length);
    return { x: PAD + (i % l.cols) * STATION_W, y: WALL_H + Math.floor(i / l.cols) * STATION_H };
  };

  Scene.prototype.spawnPaper = function (i) {
    var p = this.stationAt(i);
    this.particles.push({ type: "paper", x: p.x + 40 + Math.random() * 6, y: p.y + 48, vx: 1.8 + Math.random() * 0.6, vy: -1.6, life: 14, t: 0 });
  };
  Scene.prototype.spawnSmoke = function (i, n) {
    var p = this.stationAt(i);
    for (var k = 0; k < (n || 1); k++) this.particles.push({ type: "smoke", x: p.x + 26 + Math.random() * 8, y: p.y + 26, vx: (Math.random() - 0.5) * 0.4, vy: -0.6 - Math.random() * 0.4, life: 18 + Math.random() * 10, t: 0 });
  };
  Scene.prototype.spawnSpark = function (i) {
    var p = this.stationAt(i);
    for (var k = 0; k < 3; k++) this.particles.push({ type: "spark", x: p.x + 46 + Math.random() * 10, y: p.y + 44, vx: (Math.random() - 0.5) * 1.5, vy: -1 - Math.random(), life: 8, t: 0 });
  };

  Scene.prototype.tick = function () {
    this.frame++;
    var self = this;
    this.particles = this.particles.filter(function (p) { p.t++; p.x += p.vx; p.y += p.vy; if (p.type === "spark") p.vy += 0.25; return p.t < p.life; });
    this.robots.forEach(function (r, i) {
      var s = self.seen[r.key];
      if (s && s.freshStatus === "error" && s.freshUntil > Date.now() && self.frame % 3 === 0) self.spawnSmoke(i, 1);
    });
  };

  Scene.prototype.render = function () {
    var ctx = this.ctx, l = this.layout || layout(this.robots.length);
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.imageSmoothingEnabled = false;
    // floor
    for (var y = WALL_H; y < l.h; y += 8) for (var x = 0; x < l.w; x += 8) {
      ctx.fillStyle = ((x / 8 + y / 8) % 2 === 0) ? C.f1 : C.f2; ctx.fillRect(x, y, 8, 8);
    }
    // wall, skirting, sign, clock
    ctx.fillStyle = C.wall; ctx.fillRect(0, 0, l.w, WALL_H);
    ctx.fillStyle = C.wall2; for (var wx = 0; wx < l.w; wx += 16) ctx.fillRect(wx + ((Math.floor(wx / 16) % 2) * 8), 8, 8, 4);
    ctx.fillStyle = "#BFD4F5"; ctx.fillRect(Math.round(l.w / 2) - 30, 5, 60, 18); ctx.fillStyle = C.w; ctx.fillRect(Math.round(l.w / 2) - 1, 5, 2, 18); ctx.fillRect(Math.round(l.w / 2) - 30, 13, 60, 2);
    ctx.fillStyle = C.q; ctx.fillRect(0, WALL_H - 3, l.w, 3);
    ctx.fillStyle = C.board; ctx.fillRect(8, 6, 74, 18);
    drawText(ctx, "ASTREE", 13, 10, C.w);
    drawText(ctx, "OPEN SPACE", 13, 16, "#BFD4F5");
    var cw = 34, cx = l.w - cw - 8;
    ctx.fillStyle = C.k; ctx.fillRect(cx, 8, cw, 12);
    ctx.fillStyle = C.screen; ctx.fillRect(cx + 1, 9, cw - 2, 10);
    drawText(ctx, this.clock || "--:--", cx + 4, 11, C.c);
    if (this.demo) drawText(ctx, "DEMO", cx - 22, 11, C.ink);
    if (this.error) drawText(ctx, "HORS LIGNE", cx - 50, 11, C.r);
    // stations
    this.rects = [];
    for (var i = 0; i < this.robots.length; i++) this.renderStation(i);
    // particles
    var self = this;
    this.particles.forEach(function (p) {
      if (p.type === "paper") { drawSprite(ctx, PAPER, Math.round(p.x), Math.round(p.y)); }
      else if (p.type === "smoke") { ctx.fillStyle = "rgba(90,100,112," + (0.6 * (1 - p.t / p.life)).toFixed(2) + ")"; var r = 2 + Math.floor(p.t / 6); ctx.fillRect(Math.round(p.x) - r, Math.round(p.y) - r, r * 2, r * 2); }
      else { ctx.fillStyle = C.y; ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1); }
    });
  };

  Scene.prototype.renderStation = function (i) {
    var ctx = this.ctx, r = this.robots[i], s = this.seen[r.key] || {}, p = this.stationAt(i), f = this.frame;
    var running = r.state === "running", off = r.state === "off";
    var body = off ? OFF_BODY : BODIES[i % BODIES.length];
    var fresh = s.freshUntil > Date.now() ? s.freshStatus : null;
    var lastStatus = r.last ? r.last.status : null;
    var eye = off ? C.k : running ? C.eye : fresh === "error" ? C.r : fresh === "warning" ? C.a : (f % 28 === 0 ? body[1] : C.eye);
    var map = { b: body[0], d: body[1], E: eye, s: running ? (f % 2 ? C.y : C.g) : off ? C.k : C.g };
    this.rects.push({ x: p.x, y: p.y, w: STATION_W, h: STATION_H, key: r.key, name: r.name });
    // mat
    ctx.fillStyle = "rgba(11,18,32,.12)"; ctx.fillRect(p.x + 8, p.y + 65, 76, 3);
    // robot behind the desk
    var rx = p.x + 24, ry = p.y + 32 + (running ? (f % 4 < 2 ? 0 : 1) : 0);
    drawSprite(ctx, ROBOT, rx, ry, map);
    drawSprite(ctx, ARM, rx - 2, ry + 9, map);
    var armY = running ? (f % 2 ? ry + 6 : ry + 9) : ry + 9;
    drawSprite(ctx, ARM, rx + 10, armY, map);
    if (running) drawSprite(ctx, HAND_PEN, rx + 12, armY - 2);
    if (off) drawSprite(ctx, PLUG, rx + 14, ry + 16);
    // desk, monitor, papers, tray
    drawSprite(ctx, DESK, p.x + 6, p.y + 50);
    var screen = off ? C.screen : running ? C.t : STATUS_COLOR[lastStatus] || C.screen;
    drawSprite(ctx, MONITOR, p.x + 48, p.y + 41, { S: screen });
    if (running && f % 2) { ctx.fillStyle = C.w; ctx.fillRect(p.x + 50 + (f % 6), p.y + 43 + Math.floor((f / 6) % 3), 2, 1); }
    if (!running && !off && lastStatus === "error" && f % 8 < 4) { ctx.fillStyle = C.w; drawText(ctx, "!", p.x + 53, p.y + 42, C.w); }
    var stack = running ? Math.max(1, 5 - Math.floor((r.items || 0) / 5) % 5) : 3;
    for (var k = 0; k < stack; k++) drawSprite(ctx, PAPER, p.x + 12 + (k % 2), p.y + 48 - k);
    drawSprite(ctx, TRAY, p.x + 68, p.y + 46);
    if (running) drawText(ctx, String(r.items || 0), p.x + 70, p.y + 39, C.w);
    // bubble
    if (fresh && ICONS[fresh]) { drawSprite(ctx, BUBBLE, rx + 8, ry - 14); drawSprite(ctx, ICONS[fresh], rx + 12, ry - 12); }
    // nameplate and status
    ctx.fillStyle = C.board; ctx.fillRect(p.x + 4, p.y + 68, 96, 9);
    drawText(ctx, r.name, p.x + 7, p.y + 70, C.w, 90);
    var line, color;
    if (off) { line = "ETEINT"; color = C.s; }
    else if (running) { line = (r.worker ? r.worker.toUpperCase() + " " : "") + (r.step ? r.step.kind.toUpperCase() : "AU TRAVAIL") + " " + (r.items || 0) + (r.errors ? " / " + r.errors + " ECH." : ""); color = C.c; }
    else if (r.state === "queued") { line = "EN FILE"; color = C.ink; }
    else if (!r.last) { line = "JAMAIS LANCE"; color = C.ink; }
    else { line = ({ success: "OK", warning: "RESERVES", error: "ECHEC" }[lastStatus] || lastStatus) + " " + (r.last.items || 0) + " EL."; color = STATUS_COLOR[lastStatus] || C.ink; }
    drawText(ctx, line, p.x + 7, p.y + 80, color, 90);
    if (!off && r.next_run) drawText(ctx, "PROCHAIN " + r.next_run, p.x + 7, p.y + 87, C.s, 90);
    else if (!off) drawText(ctx, "A LA DEMANDE", p.x + 7, p.y + 87, C.s, 90);
  };

  Scene.prototype.click = function (e) {
    if (!this.onRun) return;
    var rect = this.canvas.getBoundingClientRect();
    var x = (e.clientX - rect.left) * (this.canvas.width / rect.width) / SCALE;
    var y = (e.clientY - rect.top) * (this.canvas.height / rect.height) / SCALE;
    for (var i = 0; i < this.rects.length; i++) {
      var r = this.rects[i];
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
        var self = this;
        Promise.resolve(this.onRun(r.key)).then(function () { self.refresh(); }).catch(function () {});
        return;
      }
    }
  };

  Scene.prototype.renderDom = function () {
    if (this.status) {
      var self = this;
      this.status.innerHTML = this.robots.map(function (r) {
        var s = r.state === "running" ? (r.worker ? r.worker + " · " : "") + (r.step ? r.step.kind + (r.step.label ? " · " + r.step.label : "") : "au travail") + " · " + (r.items || 0) + " élément(s)" : r.state === "queued" ? "en file d'attente" : r.state === "off" ? "éteint"
          : r.last ? ({ success: "réussi", warning: "avec réserves", error: "échec" }[r.last.status] || r.last.status) + " · " + (r.last.items || 0) + " élément(s)" : "jamais lancé";
        return "<div><b>" + esc(r.name) + "</b><span>" + esc(s) + "</span></div>";
      }).join("");
    }
    if (this.feed) {
      this.feed.innerHTML = this.events.map(function (e) {
        var label = { success: "Réussi", warning: "Avec réserves", error: "Échec", running: "En cours" }[e.status] || e.status;
        return '<li><a href="/runs/' + e.id + '"><div class="row"><b>' + esc(e.scenario_name) + (e.worker ? ' <span class="muted">· ' + esc(e.worker) + '</span>' : '') + '</b><span class="pill ' + esc(e.status) + '"><i class="dot"></i>' + label + '</span></div><div class="muted">' + esc(e.started) + ' · ' + esc(e.message || "") + '</div></a></li>';
      }).join("") || '<li class="empty">Rien pour le moment.</li>';
    }
  };

  Scene.prototype.refresh = function () {
    var self = this;
    return Promise.resolve(this.poll()).then(function (data) { self.error = null; self.update(data); })
      .catch(function (err) { self.error = err; });
  };

  Scene.prototype.start = function () {
    var self = this;
    this.resize();
    this.refresh();
    setInterval(function () { if (!document.hidden) self.refresh(); }, this.interval);
    function loop(ts) {
      if (ts - self.lastTick >= 125) { self.lastTick = ts; self.tick(); self.render(); }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
    return this;
  };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  return { start: function (opts) { return new Scene(opts).start(); }, Scene: Scene };
})();

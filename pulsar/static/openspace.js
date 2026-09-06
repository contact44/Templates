/* Samsung Pulsar · open space — isometric pixel-art live view of the team.
   No dependencies. Every sprite is drawn from strings. Two modes:
   - procedural: the room is drawn in code (isometric 2:1 tiles, back walls, furniture)
   - image: a generated background image is drawn and anchors come from openspace/anchors.json */
window.Openspace = (function () {
  "use strict";

  // ---- palette (dark charcoal-teal room, cyan strips, orange cables) --------------------------------------------
  var C = {
    k: "#0B1220", w: "#FFFFFF", ink: "#0B1220", muted: "#8A96A8",
    floorA: "#2A3A42", floorB: "#26353C", floorLine: "#1E2B31", wallA: "#1F2E35", wallB: "#182429", seam: "#111B20", trim: "#0E171B",
    neon: "#5EEAF0", neonDim: "#2E8F95", orange: "#D8622B", orangeDim: "#8E3F1B", green: "#4BE38A", red: "#E0503F", amber: "#E5A63C",
    screen: "#0A1518", glass: "#143038", steel: "#7C8B95", steelDim: "#55636C", deskTop: "#2F4048", deskSide: "#223036", deskEdge: "#3B505A",
    blue: "#1428A0", blueSoft: "#3E5BD8", plate: "#0F1E52",
    skin: "#F3D2B4", skinDim: "#D9B394", hair: "#15161C", hairGrey: "#3D4048", beard: "#4B4E58", suit: "#1D2A44", suitDim: "#141E33", shirt: "#F6F7FA",
    shoe: "#0E0F14", lens: "#C9E6F2", paper: "#F2F4F6", tablet: "#22262E", cup: "#E8E2D6"
  };
  var TIES = ["#4CC2FF", "#F0902F", "#3ED28A", "#C77DFF", "#FFD24C", "#FF6F91", "#7CE0FF", "#B7F26B"];
  var STATUS_COLOR = { success: C.green, warning: C.amber, error: C.red };

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
    "+": "...|.#.|###|.#.|...", "%": "#.#|..#|.#.|#..|#.#", "!": ".#.|.#.|.#.|...|.#.", "?": "###|..#|.##|...|.#.", " ": "...|...|...|...|..."
  };
  var ACCENTS = { "É": "E", "È": "E", "Ê": "E", "À": "A", "Â": "A", "Ç": "C", "Ô": "O", "Û": "U", "Î": "I", "·": ".", "'": " ", "’": " ", "(": " ", ")": " ", ",": "." };
  function normalize(text) { return String(text || "").toUpperCase().split("").map(function (ch) { return ACCENTS[ch] || ch; }).filter(function (ch) { return FONT[ch]; }).join(""); }
  function textWidth(text) { var t = normalize(text); return t.length ? t.length * 4 - 1 : 0; }
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
  function drawSprite(ctx, rows, x, y, map, flip) {
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r], n = row.length;
      for (var c = 0; c < n; c++) {
        var ch = row[flip ? n - 1 - c : c];
        if (ch === ".") continue;
        var col = map[ch]; if (!col) continue;
        ctx.fillStyle = col; ctx.fillRect(x + c, y + r, 1, 1);
      }
    }
  }

  // ---- characters: 12 x 19, feet on the last row. Keys: h hair, s skin, E eye, n suit, j shirt, t tie, l legs, d shoes,
  //      g glasses frame, b beard, p ponytail, q badge, m sleeve highlight -----------------------------------------------
  var BASE = [
    "....hhhh....",
    "..hhhhhhhh..",
    ".hhhhhhhhhh.",
    ".hhsssssshh.",
    ".hsEssssEsh.",
    ".hssssssssh.",
    "..ssssssss..",
    "...ssssss...",
    "..njjjjjjn..",
    ".nnnjttjnnn.",
    "nnnnjttjnnnn",
    "nsnnnttnnnsn",
    "nsnnnnnnnnsn",
    ".nnnnnnnnnn.",
    "..nnnnnnnn..",
    "..lll..lll..",
    "..lll..lll..",
    "..lll..lll..",
    "..ddd..ddd.."
  ];
  // per-character overlays (same grid, "." = keep base)
  var OVERLAY = {
    woman: [
      "....hhhh....",
      "..hhhhhhhh..",
      ".hhhhhhhhhhp",
      ".hhsssssshhp",
      ".hsEssssEshp",
      ".hssssssssp.",
      "..ssssssssp.",
      "...ssssss...",
      "..njjjjjjn..",
      ".nnnjqqjnnn.",
      "nnnnjjjjnnnn",
      "nsnnnnnnnnsn",
      "nsnnnnnnnnsn",
      ".nnnnnnnnnn.",
      "..nnnnnnnn..",
      "..nnnnnnnn..",
      "..ss....ss..",
      "..ss....ss..",
      "..dd....dd.."
    ],
    glasses: [
      "............", "............", "............", "............",
      ".hgggggggg h".replace(" ", "."),
      "............", "............", "............", "............", "............", "............", "............", "............", "............", "............", "............", "............", "............", "............"
    ],
    beard: [
      "............", "............", "............", "............", "............",
      ".hbssssssbh.",
      "..bbssssbb..",
      "...bbbbbb...",
      "............", "............", "............", "............", "............", "............", "............", "............", "............", "............", "............"
    ]
  };
  // walk frame: legs apart (row 15-18 replaced)
  var LEGS_WALK = ["..ll....ll..", ".lll....lll.", ".ll......ll.", ".dd......dd."];
  var LEGS_WALK_W = ["..ss....ss..", ".ss......ss.", ".ss......ss.", ".dd......dd."];
  // poses drawn on top: typing hands forward, reading paper, coffee cup, tablet
  var PAPER = ["ww", "ww", "ww"];
  var CUP = ["cc", "cc"];
  var TABLET = ["ppp", "ppp", "ppp", "ppp"];
  var BUBBLE = ["..kkkkkkkkkk..", ".kwwwwwwwwwwk.", "kwwwwwwwwwwwwk", "kwwwwwwwwwwwwk", "kwwwwwwwwwwwwk", "kwwwwwwwwwwwwk", "kwwwwwwwwwwwwk", "kwwwwwwwwwwwwk", ".kwwwwwwwwwwk.", "..kkkkkkkkkk..", "....kk........", "....k........."];
  var ICONS = {
    success: ["......", ".....g", "....gg", "g..gg.", "gggg..", ".gg..."],
    warning: ["..aa..", "..aa..", "..aa..", "..aa..", "......", "..aa.."],
    error: ["r....r", ".r..r.", "..rr..", "..rr..", ".r..r.", "r....r"],
    question: ["#####.", "....#.", "..###.", "..#...", "......", "..#..."]
  };

  function characterMap(index, kind) {
    var tie = TIES[index % TIES.length];
    var grey = kind === "senior";
    return { h: grey ? C.hairGrey : C.hair, s: C.skin, E: C.k, n: C.suit, j: C.shirt, t: tie, l: C.suit, d: C.shoe, g: C.k, b: C.beard, p: C.hair, q: tie, w: C.paper, c: C.cup, k: C.k, m: C.suitDim };
  }
  function drawCharacter(ctx, x, y, robot, pose, frame, flip) {
    // x,y = feet center bottom
    var top = y - 19, left = x - 6;
    var map = characterMap(robot.index, robot.look);
    var rows = BASE.slice();
    if (robot.look === "woman") rows = rows.map(function (r, i) { return mergeRow(r, OVERLAY.woman[i]); });
    if (robot.look === "glasses") rows = rows.map(function (r, i) { return mergeRow(r, OVERLAY.glasses[i]); });
    if (robot.look === "senior") rows = rows.map(function (r, i) { return mergeRow(r, OVERLAY.beard[i]); });
    if (pose === "walk" && frame % 2) {
      var legs = robot.look === "woman" ? LEGS_WALK_W : LEGS_WALK;
      rows = rows.slice(0, 15).concat(legs);
    }
    var bob = (pose === "walk" && frame % 2) ? -1 : 0;
    // shadow
    ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.fillRect(left + 2, y - 1, 8, 2);
    drawSprite(ctx, rows, left, top + bob, map, flip);
    if (pose === "type") { // hands forward on the desk
      ctx.fillStyle = C.skin; ctx.fillRect(left + 3 + (frame % 2), top + 12, 2, 1); ctx.fillRect(left + 7 - (frame % 2), top + 12, 2, 1);
    } else if (pose === "read") {
      drawSprite(ctx, PAPER, left + 4, top + 9 + (frame % 2 ? 0 : 1), map);
    } else if (pose === "coffee") {
      drawSprite(ctx, CUP, left + (flip ? 1 : 9), top + 10 - (frame % 4 === 0 ? 1 : 0), map);
    } else if (pose === "wait") {
      if (frame % 12 < 6) drawSprite(ctx, ICONS.question, left + 12, top - 6, { "#": C.amber });
    }
    if (robot.look === "senior" && pose !== "type") drawSprite(ctx, TABLET, left + (flip ? -1 : 10), top + 10, map);
  }
  function mergeRow(base, over) {
    if (!over) return base;
    var out = "";
    for (var i = 0; i < base.length; i++) out += (over[i] && over[i] !== ".") ? over[i] : base[i];
    return out;
  }

  // ---- isometric room (procedural mode) ---------------------------------------------------------------------------
  var SCALE = 3;
  var ROOM = { cols: 20, rows: 13, ox: 190, oy: 62, wallH: 46, W: 380, H: 216 };
  function iso(i, j) { return { x: ROOM.ox + (i - j) * 8, y: ROOM.oy + (i + j) * 4 }; }
  // stations: iso footprint (i, j, w, d) and where a robot stands to use it, plus the action kinds it serves
  var STATIONS = {
    selms: { i: 2.5, j: -0.6, w: 4, d: 0.6, h: 22, label: "SELMS+", stand: { i: 4.5, j: 1.6, face: 1 }, kind: "screen" },
    board: { i: 8.5, j: -0.6, w: 3, d: 0.6, h: 16, label: "", stand: null, kind: "board" },
    shared: { i: 14, j: 0, w: 3, d: 1.2, h: 26, label: "SHARED", stand: { i: 15.5, j: 2.4, face: 1 }, kind: "rack" },
    outlook: { i: 0, j: 2.2, w: 1.2, d: 2.2, h: 14, label: "OUTLOOK", stand: { i: 2.4, j: 3.2, face: -1 }, kind: "kiosk" },
    docusign: { i: 0, j: 8.5, w: 1.2, d: 2.6, h: 10, label: "DOCUSIGN", stand: { i: 2.4, j: 9.6, face: -1 }, kind: "counter" },
    coffee: { i: 17.8, j: 11, w: 1.4, d: 1.4, h: 16, label: "COFFEE", stand: { i: 16.4, j: 11.6, face: 1 }, kind: "coffee" },
    desk0: { i: 5.5, j: 6.5, w: 2.6, d: 1.2, h: 9, label: "", stand: { i: 6.6, j: 5.9, face: 1 }, kind: "desk" },
    desk1: { i: 9.5, j: 6.5, w: 2.6, d: 1.2, h: 9, label: "", stand: { i: 10.6, j: 5.9, face: 1 }, kind: "desk" },
    desk2: { i: 13.5, j: 6.5, w: 2.6, d: 1.2, h: 9, label: "", stand: { i: 14.6, j: 5.9, face: 1 }, kind: "desk" }
  };
  var KIND_STATION = { "mail.read": "outlook", "mail.reply": "outlook", "web.browse": "selms", "propose": "docusign", "send": "docusign", "archive": "shared", "wait": "coffee" };
  var KIND_POSE = { "mail.read": "read", "mail.reply": "type", "doc.read": "read", "doc.fill": "type", "web.browse": "type", "verify": "read", "propose": "wait", "send": "type", "archive": "type", "wait": "coffee" };

  function poly(ctx, pts, color) { ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); ctx.fill(); }
  function isoBox(ctx, i, j, w, d, h, top, left, right) {
    var a = iso(i, j), b = iso(i + w, j), c = iso(i + w, j + d), e = iso(i, j + d);
    poly(ctx, [[a.x, a.y - h], [b.x, b.y - h], [c.x, c.y - h], [e.x, e.y - h]], top);
    poly(ctx, [[e.x, e.y - h], [c.x, c.y - h], [c.x, c.y], [e.x, e.y]], left);   // front-left face (faces the viewer, lower-left)
    poly(ctx, [[b.x, b.y - h], [c.x, c.y - h], [c.x, c.y], [b.x, b.y]], right);  // front-right face
  }

  function drawRoom(ctx, frame) {
    var cols = ROOM.cols, rows = ROOM.rows;
    ctx.fillStyle = "#0B1418"; ctx.fillRect(0, 0, ROOM.W, ROOM.H);
    // back walls
    var o = iso(0, 0), l = iso(cols, 0), r = iso(0, rows);
    poly(ctx, [[o.x, o.y - ROOM.wallH], [l.x, l.y - ROOM.wallH], [l.x, l.y], [o.x, o.y]], C.wallA);
    poly(ctx, [[o.x, o.y - ROOM.wallH], [r.x, r.y - ROOM.wallH], [r.x, r.y], [o.x, o.y]], C.wallB);
    // panel seams
    ctx.fillStyle = C.seam;
    for (var i = 2; i < cols; i += 3) { var p = iso(i, 0); ctx.fillRect(p.x, p.y - ROOM.wallH + 2, 1, ROOM.wallH - 3); }
    for (var j = 2; j < rows; j += 3) { var q = iso(0, j); ctx.fillRect(q.x, q.y - ROOM.wallH + 2, 1, ROOM.wallH - 3); }
    // neon strips near the top of each wall (drawn as thin isometric lines)
    strip(ctx, 0, 0, cols, 0, ROOM.wallH - 4, frame % 40 < 36 ? C.neon : C.neonDim, 2);
    strip(ctx, 0, 0, 0, rows, ROOM.wallH - 4, frame % 40 < 36 ? C.neon : C.neonDim, 2);
    // orange cable running along the walls at mid height
    strip(ctx, 0, 0, cols, 0, ROOM.wallH - 18, C.orange, 1);
    strip(ctx, 0, 0, 0, rows, ROOM.wallH - 18, C.orange, 1);
    strip(ctx, 0, 0, cols, 0, ROOM.wallH - 20, C.orangeDim, 1);
    // floor tiles
    for (var ii = 0; ii < cols; ii++) for (var jj = 0; jj < rows; jj++) {
      var t = iso(ii, jj), t2 = iso(ii + 1, jj), t3 = iso(ii + 1, jj + 1), t4 = iso(ii, jj + 1);
      poly(ctx, [[t.x, t.y], [t2.x, t2.y], [t3.x, t3.y], [t4.x, t4.y]], ((ii + jj) % 2) ? C.floorA : C.floorB);
    }
    // floor grid lines (subtle)
    ctx.fillStyle = C.floorLine;
    for (var g = 0; g <= cols; g += 4) { var ga = iso(g, 0), gb = iso(g, rows); line(ctx, ga.x, ga.y, gb.x, gb.y, C.floorLine); }
    for (var g2 = 0; g2 <= rows; g2 += 4) { var gc = iso(0, g2), gd = iso(cols, g2); line(ctx, gc.x, gc.y, gd.x, gd.y, C.floorLine); }
    // skirting
    strip(ctx, 0, 0, cols, 0, 0, C.trim, 2); strip(ctx, 0, 0, 0, rows, 0, C.trim, 2);
    // wall-mounted things (flat on the wall)
    wallScreen(ctx, STATIONS.selms, frame);
    wallBoard(ctx, STATIONS.board);
    // a few wall gauges with green readouts on the right wall
    for (var k = 0; k < 3; k++) { var wp = iso(0, 9.5 + k * 1.1); ctx.fillStyle = C.k; ctx.fillRect(wp.x + 2, wp.y - 34, 6, 8); ctx.fillStyle = (frame + k * 5) % 30 < 20 ? C.green : C.red; ctx.fillRect(wp.x + 3, wp.y - 33, 4, 2); }
  }
  function line(ctx, x1, y1, x2, y2, color) { ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x1 + .5, y1 + .5); ctx.lineTo(x2 + .5, y2 + .5); ctx.stroke(); }
  function strip(ctx, i1, j1, i2, j2, h, color, thick) { var a = iso(i1, j1), b = iso(i2, j2); ctx.strokeStyle = color; ctx.lineWidth = thick; ctx.beginPath(); ctx.moveTo(a.x, a.y - h); ctx.lineTo(b.x, b.y - h); ctx.stroke(); }
  function wallScreen(ctx, st, frame) {
    // large screen on the left-back wall: parallelogram following the wall
    var a = iso(st.i, 0), b = iso(st.i + st.w, 0), top = ROOM.wallH - 8, bot = 8;
    poly(ctx, [[a.x, a.y - top], [b.x, b.y - top], [b.x, b.y - bot], [a.x, a.y - bot]], C.k);
    poly(ctx, [[a.x + 1, a.y - top + 1], [b.x - 1, b.y - top + 1], [b.x - 1, b.y - bot - 1], [a.x + 1, a.y - bot - 1]], C.glass);
    ctx.fillStyle = C.blueSoft; poly(ctx, [[a.x + 1, a.y - top + 1], [b.x - 1, b.y - top + 1], [b.x - 1, b.y - top + 4], [a.x + 1, a.y - top + 4]], C.blue);
    for (var r = 0; r < 5; r++) { var y0 = 8 + r * 4; var w = 6 + ((frame + r * 3) % 10); var pa = iso(st.i + 0.4, 0); ctx.fillStyle = C.neon; ctx.fillRect(pa.x + 1, pa.y - top + y0 + 1, w, 1); }
  }
  function wallBoard(ctx, st) {
    var a = iso(st.i, 0), b = iso(st.i + st.w, 0), top = ROOM.wallH - 12, bot = 14;
    poly(ctx, [[a.x, a.y - top], [b.x, b.y - top], [b.x, b.y - bot], [a.x, a.y - bot]], C.k);
    poly(ctx, [[a.x + 1, a.y - top + 1], [b.x - 1, b.y - top + 1], [b.x - 1, b.y - bot - 1], [a.x + 1, a.y - bot - 1]], C.plate);
  }
  function drawStation(ctx, id, st, frame, live) {
    if (st.kind === "screen" || st.kind === "board") return; // wall-mounted, drawn with the room
    var i = st.i, j = st.j, w = st.w, d = st.d, h = st.h;
    if (st.kind === "desk") {
      isoBox(ctx, i, j, w, d, h, C.deskTop, C.deskSide, C.deskEdge);
      // monitor on the desk (back side), keyboard, papers
      var m = iso(i + 2.0, j + 0.2); ctx.fillStyle = C.k; ctx.fillRect(m.x - 2, m.y - h - 9, 12, 8); ctx.fillStyle = live && live.busy ? C.glass : C.screen; ctx.fillRect(m.x, m.y - h - 8, 10, 6);
      if (live && live.busy && frame % 2) { ctx.fillStyle = C.neon; ctx.fillRect(m.x + 1 + (frame % 5), m.y - h - 7 + Math.floor(frame / 5) % 3, 2, 1); }
      var kb = iso(i + 1.0, j + 0.75); ctx.fillStyle = C.steelDim; ctx.fillRect(kb.x - 3, kb.y - h - 1, 8, 2);
      var pp = iso(i + 0.4, j + 0.6); ctx.fillStyle = C.paper; ctx.fillRect(pp.x - 2, pp.y - h - 2, 4, 3);
      return;
    }
    if (st.kind === "kiosk") {
      isoBox(ctx, i, j, w, d, h, "#2B4D8F", C.blue, "#0F1F7A");
      var e = iso(i + 0.6, j + 1.1); ctx.fillStyle = C.paper; ctx.fillRect(e.x - 1, e.y - h - 2, 6, 4); ctx.fillStyle = C.blue; ctx.fillRect(e.x, e.y - h - 1, 4, 1);
      return;
    }
    if (st.kind === "counter") {
      isoBox(ctx, i, j, w, d, h, C.deskTop, C.deskSide, C.deskEdge);
      var s1 = iso(i + 0.5, j + 0.6); ctx.fillStyle = C.paper; ctx.fillRect(s1.x - 2, s1.y - h - 3, 6, 4); ctx.fillStyle = C.k; ctx.fillRect(s1.x - 1, s1.y - h - 2, 4, 1);
      var s2 = iso(i + 0.5, j + 1.8); ctx.fillStyle = C.orange; ctx.fillRect(s2.x - 2, s2.y - h - 4, 4, 4); ctx.fillStyle = C.amber; ctx.fillRect(s2.x - 1, s2.y - h - 5, 2, 1);
      return;
    }
    if (st.kind === "rack") {
      isoBox(ctx, i, j, w, d, h, C.steelDim, C.steel, "#46545D");
      var b = iso(i + 0.3, j + d); for (var r = 0; r < 4; r++) { ctx.fillStyle = C.k; ctx.fillRect(b.x + 2, b.y - h + 4 + r * 5, 14, 3); ctx.fillStyle = (frame + r * 7) % 20 < 14 ? C.green : C.amber; ctx.fillRect(b.x + 3, b.y - h + 5 + r * 5, 2, 1); ctx.fillStyle = C.neonDim; ctx.fillRect(b.x + 6, b.y - h + 5 + r * 5, 8, 1); }
      return;
    }
    if (st.kind === "coffee") {
      isoBox(ctx, i, j, w, d, h, C.steel, C.steelDim, "#46545D");
      var cm = iso(i + 0.2, j + d); ctx.fillStyle = C.k; ctx.fillRect(cm.x + 2, cm.y - h + 2, 8, 5); ctx.fillStyle = C.red; ctx.fillRect(cm.x + 3, cm.y - h + 3, 2, 2);
      ctx.fillStyle = C.cup; ctx.fillRect(cm.x + 4, cm.y - h + 9, 4, 3);
      if (frame % 8 < 4) { ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.fillRect(cm.x + 5, cm.y - h + 7, 1, 2); }
      return;
    }
  }

  // ---- scene -------------------------------------------------------------------------------------------------------
  function Scene(opts) {
    this.canvas = opts.canvas;
    this.ctx = this.canvas.getContext("2d");
    this.poll = opts.poll;
    this.onRun = opts.onRun;
    this.interval = opts.interval || 2000;
    this.teamEl = opts.team;
    this.queueEl = opts.queue;
    this.config = opts.config || {};
    this.image = null;
    this.frame = 0;
    this.lastTick = 0;
    this.robots = [];      // {index, name, look, i, j, ti, tj, pose, face, station, busy, scenario, step, fresh, freshUntil}
    this.queued = [];
    this.events = [];
    this.clock = "";
    this.demo = false;
    this.error = null;
    this.particles = [];
    this.W = ROOM.W; this.H = ROOM.H;
    if (this.config.background) this.loadImage(this.config.background);
    this.canvas.width = this.W * SCALE; this.canvas.height = this.H * SCALE;
    this.canvas.style.maxWidth = (this.W * SCALE) + "px";
  }

  Scene.prototype.loadImage = function (src) {
    var self = this, img = new Image();
    img.onload = function () { self.image = img; var ratio = img.height / img.width; self.H = Math.round(self.W * ratio); self.canvas.height = self.H * SCALE; };
    img.src = src;
  };

  Scene.prototype.stationFor = function (robot) {
    if (!robot.busy) return "desk" + robot.index;
    var kind = robot.step && robot.step.kind;
    return (kind && KIND_STATION[kind]) || ("desk" + robot.index);
  };
  Scene.prototype.standAt = function (id, robot) {
    if (this.image && this.config.anchors && this.config.anchors[id]) {
      var a = this.config.anchors[id];
      return { x: Math.round(a.x * this.W), y: Math.round(a.y * this.H), face: a.face || 1 };
    }
    var st = STATIONS[id] || STATIONS["desk" + (robot.index % 3)];
    var s = st.stand || { i: st.i + st.w / 2, j: st.j + st.d + 1, face: 1 };
    var p = iso(s.i, s.j);
    return { x: p.x, y: p.y, face: s.face, i: s.i, j: s.j };
  };

  Scene.prototype.update = function (data) {
    var now = Date.now(), self = this;
    this.clock = data.clock || ""; this.demo = !!data.demo; this.queued = data.queued || []; this.events = data.events || [];
    var team = data.team || [];
    team.forEach(function (w, idx) {
      var r = self.robots[idx];
      if (!r) {
        var home = self.standAt("desk" + (idx % 3), { index: idx });
        r = self.robots[idx] = { index: idx, name: w.name, look: idx % 3 === 0 ? "woman" : idx % 3 === 1 ? "glasses" : "senior", x: home.x, y: home.y, tx: home.x, ty: home.y, face: 1, pose: "idle", station: "desk" + idx, busy: false, freshUntil: 0, fresh: null, runId: null, items: 0 };
      }
      r.name = w.name;
      var wasBusy = r.busy, prevRun = r.runId;
      r.busy = !!w.busy; r.scenario = w.scenario_name || null; r.step = w.step || null; r.runId = w.run_id || null;
      if (w.busy && (w.items || 0) > r.items) self.spawnPaper(r);
      r.items = w.busy ? (w.items || 0) : 0;
      if (wasBusy && !r.busy && prevRun) { // just finished: find the outcome in the events
        var ev = null; for (var i = 0; i < self.events.length; i++) if (self.events[i].id === prevRun) { ev = self.events[i]; break; }
        r.fresh = ev ? ev.status : "success"; r.freshUntil = now + 8000;
        if (r.fresh === "error") self.spawnSmoke(r, 6);
      }
      var station = self.stationFor(r);
      if (station !== r.station) { r.station = station; var s = self.standAt(station, r); r.tx = s.x; r.ty = s.y; r.faceTarget = s.face; }
    });
    this.robots.length = Math.min(this.robots.length, team.length);
    this.renderDom();
  };

  Scene.prototype.spawnPaper = function (r) { this.particles.push({ type: "paper", x: r.x + 4, y: r.y - 12, vx: 1.4 + Math.random() * 0.6, vy: -1.3, life: 12, t: 0 }); };
  Scene.prototype.spawnSmoke = function (r, n) { for (var k = 0; k < (n || 1); k++) this.particles.push({ type: "smoke", x: r.x - 2 + Math.random() * 6, y: r.y - 18, vx: (Math.random() - 0.5) * 0.4, vy: -0.5 - Math.random() * 0.4, life: 18 + Math.random() * 10, t: 0 }); };

  Scene.prototype.tick = function () {
    this.frame++;
    var self = this;
    this.robots.forEach(function (r) {
      var dx = r.tx - r.x, dy = r.ty - r.y, sp = 1.4;
      if (Math.abs(dx) > sp || Math.abs(dy) > sp) {
        r.pose = "walk";
        if (Math.abs(dx) > sp) { r.x += Math.sign(dx) * sp; r.face = Math.sign(dx); } else { r.y += Math.sign(dy) * sp; }
      } else {
        r.x = r.tx; r.y = r.ty; if (r.faceTarget) r.face = r.faceTarget;
        var kind = r.step && r.step.kind;
        r.pose = r.busy ? ((kind && KIND_POSE[kind]) || "type") : "idle";
      }
      if (r.fresh === "error" && r.freshUntil > Date.now() && self.frame % 3 === 0) self.spawnSmoke(r, 1);
    });
    this.particles = this.particles.filter(function (p) { p.t++; p.x += p.vx; p.y += p.vy; return p.t < p.life; });
  };

  Scene.prototype.render = function () {
    var ctx = this.ctx, f = this.frame, self = this;
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0); ctx.imageSmoothingEnabled = false;
    var drawables = [];
    if (this.image) {
      ctx.drawImage(this.image, 0, 0, this.W, this.H);
    } else {
      drawRoom(ctx, f);
      Object.keys(STATIONS).forEach(function (id) { var st = STATIONS[id]; if (st.kind === "screen" || st.kind === "board") return; drawables.push({ depth: (st.i + st.w / 2) + (st.j + st.d), draw: function () { drawStation(ctx, id, st, f, self.robotAtDesk(id)); } }); });
    }
    this.robots.forEach(function (r) {
      var depth = self.image ? r.y / 4 : (r.y - ROOM.oy) / 4; // iso i + j from the screen y
      drawables.push({ depth: depth + 0.01, draw: function () { self.drawRobot(r); } });
    });
    drawables.sort(function (a, b) { return a.depth - b.depth; }).forEach(function (d) { d.draw(); });
    this.robots.forEach(function (r) { self.drawRobotPlates(r); });
    // particles
    this.particles.forEach(function (p) {
      if (p.type === "paper") { ctx.fillStyle = C.paper; ctx.fillRect(Math.round(p.x), Math.round(p.y), 3, 4); }
      else { ctx.fillStyle = "rgba(200,205,215," + (0.55 * (1 - p.t / p.life)).toFixed(2) + ")"; var rr = 2 + Math.floor(p.t / 6); ctx.fillRect(Math.round(p.x) - rr, Math.round(p.y) - rr, rr * 2, rr * 2); }
    });
    // labels on stations
    var labels = this.image ? (this.config.labels || {}) : null;
    Object.keys(STATIONS).forEach(function (id) {
      var st = STATIONS[id]; if (!st.label) return;
      var pos;
      if (self.image) { if (!self.config.anchors || !self.config.anchors[id]) return; var a = self.config.anchors[id]; pos = { x: Math.round(a.x * self.W), y: Math.round(a.y * self.H) + 4 }; }
      else { var p = iso(st.i + st.w / 2, st.j + st.d); pos = { x: p.x, y: p.y + 3 }; if (st.kind === "screen") { var q = iso(st.i + st.w / 2, 0); pos = { x: q.x, y: q.y - 6 }; } }
      var w = textWidth(st.label); plate(ctx, st.label, pos.x - w / 2, pos.y, C.w, C.blue);
    });
    // HUD: sign, queue board, clock
    ctx.fillStyle = C.blue; ctx.fillRect(4, 4, 70, 19); drawText(ctx, "SAMSUNG PULSAR", 8, 7, C.w); drawText(ctx, "OPEN SPACE", 8, 14, "#BFD4F5");
    var cw = 34; ctx.fillStyle = C.k; ctx.fillRect(this.W - cw - 4, 4, cw, 12); ctx.fillStyle = C.screen; ctx.fillRect(this.W - cw - 3, 5, cw - 2, 10); drawText(ctx, this.clock || "--:--", this.W - cw, 7, C.neon);
    var busy = this.robots.filter(function (r) { return r.busy; }).length;
    var qtext = "QUEUE " + this.queued.length + "  BUSY " + busy + "  FREE " + (this.robots.length - busy);
    plate(ctx, qtext, this.W - cw - 10 - textWidth(qtext), 7, C.w, C.plate);
    if (this.demo) drawText(ctx, "DEMO", 8, 26, C.amber);
    if (this.error) drawText(ctx, "OFFLINE", this.W - 34, 20, C.red);
  };

  Scene.prototype.robotAtDesk = function (id) {
    for (var i = 0; i < this.robots.length; i++) if (this.robots[i].station === id) return this.robots[i];
    return null;
  };

  Scene.prototype.drawRobot = function (r) {
    var ctx = this.ctx, f = this.frame;
    var flip = r.face < 0;
    drawCharacter(ctx, Math.round(r.x), Math.round(r.y), r, r.pose, f, flip);
  };

  Scene.prototype.drawRobotPlates = function (r) {
    var ctx = this.ctx;
    // name plate under the feet, action plate above the head
    var name = r.name || ("ROBOT " + (r.index + 1));
    plate(ctx, name, Math.round(r.x) - textWidth(name) / 2, Math.round(r.y) + (r.station.indexOf("desk") === 0 ? 12 : 3), C.w, r.busy ? C.blue : C.plate);
    var text = r.busy ? ((r.step && r.step.kind) ? r.step.kind : "WORKING") : (r.pose === "walk" ? "..." : "AVAILABLE");
    if (r.busy && r.items) text += " " + r.items;
    var w = textWidth(text);
    plate(ctx, text, Math.max(2, Math.min(this.W - w - 4, Math.round(r.x) - w / 2)), Math.round(r.y) - 28, r.busy ? C.neon : C.muted, "rgba(11,18,32,.92)");
    if (r.fresh && r.freshUntil > Date.now() && ICONS[r.fresh]) { drawSprite(ctx, BUBBLE, Math.round(r.x) + 6, Math.round(r.y) - 42, { k: C.k, w: C.w }); drawSprite(ctx, ICONS[r.fresh], Math.round(r.x) + 10, Math.round(r.y) - 40, { g: C.green, a: C.amber, r: C.red }); }
  };

  Scene.prototype.renderDom = function () {
    var self = this;
    if (this.teamEl) {
      this.teamEl.innerHTML = this.robots.map(function (r, i) {
        var s = r.busy ? esc(r.scenario || "") + (r.step ? " · " + esc(r.step.kind) + (r.step.label ? " · " + esc(r.step.label) : "") : "") + " · " + r.items + " item(s)" + (r.runId ? ' · <a href="/runs/' + r.runId + '">run #' + r.runId + "</a>" : "") : "available";
        return '<div class="member ' + (r.busy ? "busy" : "free") + '"><div class="avatar" style="--tie:' + TIES[i % TIES.length] + '"><i></i></div><div><b>' + esc(r.name) + "</b><div class=\"muted\">" + s + "</div></div></div>";
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
    function loop(ts) { if (ts - self.lastTick >= 125) { self.lastTick = ts; self.tick(); self.render(); } requestAnimationFrame(loop); }
    requestAnimationFrame(loop);
    return this;
  };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  return { start: function (opts) { return new Scene(opts).start(); }, Scene: Scene, STATIONS: STATIONS, drawCharacter: drawCharacter };
})();

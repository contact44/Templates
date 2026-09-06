# Open space artwork

The rooms and the characters were generated with Higgsfield from the client's references; everything else here
is built from them by `python tools/openspace_assets.py --check <dir>` (sources in `tools/openspace-src/`).

- `background-light.png` · `background-dark.png` — the isometric room, 1200 px wide, one per theme (the platform
  theme picks the room).
- `scene-light.json` · `scene-dark.json` — in image pixels: the `anchors` (where a robot stands for each station,
  `face` = `ul` `ur` `dl` `dr`, the direction it looks; `label`/`lx`/`ly` = the station plate), the walk graph the
  robots follow (`nodes` + `edges`, so they go round the furniture), and the `occluders`: polygons cut out of the
  room as `fg-<theme>-<name>.png`, drawn over a robot standing behind their `depth` line (a robot behind a desk or
  in a chair). Edit the JSON, rerun the tool: it re-cuts the pieces and rewrites the placement fields.
- `sheet-<name>.png` + `chars.json` — one character per sheet: front view | back view, 38 px tall, feet on the
  last row; `legs` is the row where the legs start (the engine animates head/torso and each leg separately for the
  walk and run cycles). The back view is derived from the front one (hair over the face, closed jacket).

# Open space artwork

The rooms and the characters were generated with Higgsfield from the client's references; everything else here
is built from them by `python tools/openspace_assets.py --check <dir>` (sources in `tools/openspace-src/`).

- `background-light.png` · `background-dark.png` — the isometric room, 1200 px wide, one per theme (the platform
  theme picks the room).
- `scene-light.json` · `scene-dark.json` — in image pixels: the `anchors` (where a robot stands for each station,
  `face` = `ul` `ur` `dl` `dr`, the direction it looks, `pose: "desk"` = the robot sits there; `label`/`lx`/`ly` =
  the station plate), the walk graph the robots follow (`nodes` + `edges`, so they go round the furniture), and the
  `occluders`: polygons cut out of the room as `fg-<theme>-<name>.png`, drawn over a robot standing behind their
  `depth` line. Edit the JSON, rerun the tool: it re-cuts the pieces and rewrites the placement fields.
- `sheet-<name>.png` + `chars.json` — one character per sheet in seven poses, about 38 px tall, feet on the last row;
  the right-facing views are the left ones mirrored by the engine. Five standing poses (front, 3/4 front, profile,
  3/4 back, back) come from the Higgsfield turnaround sheet; the two seated poses (`seated_back`, `seated_front`)
  were generated separately with Higgsfield and include the office chair, so the character always sits properly in it
  and no chair has to be drawn under them. The text sources `tools/openspace-src/<name>.txt` and `<name>-seat.txt`
  are those poses reduced to a 16-colour palette (one digit per pixel), so they can be checked and edited by hand.
- `avatar-<name>.png` — head-and-shoulders portrait for the team list, cut from the original front view.

# Decisions log

| Date | Decision |
|---|---|
| 2026-09-06 | Light / dark switch in the header (remembered per browser, `data-theme` on the page; the open space follows). Seated robots use their own Higgsfield-generated sprite, chair included, instead of a character placed behind a chair drawn in the room. |
| 2026-09-06 | Header: the Samsung wordmark in white on the brand blue (a slot in `static/brand/` takes the official SVG), the product name **Pulsar** unchanged. Robots drawn from the Higgsfield turnaround sheets (six poses each, incl. seated at a desk); chairs added to the light room; a quest-style notice at the bottom right of the open space when a run finishes; the robots' portraits in the team list. |
| 2026-09-06 | Open space played like a video game: robots 38 px tall (about two thirds of the furniture), seen from the front or the back, walking along corridors round the furniture (walk graph per room), running to a station when a scenario starts, sitting at their desk otherwise; furniture in front of a robot masks it. Sprites are pixel-art cuts of the Higgsfield characters; the back view is derived from the front one. |
| 2026-09-06 | Open space artwork: the Higgsfield-generated rooms are the reference — **light room for the light theme, dark room for the dark theme** — with the generated character sheet for Andromede, Orion and Sirius. The room drawn in code stays only as a fallback when the images are missing. Samsung logo on the wall (proposal E): pending validation. |
| 2026-09-06 | Platform name: **Samsung Pulsar** (display name; package and CLI: `pulsar`). |
| 2026-09-06 | First three robots: **Andromede, Orion, Sirius** (editable under Settings > The team). |
| 2026-09-06 | Interface language: **English**. Scenario contract and action catalogue in English (`mail.read`, `web.browse`, `verify`…). |
| 2026-09-06 | Scenario 1 (monthly SELMS+ extraction) triggers on the **28th of each month at 07:00** (`0 7 28 * *`), plus "Run now". |
| 2026-09-06 | Credential vault for the generic employee account: username in the database, password in the system credential manager (Windows) or an encrypted file; read by scenarios with `ctx.credentials(name)`; masked in journals. |
| 2026-09-05 | Robots are execution slots (a team), not one robot per scenario; three simultaneous scenarios at most by default. |
| 2026-09-05 | Charter-inspired palette (deep blue accent, cool whites); no logo or brand assets reproduced in the interface. |

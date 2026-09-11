# Development tools

Scripts that drive the built game in a real browser. Build first
(`npm run build`), then run them with `node`.

| Script | What it does |
|---|---|
| `sheet.mjs` | Screenshots `dist/sheet.html` — a contact sheet of every sprite — one image per section. Build it with `npm run sheet`. |
| `playtest.mjs` | Plays the game through its own interface: lays streets, builds the water, drainage and guard buildings, zones three districts, runs the clock, and reports what the city became. Catches anything that only breaks once it is all wired together. |
| `panels.mjs` | Screenshots each interface panel at phone width. |
| `perf.mjs` | Grows a town, then measures frame pacing at three zoom levels. |
| `hero.mjs` | Grows a town and captures `docs/screenshot-valley.png`. |

They look for Chromium through Playwright. If it is installed somewhere
Playwright will not find on its own, point at it:

```bash
CHROMIUM_PATH=/path/to/chrome node tools/playtest.mjs
```

Screenshots go to `$SHOTS` when set, and to a temporary directory otherwise.

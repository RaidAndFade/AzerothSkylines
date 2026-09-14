# Azeroth Skylines

A city builder in the spirit of *Cities: Skylines*, set in Elwynn Forest and
built in the vernacular of England around 1300. A road runs into the valley
and stops; everything else is yours to lay out.

It is fully three-dimensional. The valley is one continuous surface with a
hard cap on its gradient, so there is no cliff, no step and no stack of
cubes anywhere in it — every hillside is ground you could walk up, and the
lake wades in rather than dropping off. The town standing on it is modelled
rather than drawn: cruck cottages under thatch, burgage houses whose upper
floors oversail the street on a jetty, stone slate and clay tile, a
curtain wall with drum towers and a gatehouse. A low sun casts real shadows
across the whole of it, and you can walk the camera round to look from
anywhere.

The whole game — code, models, interface — compiles to a **single shareable
`index.html` file** with no external assets, no network calls and no
dependencies at runtime. Open it from a phone, a laptop or a USB stick and
it works. It needs WebGL 2, which every current browser has.

![The valley](docs/screenshot-valley.png)

## Playing

**[Play it in your browser](https://raidandfade.github.io/AzerothSkylines/)** —
the current state of `master`, republished on every push.

To keep a copy, download `index.html` from any [Build
run](https://github.com/RaidAndFade/AzerothSkylines/actions/workflows/build.yml):
one file, which runs offline on a phone, a laptop or a USB stick. Or build it
yourself with `npm install && npm run build`.

| | |
|---|---|
| **Move the map** | One finger drag (or the mouse) while Inspect is selected; two fingers any time. With a mouse, the right button drags whatever tool is held, and a two-finger trackpad scroll moves the map |
| **Zoom** | Pinch, the scroll wheel, or `Ctrl`+scroll on a trackpad. Coming in drops the view toward the street; pulling back lifts it over the district |
| **Turn and tilt** | Drag with the middle button, or twist with two fingers. `Q` and `E` turn a step at a time |
| **Put the tool down** | Right click, or `Esc`. A second one closes the open panel |
| **Draw a street** | Pick **Roads**, then drag. Streets are laid in an L from where the drag began |
| **Footpaths** | Cheap, and the quickest way to walk — but no carts, and no water or drainage beneath them |
| **Zone land** | Pick **Dwellings**, **Trade** or **Crafting**, then drag a rectangle beside a road |
| **Build** | Pick **Build**, choose from the catalogue, then tap a plot fronting a road |
| **Annex land** | Pick **Land**, tap a lot beyond the walls, and confirm the price |
| **Clear ground** | Pick **Raze** and drag over what you want gone |
| **Keyboard** | `WASD` scroll · `Q`/`E` turn · `[`/`]` zoom · `1`–`4` speed · `Tab` next panel · `Esc` back out |
| **Tool keys** | `I` inspect · `R` roads · `Z` dwellings · `T` trade · `C` crafting · `B` build · `L` land · `X` raze |

Your city is saved to the browser on this device every ninety game-days, and
from the menu.

### Getting started

The game opens on a short guide, and it is in the menu thereafter. In brief:

1. Lay a street off the king's road where it enters your walls.
2. Zone dwellings along it. Buildings only grow on zoned land that fronts a
   street, so leave no plot more than one tile from the cobbles.
3. Sink a **Village Well** and dig a **Cesspit** — water and drainage run
   beneath the streets, so both reach any building whose door is on a road.
4. Zone for **Trade** so there is somewhere to buy bread, and **Crafting**
   so there is somewhere to work. Keep the forges downwind of the houses.
5. When the district fills, use **Land** to buy the next lot. The curtain
   wall moves out to enclose it and its woodland comes down; you pay for the
   land and the new masonry.

## How it works

### The valley

Terrain is generated from the name you give your valley, so the same name
always grows the same valley. Rolling hardwood country sits below northern
foothills; a lake is sunk into the valley floor and two or three streams are
walked down to it, cutting their beds as they go. The ground is then
classified by height and moisture into water, sand, grass, meadow, woodland,
rough grazing and snow.

Generation ends by **weathering the relief until nothing in it is steep**.
The height field is blurred, then every gradient is capped at 0.42 world
units per tile — about twenty-three degrees, the pitch of a steep pasture —
then blurred and capped again. The cap is enforced by two sweeps that
propagate the constraint the way a chamfer distance transform does, so it
holds across the whole map however far the offending ground reaches. That is
what rules out cliffs: there is no steep face left for one to form on.

What the renderer draws is not the tile grid but a Catmull-Rom surface
through it, sampled several times per tile. Bilinear interpolation would be
continuous in value but not in slope, and would crease along every tile
boundary — the grid would come straight back as a pattern of shallow ridges.
A spline surface is continuous in slope as well, and reads as ground.

The founding district is chosen **before** the town site: every possible
block of parcels is scored on how much of it is workable, level ground, and
the best one is claimed whole — and felled, since a town is not built in a
forest. (Choosing a promising tile first and claiming land around it
afterwards is how settlements end up straddling a river.) The
king's road is then A\*-routed in from the valley edge, preferring flat, dry,
open ground, and a level corridor is cut and filled along it.

### The city

| System | What it does |
|---|---|
| `sim/roads` | Placement rules, bridges, slope limits, junction connectivity, A\* pathfinding |
| `sim/zoning` | Painting districts; street-frontage rules |
| `sim/growth` | Growth ladders, upgrades and decline. Industry picks farming, timber, mining or crafting from the land around the plot |
| `sim/utilities` | Water and drainage pushed along the road network under capacity limits |
| `sim/services` | Radius coverage for the guard, the Light, merriment and commerce; pollution and land value |
| `sim/trade` | Production, haulage between buildings, hub reserves, import and export |
| `sim/population` | Who lives where, who works where, and how content they are |
| `sim/demand` | The three demand bars, driven by contentment, vacancies and unfilled posts |
| `sim/economy` | Monthly taxes and upkeep, the month in progress projected, the ledger of closed months, Crown loans, and what stops working while the city is in debt |
| `sim/walls` | The curtain wall, derived from the land you hold |
| `sim/agents` | Villagers, carts, guards and travellers. Carts keep to the streets; people on foot take the paths |

Every system is a plain function over plain state, which is why the whole
simulation can be tested without a browser.

### The artwork

There are no image files and no model files. Every building, tree, road,
wall piece and villager is **generated as geometry** at runtime from a table
of styles, which is what keeps forty-odd structures looking like one town
rather than forty separate models.

The kit they are built from is deliberately round-shouldered: lathes and
spheroids rather than boxes, smooth normals rather than faceted ones, walls
with a batter, eaves that oversail, ridges that are capped and rounded. A
house is a plinth footed on the ground, a frame of posts and studs standing
proud of its daub panels, an upper floor on joist ends, and a steep roof
with a rolled thatch edge — not a cube with a lid.

Rendering is a hand-written WebGL 2 renderer, about a thousand lines with no
dependencies:

| Pass | What it does |
|---|---|
| Shadow | One directional depth map fitted to the ground around the camera, with soft PCF |
| Sky | A gradient with the sun's glow in it, turned back into rays from the inverse view matrix |
| Ground | The terrain surface, with world-space grain and the interface's decal map |
| Objects | Roads, buildings, walls, woodland and people, batched per chunk |
| Water | A flat sheet whose movement is all in the normal, thinning out over the shallows |

Work is divided into chunks of sixteen tiles. Ground and water are built
once; roads, buildings, walls and woodland are rebuilt only for the chunks
the simulation has touched, and a frame may only spend so much on building,
so a chunk coming into view never costs a visible hitch. Woodland drops to a
reduced model beyond thirty-odd tiles. Everything is frustum-culled against
its own bounds.

The country runs on for a hundred tiles past the valley at a quarter of the
detail, and the haze thickens as the view pulls back, so however far you
stand off there is no edge of the world to find.

Zoning, the service overlays, the lot grid, the outline round a selected
building and whatever the pointer is over all go into one small map-space
texture that the ground shader samples in tile coordinates — which is why
they drape exactly over the relief instead of floating above it.

### The colour

England, around 1300, and nothing in it is saturated. Walls are lime, daub,
knapped flint and oolitic limestone; roofs climb from wheat straw through
oak shingle and stone slate to clay tile and, on what the crown pays for,
lead. The country is pasture green going to hay in high summer, hedged in
hawthorn, under the thin grey light of an island climate. The brightest
thing in view is usually a limewashed gable.

## Building it

```bash
npm install
npm run build      # -> dist/index.html, one self-contained file
npm run dev        # dev server on :8080 with live reload
npm test           # the simulation test suite
npm run typecheck  # strict TypeScript, no emit
npm run sheet      # -> dist/sheet.html, a portrait of everything modelled
```

`dist/` is not kept in the repository. GitHub Actions runs the typecheck, the
linter and the tests on every push and pull request, builds the game, and
attaches `index.html` to the run; pushes to `master` deploy it to GitHub
Pages. Build locally whenever you want the file in hand — the scripts in
`tools/` expect it at `dist/index.html`.

`npm run sheet` is a development aid: it renders every building, wall piece,
tree and villager as a small three-dimensional portrait on one page, so the
modelling can be reviewed side by side. `tools/` holds
scripts that drive the built game in a real browser — a full interface
playthrough, panel screenshots and a frame-pacing measurement. See
[`tools/README.md`](tools/README.md).

### Tests

The suite covers each simulation system and the pure parts of the renderer —
the ground surface, the camera, the geometry kit, what a wheel event means —
plus two end-to-end runs: one that
lays out a town, gives it water, drainage and a guard, and checks it grows
past five hundred residents, employs them, supplies its shops and pays its
own way; and one that neglects a town and checks it empties out.

The runner owns this. It runs the suite on every push and pull request, and
the deploy is gated on the result, so that run is the authority rather than
anything reproduced by hand. The commands are here for when you want to sit
with one particular test:

```
npm test
npm run coverage
```

### Poking at a running city

A published page exposes a small read-mostly handle for the browser console:

```js
azerothSkylines.city            // live city state
azerothSkylines.camera          // the camera: x, z, distance, yaw, pitch
azerothSkylines.screenForTile(x, y)
```

Nothing in the game depends on it; it exists for debugging and for the
automated interface tests in `tools/`.

## Lore notes

The content follows Elwynn Forest and Stormwind as closely as a city builder
can, but it is built and lit as a real English valley of the period.
Dwellings climb from a one-bay cruck cottage under thatch, through a
box-framed house with a chimney, to a jettied burgage house on the street
and a stone hall under clay tile. Industry follows the valley's real trades:
farmsteads and vineyards, the Eastvale logging camps, the Fargodeep and
Jasperlode delves, and the forges of the Dwarven District. Services are the
Stormwind City Guard, the Cathedral of Light, the Lion's Pride Inn and the
canals that bisect the city. Trade with the world runs through markets,
caravan posts for the road to Goldshire and Westfall, and deep-water docks.

Sources consulted for the setting:
[Elwynn Forest](https://warcraft.wiki.gg/wiki/Elwynn_Forest) ·
[Stormwind City](https://warcraft.wiki.gg/wiki/Stormwind_City)

## Licence

MIT — see [LICENSE](LICENSE). Warcraft, Azeroth, Stormwind and Elwynn Forest
are trademarks of Blizzard Entertainment; this is an unaffiliated fan project.

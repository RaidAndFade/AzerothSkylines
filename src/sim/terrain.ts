/**
 * Procedural generation of an Elwynn Forest valley: rolling hardwood
 * woodland below northern foothills, threaded with streams and a broad
 * lake, with a king's road running in from the edge of the map.
 */
import { Rng, hash2 } from '../core/rng';
import { ValueNoise2D } from '../core/noise';
import { clamp, clamp01, inverseLerp, lerp, smoothstep } from '../core/math';
import { DIRECTIONS, Point } from '../core/grid';
import { Terrain, isBuildable, isWater } from './types';

export const MAX_ELEVATION = 7;
/** Normalised height below which terrain is water. */
const SEA_LEVEL = 0.36;
const SHALLOW_BAND = 0.045;

export interface TerrainOptions {
  width: number;
  height: number;
  seed: number | string;
  /** 0 = gentle farmland, 1 = craggy highlands. */
  ruggedness?: number;
  /** 0 = sparse clearings, 1 = deep woodland. */
  woodland?: number;
}

export interface WorldMap {
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  /** Continuous height in [0,1], for shading and slope. */
  readonly heightField: Float32Array;
  /** Quantised height step in [0, MAX_ELEVATION]; 0 at the waterline. */
  readonly elevation: Int8Array;
  readonly terrain: Uint8Array;
  /** Wetness in [0,1]; drives grass vs meadow and farm fertility. */
  readonly moisture: Float32Array;
  /** Chance of trees standing on the tile, in [0,1]. */
  readonly treeDensity: Float32Array;
  /** Suitability for arable farming, in [0,1]. */
  readonly fertility: Float32Array;
  /** Likelihood of ore beneath the tile, in [0,1]. */
  readonly oreRichness: Float32Array;
  /** Tile the founding road ends at: the heart of the new settlement. */
  readonly foundingSite: Point;
  /** Tile where the king's road enters from outside the valley. */
  readonly roadEntry: Point;
  /** Ordered tiles of the king's road, entry first. */
  readonly kingsRoad: Point[];
}

const index = (map: { width: number }, x: number, y: number) => y * map.width + x;

export function terrainAt(map: WorldMap, x: number, y: number): Terrain {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return Terrain.DeepWater;
  return map.terrain[index(map, x, y)] as Terrain;
}

export function elevationAt(map: WorldMap, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return 0;
  return map.elevation[index(map, x, y)];
}

export function inBounds(map: WorldMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

/** True when a tile can carry a road, wall or building. */
export function isTileBuildable(map: WorldMap, x: number, y: number): boolean {
  if (!inBounds(map, x, y)) return false;
  return isBuildable(terrainAt(map, x, y));
}

/** Steepest height difference to a cardinal neighbour, in elevation steps. */
export function slopeAt(map: WorldMap, x: number, y: number): number {
  const here = elevationAt(map, x, y);
  let worst = 0;
  for (const d of DIRECTIONS) {
    if (!inBounds(map, x + d.x, y + d.y)) continue;
    worst = Math.max(worst, Math.abs(elevationAt(map, x + d.x, y + d.y) - here));
  }
  return worst;
}

export function generateWorld(options: TerrainOptions): WorldMap {
  const { width, height } = options;
  const rng = new Rng(options.seed);
  const seedNumber = rng.serialize();
  const ruggedness = options.ruggedness ?? 0.4;
  const woodland = options.woodland ?? 0.62;

  const shapeNoise = new ValueNoise2D(rng.fork(1).serialize());
  const detailNoise = new ValueNoise2D(rng.fork(2).serialize());
  const ridgeNoise = new ValueNoise2D(rng.fork(3).serialize());
  const moistNoise = new ValueNoise2D(rng.fork(4).serialize());
  const forestNoise = new ValueNoise2D(rng.fork(5).serialize());
  const oreNoise = new ValueNoise2D(rng.fork(6).serialize());

  const cells = width * height;
  const heightField = new Float32Array(cells);
  const moisture = new Float32Array(cells);
  const treeDensity = new Float32Array(cells);
  const fertility = new Float32Array(cells);
  const oreRichness = new Float32Array(cells);
  const elevation = new Int8Array(cells);
  const terrain = new Uint8Array(cells);

  const scale = 1 / 34;

  // --- 1. Base relief -------------------------------------------------------
  // Gentle rolling hills, with a ridge of foothills climbing toward the north
  // edge in the manner of the Burning Steppes above Elwynn.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = x * scale;
      const ny = y * scale;

      const rolling = shapeNoise.fbm(nx, ny, 5, 0.5, 2.05);
      const detail = detailNoise.fbm(nx * 3.1, ny * 3.1, 3, 0.45, 2.2);

      // Foothills mass in the top eighth of the map and along the far corners.
      const northBias = smoothstep(0.3, 0.0, y / height);
      const ridge = ridgeNoise.ridged(nx * 0.7, ny * 0.7, 4, 0.55, 2.1);
      const mountains = northBias * ridge * (0.55 + ruggedness * 0.55);

      // A soft bowl keeps the valley floor inland and the edges lower, so the
      // playable area sits in a natural basin.
      const edgeX = Math.min(x, width - 1 - x) / (width * 0.5);
      const edgeY = Math.min(y, height - 1 - y) / (height * 0.5);
      const basin = smoothstep(0, 0.42, Math.min(edgeX, edgeY));

      let h = rolling * 0.66 + detail * 0.14 + 0.06;
      h = lerp(h * 0.72, h, basin);
      h += mountains;
      heightField[y * width + x] = clamp01(h);
    }
  }

  // --- 2. Water: a broad lake and the streams that feed it ------------------
  const lake = carveLake(heightField, width, height, rng);
  const streams = carveStreams(heightField, width, height, rng, lake);

  // --- 3. Smooth the valley floor so the city has flat ground to build on ---
  smoothLowlands(heightField, width, height);

  // --- 4. Quantise to elevation steps and split land from water ------------
  const submerged = new Uint8Array(cells);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const h = heightField[i];
      if (h < SEA_LEVEL) {
        submerged[i] = 1;
        elevation[i] = 0;
        terrain[i] = h < SEA_LEVEL - SHALLOW_BAND ? Terrain.DeepWater : Terrain.ShallowWater;
        continue;
      }
      const above = inverseLerp(SEA_LEVEL, 1, h);
      // A gentle curve keeps most of the valley within one or two steps while
      // still letting the foothills climb.
      elevation[i] = clamp(Math.round(above ** 1.45 * MAX_ELEVATION), 0, MAX_ELEVATION);
      // Provisional: refined once moisture and woodland are known.
      terrain[i] = Terrain.Grass;
    }
  }
  flattenElevationNoise(elevation, submerged, width, height);

  // --- 5. Moisture, woodland, fertility and ore ----------------------------
  const waterDistance = distanceToWater(terrain, width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const nx = x * scale;
      const ny = y * scale;

      const nearWater = 1 - clamp01(waterDistance[i] / 14);
      const wet = clamp01(moistNoise.fbm(nx * 1.4, ny * 1.4, 4, 0.5, 2) * 0.65 + nearWater * 0.5);
      moisture[i] = wet;

      const elev = elevation[i];
      if (submerged[i]) {
        treeDensity[i] = 0;
        fertility[i] = 0;
        oreRichness[i] = 0;
        continue;
      }

      // Classify land now that moisture is known.
      if (elev >= MAX_ELEVATION) {
        terrain[i] = Terrain.Snow;
      } else if (elev >= MAX_ELEVATION - 2) {
        terrain[i] = Terrain.Rock;
      } else if (waterDistance[i] <= 1 && elev <= 1) {
        terrain[i] = Terrain.Sand;
      } else {
        // fbm clusters around its mean, so stretch the mid-range before
        // thresholding or the canopy comes out all-or-nothing between seeds.
        const canopy = smoothstep(0.36, 0.66, forestNoise.fbm(nx * 1.15, ny * 1.15, 4, 0.52, 2.1));
        const forestScore = canopy * 0.8 + wet * 0.2 - elev * 0.045;
        terrain[i] = forestScore > 1 - woodland ? Terrain.Forest : wet > 0.52 ? Terrain.Meadow : Terrain.Grass;
      }

      const finalTerrain = terrain[i] as Terrain;
      if (finalTerrain === Terrain.Forest) {
        treeDensity[i] = clamp01(0.55 + forestNoise.sample(nx * 4, ny * 4) * 0.45);
      } else if (finalTerrain === Terrain.Grass || finalTerrain === Terrain.Meadow) {
        // Scattered standards and hedgerow trees in open country.
        treeDensity[i] = clamp01(forestNoise.fbm(nx * 3, ny * 3, 2, 0.5, 2) - 0.55) * 0.7;
      } else {
        treeDensity[i] = 0;
      }

      fertility[i] = clamp01(
        (finalTerrain === Terrain.Meadow ? 0.75 : finalTerrain === Terrain.Grass ? 0.6 : 0.25) +
          wet * 0.3 -
          elev * 0.06,
      );
      oreRichness[i] = clamp01(oreNoise.fbm(nx * 2.2, ny * 2.2, 3, 0.5, 2) * 0.8 + elev / MAX_ELEVATION - 0.35);
    }
  }

  const map: WorldMap = {
    width,
    height,
    seed: seedNumber,
    heightField,
    elevation,
    terrain,
    moisture,
    treeDensity,
    fertility,
    oreRichness,
    foundingSite: { x: 0, y: 0 },
    roadEntry: { x: 0, y: 0 },
    kingsRoad: [],
  };

  // --- 6. Choose where the settlement begins and lay the king's road --------
  const site = chooseFoundingSite(map, lake, streams, rng);
  const entry = chooseRoadEntry(map, site);
  const road = traceKingsRoad(map, entry, site);
  levelRoadCorridor(map, road);

  return { ...map, foundingSite: site, roadEntry: entry, kingsRoad: road };
}

/** Sink a broad, irregular lake into the valley floor. */
function carveLake(heights: Float32Array, width: number, height: number, rng: Rng): Point {
  const cx = Math.floor(rng.range(width * 0.32, width * 0.68));
  const cy = Math.floor(rng.range(height * 0.45, height * 0.78));
  const radiusX = rng.range(width * 0.09, width * 0.14);
  const radiusY = rng.range(height * 0.07, height * 0.115);
  const wobble = new ValueNoise2D(rng.fork(11).serialize());

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = (x - cx) / radiusX;
      const dy = (y - cy) / radiusY;
      const angle = Math.atan2(dy, dx);
      const edge = 1 + (wobble.sample(Math.cos(angle) * 2 + 8, Math.sin(angle) * 2 + 8) - 0.5) * 0.55;
      const d = Math.hypot(dx, dy) / edge;
      if (d < 1.25) {
        const depth = smoothstep(1.25, 0.15, d);
        const i = y * width + x;
        heights[i] = lerp(heights[i], SEA_LEVEL - 0.1 - depth * 0.12, depth);
      }
    }
  }
  return { x: cx, y: cy };
}

/**
 * Walk two or three streams from the northern foothills down to the lake,
 * cutting their beds below the waterline as they go.
 */
function carveStreams(
  heights: Float32Array,
  width: number,
  height: number,
  rng: Rng,
  lake: Point,
): Point[][] {
  const streams: Point[][] = [];
  const count = rng.int(2, 3);

  for (let s = 0; s < count; s++) {
    let x = rng.range(width * 0.15, width * 0.85);
    let y = rng.range(0, height * 0.16);
    const path: Point[] = [];
    let dirX = 0;
    let dirY = 1;

    for (let stepIndex = 0; stepIndex < width * 2.5; stepIndex++) {
      const tx = Math.round(x);
      const ty = Math.round(y);
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) break;
      path.push({ x: tx, y: ty });
      if (heights[ty * width + tx] < SEA_LEVEL - 0.02 && stepIndex > 6) break;

      // Steer toward the lake, with a meander so the stream is not a ruler line.
      const toLakeX = lake.x - x;
      const toLakeY = lake.y - y;
      const len = Math.hypot(toLakeX, toLakeY) || 1;
      const meander = (rng.next() - 0.5) * 1.5;
      dirX = dirX * 0.7 + (toLakeX / len) * 0.3 + meander * 0.25;
      dirY = dirY * 0.7 + (toLakeY / len) * 0.3 + meander * 0.12;
      const dl = Math.hypot(dirX, dirY) || 1;
      dirX /= dl;
      dirY /= dl;
      x += dirX;
      y += dirY;
    }

    // Cut the bed, widening as the stream descends.
    const widthAt = (t: number) => lerp(1.0, 2.4, t);
    for (let p = 0; p < path.length; p++) {
      const t = p / Math.max(1, path.length - 1);
      const r = widthAt(t);
      const ri = Math.ceil(r) + 1;
      for (let dy = -ri; dy <= ri; dy++) {
        for (let dx = -ri; dx <= ri; dx++) {
          const px = path[p].x + dx;
          const py = path[p].y + dy;
          if (px < 0 || py < 0 || px >= width || py >= height) continue;
          const d = Math.hypot(dx, dy);
          if (d > r + 1) continue;
          const i = py * width + px;
          const cut = smoothstep(r + 1, 0, d);
          heights[i] = lerp(heights[i], SEA_LEVEL - 0.055, cut);
        }
      }
    }
    streams.push(path);
  }
  return streams;
}

/** Blur only the low ground, leaving ridges crisp. */
function smoothLowlands(heights: Float32Array, width: number, height: number): void {
  const copy = Float32Array.from(heights);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const h = copy[i];
      if (h < SEA_LEVEL || h > 0.62) continue;
      let total = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) total += copy[(y + dy) * width + (x + dx)];
      }
      const blurred = total / 9;
      // Stronger smoothing on the flattest, lowest ground.
      const strength = smoothstep(0.62, SEA_LEVEL, h) * 0.8;
      heights[i] = lerp(h, blurred, strength);
    }
  }
}

/** Remove single-tile elevation spikes so the isometric terrain reads cleanly. */
function flattenElevationNoise(
  elevation: Int8Array,
  submerged: Uint8Array,
  width: number,
  height: number,
): void {
  const copy = Int8Array.from(elevation);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      // Water is always at step zero; never average it back up onto dry land.
      if (submerged[i]) continue;
      const here = copy[i];
      const neighbours = [
        copy[i - width],
        copy[i + width],
        copy[i - 1],
        copy[i + 1],
      ];
      let differing = 0;
      let total = 0;
      for (const n of neighbours) {
        if (n !== here) differing++;
        total += n;
      }
      if (differing === 4) elevation[i] = Math.round(total / 4);
    }
  }
}

/** Chebyshev distance from every tile to the nearest water tile. */
function distanceToWater(terrain: Uint8Array, width: number, height: number): Float32Array {
  const dist = new Float32Array(width * height).fill(Infinity);
  const queue: number[] = [];
  for (let i = 0; i < terrain.length; i++) {
    if (isWater(terrain[i] as Terrain)) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const x = i % width;
    const y = (i / width) | 0;
    for (const d of DIRECTIONS) {
      const nx = x + d.x;
      const ny = y + d.y;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (dist[ni] > dist[i] + 1) {
        dist[ni] = dist[i] + 1;
        queue.push(ni);
      }
    }
  }
  for (let i = 0; i < dist.length; i++) if (!Number.isFinite(dist[i])) dist[i] = 999;
  return dist;
}

/**
 * Score every tile for how good a town site it is — flat, buildable, well
 * watered, away from the map edge — and take the best.
 */
function chooseFoundingSite(map: WorldMap, lake: Point, streams: Point[][], rng: Rng): Point {
  const { width, height } = map;
  const margin = Math.max(10, Math.floor(Math.min(width, height) * 0.16));
  let best: Point = { x: Math.floor(width / 2), y: Math.floor(height / 2) };
  let bestScore = -Infinity;

  const streamPoints = streams.flat();

  for (let y = margin; y < height - margin; y++) {
    for (let x = margin; x < width - margin; x++) {
      if (!isTileBuildable(map, x, y)) continue;

      // Require a generous flat, dry apron for the first district.
      let flat = 0;
      let buildable = 0;
      const here = elevationAt(map, x, y);
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          if (!inBounds(map, x + dx, y + dy)) continue;
          if (isTileBuildable(map, x + dx, y + dy)) buildable++;
          if (Math.abs(elevationAt(map, x + dx, y + dy) - here) <= 1) flat++;
        }
      }
      if (buildable < 60) continue;

      const waterDist = Math.min(
        Math.hypot(x - lake.x, y - lake.y),
        ...streamPoints.map((p) => Math.hypot(x - p.x, y - p.y)),
      );
      const centreBias = 1 - Math.hypot(x / width - 0.5, y / height - 0.5) * 1.4;
      const score =
        flat * 1.6 +
        buildable * 1.0 +
        smoothstep(26, 5, waterDist) * 60 -
        Math.max(0, 6 - waterDist) * 14 +
        centreBias * 40 +
        rng.next() * 4;

      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best;
}

/** Pick the map edge tile the king's road should enter from. */
function chooseRoadEntry(map: WorldMap, site: Point): Point {
  const { width, height } = map;
  const candidates: Point[] = [];
  for (let x = 2; x < width - 2; x++) {
    candidates.push({ x, y: 0 });
    candidates.push({ x, y: height - 1 });
  }
  for (let y = 2; y < height - 2; y++) {
    candidates.push({ x: 0, y });
    candidates.push({ x: width - 1, y });
  }

  let best = candidates[0];
  let bestScore = -Infinity;
  for (const c of candidates) {
    // The entry must be dry land with dry land just inside it.
    if (!isTileBuildable(map, c.x, c.y)) continue;
    const inwardX = c.x === 0 ? 1 : c.x === width - 1 ? -1 : 0;
    const inwardY = c.y === 0 ? 1 : c.y === height - 1 ? -1 : 0;
    let clear = true;
    for (let step = 1; step <= 4; step++) {
      if (!isTileBuildable(map, c.x + inwardX * step, c.y + inwardY * step)) clear = false;
    }
    if (!clear) continue;

    // Prefer a southern or eastern approach (from Goldshire) and a short run.
    const dist = Math.hypot(c.x - site.x, c.y - site.y);
    const southEastBonus = (c.y === height - 1 ? 26 : 0) + (c.x === width - 1 ? 18 : 0);
    const score = -dist + southEastBonus - elevationAt(map, c.x, c.y) * 6;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/**
 * A* the king's road from the valley edge to the founding site, preferring
 * flat, dry, open ground the way a real road would.
 */
function traceKingsRoad(map: WorldMap, from: Point, to: Point): Point[] {
  const { width, height } = map;
  const size = width * height;
  const cost = new Float32Array(size).fill(Infinity);
  const cameFrom = new Int32Array(size).fill(-1);
  const startIndex = from.y * width + from.x;
  const goalIndex = to.y * width + to.x;

  const heuristic = (i: number) => {
    const x = i % width;
    const y = (i / width) | 0;
    return (Math.abs(x - to.x) + Math.abs(y - to.y)) * 1.02;
  };

  // Binary-heap-free A*: the map is small enough for a sorted frontier array.
  const open: { i: number; f: number }[] = [{ i: startIndex, f: heuristic(startIndex) }];
  cost[startIndex] = 0;
  const closed = new Uint8Array(size);

  while (open.length > 0) {
    let bestAt = 0;
    for (let k = 1; k < open.length; k++) if (open[k].f < open[bestAt].f) bestAt = k;
    const current = open.splice(bestAt, 1)[0].i;
    if (current === goalIndex) break;
    if (closed[current]) continue;
    closed[current] = 1;

    const cx = current % width;
    const cy = (current / width) | 0;
    const currentElevation = map.elevation[current];

    for (const d of DIRECTIONS) {
      const nx = cx + d.x;
      const ny = cy + d.y;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (closed[ni]) continue;

      const t = map.terrain[ni] as Terrain;
      // Roads can ford shallow water but never cross the deep.
      if (t === Terrain.DeepWater) continue;
      let step = 1;
      if (t === Terrain.ShallowWater) step += 14;
      if (t === Terrain.Forest) step += 1.6;
      if (t === Terrain.Rock) step += 9;
      if (t === Terrain.Snow) step += 20;
      step += Math.abs(map.elevation[ni] - currentElevation) * 5;

      const tentative = cost[current] + step;
      if (tentative < cost[ni]) {
        cost[ni] = tentative;
        cameFrom[ni] = current;
        open.push({ i: ni, f: tentative + heuristic(ni) });
      }
    }
  }

  const path: Point[] = [];
  let node = goalIndex;
  if (cameFrom[node] === -1 && node !== startIndex) {
    // No route found (rare); fall back to a straight run so the game still starts.
    const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
    for (let s = 0; s <= steps; s++) {
      path.push({
        x: Math.round(lerp(from.x, to.x, s / steps)),
        y: Math.round(lerp(from.y, to.y, s / steps)),
      });
    }
    return path;
  }
  while (node !== -1) {
    path.push({ x: node % width, y: (node / width) | 0 });
    if (node === startIndex) break;
    node = cameFrom[node];
  }
  path.reverse();
  return path;
}

/**
 * Cut and fill a level corridor along the road, and dry out any shallow
 * water it fords, so the starting street is flat and usable.
 */
function levelRoadCorridor(map: WorldMap, road: Point[]): void {
  const { width } = map;
  for (const p of road) {
    const i = p.y * width + p.x;
    const target = map.elevation[i];
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = p.x + dx;
        const ny = p.y + dy;
        if (!inBounds(map, nx, ny)) continue;
        const ni = ny * width + nx;
        const falloff = Math.max(Math.abs(dx), Math.abs(dy));
        if (falloff <= 1) {
          map.elevation[ni] = target;
          if (isWater(map.terrain[ni] as Terrain)) {
            map.terrain[ni] = Terrain.Grass;
            map.heightField[ni] = SEA_LEVEL + 0.02;
          }
          // Clear a little of the canopy for the roadside.
          map.treeDensity[ni] *= falloff === 0 ? 0 : 0.25;
        } else {
          map.elevation[ni] = Math.round(lerp(map.elevation[ni], target, 0.5));
        }
      }
    }
  }
}

/**
 * Deterministic tree placement for a tile. Returns up to three trees with
 * stable sub-tile offsets so foliage never shimmers between frames.
 */
export function treesOnTile(
  map: WorldMap,
  x: number,
  y: number,
): { ox: number; oy: number; scale: number; variant: number }[] {
  const density = map.treeDensity[index(map, x, y)] ?? 0;
  if (density <= 0.02) return [];
  const roll = hash2(x, y, map.seed);
  const count = density > 0.7 ? 3 : density > 0.4 ? 2 : roll < density * 2 ? 1 : 0;
  const trees: { ox: number; oy: number; scale: number; variant: number }[] = [];
  for (let i = 0; i < count; i++) {
    const a = hash2(x * 7 + i, y * 13 + i * 3, map.seed ^ 0x5bf03635);
    const b = hash2(x * 17 + i * 5, y * 29 + i, map.seed ^ 0x1b873593);
    const c = hash2(x + i * 101, y + i * 57, map.seed ^ 0x27d4eb2f);
    trees.push({
      ox: (a - 0.5) * 0.78,
      oy: (b - 0.5) * 0.78,
      scale: 0.78 + c * 0.45,
      variant: Math.floor(c * 4) % 4,
    });
  }
  return trees;
}

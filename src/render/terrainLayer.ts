/**
 * Ground rendering.
 *
 * Terrain is drawn as batched isometric diamonds: every visible tile is
 * visited exactly once, bucketed by class and shade, and each bucket is
 * filled in a single path. That keeps a full screen of Elwynn down to a few
 * dozen draw calls while still giving every tile its own slight variation in
 * colour.
 *
 * The loop is deliberately allocation-free — no points, no rectangles, no
 * closures per tile — because at the widest zoom it runs over the whole
 * valley every frame.
 */
import { ELEVATION_STEP, HALF_HEIGHT, HALF_WIDTH } from './iso';
import { PALETTE, mix, shade, withAlpha } from './palette';
import { Terrain, Zone } from '../sim/types';
import { CityState, PARCEL_SIZE } from '../sim/city';
import { MAX_ELEVATION } from '../sim/terrain';
import { hash2 } from '../core/rng';

/** How many shade steps each terrain class is split into when batching. */
const SHADE_STEPS = 4;
/** Below this zoom the fine detail costs more than it adds. */
export const DETAIL_ZOOM = 0.5;

/** Base colours for each terrain class, dark to light across the shade steps. */
const TERRAIN_RAMPS: Record<number, [string, string]> = {
  [Terrain.DeepWater]: [PALETTE.waterDeep, PALETTE.water],
  [Terrain.ShallowWater]: [PALETTE.water, PALETTE.waterShallow],
  [Terrain.Sand]: [PALETTE.sandDark, PALETTE.sand],
  [Terrain.Grass]: [PALETTE.grassDark, PALETTE.grassLight],
  [Terrain.Meadow]: [PALETTE.grass, PALETTE.meadowLight],
  [Terrain.Forest]: [PALETTE.forestFloorDark, PALETTE.forestFloor],
  [Terrain.Rock]: [PALETTE.rockDark, PALETTE.rockLight],
  [Terrain.Snow]: [PALETTE.snowShade, PALETTE.snow],
};

/** Cliff-face colours, matched to the terrain standing on top of them. */
const CLIFF_COLORS: Record<number, string> = {
  [Terrain.Sand]: PALETTE.sandDark,
  [Terrain.Grass]: PALETTE.dirt,
  [Terrain.Meadow]: PALETTE.dirt,
  [Terrain.Forest]: PALETTE.dirtDark,
  [Terrain.Rock]: PALETTE.rockDark,
  [Terrain.Snow]: PALETTE.rock,
  [Terrain.DeepWater]: PALETTE.waterDeep,
  [Terrain.ShallowWater]: PALETTE.water,
};

/** Every colour a tile top can take, flattened into one lookup. */
const GROUND_COLORS: string[] = [];
/** Cliff colours, one lit and one shaded per terrain class. */
const CLIFF_LIT: string[] = [];
const CLIFF_SHADED: string[] = [];
for (let terrain = 0; terrain <= Terrain.Snow; terrain++) {
  const ramp = TERRAIN_RAMPS[terrain] ?? [PALETTE.grassDark, PALETTE.grassLight];
  for (let step = 0; step < SHADE_STEPS; step++) {
    GROUND_COLORS[terrain * SHADE_STEPS + step] = mix(ramp[0], ramp[1], step / (SHADE_STEPS - 1));
  }
  const cliff = CLIFF_COLORS[terrain] ?? PALETTE.dirt;
  CLIFF_LIT[terrain] = shade(cliff, -0.08);
  CLIFF_SHADED[terrain] = shade(cliff, -0.26);
}

const ZONE_FILL: Record<number, string> = {
  [Zone.Residential]: withAlpha(PALETTE.zoneResidential, 0.42),
  [Zone.Commercial]: withAlpha(PALETTE.zoneCommercial, 0.42),
  [Zone.Industrial]: withAlpha(PALETTE.zoneIndustrial, 0.42),
};
const ZONE_EDGE: Record<number, string> = {
  [Zone.Residential]: withAlpha(PALETTE.zoneResidential, 0.85),
  [Zone.Commercial]: withAlpha(PALETTE.zoneCommercial, 0.85),
  [Zone.Industrial]: withAlpha(PALETTE.zoneIndustrial, 0.85),
};

export interface TileRange {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ViewRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface TerrainDrawOptions {
  /** Seconds since start, for the water shimmer. */
  time: number;
  /** Draw the zoning paint over the ground. */
  showZones: boolean;
  /** Current camera zoom, which decides how much detail is worth drawing. */
  zoom: number;
}

/** Reused path buckets, so a frame allocates nothing per tile. */
const groundPaths: (Path2D | null)[] = [];
const cliffPaths: (Path2D | null)[] = [];
const zonePaths: (Path2D | null)[] = [];
let shorePath: Path2D | null = null;
let unownedPath: Path2D | null = null;

function diamond(path: Path2D, cx: number, cy: number, scale = 1): void {
  const hw = HALF_WIDTH * scale;
  const hh = HALF_HEIGHT * scale;
  path.moveTo(cx, cy - hh);
  path.lineTo(cx + hw, cy);
  path.lineTo(cx, cy + hh);
  path.lineTo(cx - hw, cy);
  path.closePath();
}

/**
 * Paint the ground for every tile in the given range, in a single pass.
 * The context must already carry the camera transform.
 */
export function drawTerrain(
  ctx: CanvasRenderingContext2D,
  city: CityState,
  view: ViewRect,
  range: TileRange,
  options: TerrainDrawOptions,
): void {
  groundPaths.length = 0;
  cliffPaths.length = 0;
  zonePaths.length = 0;
  shorePath = null;
  unownedPath = null;

  const detail = options.zoom >= DETAIL_ZOOM;
  const width = city.width;
  const seed = city.map.seed;
  const elevation = city.map.elevation;
  const terrainData = city.map.terrain;
  const moisture = city.map.moisture;

  // Shimmer needs the water tiles; collected inline to avoid a second pass.
  const shimmerX: number[] = [];
  const shimmerY: number[] = [];

  for (let y = range.y0; y <= range.y1; y++) {
    const rowIndex = y * width;
    for (let x = range.x0; x <= range.x1; x++) {
      const index = rowIndex + x;
      const step = elevation[index];
      const cx = (x - y) * HALF_WIDTH;
      const cy = (x + y) * HALF_HEIGHT - step * ELEVATION_STEP;

      // Inline culling: a rectangle test, no allocation.
      if (cx + HALF_WIDTH < view.left || cx - HALF_WIDTH > view.right) continue;
      if (cy + HALF_HEIGHT + ELEVATION_STEP * 3 < view.top || cy - HALF_HEIGHT - 4 > view.bottom) continue;

      const terrain = terrainData[index];

      // --- cliff faces, for the two sides that can be seen below a tile ---
      if (detail) {
        const southStep = y + 1 <= city.height - 1 ? elevation[index + width] : step;
        const eastStep = x + 1 <= width - 1 ? elevation[index + 1] : step;
        if (step > southStep) {
          let path = cliffPaths[terrain];
          if (!path) {
            path = new Path2D();
            cliffPaths[terrain] = path;
          }
          const drop = (step - southStep) * ELEVATION_STEP;
          path.moveTo(cx - HALF_WIDTH, cy);
          path.lineTo(cx, cy + HALF_HEIGHT);
          path.lineTo(cx, cy + HALF_HEIGHT + drop);
          path.lineTo(cx - HALF_WIDTH, cy + drop);
          path.closePath();
        }
        if (step > eastStep) {
          const shadedIndex = terrain + 16;
          let path = cliffPaths[shadedIndex];
          if (!path) {
            path = new Path2D();
            cliffPaths[shadedIndex] = path;
          }
          const drop = (step - eastStep) * ELEVATION_STEP;
          path.moveTo(cx + HALF_WIDTH, cy);
          path.lineTo(cx, cy + HALF_HEIGHT);
          path.lineTo(cx, cy + HALF_HEIGHT + drop);
          path.lineTo(cx + HALF_WIDTH, cy + drop);
          path.closePath();
        }
      }

      // --- the tile top ---------------------------------------------------
      const variation = hash2(x, y, seed);
      let bucket = Math.floor(
        (variation * 0.55 + moisture[index] * 0.3 + (step / MAX_ELEVATION) * 0.15) * SHADE_STEPS,
      );
      if (bucket < 0) bucket = 0;
      else if (bucket >= SHADE_STEPS) bucket = SHADE_STEPS - 1;

      const key = terrain * SHADE_STEPS + bucket;
      let ground = groundPaths[key];
      if (!ground) {
        ground = new Path2D();
        groundPaths[key] = ground;
      }
      diamond(ground, cx, cy);

      // --- water edges and glints ------------------------------------------
      if (terrain <= Terrain.ShallowWater) {
        if (detail) {
          const landward =
            (x > 0 && terrainData[index - 1] > Terrain.ShallowWater) ||
            (x < width - 1 && terrainData[index + 1] > Terrain.ShallowWater) ||
            (y > 0 && terrainData[index - width] > Terrain.ShallowWater) ||
            (y < city.height - 1 && terrainData[index + width] > Terrain.ShallowWater);
          if (landward) {
            if (!shorePath) shorePath = new Path2D();
            diamond(shorePath, cx, cy);
          }
          shimmerX.push(cx);
          shimmerY.push(cy);
        }
      }

      // --- land the city does not hold --------------------------------------
      const parcel = city.parcels[Math.floor(y / PARCEL_SIZE) * city.parcelsWide + Math.floor(x / PARCEL_SIZE)];
      if (!parcel?.owned) {
        if (!unownedPath) unownedPath = new Path2D();
        diamond(unownedPath, cx, cy);
      }

      // --- zoning paint, where nothing has been built yet --------------------
      if (options.showZones) {
        const zone = city.zones[index];
        if (zone !== Zone.None && city.buildingAt[index] < 0) {
          let path = zonePaths[zone];
          if (!path) {
            path = new Path2D();
            zonePaths[zone] = path;
          }
          diamond(path, cx, cy, 0.82);
        }
      }
    }
  }

  // --- one fill per bucket ------------------------------------------------
  for (let i = 0; i < cliffPaths.length; i++) {
    const path = cliffPaths[i];
    if (!path) continue;
    ctx.fillStyle = i >= 16 ? CLIFF_SHADED[i - 16] : CLIFF_LIT[i];
    ctx.fill(path);
  }
  for (let i = 0; i < groundPaths.length; i++) {
    const path = groundPaths[i];
    if (!path) continue;
    ctx.fillStyle = GROUND_COLORS[i];
    ctx.fill(path);
  }
  if (shorePath) {
    ctx.fillStyle = withAlpha(PALETTE.waterShallow, 0.55);
    ctx.fill(shorePath);
  }
  if (detail && shimmerX.length > 0) drawWaterShimmer(ctx, shimmerX, shimmerY, options.time, seed);
  if (unownedPath) {
    ctx.fillStyle = 'rgba(28, 34, 56, 0.2)';
    ctx.fill(unownedPath);
  }
  for (let i = 0; i < zonePaths.length; i++) {
    const path = zonePaths[i];
    if (!path) continue;
    ctx.fillStyle = ZONE_FILL[i];
    ctx.fill(path);
    // Stroking thousands of subpaths is expensive, and the outline adds
    // nothing once each plot is a few pixels across.
    if (detail) {
      ctx.strokeStyle = ZONE_EDGE[i];
      ctx.lineWidth = 1.4;
      ctx.stroke(path);
    }
  }
}

/** Slow, cheap highlights drifting across the water. */
function drawWaterShimmer(
  ctx: CanvasRenderingContext2D,
  xs: number[],
  ys: number[],
  time: number,
  seed: number,
): void {
  ctx.strokeStyle = withAlpha(PALETTE.waterFoam, 0.3);
  ctx.lineWidth = 2;
  ctx.beginPath();
  let any = false;
  for (let i = 0; i < xs.length; i++) {
    const phase = hash2(Math.round(xs[i]), Math.round(ys[i]), seed ^ 91) * Math.PI * 2;
    const wobble = Math.sin(time * 1.3 + phase);
    // Only about a third of tiles carry a glint at any moment.
    if (wobble < 0.45) continue;
    const offset = Math.cos(time * 0.9 + phase) * 7;
    ctx.moveTo(xs[i] - 9 + offset, ys[i]);
    ctx.lineTo(xs[i] + 4 + offset, ys[i] - 2);
    any = true;
  }
  if (any) ctx.stroke();
}

/** Outline one tile, for cursors and build previews. */
export function strokeTile(
  ctx: CanvasRenderingContext2D,
  city: CityState,
  x: number,
  y: number,
  color: string,
  lineWidth = 2,
  fill?: string,
): void {
  if (x < 0 || y < 0 || x >= city.width || y >= city.height) return;
  const step = city.map.elevation[y * city.width + x];
  const cx = (x - y) * HALF_WIDTH;
  const cy = (x + y) * HALF_HEIGHT - step * ELEVATION_STEP;
  ctx.beginPath();
  ctx.moveTo(cx, cy - HALF_HEIGHT);
  ctx.lineTo(cx + HALF_WIDTH, cy);
  ctx.lineTo(cx, cy + HALF_HEIGHT);
  ctx.lineTo(cx - HALF_WIDTH, cy);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

/** Outline a rectangle of tiles as one region, for parcels and footprints. */
export function strokeTileRect(
  ctx: CanvasRenderingContext2D,
  city: CityState,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  lineWidth = 2,
  fill?: string,
): void {
  const cx = Math.min(city.width - 1, Math.max(0, x));
  const cy = Math.min(city.height - 1, Math.max(0, y));
  const step = city.map.elevation[cy * city.width + cx];
  const lift = step * ELEVATION_STEP;
  const project = (tx: number, ty: number) => ({
    x: (tx - ty) * HALF_WIDTH,
    y: (tx + ty) * HALF_HEIGHT - lift,
  });

  const north = project(x, y);
  const east = project(x + width - 1, y);
  const south = project(x + width - 1, y + height - 1);
  const west = project(x, y + height - 1);

  ctx.beginPath();
  ctx.moveTo(north.x, north.y - HALF_HEIGHT);
  ctx.lineTo(east.x + HALF_WIDTH, east.y);
  ctx.lineTo(south.x, south.y + HALF_HEIGHT);
  ctx.lineTo(west.x - HALF_WIDTH, west.y);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

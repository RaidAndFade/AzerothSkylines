/**
 * Ground rendering.
 *
 * Terrain is drawn as batched isometric diamonds: tiles are bucketed by
 * class and shade, and each bucket is filled in a single path. That keeps
 * a full screen of Elwynn down to a few dozen draw calls while still
 * giving every tile its own slight variation in colour.
 */
import { ELEVATION_STEP, HALF_HEIGHT, HALF_WIDTH, tileToWorld } from './iso';
import { PALETTE, mix, shade, withAlpha } from './palette';
import { Terrain, Zone, isWater } from '../sim/types';
import { CityState, tileIndex } from '../sim/city';
import { MAX_ELEVATION } from '../sim/terrain';
import { hash2 } from '../core/rng';
import { Camera } from './camera';

/** How many shade steps each terrain class is split into when batching. */
const SHADE_STEPS = 4;

/** Base colours for each terrain class, light to dark across the shade steps. */
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

/** Resolve the ramp colour for a terrain class at a given shade step. */
function rampColor(terrain: Terrain, step: number): string {
  const ramp = TERRAIN_RAMPS[terrain] ?? [PALETTE.grassDark, PALETTE.grassLight];
  return mix(ramp[0], ramp[1], step / (SHADE_STEPS - 1));
}

const rampCache = new Map<number, string>();
function cachedRamp(terrain: Terrain, step: number): string {
  const key = terrain * SHADE_STEPS + step;
  const existing = rampCache.get(key);
  if (existing) return existing;
  const color = rampColor(terrain, step);
  rampCache.set(key, color);
  return color;
}

export interface TerrainDrawOptions {
  /** Seconds since start, for the water shimmer. */
  time: number;
  /** Draw the zoning paint over the ground. */
  showZones: boolean;
  /** Tint tiles the city does not own. */
  showOwnership: boolean;
}

/**
 * Paint the ground for every tile in the given range.
 * The context must already carry the camera transform.
 */
export function drawTerrain(
  ctx: CanvasRenderingContext2D,
  city: CityState,
  camera: Camera,
  range: { x0: number; y0: number; x1: number; y1: number },
  options: TerrainDrawOptions,
): void {
  const buckets = new Map<string, Path2D>();
  const cliffs = new Map<string, Path2D>();
  const waterTiles: { x: number; y: number }[] = [];

  const addTo = (map: Map<string, Path2D>, color: string): Path2D => {
    let path = map.get(color);
    if (!path) {
      path = new Path2D();
      map.set(color, path);
    }
    return path;
  };

  for (let y = range.y0; y <= range.y1; y++) {
    for (let x = range.x0; x <= range.x1; x++) {
      const index = tileIndex(city, x, y);
      const terrain = city.map.terrain[index] as Terrain;
      const elevation = city.map.elevation[index];
      const centre = tileToWorld(x, y, elevation);

      if (!camera.isVisible(centre.x - HALF_WIDTH, centre.y - HALF_HEIGHT - 4, centre.x + HALF_WIDTH, centre.y + HALF_HEIGHT + ELEVATION_STEP * 3)) {
        continue;
      }

      // Cliff faces first: the two sides that can be seen below a tile.
      const southElevation = y + 1 <= city.height - 1 ? city.map.elevation[tileIndex(city, x, y + 1)] : elevation;
      const eastElevation = x + 1 <= city.width - 1 ? city.map.elevation[tileIndex(city, x + 1, y)] : elevation;
      const drop = Math.max(elevation - southElevation, elevation - eastElevation);
      if (drop > 0) {
        const cliffBase = CLIFF_COLORS[terrain] ?? PALETTE.dirt;
        if (elevation > southElevation) {
          const path = addTo(cliffs, shade(cliffBase, -0.08));
          const height = (elevation - southElevation) * ELEVATION_STEP;
          path.moveTo(centre.x - HALF_WIDTH, centre.y);
          path.lineTo(centre.x, centre.y + HALF_HEIGHT);
          path.lineTo(centre.x, centre.y + HALF_HEIGHT + height);
          path.lineTo(centre.x - HALF_WIDTH, centre.y + height);
          path.closePath();
        }
        if (elevation > eastElevation) {
          const path = addTo(cliffs, shade(cliffBase, -0.26));
          const height = (elevation - eastElevation) * ELEVATION_STEP;
          path.moveTo(centre.x + HALF_WIDTH, centre.y);
          path.lineTo(centre.x, centre.y + HALF_HEIGHT);
          path.lineTo(centre.x, centre.y + HALF_HEIGHT + height);
          path.lineTo(centre.x + HALF_WIDTH, centre.y + height);
          path.closePath();
        }
      }

      // The tile top.
      const variation = hash2(x, y, city.map.seed);
      const moisture = city.map.moisture[index];
      const step = Math.min(
        SHADE_STEPS - 1,
        Math.max(0, Math.floor((variation * 0.55 + moisture * 0.3 + (elevation / MAX_ELEVATION) * 0.15) * SHADE_STEPS)),
      );
      const color = cachedRamp(terrain, step);
      const path = addTo(buckets, color);
      path.moveTo(centre.x, centre.y - HALF_HEIGHT);
      path.lineTo(centre.x + HALF_WIDTH, centre.y);
      path.lineTo(centre.x, centre.y + HALF_HEIGHT);
      path.lineTo(centre.x - HALF_WIDTH, centre.y);
      path.closePath();

      if (isWater(terrain)) waterTiles.push({ x, y });
    }
  }

  for (const [color, path] of cliffs) {
    ctx.fillStyle = color;
    ctx.fill(path);
  }
  for (const [color, path] of buckets) {
    ctx.fillStyle = color;
    ctx.fill(path);
  }

  drawShoreline(ctx, city, range);
  drawWaterShimmer(ctx, waterTiles, options.time);

  if (options.showOwnership) drawUnownedTint(ctx, city, range);
  if (options.showZones) drawZonePaint(ctx, city, range);
}

/** A pale rim where water meets land, which reads as shallows and foam. */
function drawShoreline(
  ctx: CanvasRenderingContext2D,
  city: CityState,
  range: { x0: number; y0: number; x1: number; y1: number },
): void {
  const path = new Path2D();
  let any = false;
  for (let y = range.y0; y <= range.y1; y++) {
    for (let x = range.x0; x <= range.x1; x++) {
      const index = tileIndex(city, x, y);
      if (!isWater(city.map.terrain[index] as Terrain)) continue;
      let touchesLand = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= city.width || ny >= city.height) continue;
        if (!isWater(city.map.terrain[tileIndex(city, nx, ny)] as Terrain)) {
          touchesLand = true;
          break;
        }
      }
      if (!touchesLand) continue;
      any = true;
      const centre = tileToWorld(x, y, 0);
      path.moveTo(centre.x, centre.y - HALF_HEIGHT);
      path.lineTo(centre.x + HALF_WIDTH, centre.y);
      path.lineTo(centre.x, centre.y + HALF_HEIGHT);
      path.lineTo(centre.x - HALF_WIDTH, centre.y);
      path.closePath();
    }
  }
  if (!any) return;
  ctx.fillStyle = withAlpha(PALETTE.waterShallow, 0.55);
  ctx.fill(path);
}

/** Slow, cheap highlights drifting across the water. */
function drawWaterShimmer(
  ctx: CanvasRenderingContext2D,
  tiles: { x: number; y: number }[],
  time: number,
): void {
  if (tiles.length === 0) return;
  ctx.strokeStyle = withAlpha(PALETTE.waterFoam, 0.3);
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const tile of tiles) {
    const phase = hash2(tile.x, tile.y, 91) * Math.PI * 2;
    const wobble = Math.sin(time * 1.3 + phase);
    // Only about a third of tiles carry a glint at any moment.
    if (wobble < 0.45) continue;
    const centre = tileToWorld(tile.x, tile.y, 0);
    const offset = Math.cos(time * 0.9 + phase) * 7;
    ctx.moveTo(centre.x - 9 + offset, centre.y);
    ctx.lineTo(centre.x + 4 + offset, centre.y - 2);
  }
  ctx.stroke();
}

/** Land beyond the city's holdings is drawn cooler and flatter. */
function drawUnownedTint(
  ctx: CanvasRenderingContext2D,
  city: CityState,
  range: { x0: number; y0: number; x1: number; y1: number },
): void {
  const path = new Path2D();
  let any = false;
  for (let y = range.y0; y <= range.y1; y++) {
    for (let x = range.x0; x <= range.x1; x++) {
      const parcel = city.parcels[
        Math.floor(y / 8) * city.parcelsWide + Math.floor(x / 8)
      ];
      if (parcel?.owned) continue;
      any = true;
      const centre = tileToWorld(x, y, city.map.elevation[tileIndex(city, x, y)]);
      path.moveTo(centre.x, centre.y - HALF_HEIGHT);
      path.lineTo(centre.x + HALF_WIDTH, centre.y);
      path.lineTo(centre.x, centre.y + HALF_HEIGHT);
      path.lineTo(centre.x - HALF_WIDTH, centre.y);
      path.closePath();
    }
  }
  if (!any) return;
  ctx.fillStyle = 'rgba(28, 34, 56, 0.2)';
  ctx.fill(path);
}

const ZONE_COLORS: Record<number, string> = {
  [Zone.Residential]: PALETTE.zoneResidential,
  [Zone.Commercial]: PALETTE.zoneCommercial,
  [Zone.Industrial]: PALETTE.zoneIndustrial,
};

/** Zoning paint, drawn as a translucent wash with a bright border. */
function drawZonePaint(
  ctx: CanvasRenderingContext2D,
  city: CityState,
  range: { x0: number; y0: number; x1: number; y1: number },
): void {
  const fills = new Map<number, Path2D>();
  for (let y = range.y0; y <= range.y1; y++) {
    for (let x = range.x0; x <= range.x1; x++) {
      const index = tileIndex(city, x, y);
      const zone = city.zones[index] as Zone;
      if (zone === Zone.None) continue;
      // Once a building stands on it, the paint has done its job.
      if (city.buildingAt[index] >= 0) continue;
      let path = fills.get(zone);
      if (!path) {
        path = new Path2D();
        fills.set(zone, path);
      }
      const centre = tileToWorld(x, y, city.map.elevation[index]);
      const inset = 0.82;
      path.moveTo(centre.x, centre.y - HALF_HEIGHT * inset);
      path.lineTo(centre.x + HALF_WIDTH * inset, centre.y);
      path.lineTo(centre.x, centre.y + HALF_HEIGHT * inset);
      path.lineTo(centre.x - HALF_WIDTH * inset, centre.y);
      path.closePath();
    }
  }
  for (const [zone, path] of fills) {
    ctx.fillStyle = withAlpha(ZONE_COLORS[zone] ?? PALETTE.grass, 0.42);
    ctx.fill(path);
    ctx.strokeStyle = withAlpha(ZONE_COLORS[zone] ?? PALETTE.grass, 0.85);
    ctx.lineWidth = 1.4;
    ctx.stroke(path);
  }
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
  const elevation = city.map.elevation[tileIndex(city, x, y)];
  const centre = tileToWorld(x, y, elevation);
  ctx.beginPath();
  ctx.moveTo(centre.x, centre.y - HALF_HEIGHT);
  ctx.lineTo(centre.x + HALF_WIDTH, centre.y);
  ctx.lineTo(centre.x, centre.y + HALF_HEIGHT);
  ctx.lineTo(centre.x - HALF_WIDTH, centre.y);
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
  const elevation = city.map.elevation[tileIndex(city, Math.min(city.width - 1, x), Math.min(city.height - 1, y))];
  const north = tileToWorld(x, y, elevation);
  const east = tileToWorld(x + width - 1, y, elevation);
  const south = tileToWorld(x + width - 1, y + height - 1, elevation);
  const west = tileToWorld(x, y + height - 1, elevation);

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

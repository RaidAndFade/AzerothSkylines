/**
 * Ground rendering.
 *
 * The valley's colour is baked once into a map-space field (see
 * `groundTexture.ts`). Here it is painted onto the screen: the visible
 * tiles are grouped into the largest possible rectangles of level ground,
 * and each rectangle is drawn with a single affine transform that maps its
 * square of the field onto its diamond on screen. Because the field is
 * interpolated, colour runs continuously across tile boundaries — there is
 * no grid to see.
 *
 * Cliff faces, shoreline foam, brushed grain and the zoning overlay are
 * drawn on top.
 */
import { ELEVATION_STEP, HALF_HEIGHT, HALF_WIDTH } from './iso';
import { PALETTE, withAlpha } from './palette';
import { light } from './light';
import { CLIFF_BASE, GroundField } from './groundTexture';
import { Terrain, Zone } from '../sim/types';
import { CityState, PARCEL_SIZE } from '../sim/city';
import { hash2 } from '../core/rng';
import { drawRoads } from './roadLayer';

/** Below this zoom the fine detail costs more than it adds. */
export const DETAIL_ZOOM = 0.5;
/** Above this zoom, individual blades and pebbles are worth drawing. */
export const FLORA_ZOOM = 0.95;

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
  time: number;
  zonePaint: ZonePaint;
  zoom: number;
}

/** A run of tiles all at the same height, drawn as one image. */
interface LevelPatch {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  elevation: number;
}

const visited = new Map<number, Uint8Array>();
const patches: LevelPatch[] = [];
const zoneFills: (Path2D | null)[] = [];
const zoneEdges: (Path2D | null)[] = [];
let grainPattern: CanvasPattern | null = null;
let grainSource: HTMLCanvasElement | null = null;

/**
 * How loudly the zoning overlay is painted.
 *
 * `full` is for the moment the player is actually drawing districts, when
 * the zone is the only thing they are looking at. `ambient` is the whisper
 * of tint that persists the rest of the time: enough to say "this yard is
 * dwellings", faint enough that the baked ground colour and the grain
 * underneath still read through it.
 */
export type ZonePaint = 'hidden' | 'ambient' | 'full';

/** Tiles are drawn a shade over size so neighbours leave no seam. */
const ZONE_OVERDRAW = 1.02;

/**
 * The band that fades inward from a district's edge, in world pixels. Two
 * strokes of the same colour, clipped to the region, so the tint gathers at
 * the boundary and thins out towards the middle — a plan drawing rather
 * than a slab of paint.
 */
const ZONE_BAND_WIDTHS = [HALF_HEIGHT * 3, HALF_HEIGHT * 1.2];

interface ZoneStyle {
  fill: string;
  edge: string;
  band: string;
  lineWidth: number;
}

const ZONE_COLOURS: Record<number, string> = {
  [Zone.Residential]: PALETTE.zoneResidential,
  [Zone.Commercial]: PALETTE.zoneCommercial,
  [Zone.Industrial]: PALETTE.zoneIndustrial,
};

function zoneStyles(fill: number, edge: number, band: number, lineWidth: number): (ZoneStyle | null)[] {
  const styles: (ZoneStyle | null)[] = [];
  for (const zone of [Zone.Residential, Zone.Commercial, Zone.Industrial]) {
    const colour = ZONE_COLOURS[zone];
    styles[zone] = {
      fill: withAlpha(colour, fill),
      edge: withAlpha(colour, edge),
      band: withAlpha(colour, band),
      lineWidth,
    };
  }
  return styles;
}

const ZONE_STYLES: Record<Exclude<ZonePaint, 'hidden'>, (ZoneStyle | null)[]> = {
  ambient: zoneStyles(0.09, 0.5, 0.1, 2),
  full: zoneStyles(0.2, 0.9, 0.16, 3),
};

/** Paint the ground for every tile in range. The camera transform is live. */
export function drawTerrain(
  ctx: CanvasRenderingContext2D,
  city: CityState,
  field: GroundField,
  view: ViewRect,
  range: TileRange,
  options: TerrainDrawOptions,
): void {
  const detail = options.zoom >= DETAIL_ZOOM;

  collectLevelPatches(city, range);
  drawGroundPatches(ctx, field);
  if (detail) drawCliffs(ctx, city, view, range);
  // Grain is a full-screen textured fill; from far away it is not worth it.
  if (detail) drawGrain(ctx, field, view);
  drawRoads(ctx, city, view, range, options.zoom);
  if (detail) {
    drawShoreline(ctx, city, view, range, options.time);
    drawWaterSheen(ctx, city, view, range, options.time);
  }
  drawUnowned(ctx, city, view, range);
  if (options.zonePaint !== 'hidden') drawZones(ctx, city, view, range, detail, options.zonePaint);
}

/**
 * Greedy-mesh the visible tiles into maximal rectangles of equal height.
 * On the valley floor this collapses thousands of tiles into a handful of
 * images, and it means level ground is drawn without any internal seams.
 */
function collectLevelPatches(city: CityState, range: TileRange): void {
  patches.length = 0;
  const width = range.x1 - range.x0 + 1;
  const height = range.y1 - range.y0 + 1;
  if (width <= 0 || height <= 0) return;

  const size = width * height;
  let seen = visited.get(size);
  if (!seen) {
    seen = new Uint8Array(size);
    visited.set(size, seen);
    // One scratch buffer per viewport size is plenty; drop any others.
    if (visited.size > 4) {
      for (const key of visited.keys()) {
        if (key !== size) {
          visited.delete(key);
          break;
        }
      }
    }
  }
  seen.fill(0);

  const elevation = city.map.elevation;
  const mapWidth = city.width;

  for (let ly = 0; ly < height; ly++) {
    for (let lx = 0; lx < width; lx++) {
      const local = ly * width + lx;
      if (seen[local]) continue;
      const x = range.x0 + lx;
      const y = range.y0 + ly;
      const step = elevation[y * mapWidth + x];

      // Extend right while the height holds.
      let runWidth = 1;
      while (
        lx + runWidth < width &&
        !seen[local + runWidth] &&
        elevation[y * mapWidth + x + runWidth] === step
      ) {
        runWidth++;
      }

      // Then extend down while every tile of the next row matches.
      let runHeight = 1;
      outer: while (ly + runHeight < height) {
        const rowBase = (ly + runHeight) * width + lx;
        for (let i = 0; i < runWidth; i++) {
          if (seen[rowBase + i]) break outer;
          if (elevation[(y + runHeight) * mapWidth + x + i] !== step) break outer;
        }
        runHeight++;
      }

      for (let dy = 0; dy < runHeight; dy++) {
        seen.fill(1, (ly + dy) * width + lx, (ly + dy) * width + lx + runWidth);
      }
      patches.push({ x0: x, y0: y, x1: x + runWidth - 1, y1: y + runHeight - 1, elevation: step });
    }
  }

  // Painter's order: ground furthest from the camera first.
  patches.sort((a, b) => a.x0 + a.y0 - (b.x0 + b.y0));
}

/**
 * Draw each patch by mapping its square of the colour field onto its
 * diamond. The transform takes map space straight to screen space, so one
 * call covers however many tiles the patch holds.
 */
function drawGroundPatches(ctx: CanvasRenderingContext2D, field: GroundField): void {
  const scale = field.scale;
  const a = HALF_WIDTH / scale;
  const b = HALF_HEIGHT / scale;

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  // The field was baked with high-quality interpolation and is already
  // smooth, so bilinear here costs a fraction of the time and looks the same.
  ctx.imageSmoothingQuality = 'low';
  // The camera transform, to compose each patch's mapping onto.
  const camera = ctx.getTransform();

  for (const patch of patches) {
    const sx = patch.x0 * scale;
    const sy = patch.y0 * scale;
    const sw = (patch.x1 - patch.x0 + 1) * scale;
    const sh = (patch.y1 - patch.y0 + 1) * scale;

    // Map field pixel (px, py) to ((px - py) * a, (px + py) * b), lifted by
    // the patch's height and shifted so a tile's centre lands where the rest
    // of the renderer expects it.
    ctx.setTransform(camera);
    ctx.transform(a, b, -a, b, 0, -HALF_HEIGHT - patch.elevation * ELEVATION_STEP);
    // A hair of overlap hides any seam between neighbouring patches.
    ctx.drawImage(field.canvas, sx, sy, sw, sh, sx, sy, sw + 0.6, sh + 0.6);
  }
  ctx.restore();
}

/** The two sides of a tile that show when the ground drops away below it. */
function drawCliffs(
  ctx: CanvasRenderingContext2D,
  city: CityState,
  view: ViewRect,
  range: TileRange,
): void {
  const width = city.width;
  const elevation = city.map.elevation;
  const terrain = city.map.terrain;
  const lit = new Map<string, Path2D>();

  for (let y = range.y0; y <= range.y1; y++) {
    for (let x = range.x0; x <= range.x1; x++) {
      const index = y * width + x;
      const step = elevation[index];
      const south = y + 1 <= city.height - 1 ? elevation[index + width] : step;
      const east = x + 1 <= width - 1 ? elevation[index + 1] : step;
      if (step <= south && step <= east) continue;

      const cx = (x - y) * HALF_WIDTH;
      const cy = (x + y) * HALF_HEIGHT - step * ELEVATION_STEP;
      if (cx + HALF_WIDTH < view.left || cx - HALF_WIDTH > view.right) continue;
      if (cy > view.bottom + 200 || cy + 260 < view.top) continue;

      const base = CLIFF_BASE[terrain[index]] ?? '#8A7048';

      if (step > south) {
        const key = `${base}|l`;
        let path = lit.get(key);
        if (!path) {
          path = new Path2D();
          lit.set(key, path);
        }
        const drop = (step - south) * ELEVATION_STEP;
        path.moveTo(cx - HALF_WIDTH, cy);
        path.lineTo(cx, cy + HALF_HEIGHT);
        path.lineTo(cx, cy + HALF_HEIGHT + drop);
        path.lineTo(cx - HALF_WIDTH, cy + drop);
        path.closePath();
      }
      if (step > east) {
        const key = `${base}|r`;
        let path = lit.get(key);
        if (!path) {
          path = new Path2D();
          lit.set(key, path);
        }
        const drop = (step - east) * ELEVATION_STEP;
        path.moveTo(cx + HALF_WIDTH, cy);
        path.lineTo(cx, cy + HALF_HEIGHT);
        path.lineTo(cx, cy + HALF_HEIGHT + drop);
        path.lineTo(cx + HALF_WIDTH, cy + drop);
        path.closePath();
      }
    }
  }

  for (const [key, path] of lit) {
    const [base, side] = key.split('|');
    ctx.fillStyle = light(base, side === 'l' ? 'left' : 'right');
    ctx.fill(path);
  }
}

/**
 * Brushed grain over the whole ground, anchored in world space so it moves
 * with the map rather than swimming across it.
 */
function drawGrain(ctx: CanvasRenderingContext2D, field: GroundField, view: ViewRect): void {
  if (grainSource !== field.grain || !grainPattern) {
    grainPattern = ctx.createPattern(field.grain, 'repeat');
    grainSource = field.grain;
  }
  if (!grainPattern) return;

  ctx.save();
  ctx.globalAlpha = 0.52;
  ctx.fillStyle = grainPattern;
  ctx.fillRect(view.left, view.top, view.right - view.left, view.bottom - view.top);
  ctx.restore();
}

/** Wet sand and a line of foam where the water meets the land. */
function drawShoreline(
  ctx: CanvasRenderingContext2D,
  city: CityState,
  view: ViewRect,
  range: TileRange,
  time: number,
): void {
  const width = city.width;
  const terrain = city.map.terrain;
  const foam = new Path2D();
  const wet = new Path2D();
  let any = false;

  for (let y = range.y0; y <= range.y1; y++) {
    for (let x = range.x0; x <= range.x1; x++) {
      const index = y * width + x;
      if (terrain[index] > Terrain.ShallowWater) continue;
      let landward = false;
      if (x > 0 && terrain[index - 1] > Terrain.ShallowWater) landward = true;
      else if (x < width - 1 && terrain[index + 1] > Terrain.ShallowWater) landward = true;
      else if (y > 0 && terrain[index - width] > Terrain.ShallowWater) landward = true;
      else if (y < city.height - 1 && terrain[index + width] > Terrain.ShallowWater) landward = true;
      if (!landward) continue;

      const cx = (x - y) * HALF_WIDTH;
      const cy = (x + y) * HALF_HEIGHT;
      if (cx + HALF_WIDTH < view.left || cx - HALF_WIDTH > view.right) continue;
      if (cy + HALF_HEIGHT < view.top || cy - HALF_HEIGHT > view.bottom) continue;
      any = true;

      // The wet band sits inside the tile; the foam breathes in and out.
      const swell = 0.62 + Math.sin(time * 0.9 + hash2(x, y, 3) * 6.28) * 0.14;
      addDiamond(wet, cx, cy, 0.96);
      addDiamond(foam, cx, cy, swell);
    }
  }
  if (!any) return;

  ctx.fillStyle = withAlpha('#4FA8C8', 0.4);
  ctx.fill(wet);
  ctx.fillStyle = withAlpha('#DFF3F6', 0.3);
  ctx.fill(foam);
}

/** A slow sheen sliding over open water. */
function drawWaterSheen(
  ctx: CanvasRenderingContext2D,
  city: CityState,
  view: ViewRect,
  range: TileRange,
  time: number,
): void {
  const width = city.width;
  const terrain = city.map.terrain;
  ctx.save();
  ctx.strokeStyle = withAlpha('#CFEDF3', 0.22);
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  let any = false;

  for (let y = range.y0; y <= range.y1; y += 1) {
    for (let x = range.x0; x <= range.x1; x += 1) {
      const index = y * width + x;
      if (terrain[index] > Terrain.ShallowWater) continue;
      const phase = hash2(x, y, 91) * Math.PI * 2;
      const wobble = Math.sin(time * 1.1 + phase);
      if (wobble < 0.55) continue;
      const cx = (x - y) * HALF_WIDTH;
      const cy = (x + y) * HALF_HEIGHT;
      if (cx < view.left - 40 || cx > view.right + 40) continue;
      if (cy < view.top - 40 || cy > view.bottom + 40) continue;
      const drift = Math.cos(time * 0.7 + phase) * 8;
      ctx.moveTo(cx - 11 + drift, cy + 1);
      ctx.lineTo(cx + 3 + drift, cy - 2);
      any = true;
    }
  }
  if (any) ctx.stroke();
  ctx.restore();
}

/** Land beyond the city's holdings reads cooler and a little further off. */
function drawUnowned(
  ctx: CanvasRenderingContext2D,
  city: CityState,
  view: ViewRect,
  range: TileRange,
): void {
  const path = new Path2D();
  let any = false;
  for (let y = range.y0; y <= range.y1; y++) {
    const parcelRow = Math.floor(y / PARCEL_SIZE) * city.parcelsWide;
    for (let x = range.x0; x <= range.x1; x++) {
      if (city.parcels[parcelRow + Math.floor(x / PARCEL_SIZE)]?.owned) continue;
      const cx = (x - y) * HALF_WIDTH;
      const cy = (x + y) * HALF_HEIGHT - city.map.elevation[y * city.width + x] * ELEVATION_STEP;
      if (cx + HALF_WIDTH < view.left || cx - HALF_WIDTH > view.right) continue;
      if (cy + HALF_HEIGHT < view.top || cy - HALF_HEIGHT > view.bottom) continue;
      addDiamond(path, cx, cy, 1.02);
      any = true;
    }
  }
  if (!any) return;
  ctx.fillStyle = 'rgba(30, 42, 70, 0.16)';
  ctx.fill(path);
}

/**
 * The zoning overlay: a tinted region per zone, outlined along its true
 * outer boundary.
 *
 * Only the edges that face out of a district are stroked, so the outline
 * traces the region itself and the tile grid inside it is never drawn.
 */
function drawZones(
  ctx: CanvasRenderingContext2D,
  city: CityState,
  view: ViewRect,
  range: TileRange,
  detail: boolean,
  paint: Exclude<ZonePaint, 'hidden'>,
): void {
  zoneFills.length = 0;
  zoneEdges.length = 0;
  const width = city.width;
  for (let y = range.y0; y <= range.y1; y++) {
    for (let x = range.x0; x <= range.x1; x++) {
      const index = y * width + x;
      const zone = city.zones[index];
      if (zone === Zone.None || city.buildingAt[index] >= 0) continue;
      const step = city.map.elevation[index];
      const cx = (x - y) * HALF_WIDTH;
      const cy = (x + y) * HALF_HEIGHT - step * ELEVATION_STEP;
      if (cx + HALF_WIDTH < view.left || cx - HALF_WIDTH > view.right) continue;
      if (cy + HALF_HEIGHT < view.top || cy - HALF_HEIGHT > view.bottom) continue;
      let fill = zoneFills[zone];
      if (!fill) {
        fill = new Path2D();
        zoneFills[zone] = fill;
      }
      addDiamond(fill, cx, cy, ZONE_OVERDRAW);
      if (!detail) continue;
      let edge = zoneEdges[zone];
      if (!edge) {
        edge = new Path2D();
        zoneEdges[zone] = edge;
      }
      addZoneBoundary(edge, city, x, y, zone, step, cx, cy);
    }
  }

  // Saved as a block: the band strokes leave a round line cap behind, and
  // everything drawn after the ground expects the default.
  ctx.save();
  for (let zone = 0; zone < zoneFills.length; zone++) {
    const fill = zoneFills[zone];
    const style = ZONE_STYLES[paint][zone];
    if (!fill || !style) continue;
    ctx.fillStyle = style.fill;
    ctx.fill(fill);

    const edge = zoneEdges[zone];
    if (!edge) continue;
    // The band strokes straddle the boundary; clipping to the region throws
    // away their outer halves and leaves a soft fade inwards.
    ctx.save();
    ctx.clip(fill);
    ctx.strokeStyle = style.band;
    ctx.lineCap = 'round';
    for (const bandWidth of ZONE_BAND_WIDTHS) {
      ctx.lineWidth = bandWidth;
      ctx.stroke(edge);
    }
    ctx.restore();

    ctx.strokeStyle = style.edge;
    ctx.lineWidth = style.lineWidth;
    ctx.lineCap = 'round';
    ctx.stroke(edge);
  }
  ctx.restore();
}

/**
 * Whether a neighbouring tile belongs to the same painted region: same zone,
 * still unbuilt, and at the same height, since tiles on different steps do
 * not share a screen edge to hide.
 */
export function inZoneRegion(city: CityState, x: number, y: number, zone: Zone, elevation: number): boolean {
  if (x < 0 || y < 0 || x >= city.width || y >= city.height) return false;
  const index = y * city.width + x;
  return city.zones[index] === zone && city.buildingAt[index] < 0 && city.map.elevation[index] === elevation;
}

/**
 * Add the edges of one tile's diamond that face out of its region. Tile +x
 * lies down-right on screen and tile +y down-left, so each neighbour owns
 * exactly one of the four edges.
 */
function addZoneBoundary(
  path: Path2D,
  city: CityState,
  x: number,
  y: number,
  zone: Zone,
  elevation: number,
  cx: number,
  cy: number,
): void {
  const hw = HALF_WIDTH * ZONE_OVERDRAW;
  const hh = HALF_HEIGHT * ZONE_OVERDRAW;
  const top = cy - hh;
  const bottom = cy + hh;
  const left = cx - hw;
  const right = cx + hw;
  if (!inZoneRegion(city, x, y - 1, zone, elevation)) {
    path.moveTo(cx, top);
    path.lineTo(right, cy);
  }
  if (!inZoneRegion(city, x + 1, y, zone, elevation)) {
    path.moveTo(right, cy);
    path.lineTo(cx, bottom);
  }
  if (!inZoneRegion(city, x, y + 1, zone, elevation)) {
    path.moveTo(cx, bottom);
    path.lineTo(left, cy);
  }
  if (!inZoneRegion(city, x - 1, y, zone, elevation)) {
    path.moveTo(left, cy);
    path.lineTo(cx, top);
  }
}

function addDiamond(path: Path2D, cx: number, cy: number, scale: number): void {
  const hw = HALF_WIDTH * scale;
  const hh = HALF_HEIGHT * scale;
  path.moveTo(cx, cy - hh);
  path.lineTo(cx + hw, cy);
  path.lineTo(cx, cy + hh);
  path.lineTo(cx - hw, cy);
  path.closePath();
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
  const lift = city.map.elevation[cy * city.width + cx] * ELEVATION_STEP;
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

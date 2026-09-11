/**
 * Streets.
 *
 * Drawing a sprite per tile put the grid back on screen: every tile edge
 * showed as a seam and every kerb ran straight through the middle of the
 * road. Instead all the streets of one class are collected into a single
 * path and filled with one world-anchored material, so the cobbles run
 * unbroken from one end of a street to the other and the kerb appears only
 * along the true outside edge of the network.
 */
import { ELEVATION_STEP, HALF_HEIGHT, HALF_WIDTH } from './iso';
import { RoadType } from '../sim/types';
import { CityState } from '../sim/city';
import { PALETTE, mix, withAlpha } from './palette';
import { light } from './light';
import { Rng } from '../core/rng';
import type { TileRange, ViewRect } from './terrainLayer';

/** Edge of a material tile, in map-space pixels (one tile is 32 of them). */
const MATERIAL_SIZE = 128;
/** Map-space pixels per tile, matching MATERIAL_SIZE's grid. */
const MATERIAL_SCALE = 32;

interface Material {
  canvas: HTMLCanvasElement;
  kerb: string;
}

const materials = new Map<RoadType, Material>();
/** Patterns are bound to a context, so they are rebuilt if that changes. */
let patternContext: CanvasRenderingContext2D | null = null;
const patterns = new Map<RoadType, CanvasPattern>();

/** Paths, keyed by road class and height, reused between frames. */
const paths = new Map<number, Path2D>();

export function drawRoads(
  ctx: CanvasRenderingContext2D,
  city: CityState,
  view: ViewRect,
  range: TileRange,
  zoom: number,
): void {
  paths.clear();
  const width = city.width;
  const elevation = city.map.elevation;

  for (let y = range.y0; y <= range.y1; y++) {
    for (let x = range.x0; x <= range.x1; x++) {
      const index = y * width + x;
      const type = city.roads[index] as RoadType;
      if (type === RoadType.None) continue;

      const step = elevation[index];
      const cx = (x - y) * HALF_WIDTH;
      const cy = (x + y) * HALF_HEIGHT - step * ELEVATION_STEP;
      if (cx + HALF_WIDTH < view.left || cx - HALF_WIDTH > view.right) continue;
      if (cy + HALF_HEIGHT < view.top || cy - HALF_HEIGHT > view.bottom) continue;

      const key = type * 16 + step;
      let path = paths.get(key);
      if (!path) {
        path = new Path2D();
        paths.set(key, path);
      }
      // A whisker of overlap so neighbouring tiles merge without a hairline.
      const hw = HALF_WIDTH * 1.02;
      const hh = HALF_HEIGHT * 1.02;
      path.moveTo(cx, cy - hh);
      path.lineTo(cx + hw, cy);
      path.lineTo(cx, cy + hh);
      path.lineTo(cx - hw, cy);
      path.closePath();
    }
  }
  if (paths.size === 0) return;

  if (patternContext !== ctx) {
    patterns.clear();
    patternContext = ctx;
  }

  const keys = [...paths.keys()].sort((a, b) => a - b);
  ctx.save();
  for (const key of keys) {
    const type = Math.floor(key / 16) as RoadType;
    const step = key % 16;
    const path = paths.get(key) as Path2D;
    const material = materialFor(type);

    // The kerb is stroked first and then buried by the fill everywhere the
    // network is continuous, so only its true outer edge survives.
    ctx.strokeStyle = material.kerb;
    ctx.lineWidth = zoom > 0.6 ? 4 : 2.5;
    ctx.lineJoin = 'round';
    ctx.stroke(path);

    const pattern = patternFor(ctx, type);
    if (pattern) {
      // Skew the material into the isometric grid so the stones lie along
      // the street rather than across it, and lift it with the ground.
      const a = HALF_WIDTH / MATERIAL_SCALE;
      const b = HALF_HEIGHT / MATERIAL_SCALE;
      pattern.setTransform(
        new DOMMatrix([a, b, -a, b, 0, -HALF_HEIGHT - step * ELEVATION_STEP]),
      );
      ctx.fillStyle = pattern;
    } else {
      ctx.fillStyle = PALETTE.cobble;
    }
    ctx.fill(path);

    // A soft darkening along the edge reads as the camber of the road.
    ctx.strokeStyle = withAlpha('#2A2419', 0.16);
    ctx.lineWidth = zoom > 0.6 ? 2 : 1.2;
    ctx.stroke(path);
  }
  ctx.restore();
}

function patternFor(ctx: CanvasRenderingContext2D, type: RoadType): CanvasPattern | null {
  const existing = patterns.get(type);
  if (existing) return existing;
  const pattern = ctx.createPattern(materialFor(type).canvas, 'repeat');
  if (pattern) patterns.set(type, pattern);
  return pattern;
}

function materialFor(type: RoadType): Material {
  const existing = materials.get(type);
  if (existing) return existing;
  const material =
    type === RoadType.Avenue ? buildFlagstone() : type === RoadType.Path ? buildDirt() : buildCobble();
  materials.set(type, material);
  return material;
}

function surface(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = MATERIAL_SIZE;
  canvas.height = MATERIAL_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is unavailable');
  return { canvas, ctx };
}

/** Rounded setts in staggered courses, the way a street is actually laid. */
function buildCobble(): Material {
  const { canvas, ctx } = surface();
  const rng = new Rng(0x51a7e);
  const base = light(PALETTE.cobble, 'top');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, MATERIAL_SIZE, MATERIAL_SIZE);

  // Mortar shadow under everything, so the setts sit in something.
  ctx.fillStyle = withAlpha('#3E3A31', 0.5);
  ctx.fillRect(0, 0, MATERIAL_SIZE, MATERIAL_SIZE);

  const rows = 10;
  const cols = 10;
  const cellW = MATERIAL_SIZE / cols;
  const cellH = MATERIAL_SIZE / rows;
  for (let row = -1; row <= rows; row++) {
    for (let col = -1; col <= cols; col++) {
      const jitterX = (rng.next() - 0.5) * cellW * 0.18;
      const jitterY = (rng.next() - 0.5) * cellH * 0.18;
      const cx = (col + 0.5 + (row % 2) * 0.5) * cellW + jitterX;
      const cy = (row + 0.5) * cellH + jitterY;
      const rx = cellW * (0.4 + rng.next() * 0.08);
      const ry = cellH * (0.38 + rng.next() * 0.08);
      const tone = rng.next();
      const stone = mix(
        mix(PALETTE.cobbleDark, PALETTE.cobbleLight, tone),
        tone > 0.8 ? '#9A8E74' : '#7E8B8E',
        0.18,
      );

      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, (rng.next() - 0.5) * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = light(stone, 'top');
      ctx.fill();

      // A lit crown on each sett and a shadow on its lower edge.
      ctx.beginPath();
      ctx.ellipse(cx - rx * 0.18, cy - ry * 0.22, rx * 0.62, ry * 0.58, 0, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(light(stone, 'bright'), 0.5);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + rx * 0.2, cy + ry * 0.26, rx * 0.6, ry * 0.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha('#2E2A22', 0.18);
      ctx.fill();
    }
  }
  return { canvas, kerb: light(PALETTE.stoneMid, 'left') };
}

/** Large dressed slabs with fine joints: the flagstone avenues. */
function buildFlagstone(): Material {
  const { canvas, ctx } = surface();
  const rng = new Rng(0xf1a65);
  ctx.fillStyle = light(PALETTE.flagstoneDark, 'top');
  ctx.fillRect(0, 0, MATERIAL_SIZE, MATERIAL_SIZE);

  const cells = 4;
  const size = MATERIAL_SIZE / cells;
  for (let row = 0; row < cells; row++) {
    for (let col = 0; col < cells; col++) {
      const inset = 1.6;
      const tone = 0.35 + rng.next() * 0.55;
      ctx.fillStyle = light(mix(PALETTE.flagstoneDark, PALETTE.flagstoneLight, tone), 'top');
      ctx.fillRect(col * size + inset, row * size + inset, size - inset * 2, size - inset * 2);
      // Bevel: light along the top-left, shadow along the bottom-right.
      ctx.strokeStyle = withAlpha('#FFF6E2', 0.22);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(col * size + inset, (row + 1) * size - inset);
      ctx.lineTo(col * size + inset, row * size + inset);
      ctx.lineTo((col + 1) * size - inset, row * size + inset);
      ctx.stroke();
      ctx.strokeStyle = withAlpha('#3A3428', 0.2);
      ctx.beginPath();
      ctx.moveTo((col + 1) * size - inset, row * size + inset);
      ctx.lineTo((col + 1) * size - inset, (row + 1) * size - inset);
      ctx.lineTo(col * size + inset, (row + 1) * size - inset);
      ctx.stroke();
    }
  }
  return { canvas, kerb: light(PALETTE.stone, 'left') };
}

/** Packed earth, rutted by feet rather than laid by masons. */
function buildDirt(): Material {
  const { canvas, ctx } = surface();
  const rng = new Rng(0xd117);
  ctx.fillStyle = light(PALETTE.path, 'top');
  ctx.fillRect(0, 0, MATERIAL_SIZE, MATERIAL_SIZE);

  for (let i = 0; i < 260; i++) {
    const x = rng.next() * MATERIAL_SIZE;
    const y = rng.next() * MATERIAL_SIZE;
    const r = 1.5 + rng.next() * 6;
    const dark = rng.next() < 0.55;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.7, rng.next() * Math.PI, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha(dark ? PALETTE.pathDark : light(PALETTE.path, 'bright'), 0.3);
    ctx.fill();
  }
  // A pair of soft ruts worn down the middle.
  for (const offset of [MATERIAL_SIZE * 0.34, MATERIAL_SIZE * 0.66]) {
    const gradient = ctx.createLinearGradient(offset - 10, 0, offset + 10, 0);
    gradient.addColorStop(0, withAlpha(PALETTE.pathDark, 0));
    gradient.addColorStop(0.5, withAlpha(PALETTE.pathDark, 0.3));
    gradient.addColorStop(1, withAlpha(PALETTE.pathDark, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(offset - 10, 0, 20, MATERIAL_SIZE);
  }
  return { canvas, kerb: withAlpha(PALETTE.dirtDark, 0.55) };
}

/** Drop the cached materials, e.g. if the palette changes. */
export function clearRoadMaterials(): void {
  materials.clear();
  patterns.clear();
  patternContext = null;
}

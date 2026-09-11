/**
 * Materials.
 *
 * A face painted in one flat colour reads as coloured card however well it
 * is shaded. These painters fill an isometric face with the thing it is
 * actually made of — coursed granite, slate, thatch, half-timbered plaster,
 * sawn board — following the face's own edges so the courses run correctly
 * in perspective.
 *
 * Each painter works inside a clip, so callers can hand over any quad.
 */
import { PALETTE, mix, withAlpha } from './palette';
import { SurfaceName, light } from './light';
import { hash2 } from '../core/rng';

export interface Point {
  x: number;
  y: number;
}

export type MaterialName =
  | 'granite'
  | 'whitestone'
  | 'plaster'
  | 'timber'
  | 'plank'
  | 'thatch'
  | 'slate'
  | 'shingle'
  | 'canvas'
  | 'plain';

/**
 * Bilinear point inside a quad given as [a, b, c, d]: `u` runs a->b along
 * the top and d->c along the bottom, `v` runs a->d down the side.
 */
function at(quad: Point[], u: number, v: number): Point {
  const topX = quad[0].x + (quad[1].x - quad[0].x) * u;
  const topY = quad[0].y + (quad[1].y - quad[0].y) * u;
  const bottomX = quad[3].x + (quad[2].x - quad[3].x) * u;
  const bottomY = quad[3].y + (quad[2].y - quad[3].y) * u;
  return { x: topX + (bottomX - topX) * v, y: topY + (bottomY - topY) * v };
}

function clipTo(ctx: CanvasRenderingContext2D, quad: Point[]): void {
  ctx.beginPath();
  ctx.moveTo(quad[0].x, quad[0].y);
  for (let i = 1; i < quad.length; i++) ctx.lineTo(quad[i].x, quad[i].y);
  ctx.closePath();
  ctx.clip();
}

function span(quad: Point[]): { width: number; height: number } {
  const width = Math.max(
    Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y),
    Math.hypot(quad[2].x - quad[3].x, quad[2].y - quad[3].y),
  );
  const height = Math.max(
    Math.hypot(quad[3].x - quad[0].x, quad[3].y - quad[0].y),
    Math.hypot(quad[2].x - quad[1].x, quad[2].y - quad[1].y),
  );
  return { width, height };
}

export interface PaintOptions {
  /** Which way the face points, for lighting. */
  surface: SurfaceName;
  /** Varies the pattern between buildings of the same type. */
  seed?: number;
  /** Extra exposure, for faces catching a little more or less light. */
  exposure?: number;
  /** Shade the foot of the face, where light does not reach. */
  occlude?: boolean;
}

/**
 * Fill a face with a material. Returns without drawing if the face has no
 * area, which happens for degenerate roof slopes.
 */
export function paintFace(
  ctx: CanvasRenderingContext2D,
  quad: Point[],
  material: MaterialName,
  base: string,
  options: PaintOptions,
): void {
  const { width, height } = span(quad);
  if (width < 0.6 || height < 0.6) return;

  ctx.save();
  clipTo(ctx, quad);

  const lit = light(base, options.surface, options.exposure ?? 0);
  ctx.fillStyle = lit;
  ctx.fill();

  const seed = options.seed ?? 0;
  switch (material) {
    case 'granite':
      courses(ctx, quad, width, height, base, options, 5, 2, 0.12, true);
      break;
    case 'whitestone':
      courses(ctx, quad, width, height, base, options, 4, 3, 0.1, true);
      break;
    case 'plaster':
      mottle(ctx, quad, width, height, base, options);
      break;
    case 'timber':
      grain(ctx, quad, width, height, base, options, true);
      break;
    case 'plank':
      grain(ctx, quad, width, height, base, options, false);
      break;
    case 'thatch':
      thatch(ctx, quad, width, height, base, options);
      break;
    case 'slate':
      slates(ctx, quad, width, height, base, options);
      break;
    case 'shingle':
      shingles(ctx, quad, width, height, base, options);
      break;
    case 'canvas':
      canvasCloth(ctx, quad, width, height, base, options);
      break;
    default:
      break;
  }

  if (options.occlude !== false) footShadow(ctx, quad, height);
  ctx.restore();
  void seed;
}

/** Ashlar courses: horizontal beds with staggered vertical joints. */
function courses(
  ctx: CanvasRenderingContext2D,
  quad: Point[],
  width: number,
  height: number,
  base: string,
  options: PaintOptions,
  blockWidth: number,
  courseHeight: number,
  variation: number,
  bevel: boolean,
): void {
  const rows = Math.max(2, Math.round(height / Math.max(3, courseHeight * 2.4)));
  const cols = Math.max(2, Math.round(width / Math.max(5, blockWidth * 2.2)));
  const seed = options.seed ?? 0;

  for (let row = 0; row < rows; row++) {
    const v0 = row / rows;
    const v1 = (row + 1) / rows;
    const offset = row % 2 === 0 ? 0 : 0.5 / cols;
    for (let col = -1; col <= cols; col++) {
      const u0 = col / cols + offset;
      const u1 = (col + 1) / cols + offset;
      if (u1 <= 0 || u0 >= 1) continue;

      const tone = hash2(col + row * 31, row, seed);
      const block = mix(base, tone > 0.5 ? '#FFFFFF' : '#000000', variation * (0.4 + tone * 0.6));
      const corners = [at(quad, u0, v0), at(quad, u1, v0), at(quad, u1, v1), at(quad, u0, v1)];

      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();
      ctx.fillStyle = light(block, options.surface, options.exposure ?? 0);
      ctx.fill();

      if (bevel) {
        // A lit chamfer along the top of each block, shadow beneath it.
        ctx.strokeStyle = withAlpha('#FFF4DE', 0.3);
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        ctx.lineTo(corners[1].x, corners[1].y);
        ctx.stroke();
      }
      ctx.strokeStyle = withAlpha('#2C2419', 0.32);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(corners[3].x, corners[3].y);
      ctx.lineTo(corners[2].x, corners[2].y);
      ctx.stroke();
    }
  }
}

/** Lime plaster: uneven, patched, brushed on by hand. */
function mottle(
  ctx: CanvasRenderingContext2D,
  quad: Point[],
  width: number,
  height: number,
  base: string,
  options: PaintOptions,
): void {
  const seed = options.seed ?? 0;
  const patches = Math.max(8, Math.round((width * height) / 46));
  for (let i = 0; i < patches; i++) {
    const u = hash2(i * 7, seed, 11);
    const v = hash2(seed, i * 13, 17);
    const point = at(quad, u, v);
    const radius = 1.6 + hash2(i, seed, 23) * Math.min(width, height) * 0.16;
    const warm = hash2(i * 3, seed, 29) > 0.5;
    ctx.beginPath();
    ctx.ellipse(point.x, point.y, radius, radius * 0.72, 0, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha(warm ? '#FFF3D8' : '#9A8C73', 0.09);
    ctx.fill();
  }
  void base;
}

/** Sawn timber: long grain with the odd knot. */
function grain(
  ctx: CanvasRenderingContext2D,
  quad: Point[],
  width: number,
  height: number,
  base: string,
  options: PaintOptions,
  vertical: boolean,
): void {
  const seed = options.seed ?? 0;
  const lines = Math.max(3, Math.round((vertical ? width : height) / 3.5));
  ctx.lineWidth = 0.9;
  for (let i = 0; i < lines; i++) {
    const t = (i + 0.5) / lines + (hash2(i, seed, 5) - 0.5) * 0.02;
    const dark = hash2(i, seed, 9) > 0.45;
    ctx.strokeStyle = withAlpha(dark ? '#2E1F12' : '#B38A58', dark ? 0.22 : 0.16);
    ctx.beginPath();
    if (vertical) {
      const a = at(quad, t, 0);
      const b = at(quad, t, 1);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    } else {
      const a = at(quad, 0, t);
      const b = at(quad, 1, t);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }
  void base;
  void height;
}

/** Layered reed, combed down the slope and thick at the eave. */
function thatch(
  ctx: CanvasRenderingContext2D,
  quad: Point[],
  width: number,
  height: number,
  base: string,
  options: PaintOptions,
): void {
  const seed = options.seed ?? 0;
  const layers = Math.max(3, Math.round(height / 4));
  for (let row = layers - 1; row >= 0; row--) {
    const v = (row + 1) / layers;
    const shade = 0.1 + (1 - row / layers) * 0.1;
    ctx.beginPath();
    const steps = 12;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const wobble = (hash2(i, row * 3 + seed, 13) - 0.5) * (height / layers) * 0.5;
      const point = at(quad, u, Math.min(1, v + wobble / height));
      if (i === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    }
    const back = at(quad, 1, Math.max(0, v - 1 / layers));
    const backStart = at(quad, 0, Math.max(0, v - 1 / layers));
    ctx.lineTo(back.x, back.y);
    ctx.lineTo(backStart.x, backStart.y);
    ctx.closePath();
    ctx.fillStyle = withAlpha('#2E2413', shade * 0.5);
    ctx.fill();
  }

  // Combed strands over the top, so the reed reads as reed.
  const strands = Math.max(8, Math.round(width / 2.4));
  ctx.lineWidth = 0.8;
  for (let i = 0; i < strands; i++) {
    const u = (i + 0.5) / strands;
    const tone = hash2(i, seed, 31);
    ctx.strokeStyle = withAlpha(tone > 0.5 ? '#F0DDA8' : '#8F7434', 0.2);
    const a = at(quad, u, 0.06);
    const b = at(quad, u + (tone - 0.5) * 0.02, 0.98);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  void base;
  void options;
}

/** Slate: overlapping courses of thin, cool, hard stone. */
function slates(
  ctx: CanvasRenderingContext2D,
  quad: Point[],
  width: number,
  height: number,
  base: string,
  options: PaintOptions,
): void {
  const seed = options.seed ?? 0;
  const rows = Math.max(3, Math.round(height / 3.2));
  const cols = Math.max(3, Math.round(width / 4));

  for (let row = 0; row < rows; row++) {
    const v0 = row / rows;
    const v1 = (row + 1.06) / rows;
    const offset = row % 2 === 0 ? 0 : 0.5 / cols;
    for (let col = -1; col <= cols; col++) {
      const u0 = col / cols + offset;
      const u1 = (col + 0.96) / cols + offset;
      if (u1 <= 0 || u0 >= 1) continue;
      const tone = hash2(col * 5 + row, row * 7, seed);
      const slate = mix(base, tone > 0.5 ? '#F2F6FF' : '#14202E', 0.05 + tone * 0.07);

      const corners = [at(quad, u0, v0), at(quad, u1, v0), at(quad, u1, v1), at(quad, u0, v1)];
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();
      ctx.fillStyle = light(slate, options.surface, options.exposure ?? 0);
      ctx.fill();

      // The shadow each course throws on the one below it.
      ctx.strokeStyle = withAlpha('#0B1522', 0.22);
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(corners[3].x, corners[3].y);
      ctx.lineTo(corners[2].x, corners[2].y);
      ctx.stroke();
    }
  }
}

/** Split wooden shingles: warmer and rougher than slate. */
function shingles(
  ctx: CanvasRenderingContext2D,
  quad: Point[],
  width: number,
  height: number,
  base: string,
  options: PaintOptions,
): void {
  const seed = options.seed ?? 0;
  const rows = Math.max(3, Math.round(height / 4.6));
  const cols = Math.max(3, Math.round(width / 4.6));

  for (let row = 0; row < rows; row++) {
    const v0 = row / rows;
    const v1 = (row + 1.1) / rows;
    const offset = row % 2 === 0 ? 0 : 0.5 / cols;
    for (let col = -1; col <= cols; col++) {
      const u0 = col / cols + offset;
      const u1 = (col + 0.94) / cols + offset;
      if (u1 <= 0 || u0 >= 1) continue;
      const tone = hash2(col + row * 13, row, seed);
      const wood = mix(base, tone > 0.5 ? '#F2D9A8' : '#3B2A16', 0.12 + tone * 0.12);

      const midTop = at(quad, (u0 + u1) / 2, v0);
      const corners = [at(quad, u0, v0), at(quad, u1, v0), at(quad, u1, v1), at(quad, u0, v1)];
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      ctx.lineTo(midTop.x, midTop.y);
      ctx.lineTo(corners[1].x, corners[1].y);
      ctx.lineTo(corners[2].x, corners[2].y);
      ctx.lineTo(corners[3].x, corners[3].y);
      ctx.closePath();
      ctx.fillStyle = light(wood, options.surface, options.exposure ?? 0);
      ctx.fill();
      ctx.strokeStyle = withAlpha('#2A1C0E', 0.26);
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(corners[3].x, corners[3].y);
      ctx.lineTo(corners[2].x, corners[2].y);
      ctx.stroke();
    }
  }
}

/** Awning cloth: broad stripes with a sag between the poles. */
function canvasCloth(
  ctx: CanvasRenderingContext2D,
  quad: Point[],
  width: number,
  height: number,
  base: string,
  options: PaintOptions,
): void {
  const stripes = Math.max(3, Math.round(width / 7));
  for (let i = 0; i < stripes; i++) {
    if (i % 2 === 0) continue;
    const u0 = i / stripes;
    const u1 = (i + 1) / stripes;
    const corners = [at(quad, u0, 0), at(quad, u1, 0), at(quad, u1, 1), at(quad, u0, 1)];
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let k = 1; k < 4; k++) ctx.lineTo(corners[k].x, corners[k].y);
    ctx.closePath();
    ctx.fillStyle = light(PALETTE.parchment, options.surface, options.exposure ?? 0);
    ctx.fill();
  }
  void base;
  void height;
}

/** Contact shadow along the foot of a wall, where light cannot reach. */
function footShadow(ctx: CanvasRenderingContext2D, quad: Point[], height: number): void {
  const top = at(quad, 0.5, Math.max(0, 1 - Math.min(0.42, 9 / Math.max(1, height))));
  const bottom = at(quad, 0.5, 1);
  const gradient = ctx.createLinearGradient(top.x, top.y, bottom.x, bottom.y);
  gradient.addColorStop(0, 'rgba(28, 30, 44, 0)');
  gradient.addColorStop(1, 'rgba(28, 30, 44, 0.3)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(quad[0].x, quad[0].y);
  for (let i = 1; i < quad.length; i++) ctx.lineTo(quad[i].x, quad[i].y);
  ctx.closePath();
  ctx.fill();
}

/** Point on a face, exported for callers that need to place detail on it. */
export { at as facepoint };

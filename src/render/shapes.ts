/**
 * Isometric drawing primitives.
 *
 * Every building, wall and prop is built from these few solids. They take a
 * material rather than a flat colour, light each face from one sun, throw a
 * shadow on the ground and outline only the silhouette — which is what
 * separates a drawn building from a coloured box.
 */
import { HALF_HEIGHT, HALF_WIDTH } from './iso';
import { withAlpha } from './palette';
import { MaterialName, paintFace } from './materials';
import { SHADOW_OFFSET, light } from './light';

export interface Point {
  x: number;
  y: number;
}

/** The silhouette line. Warm and soft, not a hard black key line. */
export const OUTLINE = 'rgba(44, 32, 20, 0.42)';

/**
 * The four corners of a w x h tile footprint, in sprite-local pixels, with
 * the origin at the footprint's north corner.
 *
 * Returned clockwise: north, east, south, west.
 */
export function footprintCorners(width: number, height: number): Point[] {
  return [
    { x: 0, y: 0 },
    { x: width * HALF_WIDTH, y: width * HALF_HEIGHT },
    { x: (width - height) * HALF_WIDTH, y: (width + height) * HALF_HEIGHT },
    { x: -height * HALF_WIDTH, y: height * HALF_HEIGHT },
  ];
}

export function raise(corners: Point[], by: number): Point[] {
  return corners.map((c) => ({ x: c.x, y: c.y - by }));
}

export function centroid(points: Point[]): Point {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return { x: x / points.length, y: y / points.length };
}

export function polygon(ctx: CanvasRenderingContext2D, points: Point[]): void {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
}

/** Fill a flat polygon in a lit colour, with an optional silhouette. */
export function fillFace(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  color: string,
  outline = true,
): void {
  polygon(ctx, points);
  ctx.fillStyle = color;
  ctx.fill();
  if (outline) {
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

export interface Skin {
  material: MaterialName;
  color: string;
  seed?: number;
}

/** A triangle, padded into the quad the material painters expect. */
function asQuad(points: Point[]): Point[] {
  return points.length >= 4 ? points.slice(0, 4) : [points[0], points[1], points[2], points[2]];
}

/**
 * An isometric box standing on a footprint. Returns the raised top corners
 * so a roof can be built straight onto it.
 */
export function isoBox(
  ctx: CanvasRenderingContext2D,
  corners: Point[],
  wallHeight: number,
  skin: Skin,
  outline = true,
): Point[] {
  const [, east, south, west] = corners;
  const top = raise(corners, wallHeight);

  // The two walls the viewer can see, then the roof plate.
  paintFace(ctx, [top[3], top[2], south, west], skin.material, skin.color, {
    surface: 'left',
    seed: skin.seed,
  });
  paintFace(ctx, [top[1], top[2], south, east], skin.material, skin.color, {
    surface: 'right',
    seed: (skin.seed ?? 0) + 7,
  });
  paintFace(ctx, top, skin.material, skin.color, {
    surface: 'top',
    seed: (skin.seed ?? 0) + 13,
    occlude: false,
  });

  if (outline) strokeSilhouette(ctx, [top[0], top[1], east, south, west, top[3]]);
  return top;
}

/** Trace the outer edge of a solid, leaving the joins between faces clean. */
export function strokeSilhouette(ctx: CanvasRenderingContext2D, points: Point[]): void {
  polygon(ctx, points);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.1;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/** A four-sided hipped roof rising to a point. */
export function hipRoof(
  ctx: CanvasRenderingContext2D,
  top: Point[],
  roofHeight: number,
  skin: Skin,
  overhang = 4,
): Point {
  const eaves = expand(top, overhang);
  const centre = centroid(eaves);
  const apex = { x: centre.x, y: centre.y - roofHeight };
  const [north, east, south, west] = eaves;

  // Far slopes first, then the two the viewer actually sees.
  paintFace(ctx, asQuad([north, east, apex]), skin.material, skin.color, { surface: 'right', exposure: -0.08, seed: skin.seed });
  paintFace(ctx, asQuad([north, west, apex]), skin.material, skin.color, { surface: 'shadow', seed: skin.seed });
  paintFace(ctx, asQuad([west, south, apex]), skin.material, skin.color, { surface: 'bright', seed: (skin.seed ?? 0) + 3 });
  paintFace(ctx, asQuad([east, south, apex]), skin.material, skin.color, { surface: 'right', seed: (skin.seed ?? 0) + 5 });

  eaveShadow(ctx, [west, south, east]);
  strokeSilhouette(ctx, [north, east, south, west]);
  ctx.strokeStyle = withAlpha('#FFF3D6', 0.3);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(west.x, west.y);
  ctx.lineTo(apex.x, apex.y);
  ctx.lineTo(south.x, south.y);
  ctx.stroke();
  return apex;
}

/**
 * A pitched roof with a ridge running along one axis.
 * `axis` 0 runs the ridge along the tile-x direction, 1 along tile-y.
 */
export function gableRoof(
  ctx: CanvasRenderingContext2D,
  top: Point[],
  roofHeight: number,
  skin: Skin,
  axis: 0 | 1,
  overhang = 4,
): { start: Point; end: Point } {
  const eaves = expand(top, overhang);
  const [north, east, south, west] = eaves;

  const midA = axis === 0 ? midpoint(north, west) : midpoint(north, east);
  const midB = axis === 0 ? midpoint(east, south) : midpoint(west, south);
  const start = { x: midA.x, y: midA.y - roofHeight };
  const end = { x: midB.x, y: midB.y - roofHeight };

  if (axis === 0) {
    paintFace(ctx, [start, end, east, north], skin.material, skin.color, { surface: 'right', exposure: -0.06, seed: skin.seed });
    paintFace(ctx, asQuad([north, west, start]), skin.material, skin.color, { surface: 'shadow', seed: (skin.seed ?? 0) + 2 });
    paintFace(ctx, asQuad([east, south, end]), skin.material, skin.color, { surface: 'right', exposure: -0.1, seed: (skin.seed ?? 0) + 4 });
    paintFace(ctx, [start, end, south, west], skin.material, skin.color, { surface: 'bright', seed: (skin.seed ?? 0) + 6 });
    eaveShadow(ctx, [west, south]);
    strokeSilhouette(ctx, [north, start, end, east]);
    strokeSilhouette(ctx, [west, start, end, south]);
  } else {
    paintFace(ctx, [start, end, west, north], skin.material, skin.color, { surface: 'shadow', seed: skin.seed });
    paintFace(ctx, asQuad([north, east, start]), skin.material, skin.color, { surface: 'right', exposure: -0.06, seed: (skin.seed ?? 0) + 2 });
    paintFace(ctx, asQuad([west, south, end]), skin.material, skin.color, { surface: 'bright', exposure: -0.08, seed: (skin.seed ?? 0) + 4 });
    paintFace(ctx, [start, end, south, east], skin.material, skin.color, { surface: 'right', seed: (skin.seed ?? 0) + 6 });
    eaveShadow(ctx, [south, east]);
    strokeSilhouette(ctx, [north, start, end, west]);
    strokeSilhouette(ctx, [east, start, end, south]);
  }

  // The lit ridge: without it a shallow roof reads as a flat slab.
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.strokeStyle = withAlpha('#FFF6DE', 0.42);
  ctx.lineWidth = 2.2;
  ctx.stroke();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.stroke();

  return { start, end };
}

/** The dark line an overhanging roof casts on the wall beneath it. */
function eaveShadow(ctx: CanvasRenderingContext2D, along: Point[]): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(24, 26, 40, 0.3)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(along[0].x, along[0].y + 1.5);
  for (let i = 1; i < along.length; i++) ctx.lineTo(along[i].x, along[i].y + 1.5);
  ctx.stroke();
  ctx.restore();
}

/** A conical roof for a round tower. */
export function coneRoof(
  ctx: CanvasRenderingContext2D,
  centre: Point,
  radiusX: number,
  radiusY: number,
  height: number,
  skin: Skin,
): Point {
  const apex = { x: centre.x, y: centre.y - height };

  // Shaded in wedges so the cone turns, but painted plain: running a course
  // pattern round a cone leaves radial seams where the wedges meet.
  const wedges = 7;
  for (let i = 0; i < wedges; i++) {
    const a0 = Math.PI + (i / wedges) * Math.PI;
    const a1 = Math.PI + ((i + 1) / wedges) * Math.PI;
    const p0 = { x: centre.x + Math.cos(a0) * radiusX, y: centre.y + Math.sin(a0) * radiusY };
    const p1 = { x: centre.x + Math.cos(a1) * radiusX, y: centre.y + Math.sin(a1) * radiusY };
    const facing = Math.cos((a0 + a1) / 2 + Math.PI * 0.25);
    const surface = facing > 0.35 ? 'bright' : facing > -0.35 ? 'left' : 'right';
    paintFace(ctx, asQuad([p0, p1, apex]), 'plain', skin.color, {
      surface,
      seed: (skin.seed ?? 0) + i,
      occlude: false,
    });
  }

  // Courses drawn as arcs across the whole cone, so they read continuously.
  const courses = Math.max(3, Math.round(height / 7));
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(centre.x - radiusX, centre.y);
  ctx.ellipse(centre.x, centre.y, radiusX, radiusY, 0, Math.PI, 0, true);
  ctx.lineTo(apex.x, apex.y);
  ctx.closePath();
  ctx.clip();
  ctx.lineWidth = 1;
  for (let i = 1; i < courses; i++) {
    const t = i / courses;
    ctx.beginPath();
    ctx.ellipse(centre.x, centre.y - height * t, radiusX * (1 - t), radiusY * (1 - t), 0, 0, Math.PI);
    ctx.strokeStyle = withAlpha('#0C1624', 0.24);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(centre.x, centre.y - height * t - 1.1, radiusX * (1 - t), radiusY * (1 - t), 0, 0, Math.PI);
    ctx.strokeStyle = withAlpha('#FFFFFF', 0.13);
    ctx.stroke();
  }
  ctx.restore();

  ctx.beginPath();
  ctx.moveTo(centre.x - radiusX, centre.y);
  ctx.ellipse(centre.x, centre.y, radiusX, radiusY, 0, Math.PI, 0, true);
  ctx.lineTo(apex.x, apex.y);
  ctx.closePath();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.1;
  ctx.stroke();
  return apex;
}

/** An upright cylinder, for round towers and wells. */
export function cylinder(
  ctx: CanvasRenderingContext2D,
  centre: Point,
  radiusX: number,
  radiusY: number,
  height: number,
  skin: Skin,
): Point {
  // Staves down the curve, so the material bends round the drum.
  const staves = 10;
  for (let i = 0; i < staves; i++) {
    const a0 = Math.PI + (i / staves) * Math.PI;
    const a1 = Math.PI + ((i + 1) / staves) * Math.PI;
    const x0 = centre.x + Math.cos(a0) * radiusX;
    const x1 = centre.x + Math.cos(a1) * radiusX;
    const y0 = centre.y + Math.sin(a0) * radiusY;
    const y1 = centre.y + Math.sin(a1) * radiusY;
    const facing = Math.cos((a0 + a1) / 2 + Math.PI * 0.25);
    const surface = facing > 0.4 ? 'bright' : facing > -0.2 ? 'left' : 'right';
    paintFace(
      ctx,
      [
        { x: x0, y: y0 - height },
        { x: x1, y: y1 - height },
        { x: x1, y: y1 },
        { x: x0, y: y0 },
      ],
      skin.material,
      skin.color,
      { surface, seed: (skin.seed ?? 0) + i * 3 },
    );
  }

  ctx.beginPath();
  ctx.moveTo(centre.x - radiusX, centre.y - height);
  ctx.lineTo(centre.x - radiusX, centre.y);
  ctx.ellipse(centre.x, centre.y, radiusX, radiusY, 0, Math.PI, 0, false);
  ctx.lineTo(centre.x + radiusX, centre.y - height);
  ctx.closePath();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.1;
  ctx.stroke();

  // Cap.
  ctx.beginPath();
  ctx.ellipse(centre.x, centre.y - height, radiusX, radiusY, 0, 0, Math.PI * 2);
  ctx.fillStyle = light(skin.color, 'top');
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  return { x: centre.x, y: centre.y - height };
}

/** Push a polygon outward from its centre, for roof overhangs. */
export function expand(points: Point[], amount: number): Point[] {
  const centre = centroid(points);
  return points.map((point) => {
    const dx = point.x - centre.x;
    const dy = point.y - centre.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: point.x + (dx / length) * amount, y: point.y + (dy / length) * amount };
  });
}

/**
 * Shrink a footprint toward its centre by a fixed number of pixels measured
 * across its width. Small buildings end up with a yard around them, while
 * large ones still fill their lot.
 */
export function insetFootprint(points: Point[], pixels: number): Point[] {
  const centre = centroid(points);
  let halfWidth = 0;
  for (const point of points) halfWidth = Math.max(halfWidth, Math.abs(point.x - centre.x));
  if (halfWidth <= 0) return points;
  const scale = Math.max(0.55, 1 - pixels / halfWidth);
  return points.map((point) => ({
    x: centre.x + (point.x - centre.x) * scale,
    y: centre.y + (point.y - centre.y) * scale,
  }));
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function lerpPoint(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * The shadow a solid throws across the ground: its footprint dragged away
 * from the sun, drawn as the hull of the two outlines.
 */
export function castShadow(
  ctx: CanvasRenderingContext2D,
  footprint: Point[],
  height: number,
  strength = 0.2,
): void {
  if (height <= 0) return;
  const dx = height * SHADOW_OFFSET.x;
  const dy = height * SHADOW_OFFSET.y;
  const points = [...footprint, ...footprint.map((p) => ({ x: p.x + dx, y: p.y + dy }))];
  const hull = convexHull(points);
  if (hull.length < 3) return;

  ctx.save();
  polygon(ctx, hull);
  ctx.fillStyle = `rgba(38, 44, 68, ${strength})`;
  ctx.filter = 'blur(1.5px)';
  ctx.fill();
  ctx.restore();
}

/** Andrew's monotone chain; the point counts here are tiny. */
function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Point[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: Point[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const point = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** A soft elliptical shadow, so small props sit on the ground. */
export function groundShadow(
  ctx: CanvasRenderingContext2D,
  centre: Point,
  radiusX: number,
  radiusY: number,
  strength = 0.22,
): void {
  const gradient = ctx.createRadialGradient(centre.x, centre.y, 0, centre.x, centre.y, radiusX);
  gradient.addColorStop(0, `rgba(30, 34, 52, ${strength})`);
  gradient.addColorStop(0.65, `rgba(30, 34, 52, ${strength * 0.5})`);
  gradient.addColorStop(1, 'rgba(30, 34, 52, 0)');
  ctx.save();
  ctx.translate(centre.x, centre.y);
  ctx.scale(1, radiusY / radiusX);
  ctx.translate(-centre.x, -centre.y);
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, radiusX, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.restore();
}

/** Window openings along a wall face, glazed and lit from within. */
export function windowRow(
  ctx: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  wallHeight: number,
  count: number,
  color: string,
  size = 5,
): void {
  for (let i = 0; i < count; i++) {
    const t = (i + 1) / (count + 1);
    const base = lerpPoint(from, to, t);
    const top = wallHeight * 0.72;
    const bottom = wallHeight * 0.35;
    const slant = (to.y - from.y) / Math.max(1, Math.abs(to.x - from.x)) * (size / 2);

    // Reveal behind the glass, so the opening has depth.
    ctx.beginPath();
    ctx.moveTo(base.x - size / 2, base.y - bottom);
    ctx.lineTo(base.x + size / 2, base.y - bottom + slant);
    ctx.lineTo(base.x + size / 2, base.y - top + slant);
    ctx.lineTo(base.x - size / 2, base.y - top);
    ctx.closePath();
    ctx.fillStyle = 'rgba(28, 24, 20, 0.85)';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(base.x - size / 2 + 0.8, base.y - bottom - 0.8);
    ctx.lineTo(base.x + size / 2 - 0.8, base.y - bottom + slant - 0.8);
    ctx.lineTo(base.x + size / 2 - 0.8, base.y - top + slant + 1);
    ctx.lineTo(base.x - size / 2 + 0.8, base.y - top + 1);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();

    // A sill catching the light.
    ctx.strokeStyle = withAlpha('#FFF3D6', 0.35);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(base.x - size / 2 - 0.6, base.y - bottom + 0.6);
    ctx.lineTo(base.x + size / 2 + 0.6, base.y - bottom + slant + 0.6);
    ctx.stroke();
  }
}

/** A hanging banner, the surest sign that a building belongs to Stormwind. */
export function banner(
  ctx: CanvasRenderingContext2D,
  anchor: Point,
  width: number,
  height: number,
  color: string,
  trim: string,
): void {
  ctx.beginPath();
  ctx.moveTo(anchor.x - width / 2, anchor.y);
  ctx.lineTo(anchor.x + width / 2, anchor.y);
  ctx.lineTo(anchor.x + width / 2, anchor.y + height);
  ctx.lineTo(anchor.x, anchor.y + height - width * 0.35);
  ctx.lineTo(anchor.x - width / 2, anchor.y + height);
  ctx.closePath();
  ctx.fillStyle = light(color, 'left');
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.stroke();

  // A fold down the middle, and the gold band at the top.
  ctx.beginPath();
  ctx.moveTo(anchor.x + width * 0.1, anchor.y);
  ctx.lineTo(anchor.x + width * 0.1, anchor.y + height - width * 0.28);
  ctx.strokeStyle = 'rgba(20, 24, 40, 0.25)';
  ctx.lineWidth = width * 0.32;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(anchor.x - width / 2, anchor.y + 1.5);
  ctx.lineTo(anchor.x + width / 2, anchor.y + 1.5);
  ctx.strokeStyle = trim;
  ctx.lineWidth = 2;
  ctx.stroke();
}

export { paintFace };
export type { MaterialName };

/**
 * Isometric drawing primitives.
 *
 * Every building, wall and tree in the game is drawn from these few shapes,
 * which is what keeps the art consistent: one projection, one light
 * direction, one outlining convention.
 */
import { HALF_HEIGHT, HALF_WIDTH } from './iso';
import { shade } from './palette';

export interface Point {
  x: number;
  y: number;
}

/** Light comes from the upper left, so faces are shaded by which way they face. */
export const FACE_LIGHT = {
  top: 0.1,
  /** The south-west face, angled toward the light. */
  left: -0.04,
  /** The south-east face, turned away from it. */
  right: -0.2,
} as const;

/** Every shape is outlined in this, which is what gives the hand-painted read. */
export const OUTLINE = 'rgba(30, 22, 14, 0.55)';

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

/** Raise a set of corners by a pixel height. */
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

/** Fill a polygon and give it the standard outline. */
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

export interface BoxColors {
  top: string;
  left: string;
  right: string;
}

/** Derive the three face shades of a box from one base colour. */
export function boxColors(base: string): BoxColors {
  return {
    top: shade(base, FACE_LIGHT.top),
    left: shade(base, FACE_LIGHT.left),
    right: shade(base, FACE_LIGHT.right),
  };
}

/**
 * An isometric box standing on a footprint. Returns the raised top corners
 * so a roof can be built straight onto it.
 */
export function isoBox(
  ctx: CanvasRenderingContext2D,
  corners: Point[],
  wallHeight: number,
  colors: BoxColors,
): Point[] {
  const [north, east, south, west] = corners;
  const top = raise(corners, wallHeight);

  // The two faces that turn toward the viewer.
  fillFace(ctx, [top[3], top[2], south, west], colors.left);
  fillFace(ctx, [top[1], top[2], south, east], colors.right);
  fillFace(ctx, top, colors.top);
  void north;
  return top;
}

/**
 * A four-sided hipped roof rising to a point. Faces are drawn back to front
 * so the near slopes cover the far ones.
 */
export function hipRoof(
  ctx: CanvasRenderingContext2D,
  top: Point[],
  roofHeight: number,
  colors: { main: string; light: string; dark: string },
  overhang = 4,
): Point {
  const eaves = expand(top, overhang);
  const centre = centroid(eaves);
  const apex = { x: centre.x, y: centre.y - roofHeight };
  const [north, east, south, west] = eaves;

  // Far slopes first.
  fillFace(ctx, [north, east, apex], shade(colors.dark, -0.05));
  fillFace(ctx, [north, west, apex], colors.dark);
  // Then the two the viewer actually sees.
  fillFace(ctx, [west, south, apex], colors.light);
  fillFace(ctx, [east, south, apex], colors.main);
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
  colors: { main: string; light: string; dark: string },
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
    // Far slope, then the gable ends, then the near slope.
    fillFace(ctx, [north, east, end, start], colors.dark);
    fillFace(ctx, [north, west, start], shade(colors.main, -0.1));
    fillFace(ctx, [east, south, end], shade(colors.main, -0.14));
    fillFace(ctx, [west, south, end, start], colors.light);
  } else {
    fillFace(ctx, [north, west, end, start], colors.dark);
    fillFace(ctx, [north, east, start], shade(colors.main, -0.1));
    fillFace(ctx, [west, south, end], shade(colors.main, -0.14));
    fillFace(ctx, [east, south, end, start], colors.main);
  }

  // A lit ridge along the apex: without it a shallow roof reads as a flat
  // slab once the building is small on screen.
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.strokeStyle = shade(colors.light, 0.25);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.stroke();

  return { start, end };
}

/** A conical roof for a round tower. */
export function coneRoof(
  ctx: CanvasRenderingContext2D,
  centre: Point,
  radiusX: number,
  radiusY: number,
  height: number,
  colors: { main: string; light: string; dark: string },
): Point {
  const apex = { x: centre.x, y: centre.y - height };
  ctx.beginPath();
  ctx.moveTo(centre.x - radiusX, centre.y);
  ctx.ellipse(centre.x, centre.y, radiusX, radiusY, 0, Math.PI, 0, true);
  ctx.lineTo(apex.x, apex.y);
  ctx.closePath();
  ctx.fillStyle = colors.main;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.stroke();

  // A lit sliver down the left-hand side.
  ctx.beginPath();
  ctx.moveTo(centre.x - radiusX, centre.y);
  ctx.lineTo(apex.x, apex.y);
  ctx.lineTo(centre.x - radiusX * 0.2, centre.y + radiusY * 0.75);
  ctx.closePath();
  ctx.fillStyle = colors.light;
  ctx.fill();
  return apex;
}

/** An upright cylinder, for round towers and wells. */
export function cylinder(
  ctx: CanvasRenderingContext2D,
  centre: Point,
  radiusX: number,
  radiusY: number,
  height: number,
  base: string,
): Point {
  const colors = boxColors(base);
  ctx.beginPath();
  ctx.moveTo(centre.x - radiusX, centre.y - height);
  ctx.lineTo(centre.x - radiusX, centre.y);
  ctx.ellipse(centre.x, centre.y, radiusX, radiusY, 0, Math.PI, 0, false);
  ctx.lineTo(centre.x + radiusX, centre.y - height);
  ctx.closePath();
  ctx.fillStyle = colors.right;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Lit side.
  ctx.beginPath();
  ctx.moveTo(centre.x - radiusX, centre.y - height);
  ctx.lineTo(centre.x - radiusX, centre.y);
  ctx.lineTo(centre.x - radiusX * 0.25, centre.y + radiusY * 0.9);
  ctx.lineTo(centre.x - radiusX * 0.25, centre.y - height + radiusY * 0.9);
  ctx.closePath();
  ctx.fillStyle = colors.left;
  ctx.fill();

  // Cap.
  ctx.beginPath();
  ctx.ellipse(centre.x, centre.y - height, radiusX, radiusY, 0, 0, Math.PI * 2);
  ctx.fillStyle = colors.top;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  return { x: centre.x, y: centre.y - height };
}

/**
 * Shrink a footprint toward its centre by a fixed number of pixels measured
 * across its width. Small buildings end up with a yard around them, while
 * large ones still fill their lot — which is what stops a street of
 * one-tile cottages from reading as an unbroken sea of roofs.
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

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function lerpPoint(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * A soft elliptical shadow on the ground, so buildings and agents sit in
 * the world rather than floating above it.
 */
export function groundShadow(
  ctx: CanvasRenderingContext2D,
  centre: Point,
  radiusX: number,
  radiusY: number,
  strength = 0.22,
): void {
  const gradient = ctx.createRadialGradient(centre.x, centre.y, 0, centre.x, centre.y, radiusX);
  gradient.addColorStop(0, `rgba(24, 18, 10, ${strength})`);
  gradient.addColorStop(1, 'rgba(24, 18, 10, 0)');
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

/**
 * A row of window openings along a wall face, spaced between two corners.
 */
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
    ctx.beginPath();
    ctx.moveTo(base.x - size / 2, base.y - wallHeight * 0.35);
    ctx.lineTo(base.x + size / 2, base.y - wallHeight * 0.35 + size * 0.3);
    ctx.lineTo(base.x + size / 2, base.y - wallHeight * 0.72 + size * 0.3);
    ctx.lineTo(base.x - size / 2, base.y - wallHeight * 0.72);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
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
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(anchor.x - width / 2, anchor.y + 1.5);
  ctx.lineTo(anchor.x + width / 2, anchor.y + 1.5);
  ctx.strokeStyle = trim;
  ctx.lineWidth = 2;
  ctx.stroke();
}

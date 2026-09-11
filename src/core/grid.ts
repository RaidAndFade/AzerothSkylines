/** Grid primitives shared by terrain, zoning, utilities and pathfinding. */

export interface Point {
  x: number;
  y: number;
}

/** Cardinal directions, ordered N, E, S, W. Index order is load-bearing:
 *  road auto-tiling packs neighbour connectivity into a 4-bit mask using it. */
export const DIRECTIONS: readonly Point[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

/** The four diagonals, for corner-aware rendering and wall towers. */
export const DIAGONALS: readonly Point[] = [
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

export const NEIGHBORS_8: readonly Point[] = [...DIRECTIONS, ...DIAGONALS];

/** A dense 2D array with bounds-checked access. */
export class Grid<T> {
  readonly width: number;
  readonly height: number;
  private readonly cells: T[];

  constructor(width: number, height: number, fill: T | ((x: number, y: number) => T)) {
    this.width = width;
    this.height = height;
    this.cells = new Array<T>(width * height);
    const make = typeof fill === 'function' ? (fill as (x: number, y: number) => T) : null;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        this.cells[y * width + x] = make ? make(x, y) : (fill as T);
      }
    }
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  /** Reads outside the grid return `fallback` rather than throwing. */
  get(x: number, y: number, fallback?: T): T {
    if (!this.inBounds(x, y)) return fallback as T;
    return this.cells[y * this.width + x];
  }

  set(x: number, y: number, value: T): void {
    if (!this.inBounds(x, y)) return;
    this.cells[y * this.width + x] = value;
  }

  fill(value: T): void {
    this.cells.fill(value);
  }

  forEach(visit: (value: T, x: number, y: number) => void): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        visit(this.cells[y * this.width + x], x, y);
      }
    }
  }

  map<U>(transform: (value: T, x: number, y: number) => U): Grid<U> {
    return new Grid<U>(this.width, this.height, (x, y) => transform(this.get(x, y), x, y));
  }

  /** Raw backing array; used for fast bulk operations and serialization. */
  raw(): readonly T[] {
    return this.cells;
  }
}

/** A numeric grid backed by a typed array, for maps sampled every tick. */
export class ScalarGrid {
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;

  constructor(width: number, height: number, fill = 0) {
    this.width = width;
    this.height = height;
    this.data = new Float32Array(width * height);
    if (fill !== 0) this.data.fill(fill);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x: number, y: number): number {
    if (!this.inBounds(x, y)) return 0;
    return this.data[y * this.width + x];
  }

  set(x: number, y: number, value: number): void {
    if (!this.inBounds(x, y)) return;
    this.data[y * this.width + x] = value;
  }

  add(x: number, y: number, value: number): void {
    if (!this.inBounds(x, y)) return;
    this.data[y * this.width + x] += value;
  }

  /** Keep the highest of the existing and incoming value (coverage stacking). */
  max(x: number, y: number, value: number): void {
    if (!this.inBounds(x, y)) return;
    const i = y * this.width + x;
    if (value > this.data[i]) this.data[i] = value;
  }

  clear(): void {
    this.data.fill(0);
  }

  /** Multiply every cell, e.g. to decay pollution over time. */
  scale(factor: number): void {
    for (let i = 0; i < this.data.length; i++) this.data[i] *= factor;
  }
}

export function key(x: number, y: number): number {
  // Packs coordinates into one integer for Map/Set keys. Supports maps up to 4096 wide.
  return (y << 12) | x;
}

export function unkey(packed: number): Point {
  return { x: packed & 0xfff, y: packed >> 12 };
}

/** Iterate the tiles of a rectangle, clipped to nothing outside it. */
export function forRect(
  x0: number,
  y0: number,
  w: number,
  h: number,
  visit: (x: number, y: number) => void,
): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) visit(x, y);
  }
}

/** Tiles within a Chebyshev radius, nearest first. */
export function tilesInRadius(cx: number, cy: number, radius: number): Point[] {
  const out: Point[] = [];
  const r = Math.ceil(radius);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (Math.hypot(dx, dy) <= radius) out.push({ x: cx + dx, y: cy + dy });
    }
  }
  out.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
  return out;
}

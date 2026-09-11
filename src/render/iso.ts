/** Isometric projection between tile space and screen space. */

/** Width of one tile diamond, in world pixels at zoom 1. */
export const TILE_WIDTH = 64;
/** Height of one tile diamond. A 2:1 ratio gives the classic isometric look. */
export const TILE_HEIGHT = 32;
/** Vertical pixels per step of elevation. */
export const ELEVATION_STEP = 13;

export const HALF_WIDTH = TILE_WIDTH / 2;
export const HALF_HEIGHT = TILE_HEIGHT / 2;

export interface ScreenPoint {
  x: number;
  y: number;
}

/** Project a tile coordinate (and its height) to world-space pixels. */
export function tileToWorld(x: number, y: number, elevation = 0): ScreenPoint {
  return {
    x: (x - y) * HALF_WIDTH,
    y: (x + y) * HALF_HEIGHT - elevation * ELEVATION_STEP,
  };
}

/**
 * Invert the projection at a known elevation. Because a screen point maps to
 * a whole column of tiles once height is involved, callers that need to be
 * exact should use `pickTile`, which walks the height field.
 */
export function worldToTile(worldX: number, worldY: number, elevation = 0): ScreenPoint {
  const adjustedY = worldY + elevation * ELEVATION_STEP;
  const tx = adjustedY / TILE_HEIGHT + worldX / TILE_WIDTH;
  const ty = adjustedY / TILE_HEIGHT - worldX / TILE_WIDTH;
  return { x: tx, y: ty };
}

/** The four corners of a tile's diamond, clockwise from the north corner. */
export function tileDiamond(x: number, y: number, elevation = 0): ScreenPoint[] {
  const centre = tileToWorld(x, y, elevation);
  return [
    { x: centre.x, y: centre.y - HALF_HEIGHT },
    { x: centre.x + HALF_WIDTH, y: centre.y },
    { x: centre.x, y: centre.y + HALF_HEIGHT },
    { x: centre.x - HALF_WIDTH, y: centre.y },
  ];
}

/**
 * Painter's-algorithm sort key. Tiles further from the camera (smaller
 * x + y) are drawn first; ties are broken by height so that a building on
 * a hill draws over the slope behind it.
 */
export function depthOf(x: number, y: number, elevation = 0, bias = 0): number {
  return (x + y) * 64 + elevation * 4 + bias;
}

/** World-space bounding box of a rectangle of tiles, ignoring height. */
export function tileRectBounds(
  x: number,
  y: number,
  width: number,
  height: number,
): { left: number; top: number; right: number; bottom: number } {
  const corners = [
    tileToWorld(x, y),
    tileToWorld(x + width, y),
    tileToWorld(x, y + height),
    tileToWorld(x + width, y + height),
  ];
  return {
    left: Math.min(...corners.map((c) => c.x)) - HALF_WIDTH,
    right: Math.max(...corners.map((c) => c.x)) + HALF_WIDTH,
    top: Math.min(...corners.map((c) => c.y)) - HALF_HEIGHT,
    bottom: Math.max(...corners.map((c) => c.y)) + HALF_HEIGHT,
  };
}

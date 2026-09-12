/**
 * Tile space and world space.
 *
 * The world is three-dimensional and measured in tiles: tile (x, y) covers
 * the world square from (x, y) to (x + 1, y + 1) on the ground plane, and
 * height runs up the Y axis. So world X is tile x, world Z is tile y, and
 * nothing is projected anywhere until the camera does it.
 */
import { WorldMap, surfaceHeight, tileHeight } from '../sim/terrain';

export { surfaceHeight, tileHeight };

/** The centre of a tile, on the ground plane. */
export function tileCentre(x: number, y: number): { x: number; z: number } {
  return { x: x + 0.5, z: y + 0.5 };
}

/** The tile a world position falls in. */
export function tileAt(worldX: number, worldZ: number): { x: number; y: number } {
  return { x: Math.floor(worldX), y: Math.floor(worldZ) };
}

/** Ground height at the centre of a tile, in world units. */
export function groundAt(map: WorldMap, x: number, y: number): number {
  return surfaceHeight(map, x + 0.5, y + 0.5);
}

/**
 * The highest ground under a rectangle of tiles. Buildings stand on this
 * and skirt down to the ground behind them, the way a plinth does.
 */
export function highestGround(
  map: WorldMap,
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  let highest = -Infinity;
  for (let ty = 0; ty <= height; ty++) {
    for (let tx = 0; tx <= width; tx++) {
      highest = Math.max(highest, surfaceHeight(map, x + tx, y + ty));
    }
  }
  return highest;
}

/** The lowest ground under a rectangle of tiles. */
export function lowestGround(
  map: WorldMap,
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  let lowest = Infinity;
  for (let ty = 0; ty <= height; ty++) {
    for (let tx = 0; tx <= width; tx++) {
      lowest = Math.min(lowest, surfaceHeight(map, x + tx, y + ty));
    }
  }
  return lowest;
}

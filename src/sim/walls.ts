/**
 * The curtain wall.
 *
 * Stormwind's walls are the city's outline: they follow the boundary of the
 * land the player holds, break for gatehouses wherever a road crosses, and
 * carry towers at every corner. Buying a neighbouring lot pushes the wall
 * outward, and the masonry bill is charged for the new stonework only.
 */
import { DIRECTIONS } from '../core/grid';
import { RoadType, Terrain, WallSegment, isWater } from './types';
import {
  CityState,
  WALL_COST_PER_TILE,
  inCity,
  isTileOwned,
  markDirty,
  roadAt,
  tileIndex,
} from './city';

/** A gatehouse costs this multiple of a plain wall tile. */
export const GATE_COST_MULTIPLIER = 5;
/** A corner tower costs this multiple of a plain wall tile. */
export const TOWER_COST_MULTIPLIER = 3;

export interface WallRebuildResult {
  segments: WallSegment[];
  /** Tiles of wall that did not exist before this rebuild. */
  newTiles: number;
  newGates: number;
  newTowers: number;
  /** Gold owed for the new stonework. */
  cost: number;
}

/**
 * Work out where the wall should stand, given who owns what. Pure: it does
 * not mutate the city, so callers can quote a price before committing.
 */
export function planWalls(city: CityState): WallRebuildResult {
  const segments: WallSegment[] = [];
  const onBoundary = new Uint8Array(city.width * city.height);

  // 1. A tile is on the boundary if it is owned and touches unowned ground
  //    (or the edge of the valley).
  for (let y = 0; y < city.height; y++) {
    for (let x = 0; x < city.width; x++) {
      if (!isTileOwned(city, x, y)) continue;
      let exposed = false;
      for (const d of DIRECTIONS) {
        if (!isTileOwned(city, x + d.x, y + d.y)) {
          exposed = true;
          break;
        }
      }
      if (!exposed) continue;
      // Deep water needs no wall; the lake defends itself.
      const terrain = city.map.terrain[tileIndex(city, x, y)] as Terrain;
      if (terrain === Terrain.DeepWater) continue;
      onBoundary[tileIndex(city, x, y)] = 1;
    }
  }

  // 2. Turn boundary tiles into wall, gate or tower pieces.
  for (let y = 0; y < city.height; y++) {
    for (let x = 0; x < city.width; x++) {
      const i = tileIndex(city, x, y);
      if (!onBoundary[i]) continue;

      let connections = 0;
      for (let d = 0; d < DIRECTIONS.length; d++) {
        const nx = x + DIRECTIONS[d].x;
        const ny = y + DIRECTIONS[d].y;
        if (inCity(city, nx, ny) && onBoundary[tileIndex(city, nx, ny)]) connections |= 1 << d;
      }

      const hasRoad = roadAt(city, x, y) !== RoadType.None;
      const overWater = isWater(city.map.terrain[i] as Terrain);

      let kind: WallSegment['kind'] = 'wall';
      let orientation = 0;
      if (hasRoad) {
        kind = 'gate';
        // The passage runs the way the road runs: north-south if the road
        // continues above or below, otherwise east-west.
        const roadNorth = roadAt(city, x, y - 1) !== RoadType.None;
        const roadSouth = roadAt(city, x, y + 1) !== RoadType.None;
        orientation = roadNorth || roadSouth ? 0 : 1;
      } else if (isCorner(connections)) {
        kind = 'tower';
      } else if (overWater) {
        // A wall foot in the shallows still needs a tower to anchor it.
        kind = 'tower';
      }

      segments.push({ x, y, connections, kind, orientation });
    }
  }

  // 3. Space extra towers along long straight runs, the way Stormwind does.
  addSpacedTowers(segments);

  // 4. Price the difference against what already stands.
  let newTiles = 0;
  let newGates = 0;
  let newTowers = 0;
  for (const segment of segments) {
    const previousIndex = city.wallAt[tileIndex(city, segment.x, segment.y)];
    const previous = previousIndex >= 0 ? city.walls[previousIndex] : null;
    if (previous && previous.kind === segment.kind) continue;
    if (previous) {
      // Re-cutting an existing tile into a tower or gate costs the upgrade only.
      if (segment.kind === 'gate') newGates++;
      else if (segment.kind === 'tower') newTowers++;
      continue;
    }
    if (segment.kind === 'gate') newGates++;
    else if (segment.kind === 'tower') newTowers++;
    else newTiles++;
  }

  const cost = Math.round(
    newTiles * WALL_COST_PER_TILE +
      newTowers * WALL_COST_PER_TILE * TOWER_COST_MULTIPLIER +
      newGates * WALL_COST_PER_TILE * GATE_COST_MULTIPLIER,
  );

  return { segments, newTiles, newGates, newTowers, cost };
}

/** A boundary tile is a corner when its two neighbours are perpendicular. */
function isCorner(connections: number): boolean {
  const north = (connections & 1) !== 0;
  const east = (connections & 2) !== 0;
  const south = (connections & 4) !== 0;
  const west = (connections & 8) !== 0;
  const vertical = north || south;
  const horizontal = east || west;
  // Dead ends also get a tower so the wall never simply stops.
  const count = (north ? 1 : 0) + (east ? 1 : 0) + (south ? 1 : 0) + (west ? 1 : 0);
  return (vertical && horizontal) || count <= 1;
}

/** Promote every eighth plain wall tile of a straight run into a tower. */
function addSpacedTowers(segments: WallSegment[]): void {
  let sinceTower = 0;
  for (const segment of segments) {
    if (segment.kind !== 'wall') {
      sinceTower = 0;
      continue;
    }
    sinceTower++;
    if (sinceTower >= 9) {
      segment.kind = 'tower';
      sinceTower = 0;
    }
  }
}

/**
 * Commit a wall plan to the city, clearing the previous ring and marking
 * every affected tile for redraw.
 */
export function applyWalls(city: CityState, plan: WallRebuildResult): void {
  for (const segment of city.walls) {
    const i = tileIndex(city, segment.x, segment.y);
    if (city.wallAt[i] >= 0) {
      city.wallAt[i] = -1;
      markDirty(city, segment.x, segment.y);
    }
  }
  city.walls = plan.segments;
  for (let index = 0; index < city.walls.length; index++) {
    const segment = city.walls[index];
    city.wallAt[tileIndex(city, segment.x, segment.y)] = index;
    markDirty(city, segment.x, segment.y);
  }
  city.wallsDirty = false;
}

/**
 * Recompute the wall after an ownership change. Returns the gold charged.
 * When `charge` is false (the founding wall) the stonework is a gift.
 */
export function rebuildWalls(city: CityState, charge = true): number {
  const plan = planWalls(city);
  applyWalls(city, plan);
  if (!charge) return 0;
  city.budget.gold -= plan.cost;
  return plan.cost;
}

/** Every tile enclosed by the wall — which is simply the land you hold. */
export function isProtected(city: CityState, x: number, y: number): boolean {
  return isTileOwned(city, x, y);
}

/** Count of standing wall pieces, for the HUD and upkeep. */
export function wallStats(city: CityState): { walls: number; towers: number; gates: number } {
  let walls = 0;
  let towers = 0;
  let gates = 0;
  for (const segment of city.walls) {
    if (segment.kind === 'gate') gates++;
    else if (segment.kind === 'tower') towers++;
    else walls++;
  }
  return { walls, towers, gates };
}

/**
 * The road network: placement rules, auto-tiling connectivity, reachability
 * from the city gates, and the pathfinding that carts and villagers use.
 */
import { DIRECTIONS, Point } from '../core/grid';
import { Terrain, RoadType, isWater } from './types';
import {
  CityState,
  ROAD_COST,
  buildingTiles,
  inCity,
  isTileOwned,
  markDirty,
  roadAt,
  tileIndex,
} from './city';
import { isTileBuildable } from './terrain';
import type { Building } from './types';

/** Multiplier applied to road cost when the span crosses shallow water. */
export const BRIDGE_COST_MULTIPLIER = 4;
/** Steepest elevation change a road may climb in one tile. */
export const MAX_ROAD_SLOPE = 2;

export interface RoadPlacement {
  ok: boolean;
  reason?: string;
  cost: number;
  isBridge: boolean;
}

/** Only cart-bearing roads may bridge water; footpaths cannot. */
function canBridge(type: RoadType): boolean {
  return type === RoadType.Cobble || type === RoadType.Avenue;
}

export function evaluateRoadPlacement(
  city: CityState,
  x: number,
  y: number,
  type: RoadType,
): RoadPlacement {
  if (!inCity(city, x, y)) return { ok: false, reason: 'Outside the valley', cost: 0, isBridge: false };
  const i = tileIndex(city, x, y);
  const terrain = city.map.terrain[i] as Terrain;

  if (!isTileOwned(city, x, y)) {
    return { ok: false, reason: 'You do not hold this land', cost: 0, isBridge: false };
  }
  if (city.wallAt[i] >= 0) {
    return { ok: false, reason: 'The city wall stands here', cost: 0, isBridge: false };
  }
  if (city.buildingAt[i] >= 0) {
    return { ok: false, reason: 'A building stands here', cost: 0, isBridge: false };
  }

  const bridge = isWater(terrain);
  if (bridge) {
    if (terrain === Terrain.DeepWater) {
      return { ok: false, reason: 'The water is too deep', cost: 0, isBridge: false };
    }
    if (!canBridge(type)) {
      return { ok: false, reason: 'Footpaths cannot bridge water', cost: 0, isBridge: false };
    }
  } else if (!isTileBuildable(city.map, x, y)) {
    return { ok: false, reason: 'The ground will not take a road', cost: 0, isBridge: false };
  }

  const existing = city.roads[i] as RoadType;
  if (existing === type) return { ok: false, reason: 'Already paved', cost: 0, isBridge: bridge };

  let cost = ROAD_COST[type as RoadType.Path | RoadType.Cobble | RoadType.Avenue];
  if (bridge) cost *= BRIDGE_COST_MULTIPLIER;
  // Upgrading only charges the difference.
  if (existing !== RoadType.None) {
    const previous = ROAD_COST[existing as RoadType.Path | RoadType.Cobble | RoadType.Avenue];
    cost = Math.max(2, cost - previous);
  }
  return { ok: true, cost: Math.round(cost), isBridge: bridge };
}

export function placeRoad(city: CityState, x: number, y: number, type: RoadType): boolean {
  const check = evaluateRoadPlacement(city, x, y, type);
  if (!check.ok) return false;
  if (city.budget.gold < check.cost) return false;
  city.budget.gold -= check.cost;
  city.roads[tileIndex(city, x, y)] = type;
  // The road and its neighbours all change appearance when connectivity shifts.
  markDirty(city, x, y);
  for (const d of DIRECTIONS) markDirty(city, x + d.x, y + d.y);
  return true;
}

export function removeRoad(city: CityState, x: number, y: number): boolean {
  if (!inCity(city, x, y)) return false;
  const i = tileIndex(city, x, y);
  if (city.roads[i] === RoadType.None) return false;
  city.roads[i] = RoadType.None;
  markDirty(city, x, y);
  for (const d of DIRECTIONS) markDirty(city, x + d.x, y + d.y);
  return true;
}

/**
 * Four-bit mask of which cardinal neighbours this road joins, in
 * DIRECTIONS order (N=1, E=2, S=4, W=8). Used for auto-tiling the artwork.
 */
export function roadConnectionMask(city: CityState, x: number, y: number): number {
  const here = roadAt(city, x, y);
  if (here === RoadType.None) return 0;
  let mask = 0;
  for (let d = 0; d < DIRECTIONS.length; d++) {
    const nx = x + DIRECTIONS[d].x;
    const ny = y + DIRECTIONS[d].y;
    if (roadAt(city, nx, ny) !== RoadType.None) mask |= 1 << d;
  }
  return mask;
}

/** Roads join only if the elevation step between them is walkable. */
export function roadsConnect(city: CityState, ax: number, ay: number, bx: number, by: number): boolean {
  if (roadAt(city, ax, ay) === RoadType.None || roadAt(city, bx, by) === RoadType.None) return false;
  const ea = city.map.elevation[tileIndex(city, ax, ay)];
  const eb = city.map.elevation[tileIndex(city, bx, by)];
  return Math.abs(ea - eb) <= MAX_ROAD_SLOPE;
}

/** True when a cart can use this road class. */
export function carriesCarts(type: RoadType): boolean {
  return type === RoadType.Cobble || type === RoadType.Avenue;
}

/** How fast a cart rolls along a road class. */
export function roadSpeed(type: RoadType): number {
  switch (type) {
    case RoadType.Avenue:
      return 1.5;
    case RoadType.Cobble:
      return 1.15;
    case RoadType.Path:
      return 0.8;
    default:
      return 0.45;
  }
}

/**
 * How fast someone on foot moves. A packed footpath is as good as cobbles
 * for walking and better than dodging carts on an avenue, which is what
 * makes paths worth laying: they are cheap, and they are for people.
 */
export function walkSpeed(type: RoadType): number {
  switch (type) {
    case RoadType.Path:
      return 1.2;
    case RoadType.Cobble:
      return 1.05;
    case RoadType.Avenue:
      return 1.15;
    default:
      return 0.45;
  }
}

/** Road tiles orthogonally adjacent to a building's footprint. */
export function adjacentRoadTiles(city: CityState, building: Building): Point[] {
  const out: Point[] = [];
  const seen = new Set<number>();
  for (const tile of buildingTiles(building)) {
    for (const d of DIRECTIONS) {
      const nx = tile.x + d.x;
      const ny = tile.y + d.y;
      if (!inCity(city, nx, ny)) continue;
      if (roadAt(city, nx, ny) === RoadType.None) continue;
      const k = tileIndex(city, nx, ny);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ x: nx, y: ny });
    }
  }
  return out;
}

export function hasRoadAccess(city: CityState, building: Building): boolean {
  return adjacentRoadTiles(city, building).length > 0;
}

/** The single road tile a building's traffic uses, or null when cut off. */
export function doorTile(city: CityState, building: Building): Point | null {
  const options = adjacentRoadTiles(city, building);
  if (options.length === 0) return null;
  // Prefer the best-connected road so carts spawn on a through street.
  let best = options[0];
  let bestScore = -1;
  for (const option of options) {
    const type = roadAt(city, option.x, option.y);
    const score = roadSpeed(type) * 10 + popcount(roadConnectionMask(city, option.x, option.y));
    if (score > bestScore) {
      bestScore = score;
      best = option;
    }
  }
  return best;
}

function popcount(value: number): number {
  let v = value;
  let count = 0;
  while (v) {
    count += v & 1;
    v >>= 1;
  }
  return count;
}

/** Tiles where the king's road (or any road) crosses the city wall. */
export function gateTiles(city: CityState): Point[] {
  const out: Point[] = [];
  for (const wall of city.walls) {
    if (wall.kind === 'gate') out.push({ x: wall.x, y: wall.y });
  }
  return out;
}

/**
 * Breadth-first hop count along the road network from every city gate.
 * Buildings far from a gate are harder to supply and less desirable.
 */
export function computeGateDistance(city: CityState): void {
  city.gateDistance.fill(Infinity);
  const queue: number[] = [];
  const gates = gateTiles(city);

  // If no walls exist yet, seed from wherever the king's road leaves the map.
  const seeds: Point[] = gates.length > 0 ? gates : [city.map.roadEntry];
  for (const seed of seeds) {
    if (!inCity(city, seed.x, seed.y)) continue;
    if (roadAt(city, seed.x, seed.y) === RoadType.None) continue;
    const i = tileIndex(city, seed.x, seed.y);
    city.gateDistance[i] = 0;
    queue.push(i);
  }

  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const x = i % city.width;
    const y = (i / city.width) | 0;
    for (const d of DIRECTIONS) {
      const nx = x + d.x;
      const ny = y + d.y;
      if (!inCity(city, nx, ny)) continue;
      if (!roadsConnect(city, x, y, nx, ny)) continue;
      const ni = tileIndex(city, nx, ny);
      if (city.gateDistance[ni] <= city.gateDistance[i] + 1) continue;
      city.gateDistance[ni] = city.gateDistance[i] + 1;
      queue.push(ni);
    }
  }
}

export interface PathOptions {
  /** Restrict to roads carts can use. */
  cartsOnly?: boolean;
  /** Cost the route the way someone walking it would. */
  onFoot?: boolean;
  /** Give up after this many expanded nodes. */
  maxNodes?: number;
}

/**
 * A* between two road tiles. Returns packed tile indices from start to goal,
 * or null when no route exists within the node budget.
 */
export function findRoadPath(
  city: CityState,
  from: Point,
  to: Point,
  options: PathOptions = {},
): number[] | null {
  if (!inCity(city, from.x, from.y) || !inCity(city, to.x, to.y)) return null;
  const startIndex = tileIndex(city, from.x, from.y);
  const goalIndex = tileIndex(city, to.x, to.y);
  if (startIndex === goalIndex) return [startIndex];
  if (roadAt(city, from.x, from.y) === RoadType.None) return null;
  if (roadAt(city, to.x, to.y) === RoadType.None) return null;

  const cartsOnly = options.cartsOnly ?? false;
  const onFoot = options.onFoot ?? false;
  const speedOf = onFoot ? walkSpeed : roadSpeed;
  const maxNodes = options.maxNodes ?? 4000;

  const gScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  const open: { i: number; f: number }[] = [];
  const closed = new Set<number>();

  const heuristic = (i: number) => {
    const x = i % city.width;
    const y = (i / city.width) | 0;
    return Math.abs(x - to.x) + Math.abs(y - to.y);
  };

  gScore.set(startIndex, 0);
  open.push({ i: startIndex, f: heuristic(startIndex) });
  let expanded = 0;

  while (open.length > 0 && expanded < maxNodes) {
    let bestAt = 0;
    for (let k = 1; k < open.length; k++) if (open[k].f < open[bestAt].f) bestAt = k;
    const current = open.splice(bestAt, 1)[0].i;
    if (closed.has(current)) continue;
    closed.add(current);
    expanded++;

    if (current === goalIndex) {
      const path: number[] = [current];
      let node = current;
      while (cameFrom.has(node)) {
        node = cameFrom.get(node) as number;
        path.push(node);
      }
      path.reverse();
      return path;
    }

    const cx = current % city.width;
    const cy = (current / city.width) | 0;
    for (const d of DIRECTIONS) {
      const nx = cx + d.x;
      const ny = cy + d.y;
      if (!inCity(city, nx, ny)) continue;
      const ni = tileIndex(city, nx, ny);
      if (closed.has(ni)) continue;
      const type = roadAt(city, nx, ny);
      if (type === RoadType.None) continue;
      if (cartsOnly && !carriesCarts(type)) continue;
      if (!roadsConnect(city, cx, cy, nx, ny)) continue;

      const step = 1 / speedOf(type);
      const tentative = (gScore.get(current) ?? Infinity) + step;
      if (tentative < (gScore.get(ni) ?? Infinity)) {
        gScore.set(ni, tentative);
        cameFrom.set(ni, current);
        open.push({ i: ni, f: tentative + heuristic(ni) });
      }
    }
  }
  return null;
}

/** Convert a packed path into tile-space waypoints. */
export function pathToPoints(city: CityState, path: readonly number[]): Point[] {
  return path.map((i) => ({ x: i % city.width, y: (i / city.width) | 0 }));
}

/** Total road tiles laid, by class; used for upkeep. */
export function countRoads(city: CityState): Record<RoadType, number> {
  const counts = {
    [RoadType.None]: 0,
    [RoadType.Path]: 0,
    [RoadType.Cobble]: 0,
    [RoadType.Avenue]: 0,
  } as Record<RoadType, number>;
  for (let i = 0; i < city.roads.length; i++) counts[city.roads[i] as RoadType]++;
  return counts;
}

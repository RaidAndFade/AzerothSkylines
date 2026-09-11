/**
 * Player actions: raising buildings, tearing things down, and annexing the
 * land the walls will grow to enclose.
 */
import { DIRECTIONS } from '../core/grid';
import { RoadType, Zone } from './types';
import {
  CityState,
  DEMOLISH_COST_PER_TILE,
  PARCEL_SIZE,
  buildingAtTile,
  createBuilding,
  inCity,
  isTileOwned,
  logEvent,
  markDirty,
  markRectDirty,
  parcelAt,
  registerBuilding,
  removeBuilding,
  tileIndex,
  touchesWater,
} from './city';
import { getDef } from '../data/buildings';
import { isTileBuildable } from './terrain';
import { computeRoadComponents } from './trade';
import { planWalls, applyWalls } from './walls';
import { isGrown } from './growth';

export interface PlacementCheck {
  ok: boolean;
  reason?: string;
  cost: number;
}

/**
 * Can this definition stand here? Checks ownership, ground, clearance,
 * special siting requirements and the treasury.
 */
export function evaluatePlacement(
  city: CityState,
  defId: string,
  x: number,
  y: number,
): PlacementCheck {
  const def = getDef(defId);
  const cost = def.cost;

  if (def.unlockPopulation && city.stats.population < def.unlockPopulation) {
    return { ok: false, reason: `Needs a population of ${def.unlockPopulation}`, cost };
  }

  let baseElevation: number | null = null;
  for (let ty = y; ty < y + def.height; ty++) {
    for (let tx = x; tx < x + def.width; tx++) {
      if (!inCity(city, tx, ty)) return { ok: false, reason: 'Outside the valley', cost };
      if (!isTileOwned(city, tx, ty)) return { ok: false, reason: 'You do not hold this land', cost };
      if (!isTileBuildable(city.map, tx, ty)) return { ok: false, reason: 'The ground will not take it', cost };
      const i = tileIndex(city, tx, ty);
      if (city.roads[i] !== RoadType.None) return { ok: false, reason: 'A road runs here', cost };
      if (city.wallAt[i] >= 0) return { ok: false, reason: 'The city wall stands here', cost };
      if (city.buildingAt[i] >= 0) return { ok: false, reason: 'Something already stands here', cost };
      const elevation = city.map.elevation[i];
      if (baseElevation === null) baseElevation = elevation;
      else if (Math.abs(elevation - baseElevation) > 1) {
        return { ok: false, reason: 'The ground is too uneven', cost };
      }
    }
  }

  if (def.requiresWaterAdjacency && !touchesWater(city, x, y, def.width, def.height)) {
    return { ok: false, reason: 'Must be built against the water', cost };
  }

  if (!hasAdjacentRoad(city, x, y, def.width, def.height)) {
    return { ok: false, reason: 'Must front onto a road', cost };
  }

  if (def.requiresMapEdge && !reachesTheWorld(city, x, y, def.width, def.height)) {
    return { ok: false, reason: 'Needs a road running out of the valley', cost };
  }

  if (city.budget.gold < cost) return { ok: false, reason: 'Not enough gold', cost };

  return { ok: true, cost };
}

function hasAdjacentRoad(city: CityState, x: number, y: number, w: number, h: number): boolean {
  for (let ty = y; ty < y + h; ty++) {
    for (let tx = x; tx < x + w; tx++) {
      for (const d of DIRECTIONS) {
        const nx = tx + d.x;
        const ny = ty + d.y;
        if (nx >= x && nx < x + w && ny >= y && ny < y + h) continue;
        if (!inCity(city, nx, ny)) continue;
        if (city.roads[tileIndex(city, nx, ny)] !== RoadType.None) return true;
      }
    }
  }
  return false;
}

/**
 * True when the plot's street is part of the same road network as the
 * king's road where it leaves the valley — the trade route to the kingdom.
 */
function reachesTheWorld(city: CityState, x: number, y: number, w: number, h: number): boolean {
  const labels = computeRoadComponents(city);
  const entry = city.map.roadEntry;
  if (!inCity(city, entry.x, entry.y)) return false;
  const worldLabel = labels[tileIndex(city, entry.x, entry.y)];
  if (worldLabel < 0) return false;

  for (let ty = y - 1; ty <= y + h; ty++) {
    for (let tx = x - 1; tx <= x + w; tx++) {
      if (!inCity(city, tx, ty)) continue;
      if (labels[tileIndex(city, tx, ty)] === worldLabel) return true;
    }
  }
  return false;
}

/** Raise a building, charging the treasury. */
export function placeBuilding(city: CityState, defId: string, x: number, y: number): boolean {
  const check = evaluatePlacement(city, defId, x, y);
  if (!check.ok) return false;
  city.budget.gold -= check.cost;

  const building = createBuilding(city, defId, x, y, facingTowardRoad(city, x, y, getDef(defId).width, getDef(defId).height));
  registerBuilding(city, building);
  // Clear any zoning paint beneath a placed building.
  for (let ty = y; ty < y + building.height; ty++) {
    for (let tx = x; tx < x + building.width; tx++) city.zones[tileIndex(city, tx, ty)] = Zone.None;
  }
  logEvent(city, `${getDef(defId).name} raised.`, 'good');
  return true;
}

function facingTowardRoad(city: CityState, x: number, y: number, w: number, h: number): number {
  for (let d = 0; d < DIRECTIONS.length; d++) {
    for (let ty = y; ty < y + h; ty++) {
      for (let tx = x; tx < x + w; tx++) {
        const nx = tx + DIRECTIONS[d].x;
        const ny = ty + DIRECTIONS[d].y;
        if (nx >= x && nx < x + w && ny >= y && ny < y + h) continue;
        if (!inCity(city, nx, ny)) continue;
        if (city.roads[tileIndex(city, nx, ny)] !== RoadType.None) return d;
      }
    }
  }
  return 2;
}

export interface DemolishResult {
  ok: boolean;
  reason?: string;
  cost: number;
}

/**
 * Clear a tile. Buildings go first, then roads, then zoning paint. Walls
 * cannot be knocked down by hand — they follow the land you hold.
 */
export function demolish(city: CityState, x: number, y: number): DemolishResult {
  if (!inCity(city, x, y)) return { ok: false, reason: 'Outside the valley', cost: 0 };
  const i = tileIndex(city, x, y);

  if (city.wallAt[i] >= 0) {
    return { ok: false, reason: 'The wall follows the land you hold', cost: 0 };
  }

  const building = buildingAtTile(city, x, y);
  if (building) {
    const tiles = building.width * building.height;
    const cost = isGrown(building) ? tiles * DEMOLISH_COST_PER_TILE : Math.round(getDef(building.defId).cost * 0.1);
    if (city.budget.gold < cost) return { ok: false, reason: 'Not enough gold', cost };
    city.budget.gold -= cost;
    removeBuilding(city, building.id);
    return { ok: true, cost };
  }

  if (city.roads[i] !== RoadType.None) {
    const cost = DEMOLISH_COST_PER_TILE;
    if (city.budget.gold < cost) return { ok: false, reason: 'Not enough gold', cost };
    city.budget.gold -= cost;
    city.roads[i] = RoadType.None;
    markDirty(city, x, y);
    for (const d of DIRECTIONS) markDirty(city, x + d.x, y + d.y);
    return { ok: true, cost };
  }

  if (city.zones[i] !== Zone.None) {
    city.zones[i] = Zone.None;
    markDirty(city, x, y);
    return { ok: true, cost: 0 };
  }

  return { ok: false, reason: 'Nothing to clear', cost: 0 };
}

export interface ParcelQuote {
  ok: boolean;
  reason?: string;
  /** Price of the land itself. */
  land: number;
  /** Price of extending the curtain wall around it. */
  masonry: number;
  total: number;
}

/** Price up annexing a parcel, including the stonework it will need. */
export function quoteParcel(city: CityState, px: number, py: number): ParcelQuote {
  const parcel = parcelAt(city, px, py);
  if (!parcel) return { ok: false, reason: 'No such land', land: 0, masonry: 0, total: 0 };
  if (parcel.owned) return { ok: false, reason: 'Already yours', land: 0, masonry: 0, total: 0 };
  if (!parcel.settleable) {
    return { ok: false, reason: 'Nothing there but water and stone', land: 0, masonry: 0, total: 0 };
  }

  const adjacent = [
    parcelAt(city, px - 1, py),
    parcelAt(city, px + 1, py),
    parcelAt(city, px, py - 1),
    parcelAt(city, px, py + 1),
  ].some((p) => p?.owned);
  if (!adjacent) {
    return { ok: false, reason: 'Must adjoin land you already hold', land: 0, masonry: 0, total: 0 };
  }

  // Plan the wall as if the parcel were already ours, to quote the masonry.
  parcel.owned = true;
  const plan = planWalls(city);
  parcel.owned = false;

  const land = parcel.price;
  const masonry = plan.cost;
  return { ok: true, land, masonry, total: land + masonry };
}

/** Annex a parcel and push the walls out to enclose it. */
export function buyParcel(city: CityState, px: number, py: number): ParcelQuote {
  const quote = quoteParcel(city, px, py);
  if (!quote.ok) return quote;
  if (city.budget.gold < quote.total) {
    return { ...quote, ok: false, reason: 'Not enough gold' };
  }

  const parcel = parcelAt(city, px, py);
  if (!parcel) return { ...quote, ok: false, reason: 'No such land' };

  city.budget.gold -= quote.total;
  parcel.owned = true;
  applyWalls(city, planWalls(city));
  markRectDirty(city, px * PARCEL_SIZE, py * PARCEL_SIZE, PARCEL_SIZE, PARCEL_SIZE);
  logEvent(
    city,
    `New ground broken: ${quote.land}g for the land, ${quote.masonry}g for the walls.`,
    'good',
  );
  return quote;
}

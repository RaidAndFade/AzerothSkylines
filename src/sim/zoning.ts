/** Painting and querying the zoning grid. */
import { DIRECTIONS } from '../core/grid';
import { RoadType, Zone } from './types';
import {
  CityState,
  buildingAtTile,
  inCity,
  isTileOwned,
  markDirty,
  roadAt,
  tileIndex,
  zoneAt,
} from './city';
import { isTileBuildable } from './terrain';

/** Gold charged per tile of zoning paint — surveying and charters. */
export const ZONE_COST_PER_TILE = 3;

export interface ZoneCheck {
  ok: boolean;
  reason?: string;
}

export function canZone(city: CityState, x: number, y: number, zone: Zone): ZoneCheck {
  if (!inCity(city, x, y)) return { ok: false, reason: 'Outside the valley' };
  if (!isTileOwned(city, x, y)) return { ok: false, reason: 'You do not hold this land' };
  if (!isTileBuildable(city.map, x, y)) return { ok: false, reason: 'The ground cannot be built on' };
  const i = tileIndex(city, x, y);
  if (city.roads[i] !== RoadType.None) return { ok: false, reason: 'A road runs here' };
  if (city.wallAt[i] >= 0) return { ok: false, reason: 'The city wall stands here' };
  if (city.buildingAt[i] >= 0) {
    const building = buildingAtTile(city, x, y);
    // Repainting under an existing building is allowed only to clear it.
    if (building && zone !== Zone.None) return { ok: false, reason: 'A building stands here' };
  }
  if (city.zones[i] === zone) return { ok: false, reason: 'Already zoned' };
  return { ok: true };
}

/** Paint one tile. Returns the gold spent, or 0 if nothing changed. */
export function setZone(city: CityState, x: number, y: number, zone: Zone): number {
  const check = canZone(city, x, y, zone);
  if (!check.ok) return 0;
  const cost = zone === Zone.None ? 0 : ZONE_COST_PER_TILE;
  if (cost > city.budget.gold) return 0;
  city.budget.gold -= cost;
  city.zones[tileIndex(city, x, y)] = zone;
  markDirty(city, x, y);
  return cost;
}

/** Zoned tiles only develop when a street runs past the door. */
export function hasStreetFrontage(city: CityState, x: number, y: number, w = 1, h = 1): boolean {
  for (let ty = y; ty < y + h; ty++) {
    for (let tx = x; tx < x + w; tx++) {
      for (const d of DIRECTIONS) {
        if (roadAt(city, tx + d.x, ty + d.y) !== RoadType.None) return true;
      }
    }
  }
  return false;
}

/** The direction a building on this tile should face: toward its street. */
export function frontageFacing(city: CityState, x: number, y: number, w = 1, h = 1): number {
  for (let d = 0; d < DIRECTIONS.length; d++) {
    for (let ty = y; ty < y + h; ty++) {
      for (let tx = x; tx < x + w; tx++) {
        const nx = tx + DIRECTIONS[d].x;
        const ny = ty + DIRECTIONS[d].y;
        // Only look outward from the footprint.
        if (nx >= x && nx < x + w && ny >= y && ny < y + h) continue;
        if (roadAt(city, nx, ny) !== RoadType.None) return d;
      }
    }
  }
  return 2;
}

/** Tiles of a zone that are empty and ready to develop. */
export function developableTiles(city: CityState, zone: Zone): number[] {
  const out: number[] = [];
  for (let y = 0; y < city.height; y++) {
    for (let x = 0; x < city.width; x++) {
      const i = tileIndex(city, x, y);
      if (city.zones[i] !== zone) continue;
      if (city.buildingAt[i] >= 0) continue;
      if (city.roads[i] !== RoadType.None) continue;
      if (city.wallAt[i] >= 0) continue;
      if (!hasStreetFrontage(city, x, y)) continue;
      out.push(i);
    }
  }
  return out;
}

/** Count zoned tiles by type. */
export function zoneCounts(city: CityState): Record<Zone, number> {
  const counts = {
    [Zone.None]: 0,
    [Zone.Residential]: 0,
    [Zone.Commercial]: 0,
    [Zone.Industrial]: 0,
  } as Record<Zone, number>;
  for (let i = 0; i < city.zones.length; i++) counts[city.zones[i] as Zone]++;
  return counts;
}

export { zoneAt };

/**
 * Water and drainage.
 *
 * Both run beneath the streets, so a source pushes service out along the
 * road network rather than in a naive circle. Each source serves a limited
 * number of buildings; overload it and the houses at the far end go dry.
 */
import { DIRECTIONS } from '../core/grid';
import { Building, BuildingKind, Service } from './types';
import { CityState, buildingTiles, inCity, tileIndex } from './city';
import { getDef } from '../data/buildings';
import { roadsConnect } from './roads';
import { RoadType } from './types';

/** Buildings that need plumbing at all. */
export function needsUtilities(building: Building): boolean {
  return (
    building.kind === BuildingKind.Dwelling ||
    building.kind === BuildingKind.Shop ||
    building.kind === BuildingKind.Workshop
  );
}

export interface UtilityReport {
  /** Buildings connected to at least one source. */
  connected: number;
  /** Buildings that asked for service and got it. */
  served: number;
  /** Total capacity installed. */
  capacity: number;
  /** Demand placed on the networks. */
  demand: number;
}

/**
 * Distribute one utility across the city. Sources are worked in order of
 * capacity, largest first, each claiming the nearest unserved buildings it
 * can reach along the roads until its capacity runs out.
 */
export function distributeUtility(city: CityState, service: Service.Water | Service.Sewage): UtilityReport {
  const field = city.coverage[service];
  field.fill(0);

  const consumers: Building[] = [];
  for (const building of city.buildings.values()) {
    if (!building.abandoned && needsUtilities(building)) consumers.push(building);
  }

  // Map every consumer's door tiles back to the building, so a BFS over roads
  // can discover who it reaches.
  const consumerAt = new Map<number, Building[]>();
  for (const building of consumers) {
    for (const tile of buildingTiles(building)) {
      for (const d of DIRECTIONS) {
        const nx = tile.x + d.x;
        const ny = tile.y + d.y;
        if (!inCity(city, nx, ny)) continue;
        if (city.roads[tileIndex(city, nx, ny)] === RoadType.None) continue;
        const key = tileIndex(city, nx, ny);
        const list = consumerAt.get(key);
        if (list) {
          if (!list.includes(building)) list.push(building);
        } else {
          consumerAt.set(key, [building]);
        }
      }
    }
  }

  const sources = [...city.buildings.values()]
    .filter((b) => !b.abandoned && getDef(b.defId).utility?.type === service)
    .sort((a, b) => (getDef(b.defId).utility?.capacity ?? 0) - (getDef(a.defId).utility?.capacity ?? 0));

  const served = new Set<number>();
  const reachable = new Set<number>();
  let capacity = 0;

  for (const source of sources) {
    const spec = getDef(source.defId).utility;
    if (!spec) continue;
    capacity += spec.capacity;
    let remaining = spec.capacity;

    // Seed the flood from every road tile touching the source.
    const distance = new Map<number, number>();
    const queue: number[] = [];
    for (const tile of buildingTiles(source)) {
      for (const d of DIRECTIONS) {
        const nx = tile.x + d.x;
        const ny = tile.y + d.y;
        if (!inCity(city, nx, ny)) continue;
        const i = tileIndex(city, nx, ny);
        if (city.roads[i] === RoadType.None) continue;
        if (distance.has(i)) continue;
        distance.set(i, 0);
        queue.push(i);
      }
    }

    for (let head = 0; head < queue.length; head++) {
      const i = queue[head];
      const depth = distance.get(i) ?? 0;
      const x = i % city.width;
      const y = (i / city.width) | 0;

      // Mark the pipe run itself, so the overlay shows the served streets.
      field[i] = Math.max(field[i], 1);

      for (const building of consumerAt.get(i) ?? []) {
        reachable.add(building.id);
        if (remaining <= 0 || served.has(building.id)) continue;
        served.add(building.id);
        remaining--;
        for (const tile of buildingTiles(building)) {
          if (inCity(city, tile.x, tile.y)) field[tileIndex(city, tile.x, tile.y)] = 1;
        }
      }

      if (depth >= spec.networkRange) continue;
      for (const d of DIRECTIONS) {
        const nx = x + d.x;
        const ny = y + d.y;
        if (!inCity(city, nx, ny)) continue;
        const ni = tileIndex(city, nx, ny);
        if (distance.has(ni)) continue;
        if (!roadsConnect(city, x, y, nx, ny)) continue;
        distance.set(ni, depth + 1);
        queue.push(ni);
      }
    }
  }

  return {
    connected: reachable.size,
    served: served.size,
    capacity,
    demand: consumers.length,
  };
}

/** Read a building's utility level as a 0 or 1. */
export function utilityLevel(city: CityState, building: Building, service: Service): number {
  return city.coverage[service][tileIndex(city, building.x, building.y)] > 0 ? 1 : 0;
}

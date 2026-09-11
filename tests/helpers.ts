/**
 * Test fixtures. Most simulation tests want a predictable, flat valley
 * rather than a randomly generated one, so that assertions are about the
 * rules rather than about the terrain that happened to roll.
 */
import { CityState, PARCEL_SIZE, createCity, parcelAt, tileIndex } from '@/sim/city';
import { RoadType, Terrain, Zone } from '@/sim/types';
import { Simulation } from '@/sim/simulation';
import { createTrafficQueue } from '@/sim/agents';
import { rebuildWalls } from '@/sim/walls';
import { setZone } from '@/sim/zoning';

export interface FlatCityOptions {
  size?: number;
  /** How many parcels across and down to own, from the top-left. */
  ownedParcels?: number;
  gold?: number;
}

/**
 * A flat grass valley with a straight king's road running west to east
 * through the middle of the owned land.
 */
export function makeFlatCity(options: FlatCityOptions = {}): CityState {
  const size = options.size ?? 32;
  const owned = options.ownedParcels ?? 2;
  const city = createCity({ width: size, height: size, seed: 'test-valley', startingGold: options.gold ?? 100000 });

  // Flatten everything to buildable grass.
  city.map.terrain.fill(Terrain.Grass);
  city.map.elevation.fill(1);
  city.map.heightField.fill(0.5);
  city.map.treeDensity.fill(0);
  city.map.fertility.fill(0.6);
  city.map.oreRichness.fill(0.2);
  city.roads.fill(RoadType.None);
  city.zones.fill(Zone.None);
  city.buildingAt.fill(-1);
  city.wallAt.fill(-1);
  city.buildings.clear();
  city.walls = [];

  // Own a square block of parcels in the north-west of the valley.
  for (const parcel of city.parcels) {
    parcel.settleable = true;
    parcel.owned = parcel.px < owned && parcel.py < owned;
  }

  // A straight road along the middle row of the owned block.
  const roadY = Math.floor((owned * PARCEL_SIZE) / 2);
  for (let x = 0; x < owned * PARCEL_SIZE; x++) {
    city.roads[tileIndex(city, x, roadY)] = RoadType.Cobble;
  }
  // And out through the western edge, so the city has a route to the world.
  const entry = city.map as unknown as { roadEntry: { x: number; y: number }; foundingSite: { x: number; y: number } };
  entry.roadEntry = { x: 0, y: roadY };
  entry.foundingSite = { x: Math.floor((owned * PARCEL_SIZE) / 2), y: roadY };

  rebuildWalls(city, false);
  return city;
}

/** The y coordinate of the straight road laid by `makeFlatCity`. */
export function mainRoadY(ownedParcels = 2): number {
  return Math.floor((ownedParcels * PARCEL_SIZE) / 2);
}

/** Paint a rectangle of zoning, bypassing the gold check for convenience. */
export function zoneRect(
  city: CityState,
  zone: Zone,
  x0: number,
  y0: number,
  w: number,
  h: number,
): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) setZone(city, x, y, zone);
  }
}

/** Run a simulation for a number of game-days. */
export function runDays(city: CityState, days: number): Simulation {
  const sim = new Simulation(city, createTrafficQueue());
  for (let i = 0; i < days; i++) sim.runDay();
  return sim;
}

/** Own every parcel in a square block, for tests that need more room. */
export function ownParcelBlock(city: CityState, width: number, height: number): void {
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const parcel = parcelAt(city, px, py);
      if (parcel) {
        parcel.owned = true;
        parcel.settleable = true;
      }
    }
  }
  rebuildWalls(city, false);
}

/**
 * Radius services, pollution and land value — the three fields that decide
 * whether a neighbourhood thrives or rots.
 */
import { clamp, clamp01, lerp } from '../core/math';
import { Service, Terrain, RoadType, isWater } from './types';
import { CityState, buildingCenter, tileIndex, treeDensityAt } from './city';
import { getDef } from '../data/buildings';
import { MAX_ELEVATION } from './terrain';

/** Services that radiate from a building rather than running under streets. */
export const RADIUS_SERVICES: readonly Service[] = [
  Service.Safety,
  Service.Faith,
  Service.Leisure,
  Service.Commerce,
];

/**
 * Splat every provider's coverage into its service field, keeping the
 * strongest contribution at each tile.
 */
export function computeServiceCoverage(city: CityState): void {
  for (const service of RADIUS_SERVICES) city.coverage[service].fill(0);

  for (const building of city.buildings.values()) {
    if (building.abandoned) continue;
    const def = getDef(building.defId);
    if (!def.provides) continue;
    // A shop with nobody behind the counter serves nobody.
    const staffing =
      def.jobs && def.jobs > 0 ? clamp01(0.35 + (building.workers / def.jobs) * 0.65) : 1;

    const centre = buildingCenter(building);
    for (const key of Object.keys(def.provides) as Service[]) {
      const spec = def.provides[key];
      if (!spec) continue;
      const field = city.coverage[key];
      const radius = spec.radius;
      const strength = spec.strength * staffing;
      const r = Math.ceil(radius);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = Math.round(centre.x) + dx;
          const y = Math.round(centre.y) + dy;
          if (x < 0 || y < 0 || x >= city.width || y >= city.height) continue;
          const d = Math.hypot(dx, dy);
          if (d > radius) continue;
          // Full strength at the door, tapering to nothing at the edge.
          const value = strength * (1 - (d / radius) ** 1.6);
          const i = tileIndex(city, x, y);
          if (value > field[i]) field[i] = value;
        }
      }
    }
  }
}

/** Smoke and filth accumulate near workshops and drains, then disperse. */
export function computePollution(city: CityState): void {
  const next = new Float32Array(city.pollution.length);

  for (const building of city.buildings.values()) {
    if (building.abandoned) continue;
    const def = getDef(building.defId);
    const amount = def.pollution ?? 0;
    if (amount <= 0) continue;
    const staffing = def.jobs && def.jobs > 0 ? clamp01(0.3 + building.workers / def.jobs) : 1;
    const centre = buildingCenter(building);
    const radius = 4 + amount * 9;
    const r = Math.ceil(radius);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = Math.round(centre.x) + dx;
        const y = Math.round(centre.y) + dy;
        if (x < 0 || y < 0 || x >= city.width || y >= city.height) continue;
        const d = Math.hypot(dx, dy);
        if (d > radius) continue;
        next[tileIndex(city, x, y)] += amount * staffing * (1 - d / radius);
      }
    }
  }

  // Buildings with no drainage foul their own street.
  const sewage = city.coverage[Service.Sewage];
  for (const building of city.buildings.values()) {
    if (building.abandoned || building.residents + building.workers === 0) continue;
    const i = tileIndex(city, building.x, building.y);
    if (sewage[i] > 0) continue;
    const load = (building.residents + building.workers) / 90;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = building.x + dx;
        const y = building.y + dy;
        if (x < 0 || y < 0 || x >= city.width || y >= city.height) continue;
        next[tileIndex(city, x, y)] += load;
      }
    }
  }

  // Ease toward the new reading so the overlay does not flicker.
  for (let i = 0; i < city.pollution.length; i++) {
    city.pollution[i] = lerp(city.pollution[i], clamp01(next[i]), 0.35);
  }
}

/**
 * Land value blends natural beauty, the services reaching the plot, the
 * quality of its street and how much smoke hangs over it.
 */
export function computeLandValue(city: CityState): void {
  const safety = city.coverage[Service.Safety];
  const faith = city.coverage[Service.Faith];
  const leisure = city.coverage[Service.Leisure];
  const commerce = city.coverage[Service.Commerce];
  const water = city.coverage[Service.Water];
  const sewage = city.coverage[Service.Sewage];

  // Buildings themselves raise or lower the tone of a district.
  const influence = new Float32Array(city.landValue.length);
  for (const building of city.buildings.values()) {
    const def = getDef(building.defId);
    const effect = (def.landValue ?? 0) / 100;
    if (effect === 0) continue;
    const centre = buildingCenter(building);
    const radius = 6 + Math.abs(def.landValue ?? 0) * 0.5;
    const r = Math.ceil(radius);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = Math.round(centre.x) + dx;
        const y = Math.round(centre.y) + dy;
        if (x < 0 || y < 0 || x >= city.width || y >= city.height) continue;
        const d = Math.hypot(dx, dy);
        if (d > radius) continue;
        influence[tileIndex(city, x, y)] += effect * (1 - d / radius) * (building.abandoned ? -1 : 1);
      }
    }
  }

  for (let y = 0; y < city.height; y++) {
    for (let x = 0; x < city.width; x++) {
      const i = tileIndex(city, x, y);
      const terrain = city.map.terrain[i] as Terrain;
      if (isWater(terrain)) {
        city.landValue[i] = 0;
        continue;
      }

      // Natural amenity: a view over water, old trees, gentle high ground.
      // Trees only count where they still stand — ground the city holds was
      // cleared to build on, so it collects no bonus from a felled forest.
      let natural = 0.3;
      natural += treeDensityAt(city, x, y) * 0.12;
      natural += (city.map.elevation[i] / MAX_ELEVATION) * 0.09;
      if (nearWater(city, x, y, 4)) natural += 0.12;

      const road = city.roads[i] as RoadType;
      const street = road === RoadType.Avenue ? 0.12 : road === RoadType.Cobble ? 0.07 : road === RoadType.Path ? 0.02 : 0;
      const streetNearby = bestNearbyRoad(city, x, y);

      const serviced =
        safety[i] * 0.16 +
        faith[i] * 0.12 +
        leisure[i] * 0.16 +
        commerce[i] * 0.14 +
        (water[i] > 0 ? 0.12 : 0) +
        (sewage[i] > 0 ? 0.1 : 0);

      const blight = city.pollution[i] * 0.42;
      const isolated = Number.isFinite(city.gateDistance[i]) ? 0 : 0.06;

      // Neighbouring buildings nudge the tone of a district, but a long row
      // of them must not stack into an unrecoverable hole.
      const neighbours = clamp(influence[i], -0.35, 0.35);
      const target = clamp01(natural + street + streetNearby + serviced + neighbours - blight - isolated);
      city.landValue[i] = lerp(city.landValue[i], target, 0.3);
    }
  }
}

function nearWater(city: CityState, x: number, y: number, radius: number): boolean {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= city.width || ny >= city.height) continue;
      if (isWater(city.map.terrain[tileIndex(city, nx, ny)] as Terrain)) return true;
    }
  }
  return false;
}

/** A small bonus for being a short walk from a decent street. */
function bestNearbyRoad(city: CityState, x: number, y: number): number {
  let best = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= city.width || ny >= city.height) continue;
      const road = city.roads[tileIndex(city, nx, ny)] as RoadType;
      const value = road === RoadType.Avenue ? 0.07 : road === RoadType.Cobble ? 0.045 : road === RoadType.Path ? 0.015 : 0;
      if (value > best) best = value;
    }
  }
  return best;
}

/** Sample a service field at a building. */
export function serviceAt(city: CityState, service: Service, x: number, y: number): number {
  return city.coverage[service][tileIndex(city, x, y)];
}

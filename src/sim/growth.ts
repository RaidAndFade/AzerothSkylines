/**
 * Growth: how zoned land turns into buildings, how those buildings improve,
 * and how they fall derelict when the city fails them.
 */
import { clamp01 } from '../core/math';
import { hash2 } from '../core/rng';
import { Building, Good, Zone } from './types';
import {
  CityState,
  buildingCenter,
  createBuilding,
  inCity,
  isTileOwned,
  logEvent,
  markRectDirty,
  registerBuilding,
  removeBuilding,
  tileIndex,
} from './city';
import { INDUSTRY_LINES, IndustryLine, getDef, growthLadder } from '../data/buildings';
import { frontageFacing, hasStreetFrontage } from './zoning';
import { isTileBuildable } from './terrain';
import { hasRoadAccess } from './roads';

/** Contentment a building must sustain before it will invest in an upgrade. */
export const UPGRADE_HAPPINESS = 0.62;
/** Land value a plot needs before its owner builds in stone. */
export const UPGRADE_LAND_VALUE = 0.42;
/** Minimum days at a level before an upgrade is considered. */
export const UPGRADE_MIN_AGE = 12;
/** Contentment below which a building starts to rot. */
export const DECAY_HAPPINESS = 0.3;
/** Days of misery before the occupants leave. */
export const DECAY_DAYS = 14;
/** Days an abandoned shell stands before it collapses. */
export const RUIN_DAYS = 24;

export interface GrowthReport {
  built: number;
  upgraded: number;
  abandoned: number;
  demolished: number;
}

/**
 * Advance construction for one simulated day.
 */
export function updateGrowth(city: CityState): GrowthReport {
  const report: GrowthReport = { built: 0, upgraded: 0, abandoned: 0, demolished: 0 };

  report.built += developZone(city, Zone.Residential, city.demand.residential);
  report.built += developZone(city, Zone.Commercial, city.demand.commercial);
  report.built += developZone(city, Zone.Industrial, city.demand.industrial);

  for (const building of [...city.buildings.values()]) {
    building.age += 1;
    if (building.abandoned) {
      building.decay += 1;
      if (building.decay > RUIN_DAYS) {
        removeBuilding(city, building.id);
        report.demolished++;
      }
      continue;
    }
    if (!isGrown(building)) continue;

    // A workplace with no staff at all is a business without employees: it
    // folds, however pleasant its surroundings.
    const def = getDef(building.defId);
    const unstaffed = (def.jobs ?? 0) > 0 && building.workers === 0;

    if (building.happiness < DECAY_HAPPINESS || !building.connected || unstaffed) {
      building.decay += 1;
      if (building.decay >= DECAY_DAYS) {
        abandon(city, building);
        report.abandoned++;
      }
    } else {
      building.decay = Math.max(0, building.decay - 1.5);
      if (tryUpgrade(city, building)) report.upgraded++;
    }
  }

  return report;
}

/** True for buildings that grew from a zone rather than being placed. */
export function isGrown(building: Building): boolean {
  return getDef(building.defId).zone !== undefined;
}

/**
 * How many new buildings a zone may put up today. Strong demand builds
 * quickly; slack demand builds not at all.
 */
export function buildQuota(demand: number, population: number): number {
  if (demand <= 0.08) return 0;
  const base = 0.6 + Math.sqrt(population) * 0.06;
  return Math.max(1, Math.round(demand * base * 2.2));
}

function developZone(city: CityState, zone: Zone, demand: number): number {
  const quota = buildQuota(demand, city.stats.population);
  if (quota <= 0) return 0;

  const candidates = collectCandidates(city, zone);
  if (candidates.length === 0) return 0;

  // Build on the most desirable plots first, with a little jitter so the city
  // does not develop in perfectly sorted order.
  candidates.sort((a, b) => b.score - a.score);

  let built = 0;
  for (const candidate of candidates) {
    if (built >= quota) break;
    const i = tileIndex(city, candidate.x, candidate.y);
    if (city.buildingAt[i] >= 0) continue;
    if (!hasStreetFrontage(city, candidate.x, candidate.y)) continue;

    const defId = startingDefFor(city, zone, candidate.x, candidate.y);
    const building = createBuilding(city, defId, candidate.x, candidate.y, frontageFacing(city, candidate.x, candidate.y));
    registerBuilding(city, building);
    built++;
  }
  return built;
}

interface Candidate {
  x: number;
  y: number;
  score: number;
}

function collectCandidates(city: CityState, zone: Zone): Candidate[] {
  const out: Candidate[] = [];
  for (let y = 0; y < city.height; y++) {
    for (let x = 0; x < city.width; x++) {
      const i = tileIndex(city, x, y);
      if (city.zones[i] !== zone) continue;
      if (city.buildingAt[i] >= 0) continue;
      if (city.roads[i] !== 0) continue;
      if (city.wallAt[i] >= 0) continue;
      if (!hasStreetFrontage(city, x, y)) continue;

      // Desirable plots are valuable, served, and not choking on smoke.
      const desirability =
        city.landValue[i] * 1.4 -
        city.pollution[i] * (zone === Zone.Industrial ? 0.2 : 1.1) +
        (Number.isFinite(city.gateDistance[i]) ? 0.3 : -0.6);
      out.push({ x, y, score: desirability + hash2(x, y, city.clock.totalDays) * 0.35 });
    }
  }
  return out;
}

/** The level-one definition a new building on this tile should use. */
export function startingDefFor(city: CityState, zone: Zone, x: number, y: number): string {
  if (zone === Zone.Industrial) {
    return INDUSTRY_LINES[chooseIndustryLine(city, x, y)][0];
  }
  return growthLadder(zone)[0].id;
}

/**
 * Which industry a plot turns to. Elwynn's answer depends on the land: open
 * fertile ground grows grain, woodland feeds the sawmills, stony hills hide
 * ore, and well-connected ground inside the city becomes a craft hall.
 */
export function chooseIndustryLine(city: CityState, x: number, y: number): IndustryLine {
  let fertility = 0;
  let trees = 0;
  let ore = 0;
  let samples = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inCity(city, nx, ny)) continue;
      const i = tileIndex(city, nx, ny);
      fertility += city.map.fertility[i];
      trees += city.map.treeDensity[i];
      ore += city.map.oreRichness[i];
      samples++;
    }
  }
  if (samples === 0) return 'craft';
  fertility /= samples;
  trees /= samples;
  ore /= samples;

  // Supply pressure nudges the choice toward whatever the city is short of.
  const shortage = (good: Good) => clamp01(1 - city.reserves[good] / 120);
  const scores: Record<IndustryLine, number> = {
    farm: fertility * 1.25 + shortage(Good.Grain) * 0.5,
    timber: trees * 1.7 + shortage(Good.Timber) * 0.5,
    mine: ore * 1.8 + shortage(Good.Ore) * 0.55,
    craft:
      0.55 +
      shortage(Good.Wares) * 0.7 +
      clamp01(city.reserves[Good.Timber] / 150) * 0.3 +
      clamp01(city.reserves[Good.Ore] / 150) * 0.3,
  };

  const jitter = hash2(x, y, city.map.seed) * 0.28;
  let best: IndustryLine = 'farm';
  let bestScore = -Infinity;
  (Object.keys(scores) as IndustryLine[]).forEach((line, index) => {
    const score = scores[line] + (index === 0 ? jitter : hash2(x + index * 31, y, city.map.seed) * 0.28);
    if (score > bestScore) {
      bestScore = score;
      best = line;
    }
  });
  return best;
}

/** The ladder a building belongs to, so we know what it upgrades into. */
export function ladderFor(building: Building): { ids: string[]; index: number } {
  for (const ids of Object.values(INDUSTRY_LINES)) {
    const index = ids.indexOf(building.defId);
    if (index >= 0) return { ids, index };
  }
  const def = getDef(building.defId);
  if (def.zone === undefined) return { ids: [building.defId], index: 0 };
  const ids = growthLadder(def.zone).map((d) => d.id);
  return { ids, index: ids.indexOf(building.defId) };
}

/**
 * Invest in the next rung of the ladder when the plot deserves it and the
 * footprint can be found.
 */
export function tryUpgrade(city: CityState, building: Building): boolean {
  if (building.age < UPGRADE_MIN_AGE) return false;
  if (building.happiness < UPGRADE_HAPPINESS) return false;

  const { ids, index } = ladderFor(building);
  if (index < 0 || index + 1 >= ids.length) return false;
  const nextDef = getDef(ids[index + 1]);

  const centre = buildingCenter(building);
  const value = city.landValue[tileIndex(city, Math.round(centre.x), Math.round(centre.y))];
  // Each rung asks more of the neighbourhood than the last.
  if (value < UPGRADE_LAND_VALUE + index * 0.14) return false;

  const zone = getDef(building.defId).zone;
  const zoneDemand =
    zone === Zone.Residential
      ? city.demand.residential
      : zone === Zone.Commercial
        ? city.demand.commercial
        : city.demand.industrial;
  if (zoneDemand < 0.12) return false;

  const spot = findFootprint(city, building, nextDef.width, nextDef.height, zone ?? Zone.None);
  if (!spot) return false;

  const residents = building.residents;
  const workers = building.workers;
  const stock = building.stock;
  const happiness = building.happiness;

  removeBuilding(city, building.id);
  const upgraded = createBuilding(city, nextDef.id, spot.x, spot.y, frontageFacing(city, spot.x, spot.y, nextDef.width, nextDef.height));
  upgraded.residents = Math.min(residents, nextDef.residents ?? 0);
  upgraded.workers = Math.min(workers, nextDef.jobs ?? 0);
  upgraded.stock = stock;
  upgraded.happiness = happiness;
  upgraded.age = 0;
  registerBuilding(city, upgraded);
  return true;
}

/**
 * Find somewhere the larger footprint fits, anchored so it still covers the
 * original plot and still fronts a street.
 */
export function findFootprint(
  city: CityState,
  building: Building,
  width: number,
  height: number,
  zone: Zone,
): { x: number; y: number } | null {
  if (width === building.width && height === building.height) {
    return { x: building.x, y: building.y };
  }
  const offsets: { x: number; y: number }[] = [];
  for (let oy = 0; oy < height; oy++) {
    for (let ox = 0; ox < width; ox++) offsets.push({ x: building.x - ox, y: building.y - oy });
  }

  for (const origin of offsets) {
    let ok = true;
    for (let y = origin.y; y < origin.y + height && ok; y++) {
      for (let x = origin.x; x < origin.x + width && ok; x++) {
        if (!inCity(city, x, y)) ok = false;
        else if (!isTileOwned(city, x, y)) ok = false;
        else if (!isTileBuildable(city.map, x, y)) ok = false;
        else {
          const i = tileIndex(city, x, y);
          if (city.roads[i] !== 0) ok = false;
          else if (city.wallAt[i] >= 0) ok = false;
          else if (city.buildingAt[i] >= 0 && city.buildingAt[i] !== building.id) ok = false;
          else if (zone !== Zone.None && city.zones[i] !== zone) ok = false;
        }
      }
    }
    if (!ok) continue;
    if (!hasStreetFrontage(city, origin.x, origin.y, width, height)) continue;
    return origin;
  }
  return null;
}

function abandon(city: CityState, building: Building): void {
  building.abandoned = true;
  building.residents = 0;
  building.workers = 0;
  building.decay = 0;
  markRectDirty(city, building.x, building.y, building.width, building.height);
  if (city.rng.chance(0.25)) {
    logEvent(city, `${getDef(building.defId).name} stands empty — the folk have moved on.`, 'bad');
  }
}

/** Refresh the cached road-access and protection flags on every building. */
export function refreshBuildingFlags(city: CityState): void {
  for (const building of city.buildings.values()) {
    building.connected = hasRoadAccess(city, building);
    building.protected = isTileOwned(city, building.x, building.y);
  }
}

/**
 * The simulation loop.
 *
 * Real time drives a game clock; each whole game-day the city is settled in
 * a fixed order — infrastructure first, then the economy, then the people,
 * then what they choose to build next.
 */
import { clamp01 } from '../core/math';
import { ALL_GOODS, ALL_SERVICES, BuildingKind, Good, Service } from './types';
import { CityState, emptyStats, logEvent, tileIndex } from './city';
import { computeGateDistance } from './roads';
import { distributeUtility } from './utilities';
import { computeLandValue, computePollution, computeServiceCoverage } from './services';
import { refreshBuildingFlags, updateGrowth } from './growth';
import { updateHappiness, updatePopulation } from './population';
import { updateDemand } from './demand';
import { runTrade } from './trade';
import { advanceCalendar, settleMonth } from './economy';
import { TrafficQueue, maintainAgents, spawnDeliveryCarts, updateAgents } from './agents';
import { rebuildWalls } from './walls';
import { getDef } from '../data/buildings';

/** Real seconds one game-day takes at normal speed. */
export const SECONDS_PER_DAY = 2.4;
/** How often agent spawning is topped up, in real seconds. */
export const TRAFFIC_INTERVAL = 0.6;

export interface SimulationOptions {
  /** 0 = paused, 1 = normal, 2 = fast, 3 = very fast. */
  speed: number;
}

export class Simulation {
  readonly city: CityState;
  readonly traffic: TrafficQueue;
  speed = 1;

  private dayAccumulator = 0;
  private trafficAccumulator = 0;
  /** Days elapsed since the last full milestone check. */
  private milestoneAccumulator = 0;

  constructor(city: CityState, traffic: TrafficQueue) {
    this.city = city;
    this.traffic = traffic;
    // Raise the founding wall for free, then settle the city once so the
    // opening view already shows a living valley.
    rebuildWalls(city, false);
    this.runDay();
  }

  /** Advance by a slice of real time. */
  update(dt: number): void {
    const city = this.city;
    if (city.wallsDirty) rebuildWalls(city, false);

    // Agents keep moving even while paused-adjacent, but not when stopped.
    if (this.speed > 0) {
      const scaled = dt * this.speed;
      updateAgents(city, scaled);

      this.trafficAccumulator += scaled;
      if (this.trafficAccumulator >= TRAFFIC_INTERVAL) {
        this.trafficAccumulator = 0;
        maintainAgents(city, this.traffic);
      }

      this.dayAccumulator += scaled;
      // Cap catch-up so a background tab cannot stall the main thread.
      let guard = 0;
      while (this.dayAccumulator >= SECONDS_PER_DAY && guard < 4) {
        this.dayAccumulator -= SECONDS_PER_DAY;
        guard++;
        this.runDay();
      }
      city.clock.dayFraction = clamp01(this.dayAccumulator / SECONDS_PER_DAY);
    }
  }

  /** Settle one whole game-day. */
  runDay(): void {
    const city = this.city;

    // 1. Infrastructure: who is connected, and what reaches them.
    refreshBuildingFlags(city);
    computeGateDistance(city);
    const water = distributeUtility(city, Service.Water);
    const sewage = distributeUtility(city, Service.Sewage);
    computeServiceCoverage(city);
    computePollution(city);
    computeLandValue(city);

    // 2. The economy: make things, move things, sell things.
    const trade = runTrade(city);
    spawnDeliveryCarts(this.traffic, trade.deliveries);

    // 3. The people: how they feel, and whether they stay.
    updateHappiness(city);
    const population = updatePopulation(city);

    // 4. What gets built next.
    updateGrowth(city);

    // 5. Bookkeeping.
    updateStats(city, {
      population: population.population,
      housingCapacity: population.housingCapacity,
      jobs: population.jobs,
      employed: population.employed,
      travelers: trade.travelers,
      produced: trade.produced,
      consumed: trade.consumed,
      waterServed: water.served,
      waterDemand: water.demand,
      sewageServed: sewage.served,
      sewageDemand: sewage.demand,
    });
    updateDemand(city);

    const { newMonth } = advanceCalendar(city);
    if (newMonth) settleMonth(city);

    this.milestoneAccumulator++;
    if (this.milestoneAccumulator >= 10) {
      this.milestoneAccumulator = 0;
      checkMilestones(city);
    }
  }
}

interface StatsInput {
  population: number;
  housingCapacity: number;
  jobs: number;
  employed: number;
  travelers: number;
  produced: Record<Good, number>;
  consumed: Record<Good, number>;
  waterServed: number;
  waterDemand: number;
  sewageServed: number;
  sewageDemand: number;
}

/** Roll every per-building figure up into the numbers the HUD shows. */
export function updateStats(city: CityState, input: StatsInput): void {
  const stats = city.stats;
  stats.population = input.population;
  stats.housingCapacity = input.housingCapacity;
  stats.jobs = input.jobs;
  stats.employed = input.employed;
  stats.travelers = input.travelers;
  stats.goodsProduced = input.produced;
  stats.goodsConsumed = input.consumed;

  const workforce = input.population * 0.62;
  stats.unemployment = workforce > 0 ? clamp01((workforce - input.employed) / workforce) : 0;

  // Contentment is the weighted average over inhabited dwellings, so an
  // empty quarter of ruins does not drag the whole city down forever.
  let happinessTotal = 0;
  let happinessWeight = 0;
  let buildingCount = 0;
  let abandonedCount = 0;
  for (const building of city.buildings.values()) {
    buildingCount++;
    if (building.abandoned) {
      abandonedCount++;
      continue;
    }
    if (building.kind === BuildingKind.Dwelling && building.residents > 0) {
      happinessTotal += building.happiness * building.residents;
      happinessWeight += building.residents;
    }
  }
  stats.happiness = happinessWeight > 0 ? happinessTotal / happinessWeight : 0.6;
  stats.buildingCount = buildingCount;
  stats.abandonedCount = abandonedCount;

  // Service scores: the share of buildings actually reached.
  const served: Record<Service, number> = { ...stats.services };
  served[Service.Water] = input.waterDemand > 0 ? input.waterServed / input.waterDemand : 1;
  served[Service.Sewage] = input.sewageDemand > 0 ? input.sewageServed / input.sewageDemand : 1;
  for (const service of ALL_SERVICES) {
    if (service === Service.Water || service === Service.Sewage) continue;
    served[service] = averageOverDwellings(city, service);
  }
  stats.services = served;

  for (const good of ALL_GOODS) stats.stockpile[good] = city.reserves[good];

  let pollution = 0;
  let landValue = 0;
  let samples = 0;
  for (const building of city.buildings.values()) {
    const i = tileIndex(city, building.x, building.y);
    pollution += city.pollution[i];
    landValue += city.landValue[i];
    samples++;
  }
  stats.pollution = samples > 0 ? pollution / samples : 0;
  stats.landValue = samples > 0 ? landValue / samples : 0.3;
}

function averageOverDwellings(city: CityState, service: Service): number {
  let total = 0;
  let count = 0;
  for (const building of city.buildings.values()) {
    if (building.kind !== BuildingKind.Dwelling || building.abandoned) continue;
    total += clamp01(city.coverage[service][tileIndex(city, building.x, building.y)]);
    count++;
  }
  return count > 0 ? total / count : 0;
}

/** Population milestones, announced in the journal. */
const MILESTONES: { population: number; title: string }[] = [
  { population: 60, title: 'Hamlet' },
  { population: 180, title: 'Village' },
  { population: 500, title: 'Township' },
  { population: 1200, title: 'Walled Town' },
  { population: 2600, title: 'Free City' },
  { population: 5000, title: 'Jewel of Elwynn' },
];

const reached = new WeakMap<CityState, Set<number>>();

export function checkMilestones(city: CityState): void {
  let seen = reached.get(city);
  if (!seen) {
    seen = new Set();
    reached.set(city, seen);
  }
  for (const milestone of MILESTONES) {
    if (city.stats.population >= milestone.population && !seen.has(milestone.population)) {
      seen.add(milestone.population);
      logEvent(city, `The settlement is now a ${milestone.title}.`, 'good');
    }
  }

  // Warn about the most pressing shortage, once in a while.
  const worst = worstService(city);
  if (worst && city.stats.population > 40) {
    logEvent(city, worst, 'bad');
  }
}

function worstService(city: CityState): string | null {
  const complaints: { score: number; text: string }[] = [];
  const s = city.stats.services;
  if (s[Service.Water] < 0.55) complaints.push({ score: s[Service.Water], text: 'Half the city hauls its own water. Sink more wells.' });
  if (s[Service.Sewage] < 0.45) complaints.push({ score: s[Service.Sewage], text: 'Filth runs in the streets — the city needs drainage.' });
  if (s[Service.Safety] < 0.4) complaints.push({ score: s[Service.Safety], text: 'Folk fear the night. Post more of the guard.' });
  if (s[Service.Commerce] < 0.4) complaints.push({ score: s[Service.Commerce], text: 'There is nowhere to buy bread. Zone for trade.' });
  if (city.stats.unemployment > 0.25) complaints.push({ score: 1 - city.stats.unemployment, text: 'Too many idle hands. The city needs work.' });
  if (complaints.length === 0) return null;
  complaints.sort((a, b) => a.score - b.score);
  return complaints[0].text;
}

/** Reset derived fields, e.g. after loading a save. */
export function resettle(city: CityState): void {
  city.stats = emptyStats();
  refreshBuildingFlags(city);
  computeGateDistance(city);
  computeServiceCoverage(city);
  computeLandValue(city);
}

export { getDef };

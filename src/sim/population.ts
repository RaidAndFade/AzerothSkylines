/**
 * Villagers: who lives where, who works where, and how content they are.
 *
 * Newcomers walk in along the king's road whenever there is room for them
 * and a reason to come. Misery empties houses just as steadily.
 */
import { clamp01, lerp } from '../core/math';
import { ALL_SERVICES, Building, BuildingKind, SERVICE_WEIGHT, Service } from './types';
import { CityState, tileIndex } from './city';
import { getDef } from '../data/buildings';

/** Fraction of the population of working age. */
export const WORKFORCE_RATIO = 0.62;
/** Share of a dwelling's vacancies that can fill in a single day. */
export const MOVE_IN_RATE = 0.22;
/** Share of residents who leave a miserable house each day. */
export const MOVE_OUT_RATE = 0.14;
/** Contentment below which villagers start packing. */
export const FLIGHT_THRESHOLD = 0.32;
/**
 * Contentment of a connected dwelling with no services at all. A village
 * on its founding day should be liveable, if unremarkable.
 */
export const BASE_CONTENTMENT = 0.5;
/** How much fully provided services can add on top of the baseline. */
export const SERVICE_CONTRIBUTION = 0.34;

export interface PopulationReport {
  arrivals: number;
  departures: number;
  population: number;
  housingCapacity: number;
  jobs: number;
  employed: number;
}

/**
 * Contentment of a single building, in [0,1].
 *
 * Dwellings weigh the services reaching them; workplaces weigh whether
 * their goods arrive and whether anyone can get to work.
 */
export function evaluateHappiness(city: CityState, building: Building): number {
  const def = getDef(building.defId);
  const i = tileIndex(city, building.x, building.y);

  if (!building.connected) return 0.05;
  if (building.abandoned) return 0;

  // Contentment starts from a liveable baseline — a roof, a street outside,
  // and the king's peace — and services build on top of it. Modelling it as
  // a plain average over every service instead would leave a young village
  // permanently miserable simply for not yet having a cathedral.
  let happiness: number;

  if (building.kind === BuildingKind.Dwelling) {
    let serviceScore = 0;
    let serviceWeight = 0;
    for (const service of ALL_SERVICES) {
      const w = SERVICE_WEIGHT[service];
      serviceScore += clamp01(city.coverage[service][i]) * w;
      serviceWeight += w;
    }
    const serviced = serviceWeight > 0 ? serviceScore / serviceWeight : 0;

    // Crowding: a full house is less pleasant than a comfortable one.
    const capacity = def.residents ?? 1;
    const crowding = clamp01(building.residents / Math.max(1, capacity));

    happiness =
      BASE_CONTENTMENT +
      serviced * SERVICE_CONTRIBUTION +
      city.landValue[i] * 0.22 -
      crowding * 0.12;
  } else {
    // Workplaces care about deliveries, custom and staffing.
    const jobs = def.jobs ?? 0;
    const staffing = jobs > 0 ? clamp01(building.workers / jobs) : 1;
    happiness =
      0.38 +
      building.supplyRatio * 0.26 +
      staffing * 0.18 +
      clamp01(city.coverage[Service.Water][i]) * 0.07 +
      clamp01(city.coverage[Service.Safety][i]) * 0.06 +
      city.landValue[i] * 0.12;
  }

  // Smoke, filth and taxes drag on everyone.
  happiness -= city.pollution[i] * 0.35;
  happiness -= taxPenalty(city, building) * 0.32;
  // Living behind the king's walls is worth something in Elwynn.
  if (building.protected) happiness += 0.05;
  // A long haul to the gate makes a plot feel remote.
  const gate = city.gateDistance[i];
  if (!Number.isFinite(gate)) happiness -= 0.12;
  else happiness -= clamp01(gate / 90) * 0.08;

  return clamp01(happiness);
}

/** How punishing the tax rate on this building's class feels. */
export function taxPenalty(city: CityState, building: Building): number {
  const rate =
    building.kind === BuildingKind.Dwelling
      ? city.budget.taxRateResidential
      : building.kind === BuildingKind.Shop
        ? city.budget.taxRateCommercial
        : city.budget.taxRateIndustrial;
  // A tithe of one in ten is expected; beyond that resentment grows sharply.
  return clamp01((rate - 0.1) / 0.22) ** 1.35;
}

/** Recompute happiness for every building, easing toward the new value. */
export function updateHappiness(city: CityState): void {
  for (const building of city.buildings.values()) {
    const target = evaluateHappiness(city, building);
    building.happiness = lerp(building.happiness, target, 0.28);
  }
}

/**
 * Move villagers in and out, then hand out the jobs.
 */
export function updatePopulation(city: CityState): PopulationReport {
  const dwellings: Building[] = [];
  let housingCapacity = 0;
  let population = 0;

  for (const building of city.buildings.values()) {
    if (building.kind !== BuildingKind.Dwelling) continue;
    population += building.residents;
    if (building.abandoned) continue;
    dwellings.push(building);
    housingCapacity += getDef(building.defId).residents ?? 0;
  }

  // Desirability of the city as a whole decides how many newcomers appear.
  const pull = clamp01(city.demand.residential * 0.75 + city.stats.happiness * 0.45 - 0.12);

  let arrivals = 0;
  let departures = 0;

  // Best houses fill first — people move to the nicest street they can afford.
  dwellings.sort((a, b) => b.happiness - a.happiness);

  for (const dwelling of dwellings) {
    const capacity = getDef(dwelling.defId).residents ?? 0;
    if (dwelling.happiness < FLIGHT_THRESHOLD && dwelling.residents > 0) {
      const leaving = Math.max(1, Math.round(dwelling.residents * MOVE_OUT_RATE * (1 - dwelling.happiness)));
      dwelling.residents = Math.max(0, dwelling.residents - leaving);
      departures += leaving;
      continue;
    }
    const vacancies = capacity - dwelling.residents;
    if (vacancies <= 0 || pull <= 0.02) continue;
    const moving = Math.min(vacancies, Math.max(1, Math.round(vacancies * MOVE_IN_RATE * pull)));
    dwelling.residents += moving;
    arrivals += moving;
  }

  population = population + arrivals - departures;

  const { jobs, employed } = assignJobs(city, population);

  return { arrivals, departures, population, housingCapacity, jobs, employed };
}

/**
 * Hand out the available work. Well-run, well-connected premises fill their
 * posts first; derelict or cut-off ones go unstaffed.
 */
export function assignJobs(city: CityState, population: number): { jobs: number; employed: number } {
  const workplaces: Building[] = [];
  let jobs = 0;
  for (const building of city.buildings.values()) {
    if (building.abandoned) {
      building.workers = 0;
      continue;
    }
    const def = getDef(building.defId);
    if (!def.jobs) continue;
    if (!building.connected) {
      building.workers = 0;
      continue;
    }
    jobs += def.jobs;
    workplaces.push(building);
  }

  let workforce = Math.floor(population * WORKFORCE_RATIO);
  // The best places to work get their pick of the labour.
  workplaces.sort((a, b) => b.happiness + b.supplyRatio - (a.happiness + a.supplyRatio));

  let employed = 0;
  for (const workplace of workplaces) {
    const posts = getDef(workplace.defId).jobs ?? 0;
    const filled = Math.min(posts, workforce);
    workplace.workers = filled;
    workforce -= filled;
    employed += filled;
  }

  return { jobs, employed };
}

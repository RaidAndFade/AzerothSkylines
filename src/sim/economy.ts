/**
 * The treasury: taxes in, upkeep out, settled once a month.
 */
import { clamp01 } from '../core/math';
import { Building, BuildingKind, RoadType } from './types';
import { CityState, ROAD_UPKEEP, buildingTiles, logEvent, tileIndex } from './city';
import { getDef } from '../data/buildings';
import { countRoads } from './roads';
import { wallStats } from './walls';

/** Days in a game month. */
export const DAYS_PER_MONTH = 30;
/** Months in a game year. */
export const MONTHS_PER_YEAR = 12;

/**
 * Monthly tax take per head at a notional 100% rate, before the land-value
 * multiplier. The rate the player sets scales these directly, so a tithe of
 * one in ten on a resident yields about two gold a month.
 */
export const TAX_PER_RESIDENT = 22;
export const TAX_PER_SHOP_WORKER = 52;
export const TAX_PER_WORKSHOP_WORKER = 44;
/** Monthly upkeep per standing wall tile. */
export const WALL_UPKEEP = 0.5;
export const TOWER_UPKEEP = 1.4;
export const GATE_UPKEEP = 2.2;

export interface MonthlyStatement {
  residentialTax: number;
  commercialTax: number;
  industrialTax: number;
  buildingUpkeep: number;
  roadUpkeep: number;
  wallUpkeep: number;
  trade: number;
  net: number;
}

/**
 * The land value a building is taxed on: the mean over its whole footprint
 * rather than the value under its anchor tile, which for anything larger
 * than 1x1 is an arbitrary corner of a gradient.
 */
export function ratedLandValue(city: CityState, building: Building): number {
  let total = 0;
  let count = 0;
  for (const tile of buildingTiles(building)) {
    if (tile.x < 0 || tile.y < 0 || tile.x >= city.width || tile.y >= city.height) continue;
    total += city.landValue[tileIndex(city, tile.x, tile.y)];
    count++;
  }
  if (count === 0) return city.landValue[tileIndex(city, building.x, building.y)];
  return total / count;
}

/**
 * One pass over the building map for both sides of the ledger. Taxes and
 * building upkeep have different exemptions but the same iteration, and at
 * 8x speed on a phone the month's settlement is one of the few whole-map
 * passes left, so it walks the map once.
 */
function surveyBuildings(city: CityState): {
  residential: number;
  commercial: number;
  industrial: number;
  upkeep: number;
} {
  let residential = 0;
  let commercial = 0;
  let industrial = 0;
  let upkeep = 0;

  for (const building of city.buildings.values()) {
    // A ruin pays no rates, but it is not billed for its upkeep either.
    if (building.abandoned) continue;
    upkeep += getDef(building.defId).upkeep;

    // Premises cut off from the road network are earning nothing to tax.
    if (!building.connected) continue;
    const value = 0.65 + ratedLandValue(city, building) * 0.9;

    if (building.kind === BuildingKind.Dwelling) {
      residential += building.residents * TAX_PER_RESIDENT * city.budget.taxRateResidential * value;
    } else if (building.kind === BuildingKind.Shop) {
      const trade = clamp01(0.35 + building.supplyRatio * 0.65);
      commercial += building.workers * TAX_PER_SHOP_WORKER * city.budget.taxRateCommercial * value * trade;
    } else if (building.kind === BuildingKind.Workshop) {
      const output = clamp01(0.35 + building.supplyRatio * 0.65);
      industrial += building.workers * TAX_PER_WORKSHOP_WORKER * city.budget.taxRateIndustrial * value * output;
    }
  }

  return { residential, commercial, industrial, upkeep };
}

/** Tax income for one month, before upkeep. */
export function collectTaxes(city: CityState): {
  residential: number;
  commercial: number;
  industrial: number;
} {
  const { residential, commercial, industrial } = surveyBuildings(city);
  return { residential, commercial, industrial };
}

/**
 * Everything the city pays for each month.
 *
 * The road and wall tallies are full scans. They look like obvious
 * candidates for counters maintained by `placeRoad`/`removeRoad`, but
 * `city.roads` is also written directly — by `layKingsRoad` when the valley
 * is generated and by `demolish`, among others — so a counter would drift
 * silently out of step with the map it claims to describe. Scanning stays
 * honest; measure before trading that away.
 */
export function totalUpkeep(city: CityState): {
  buildings: number;
  roads: number;
  walls: number;
} {
  return { buildings: surveyBuildings(city).upkeep, ...roadAndWallUpkeep(city) };
}

/** The infrastructure half of the bill: everything not a building. */
function roadAndWallUpkeep(city: CityState): { roads: number; walls: number } {
  const roadCounts = countRoads(city);
  const roads =
    roadCounts[RoadType.Path] * ROAD_UPKEEP[RoadType.Path] * DAYS_PER_MONTH +
    roadCounts[RoadType.Cobble] * ROAD_UPKEEP[RoadType.Cobble] * DAYS_PER_MONTH +
    roadCounts[RoadType.Avenue] * ROAD_UPKEEP[RoadType.Avenue] * DAYS_PER_MONTH;

  const { walls: wallTiles, towers, gates } = wallStats(city);
  const walls = wallTiles * WALL_UPKEEP + towers * TOWER_UPKEEP + gates * GATE_UPKEEP;

  return { roads, walls };
}

/**
 * Close the books on a month and pay out.
 *
 * Taxes and upkeep move the treasury here, on the thirtieth. Trade does
 * not: `tradeWithWorld` in `sim/trade.ts` pays the city the day the caravans
 * arrive, and `budget.tradeAccumulator` only mirrors what it already paid,
 * so the ledger can show the month's trade as a line of its own. Adding
 * that mirror to `gold` below would pay the city twice — `net` folds it in
 * only because it reports the whole month's movement, not this function's
 * own.
 */
export function settleMonth(city: CityState): MonthlyStatement {
  const survey = surveyBuildings(city);
  const upkeep = {
    buildings: survey.upkeep,
    ...roadAndWallUpkeep(city),
  };

  const income = survey.residential + survey.commercial + survey.industrial;
  const costs = upkeep.buildings + upkeep.roads + upkeep.walls;
  const trade = city.budget.tradeAccumulator;

  city.budget.gold += income - costs;
  city.budget.lastIncome = income;
  city.budget.lastUpkeep = costs;
  city.budget.lastTrade = trade;
  city.budget.tradeAccumulator = 0;

  const net = income - costs + trade;

  if (city.budget.gold < 0) {
    logEvent(city, 'The treasury is empty. The city cannot pay its debts.', 'bad');
  } else if (net < 0 && city.budget.gold < costs * 2) {
    logEvent(city, 'Coffers running low — the city is spending beyond its means.', 'bad');
  }

  return {
    residentialTax: survey.residential,
    commercialTax: survey.commercial,
    industrialTax: survey.industrial,
    buildingUpkeep: upkeep.buildings,
    roadUpkeep: upkeep.roads,
    wallUpkeep: upkeep.walls,
    trade,
    net,
  };
}

/** Advance the calendar by one day, rolling months and years over. */
export function advanceCalendar(city: CityState): { newMonth: boolean; newYear: boolean } {
  const clock = city.clock;
  clock.totalDays += 1;
  clock.day += 1;
  let newMonth = false;
  let newYear = false;
  if (clock.day > DAYS_PER_MONTH) {
    clock.day = 1;
    clock.month += 1;
    newMonth = true;
    if (clock.month > MONTHS_PER_YEAR) {
      clock.month = 1;
      clock.year += 1;
      newYear = true;
    }
  }
  return { newMonth, newYear };
}

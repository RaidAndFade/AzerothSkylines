/**
 * The treasury: taxes in, upkeep out, settled once a month.
 */
import { clamp01 } from '../core/math';
import { BuildingKind, RoadType } from './types';
import { CityState, ROAD_UPKEEP, logEvent, tileIndex } from './city';
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

/** Tax income for one month, before upkeep. */
export function collectTaxes(city: CityState): {
  residential: number;
  commercial: number;
  industrial: number;
} {
  let residential = 0;
  let commercial = 0;
  let industrial = 0;

  for (const building of city.buildings.values()) {
    if (building.abandoned || !building.connected) continue;
    const value = 0.65 + city.landValue[tileIndex(city, building.x, building.y)] * 0.9;

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

  return { residential, commercial, industrial };
}

/** Everything the city pays for each month. */
export function totalUpkeep(city: CityState): {
  buildings: number;
  roads: number;
  walls: number;
} {
  let buildings = 0;
  for (const building of city.buildings.values()) {
    if (building.abandoned) continue;
    buildings += getDef(building.defId).upkeep;
  }

  const roadCounts = countRoads(city);
  const roads =
    roadCounts[RoadType.Path] * ROAD_UPKEEP[RoadType.Path] * DAYS_PER_MONTH +
    roadCounts[RoadType.Cobble] * ROAD_UPKEEP[RoadType.Cobble] * DAYS_PER_MONTH +
    roadCounts[RoadType.Avenue] * ROAD_UPKEEP[RoadType.Avenue] * DAYS_PER_MONTH;

  const { walls: wallTiles, towers, gates } = wallStats(city);
  const walls = wallTiles * WALL_UPKEEP + towers * TOWER_UPKEEP + gates * GATE_UPKEEP;

  return { buildings, roads, walls };
}

/** Close the books on a month and pay out. */
export function settleMonth(city: CityState): MonthlyStatement {
  const taxes = collectTaxes(city);
  const upkeep = totalUpkeep(city);

  const income = taxes.residential + taxes.commercial + taxes.industrial;
  const costs = upkeep.buildings + upkeep.roads + upkeep.walls;
  const trade = city.budget.tradeAccumulator;

  city.budget.gold += income - costs;
  city.budget.lastIncome = income;
  city.budget.lastUpkeep = costs;
  city.budget.lastTrade = trade;
  city.budget.incomeAccumulator = 0;
  city.budget.upkeepAccumulator = 0;
  city.budget.tradeAccumulator = 0;

  const net = income - costs + trade;

  if (city.budget.gold < 0) {
    logEvent(city, 'The treasury is empty. The city cannot pay its debts.', 'bad');
  } else if (net < 0 && city.budget.gold < costs * 2) {
    logEvent(city, 'Coffers running low — the city is spending beyond its means.', 'bad');
  }

  return {
    residentialTax: taxes.residential,
    commercialTax: taxes.commercial,
    industrialTax: taxes.industrial,
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

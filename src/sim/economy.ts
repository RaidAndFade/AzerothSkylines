/**
 * The treasury: taxes in, upkeep out, settled once a month.
 */
import { clamp, clamp01 } from '../core/math';
import { Building, BuildingKind, Loan, MonthlyStatement, RoadType } from './types';
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

/** Years a Crown loan runs for, in months. */
export const LOAN_TERM_MONTHS = 12;
/** Interest charged over the whole term, as a share of the principal. */
export const LOAN_INTEREST = 0.2;
/** The smallest and largest advance the Crown will make. */
export const MIN_LOAN = 1500;
export const MAX_LOAN = 20000;
/** Months of upkeep a loan is sized to cover. */
export const LOAN_MONTHS_OF_COVER = 8;
/** Months the city may close in the red before its servants go unpaid. */
export const ARREARS_GRACE = 1;
/** How many closed months the ledger keeps. */
export const LEDGER_MONTHS = 12;

export type { MonthlyStatement } from './types';

/** The three rates, as a bag that can be swapped for a notional one. */
interface TaxRates {
  taxRateResidential: number;
  taxRateCommercial: number;
  taxRateIndustrial: number;
}

/** Rates of one, so a survey reports what a full tithe would be worth. */
const UNIT_RATES: TaxRates = {
  taxRateResidential: 1,
  taxRateCommercial: 1,
  taxRateIndustrial: 1,
};

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
function surveyBuildings(city: CityState, rates: TaxRates = city.budget): {
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
      residential += building.residents * TAX_PER_RESIDENT * rates.taxRateResidential * value;
    } else if (building.kind === BuildingKind.Shop) {
      const trade = clamp01(0.35 + building.supplyRatio * 0.65);
      commercial += building.workers * TAX_PER_SHOP_WORKER * rates.taxRateCommercial * value * trade;
    } else if (building.kind === BuildingKind.Workshop) {
      const output = clamp01(0.35 + building.supplyRatio * 0.65);
      industrial += building.workers * TAX_PER_WORKSHOP_WORKER * rates.taxRateIndustrial * value * output;
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
 * What a full tithe — a rate of one — would be worth in each zone this
 * month. The rate the player sets scales the take linearly, so the panel can
 * price a slider as it moves without surveying the whole map per frame.
 */
export function taxBase(city: CityState): {
  residential: number;
  commercial: number;
  industrial: number;
} {
  const { residential, commercial, industrial } = surveyBuildings(city, UNIT_RATES);
  return { residential, commercial, industrial };
}

/** One line of the upkeep bill: every standing building of one type. */
export interface UpkeepLine {
  defId: string;
  name: string;
  count: number;
  /** Gold a month for all of them together. */
  upkeep: number;
}

/**
 * The building half of the bill, itemised — "is it the walls or the wells
 * that are bleeding me" is not a question three totals can answer. Dearest
 * first, since that is the row the player is looking for.
 */
export function upkeepByType(city: CityState): UpkeepLine[] {
  const lines = new Map<string, UpkeepLine>();
  for (const building of city.buildings.values()) {
    // A ruin is not billed for its upkeep, and so does not appear here.
    if (building.abandoned) continue;
    const def = getDef(building.defId);
    if (def.upkeep <= 0) continue;
    let line = lines.get(building.defId);
    if (!line) {
      line = { defId: building.defId, name: def.name, count: 0, upkeep: 0 };
      lines.set(building.defId, line);
    }
    line.count++;
    line.upkeep += def.upkeep;
  }
  return [...lines.values()].sort((a, b) => b.upkeep - a.upkeep);
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

  return { roads, walls: wallUpkeepFor(wallStats(city)) };
}

/** Monthly upkeep for a stretch of curtain wall, standing or merely planned. */
export function wallUpkeepFor(stats: { walls: number; towers: number; gates: number }): number {
  return stats.walls * WALL_UPKEEP + stats.towers * TOWER_UPKEEP + stats.gates * GATE_UPKEEP;
}

/**
 * What the Crown will lend, sized to the bills the city cannot meet: eight
 * months of upkeep, within fixed bounds. One loan at a time — the point is a
 * way back from a bad month, not a second treasury.
 */
export interface LoanOffer {
  available: boolean;
  reason?: string;
  /** Gold advanced now. */
  principal: number;
  /** Taken each month until the debt is cleared. */
  payment: number;
  /** Principal and interest together. */
  total: number;
  months: number;
}

export function loanOffer(city: CityState): LoanOffer {
  const upkeep = totalUpkeep(city);
  const monthly = upkeep.buildings + upkeep.roads + upkeep.walls;
  const principal = clamp(
    Math.round((monthly * LOAN_MONTHS_OF_COVER) / 100) * 100,
    MIN_LOAN,
    MAX_LOAN,
  );
  const total = Math.round(principal * (1 + LOAN_INTEREST));
  const offer: LoanOffer = {
    available: true,
    principal,
    payment: Math.round(total / LOAN_TERM_MONTHS),
    total,
    months: LOAN_TERM_MONTHS,
  };
  if (city.budget.loan) {
    return { ...offer, available: false, reason: 'The Crown will not lend twice at once.' };
  }
  return offer;
}

/** Take the standing offer. Returns false when there is none to take. */
export function takeLoan(city: CityState): Loan | null {
  const offer = loanOffer(city);
  if (!offer.available) return null;
  const loan: Loan = {
    principal: offer.principal,
    outstanding: offer.total,
    payment: offer.payment,
    monthsRemaining: offer.months,
  };
  city.budget.loan = loan;
  city.budget.gold += offer.principal;
  logEvent(
    city,
    `The Crown advances ${offer.principal}g, to be repaid at ${offer.payment}g a month for a year.`,
    'info',
  );
  return loan;
}

/** Take this month's instalment, if the city owes one. */
function repayCrown(city: CityState): number {
  const loan = city.budget.loan;
  if (!loan) return 0;
  const payment = Math.min(loan.outstanding, loan.payment);
  loan.outstanding -= payment;
  loan.monthsRemaining = Math.max(0, loan.monthsRemaining - 1);
  if (loan.outstanding <= 0.005) {
    city.budget.loan = null;
    logEvent(city, "The Crown's loan is repaid in full.", 'good');
  }
  return payment;
}

/**
 * How much of the city's service work still gets done.
 *
 * Wages come out of the same purse as the masonry. One month in the red is a
 * warning; a city that stays in debt finds the guard post empty and the
 * chapel shut, which costs it contentment and land value until the books are
 * straight again. It never falls to nothing — there is always a way back.
 */
export function serviceAusterity(city: CityState): number {
  const months = city.budget.arrears;
  if (months <= ARREARS_GRACE) return 1;
  return clamp(1 - (months - ARREARS_GRACE) * 0.25, 0.3, 1);
}

/** The month whose books close on this date; the calendar has already rolled. */
function closedMonth(city: CityState): { month: number; year: number } {
  const month = city.clock.month - 1;
  if (month >= 1) return { month, year: city.clock.year };
  return { month: MONTHS_PER_YEAR, year: city.clock.year - 1 };
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
 *
 * The statement is kept: the panel shows the month by category, and the last
 * year of them as a trend.
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
  // The Crown is paid before the city's own bills: the instalment falls due
  // whether or not the month's taxes cover it, and one that cannot be met is
  // what tips a struggling city into arrears.
  const loanRepayment = repayCrown(city);

  city.budget.gold += income - costs - loanRepayment;
  city.budget.lastIncome = income;
  city.budget.lastUpkeep = costs;
  city.budget.lastTrade = trade;
  city.budget.tradeAccumulator = 0;

  const net = income - costs - loanRepayment + trade;
  const { month, year } = closedMonth(city);
  const statement: MonthlyStatement = {
    month,
    year,
    residentialTax: survey.residential,
    commercialTax: survey.commercial,
    industrialTax: survey.industrial,
    buildingUpkeep: upkeep.buildings,
    roadUpkeep: upkeep.roads,
    wallUpkeep: upkeep.walls,
    loanRepayment,
    trade,
    net,
    closingGold: city.budget.gold,
  };

  city.budget.history.push(statement);
  while (city.budget.history.length > LEDGER_MONTHS) city.budget.history.shift();

  if (city.budget.gold < 0) {
    city.budget.arrears += 1;
    const months = city.budget.arrears;
    if (months === 1) {
      logEvent(city, 'The treasury is empty. The city cannot pay its debts.', 'bad');
    } else if (months === ARREARS_GRACE + 1) {
      logEvent(
        city,
        'A second month in debt: unpaid, the guard and the wardens leave their posts.',
        'bad',
      );
    } else if (months % 3 === 0) {
      logEvent(
        city,
        `${months} months in arrears — less and less of the city is still being served.`,
        'bad',
      );
    }
  } else {
    if (city.budget.arrears > 0) {
      logEvent(city, 'The debts are cleared, and the city\u2019s servants return to their posts.', 'good');
      city.budget.arrears = 0;
    }
    if (net < 0 && city.budget.gold < costs * 2) {
      logEvent(city, 'Coffers running low — the city is spending beyond its means.', 'bad');
    }
  }

  return statement;
}

/**
 * The month the city is currently having, rather than the one it last closed.
 *
 * Taxes and upkeep are deterministic from the state of the map, so they can
 * be quoted in full at any point in the month. Trade is the day-by-day part:
 * it is carried forward at the rate it has run so far, and before there is
 * any of it to go on, last month's stands in.
 */
export function projectMonth(city: CityState): MonthlyStatement {
  const survey = surveyBuildings(city);
  const upkeep = {
    buildings: survey.upkeep,
    ...roadAndWallUpkeep(city),
  };

  const income = survey.residential + survey.commercial + survey.industrial;
  const costs = upkeep.buildings + upkeep.roads + upkeep.walls;
  const loan = city.budget.loan;
  const loanRepayment = loan ? Math.min(loan.outstanding, loan.payment) : 0;

  // `clock.day` is the day being lived through, so the days already banked
  // into the accumulator are the ones before it.
  const elapsed = Math.max(0, city.clock.day - 1);
  const trade =
    elapsed > 0
      ? (city.budget.tradeAccumulator / elapsed) * DAYS_PER_MONTH
      : city.budget.lastTrade;

  return {
    month: city.clock.month,
    year: city.clock.year,
    residentialTax: survey.residential,
    commercialTax: survey.commercial,
    industrialTax: survey.industrial,
    buildingUpkeep: upkeep.buildings,
    roadUpkeep: upkeep.roads,
    wallUpkeep: upkeep.walls,
    loanRepayment,
    trade,
    net: income - costs - loanRepayment + trade,
    // Trade banked so far is already in `gold`; only the rest of the month's
    // is still to come.
    closingGold:
      city.budget.gold + income - costs - loanRepayment + (trade - city.budget.tradeAccumulator),
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

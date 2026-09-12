import { describe, expect, it } from 'vitest';
import { RoadType } from '@/sim/types';
import { buildingTiles, createBuilding, registerBuilding, tileIndex } from '@/sim/city';
import { getDef } from '@/data/buildings';
import {
  ARREARS_GRACE,
  DAYS_PER_MONTH,
  LEDGER_MONTHS,
  LOAN_INTEREST,
  LOAN_TERM_MONTHS,
  MONTHS_PER_YEAR,
  TAX_PER_RESIDENT,
  advanceCalendar,
  collectTaxes,
  loanOffer,
  projectMonth,
  ratedLandValue,
  serviceAusterity,
  settleMonth,
  takeLoan,
  taxBase,
  totalUpkeep,
  upkeepByType,
} from '@/sim/economy';
import { computeServiceCoverage } from '@/sim/services';
import { Service } from '@/sim/types';
import { makeFlatCity, mainRoadY } from './helpers';

function cityWithTaxpayers() {
  const city = makeFlatCity();
  const y = mainRoadY();
  const house = createBuilding(city, 'house2', 3, y + 1);
  house.residents = 12;
  house.connected = true;
  registerBuilding(city, house);

  const shop = createBuilding(city, 'shop2', 5, y + 1);
  shop.workers = 8;
  shop.connected = true;
  shop.supplyRatio = 1;
  registerBuilding(city, shop);

  const mill = createBuilding(city, 'timber2', 7, y + 1);
  mill.workers = 11;
  mill.connected = true;
  mill.supplyRatio = 1;
  registerBuilding(city, mill);

  city.landValue.fill(0.5);
  return { city, house, shop, mill };
}

describe('taxes', () => {
  it('collects from dwellings, shops and workshops separately', () => {
    const { city } = cityWithTaxpayers();
    const taxes = collectTaxes(city);
    expect(taxes.residential).toBeGreaterThan(0);
    expect(taxes.commercial).toBeGreaterThan(0);
    expect(taxes.industrial).toBeGreaterThan(0);
  });

  it('scales with the tax rate', () => {
    const { city } = cityWithTaxpayers();
    const low = collectTaxes(city).residential;
    city.budget.taxRateResidential = 0.2;
    expect(collectTaxes(city).residential).toBeCloseTo(low * 2, 5);
  });

  it('scales with land value', () => {
    const { city } = cityWithTaxpayers();
    const modest = collectTaxes(city).residential;
    city.landValue.fill(1);
    expect(collectTaxes(city).residential).toBeGreaterThan(modest);
  });

  it('collects nothing from abandoned or cut-off premises', () => {
    const { city, house, shop, mill } = cityWithTaxpayers();
    house.abandoned = true;
    shop.connected = false;
    mill.abandoned = true;
    const taxes = collectTaxes(city);
    expect(taxes.residential).toBe(0);
    expect(taxes.commercial).toBe(0);
    expect(taxes.industrial).toBe(0);
  });

  it('rates a large building on its whole footprint, not its anchor corner', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    const manor = createBuilding(city, 'house4', 4, y + 1);
    manor.residents = 20;
    manor.connected = true;
    registerBuilding(city, manor);

    // A gradient running across the manor: cheap at the anchor, dear beyond it.
    city.landValue.fill(0);
    for (const tile of buildingTiles(manor)) {
      city.landValue[tileIndex(city, tile.x, tile.y)] = tile.x === manor.x && tile.y === manor.y ? 0 : 1;
    }

    expect(ratedLandValue(city, manor)).toBeCloseTo(0.75, 5);
    // Taxed on the corner alone the multiplier would be 0.65; on the mean it is higher.
    const anchorOnly = manor.residents * TAX_PER_RESIDENT * city.budget.taxRateResidential * 0.65;
    expect(collectTaxes(city).residential).toBeGreaterThan(anchorOnly);
  });

  it('collects less from a shop with empty shelves', () => {
    const { city, shop } = cityWithTaxpayers();
    const stocked = collectTaxes(city).commercial;
    shop.supplyRatio = 0;
    expect(collectTaxes(city).commercial).toBeLessThan(stocked);
  });
});

describe('upkeep', () => {
  it('bills buildings, roads and walls', () => {
    const { city } = cityWithTaxpayers();
    registerBuilding(city, createBuilding(city, 'chapel', 9, mainRoadY() + 1));
    const upkeep = totalUpkeep(city);
    expect(upkeep.buildings).toBeGreaterThan(0);
    expect(upkeep.roads).toBeGreaterThan(0);
    expect(upkeep.walls).toBeGreaterThan(0);
  });

  it('charges nothing for an abandoned building', () => {
    const city = makeFlatCity();
    const chapel = createBuilding(city, 'chapel', 4, mainRoadY() + 1);
    registerBuilding(city, chapel);
    const before = totalUpkeep(city).buildings;
    chapel.abandoned = true;
    expect(totalUpkeep(city).buildings).toBeLessThan(before);
  });

  it('charges more for grander roads', () => {
    const city = makeFlatCity();
    const cobbleBill = totalUpkeep(city).roads;
    for (let x = 0; x < 16; x++) city.roads[tileIndex(city, x, mainRoadY())] = RoadType.Avenue;
    expect(totalUpkeep(city).roads).toBeGreaterThan(cobbleBill);
  });
});

describe('monthly settlement', () => {
  it('adds income and subtracts upkeep from the treasury', () => {
    const { city } = cityWithTaxpayers();
    const before = city.budget.gold;
    const statement = settleMonth(city);
    expect(city.budget.gold).toBeCloseTo(
      before + statement.residentialTax + statement.commercialTax + statement.industrialTax -
        statement.buildingUpkeep - statement.roadUpkeep - statement.wallUpkeep,
      5,
    );
  });

  it('records the month for the ledger and resets the accumulators', () => {
    const { city } = cityWithTaxpayers();
    city.budget.tradeAccumulator = 120;
    const statement = settleMonth(city);
    expect(city.budget.lastIncome).toBeCloseTo(
      statement.residentialTax + statement.commercialTax + statement.industrialTax,
      5,
    );
    expect(city.budget.lastTrade).toBe(120);
    expect(city.budget.tradeAccumulator).toBe(0);
  });

  it('does not pay the trade balance a second time at settlement', () => {
    // tradeWithWorld already moved this gold when the caravans arrived; the
    // accumulator only mirrors it for the ledger. Settling must not re-credit it.
    const { city } = cityWithTaxpayers();
    const before = city.budget.gold;
    city.budget.tradeAccumulator = 500;
    const statement = settleMonth(city);
    expect(city.budget.gold).toBeCloseTo(
      before + statement.residentialTax + statement.commercialTax + statement.industrialTax -
        statement.buildingUpkeep - statement.roadUpkeep - statement.wallUpkeep,
      5,
    );
    expect(statement.trade).toBe(500);
  });

  it("reports a net that matches the month's whole movement in gold", () => {
    const { city } = cityWithTaxpayers();
    const opening = city.budget.gold;

    // A month of trading: the world pays the city day by day.
    for (let day = 0; day < DAYS_PER_MONTH; day++) {
      const takings = 40 - day;
      city.budget.gold += takings;
      city.budget.tradeAccumulator += takings;
    }

    const statement = settleMonth(city);
    expect(city.budget.gold - opening).toBeCloseTo(statement.net, 5);
  });

  it('warns the journal when the treasury runs dry', () => {
    const { city } = cityWithTaxpayers();
    city.budget.gold = -100000;
    settleMonth(city);
    expect(city.journal.some((entry) => entry.tone === 'bad')).toBe(true);
  });
});

describe('the itemised bill', () => {
  it('groups standing buildings by type, dearest first', () => {
    const { city } = cityWithTaxpayers();
    const y = mainRoadY();
    registerBuilding(city, createBuilding(city, 'chapel', 9, y + 1));
    registerBuilding(city, createBuilding(city, 'guardpost', 12, y + 1));
    registerBuilding(city, createBuilding(city, 'guardpost', 14, y + 1));

    const lines = upkeepByType(city);
    const guards = lines.find((line) => line.defId === 'guardpost');
    expect(guards?.count).toBe(2);
    expect(guards?.upkeep).toBeCloseTo(getDef('guardpost').upkeep * 2, 5);
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i - 1].upkeep).toBeGreaterThanOrEqual(lines[i].upkeep);
    }
  });

  it('adds up to the building upkeep the month is billed for', () => {
    const { city } = cityWithTaxpayers();
    registerBuilding(city, createBuilding(city, 'chapel', 9, mainRoadY() + 1));
    const itemised = upkeepByType(city).reduce((sum, line) => sum + line.upkeep, 0);
    expect(itemised).toBeCloseTo(totalUpkeep(city).buildings, 5);
  });

  it('leaves out ruins, which are billed for nothing', () => {
    const { city } = cityWithTaxpayers();
    const chapel = createBuilding(city, 'chapel', 9, mainRoadY() + 1);
    registerBuilding(city, chapel);
    chapel.abandoned = true;
    expect(upkeepByType(city).some((line) => line.defId === 'chapel')).toBe(false);
  });
});

describe('pricing a tithe before it is set', () => {
  it('reports what a full rate would be worth in each zone', () => {
    const { city } = cityWithTaxpayers();
    const base = taxBase(city);
    const taxes = collectTaxes(city);
    expect(base.residential * city.budget.taxRateResidential).toBeCloseTo(taxes.residential, 5);
    expect(base.commercial * city.budget.taxRateCommercial).toBeCloseTo(taxes.commercial, 5);
    expect(base.industrial * city.budget.taxRateIndustrial).toBeCloseTo(taxes.industrial, 5);
  });

  it('does not disturb the rates the city is actually on', () => {
    const { city } = cityWithTaxpayers();
    taxBase(city);
    expect(city.budget.taxRateResidential).toBe(0.1);
    expect(city.budget.taxRateCommercial).toBe(0.1);
    expect(city.budget.taxRateIndustrial).toBe(0.1);
  });
});

describe('the month in progress', () => {
  it('quotes a whole month of tithes and upkeep on the first day of it', () => {
    const { city } = cityWithTaxpayers();
    city.clock.day = 1;
    const projected = projectMonth(city);
    const taxes = collectTaxes(city);
    const upkeep = totalUpkeep(city);

    expect(projected.residentialTax).toBeCloseTo(taxes.residential, 5);
    expect(projected.buildingUpkeep).toBeCloseTo(upkeep.buildings, 5);
    expect(projected.roadUpkeep).toBeCloseTo(upkeep.roads, 5);
    expect(projected.wallUpkeep).toBeCloseTo(upkeep.walls, 5);
  });

  it('carries the month’s trade forward at the rate it has run so far', () => {
    const { city } = cityWithTaxpayers();
    // Ten days gone, at a hundred gold a day.
    city.clock.day = 11;
    city.budget.tradeAccumulator = 1000;
    expect(projectMonth(city).trade).toBeCloseTo(100 * DAYS_PER_MONTH, 5);
  });

  it('falls back to last month before the new one has any trade to go on', () => {
    const { city } = cityWithTaxpayers();
    city.clock.day = 1;
    city.budget.tradeAccumulator = 0;
    city.budget.lastTrade = 420;
    expect(projectMonth(city).trade).toBe(420);
  });

  it('does not count trade already banked twice over in the closing treasury', () => {
    const { city } = cityWithTaxpayers();
    city.clock.day = 16;
    // Half the month gone, and the caravans have already paid this much in.
    city.budget.tradeAccumulator = 600;
    const projected = projectMonth(city);
    const bills = projected.residentialTax + projected.commercialTax + projected.industrialTax -
      projected.buildingUpkeep - projected.roadUpkeep - projected.wallUpkeep;
    expect(projected.closingGold).toBeCloseTo(city.budget.gold + bills + 600, 5);
  });

  it('shows the upkeep of a building the moment it is raised, not a month later', () => {
    const { city } = cityWithTaxpayers();
    city.clock.day = 1;
    const before = projectMonth(city).net;
    registerBuilding(city, createBuilding(city, 'garrison', 9, mainRoadY() + 1));
    expect(projectMonth(city).net).toBeCloseTo(before - getDef('garrison').upkeep, 5);
  });
});

describe('the ledger', () => {
  it('keeps the statement of every month it closes', () => {
    const { city } = cityWithTaxpayers();
    const statement = settleMonth(city);
    expect(city.budget.history).toHaveLength(1);
    expect(city.budget.history[0]).toEqual(statement);
    expect(statement.closingGold).toBe(city.budget.gold);
  });

  it('dates a statement to the month that closed, not the one starting', () => {
    const { city } = cityWithTaxpayers();
    city.clock.day = DAYS_PER_MONTH;
    city.clock.month = MONTHS_PER_YEAR;
    const startYear = city.clock.year;
    advanceCalendar(city);

    const statement = settleMonth(city);
    expect(city.clock.month).toBe(1);
    expect(statement.month).toBe(MONTHS_PER_YEAR);
    expect(statement.year).toBe(startYear);
  });

  it('keeps a year and no more', () => {
    const { city } = cityWithTaxpayers();
    for (let month = 0; month < LEDGER_MONTHS + 4; month++) settleMonth(city);
    expect(city.budget.history).toHaveLength(LEDGER_MONTHS);
  });
});

describe('borrowing from the Crown', () => {
  it('advances the gold and books the debt with interest', () => {
    const { city } = cityWithTaxpayers();
    const before = city.budget.gold;
    const offer = loanOffer(city);
    const loan = takeLoan(city);

    expect(loan).not.toBeNull();
    expect(city.budget.gold).toBe(before + offer.principal);
    expect(loan!.outstanding).toBeCloseTo(offer.principal * (1 + LOAN_INTEREST), 0);
    expect(loan!.monthsRemaining).toBe(LOAN_TERM_MONTHS);
  });

  it('will not lend twice at once', () => {
    const { city } = cityWithTaxpayers();
    takeLoan(city);
    expect(loanOffer(city).available).toBe(false);
    const before = city.budget.gold;
    expect(takeLoan(city)).toBeNull();
    expect(city.budget.gold).toBe(before);
  });

  it('takes an instalment each month until the debt is cleared', () => {
    const { city } = cityWithTaxpayers();
    const loan = takeLoan(city)!;
    const owed = loan.outstanding;

    let repaid = 0;
    for (let month = 0; month < LOAN_TERM_MONTHS; month++) {
      repaid += settleMonth(city).loanRepayment;
    }
    expect(repaid).toBeCloseTo(owed, 5);
    expect(city.budget.loan).toBeNull();
    // And nothing is taken once the Crown has been paid.
    expect(settleMonth(city).loanRepayment).toBe(0);
  });

  it('takes the instalment whether or not the month’s tithes cover it', () => {
    const { city } = cityWithTaxpayers();
    const loan = takeLoan(city)!;
    city.budget.gold = 0;
    const statement = settleMonth(city);
    expect(statement.loanRepayment).toBeCloseTo(loan.payment, 5);
    expect(city.budget.gold).toBeCloseTo(
      statement.residentialTax + statement.commercialTax + statement.industrialTax -
        statement.buildingUpkeep - statement.roadUpkeep - statement.wallUpkeep -
        statement.loanRepayment,
      5,
    );
  });

  it('offers more to a city with more to maintain', () => {
    const { city } = cityWithTaxpayers();
    const modest = loanOffer(city).principal;
    for (let i = 0; i < 6; i++) {
      registerBuilding(city, createBuilding(city, 'garrison', 9 + i * 3, mainRoadY() + 3));
    }
    expect(loanOffer(city).principal).toBeGreaterThanOrEqual(modest);
  });
});

describe('running out of gold', () => {
  it('counts the months the city closes in the red, and forgets them once paid', () => {
    const { city } = cityWithTaxpayers();
    city.budget.gold = -500;
    settleMonth(city);
    expect(city.budget.arrears).toBe(1);

    city.budget.gold = -500;
    settleMonth(city);
    expect(city.budget.arrears).toBe(2);

    city.budget.gold = 10000;
    settleMonth(city);
    expect(city.budget.arrears).toBe(0);
  });

  it('leaves the first month in the red as a warning only', () => {
    const { city } = cityWithTaxpayers();
    city.budget.arrears = ARREARS_GRACE;
    expect(serviceAusterity(city)).toBe(1);
  });

  it('shuts down more of the city the longer the debt stands, but never all of it', () => {
    const { city } = cityWithTaxpayers();
    city.budget.arrears = ARREARS_GRACE + 1;
    const first = serviceAusterity(city);
    city.budget.arrears = ARREARS_GRACE + 2;
    const second = serviceAusterity(city);

    expect(first).toBeLessThan(1);
    expect(second).toBeLessThan(first);
    city.budget.arrears = 40;
    expect(serviceAusterity(city)).toBeGreaterThan(0);
  });

  it('empties the guard post it cannot pay for', () => {
    const { city } = cityWithTaxpayers();
    const post = createBuilding(city, 'guardpost', 9, mainRoadY() + 1);
    registerBuilding(city, post);

    computeServiceCoverage(city);
    const paid = city.coverage[Service.Safety][tileIndex(city, post.x, post.y)];

    city.budget.arrears = ARREARS_GRACE + 2;
    computeServiceCoverage(city);
    const unpaid = city.coverage[Service.Safety][tileIndex(city, post.x, post.y)];

    expect(paid).toBeGreaterThan(0);
    expect(unpaid).toBeLessThan(paid);
    expect(unpaid).toBeGreaterThan(0);
  });
});

describe('the calendar', () => {
  it('rolls days into months and months into years', () => {
    const city = makeFlatCity();
    city.clock.day = 1;
    city.clock.month = 1;
    const startYear = city.clock.year;

    let months = 0;
    let years = 0;
    for (let day = 0; day < DAYS_PER_MONTH * MONTHS_PER_YEAR; day++) {
      const rolled = advanceCalendar(city);
      if (rolled.newMonth) months++;
      if (rolled.newYear) years++;
    }
    expect(months).toBe(MONTHS_PER_YEAR);
    expect(years).toBe(1);
    expect(city.clock.year).toBe(startYear + 1);
    expect(city.clock.month).toBe(1);
    expect(city.clock.totalDays).toBe(DAYS_PER_MONTH * MONTHS_PER_YEAR);
  });
});

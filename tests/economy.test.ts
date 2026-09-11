import { describe, expect, it } from 'vitest';
import { RoadType } from '@/sim/types';
import { buildingTiles, createBuilding, registerBuilding, tileIndex } from '@/sim/city';
import {
  DAYS_PER_MONTH,
  MONTHS_PER_YEAR,
  TAX_PER_RESIDENT,
  advanceCalendar,
  collectTaxes,
  ratedLandValue,
  settleMonth,
  totalUpkeep,
} from '@/sim/economy';
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

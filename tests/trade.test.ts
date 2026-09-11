import { describe, expect, it } from 'vitest';
import { Good } from '@/sim/types';
import { createBuilding, registerBuilding, tileIndex } from '@/sim/city';
import {
  MAX_HAUL_DISTANCE,
  bestPriceBonus,
  computeRoadComponents,
  dailyNeed,
  reserveCapacity,
  runTrade,
  tradeWithWorld,
} from '@/sim/trade';
import { refreshBuildingFlags } from '@/sim/growth';
import { makeFlatCity, mainRoadY } from './helpers';

function place(city: ReturnType<typeof makeFlatCity>, defId: string, x: number, y: number) {
  const building = createBuilding(city, defId, x, y);
  registerBuilding(city, building);
  return building;
}

describe('road components', () => {
  it('labels one connected street as a single component', () => {
    const city = makeFlatCity();
    const labels = computeRoadComponents(city);
    const y = mainRoadY();
    const first = labels[tileIndex(city, 0, y)];
    expect(first).toBeGreaterThanOrEqual(0);
    for (let x = 0; x < 16; x++) expect(labels[tileIndex(city, x, y)]).toBe(first);
  });

  it('splits into two components when the street is severed', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    city.roads[tileIndex(city, 8, y)] = 0;
    const labels = computeRoadComponents(city);
    expect(labels[tileIndex(city, 2, y)]).not.toBe(labels[tileIndex(city, 12, y)]);
  });

  it('leaves tiles with no road unlabelled', () => {
    const city = makeFlatCity();
    const labels = computeRoadComponents(city);
    expect(labels[tileIndex(city, 3, 1)]).toBe(-1);
  });
});

describe('production', () => {
  it('makes goods in proportion to staffing', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    const mill = place(city, 'timber2', 3, y + 1);
    refreshBuildingFlags(city);
    mill.workers = 11; // Fully staffed.

    const report = runTrade(city);
    expect(report.produced[Good.Timber]).toBeCloseTo(12, 5);
  });

  it('makes nothing with nobody working', () => {
    const city = makeFlatCity();
    const mill = place(city, 'timber2', 3, mainRoadY() + 1);
    refreshBuildingFlags(city);
    mill.workers = 0;
    expect(runTrade(city).produced[Good.Timber]).toBe(0);
  });

  it('makes nothing when cut off from the road', () => {
    const city = makeFlatCity();
    const mill = place(city, 'timber2', 3, mainRoadY() + 4);
    refreshBuildingFlags(city);
    mill.workers = 11;
    expect(runTrade(city).produced[Good.Timber]).toBe(0);
  });

  it('limits a forge to the inputs it actually holds', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    const forge = place(city, 'craft1', 3, y + 1);
    refreshBuildingFlags(city);
    forge.workers = 6;
    city.reserves.timber = 0;
    city.reserves.ore = 0;

    // With no timber or ore on site, nothing is forged.
    expect(runTrade(city).produced[Good.Wares]).toBe(0);

    forge.stock[Good.Timber] = 10;
    forge.stock[Good.Ore] = 10;
    expect(runTrade(city).produced[Good.Wares]).toBeCloseTo(3, 5);
  });

  it('consumes inputs as it produces', () => {
    const city = makeFlatCity();
    const forge = place(city, 'craft1', 3, mainRoadY() + 1);
    refreshBuildingFlags(city);
    forge.workers = 6;
    forge.stock[Good.Timber] = 10;
    forge.stock[Good.Ore] = 10;
    runTrade(city);
    expect(forge.stock[Good.Timber]).toBeCloseTo(8, 5);
    expect(forge.stock[Good.Ore]).toBeCloseTo(8, 5);
  });
});

describe('haulage', () => {
  it('moves goods from a mill to a forge down the same street', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    const mill = place(city, 'timber2', 3, y + 1);
    const mine = place(city, 'mine2', 5, y + 1);
    const forge = place(city, 'craft1', 9, y + 1);
    refreshBuildingFlags(city);
    mill.workers = 11;
    mine.workers = 12;
    forge.workers = 6;
    mill.stock[Good.Timber] = 40;
    mine.stock[Good.Ore] = 40;
    city.reserves.timber = 0;
    city.reserves.ore = 0;

    const report = runTrade(city);
    expect(forge.stock[Good.Timber]).toBeGreaterThan(0);
    expect(forge.stock[Good.Ore]).toBeGreaterThan(0);
    expect(report.deliveries.some((d) => d.from === mill.id && d.to === forge.id)).toBe(true);
  });

  it('will not haul across a severed street', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    const mill = place(city, 'timber2', 3, y + 1);
    const forge = place(city, 'craft1', 12, y + 1);
    city.roads[tileIndex(city, 8, y)] = 0;
    refreshBuildingFlags(city);
    mill.workers = 11;
    forge.workers = 6;
    mill.stock[Good.Timber] = 40;
    city.reserves.timber = 0;

    runTrade(city);
    expect(forge.stock[Good.Timber] ?? 0).toBe(0);
  });

  it('falls back on the hub reserves when no producer can supply', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    const forge = place(city, 'craft1', 4, y + 1);
    refreshBuildingFlags(city);
    forge.workers = 6;
    city.reserves.timber = 100;
    city.reserves.ore = 100;

    const report = runTrade(city);
    expect(forge.stock[Good.Timber]).toBeGreaterThan(0);
    expect(report.deliveries.some((d) => d.from === -1 && d.to === forge.id)).toBe(true);
    expect(city.reserves.timber).toBeLessThan(100);
  });

  it('records how well supplied each workplace is', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    const starved = place(city, 'craft1', 4, y + 1);
    refreshBuildingFlags(city);
    starved.workers = 6;
    city.reserves.timber = 0;
    city.reserves.ore = 0;
    for (let day = 0; day < 6; day++) runTrade(city);
    expect(starved.supplyRatio).toBeLessThan(0.2);

    city.reserves.timber = 400;
    city.reserves.ore = 400;
    for (let day = 0; day < 6; day++) runTrade(city);
    expect(starved.supplyRatio).toBeGreaterThan(0.6);
  });

  it('quotes a daily need scaled by staffing', () => {
    const city = makeFlatCity();
    const shop = place(city, 'shop2', 4, mainRoadY() + 1);
    shop.workers = 8;
    const full = dailyNeed(shop)[Good.Wares] ?? 0;
    shop.workers = 0;
    const idle = dailyNeed(shop)[Good.Wares] ?? 0;
    expect(full).toBeGreaterThan(idle);
    expect(idle).toBeGreaterThan(0);
  });

  it('keeps hauls within a sensible radius', () => {
    expect(MAX_HAUL_DISTANCE).toBeGreaterThan(10);
    expect(MAX_HAUL_DISTANCE).toBeLessThan(200);
  });
});

describe('trade hubs', () => {
  it('adds storage to the city reserves', () => {
    const city = makeFlatCity();
    const bare = reserveCapacity(city);
    place(city, 'market', 4, mainRoadY() + 1);
    expect(reserveCapacity(city)).toBe(bare + 40);
  });

  it('reports the best margin any hub can offer', () => {
    const city = makeFlatCity();
    expect(bestPriceBonus(city)).toBe(0);
    place(city, 'market', 4, mainRoadY() + 1);
    expect(bestPriceBonus(city)).toBe(0);
    place(city, 'caravanserai', 8, mainRoadY() + 1);
    expect(bestPriceBonus(city)).toBeCloseTo(0.12, 5);
  });

  it('does no outside trade at all with no hub', () => {
    const city = makeFlatCity();
    const before = city.budget.gold;
    const result = tradeWithWorld(city, reserveCapacity(city));
    expect(result.exportIncome).toBe(0);
    expect(result.importSpend).toBe(0);
    expect(city.budget.gold).toBe(before);
  });

  it('sells the surplus for gold', () => {
    const city = makeFlatCity();
    const market = place(city, 'market', 4, mainRoadY() + 1);
    refreshBuildingFlags(city);
    market.workers = 14;
    const capacity = reserveCapacity(city);
    for (const good of [Good.Grain, Good.Timber, Good.Ore, Good.Wares]) {
      city.reserves[good] = capacity;
    }
    const before = city.budget.gold;
    const result = tradeWithWorld(city, capacity);
    expect(result.exportIncome).toBeGreaterThan(0);
    expect(city.budget.gold).toBeGreaterThan(before);
  });

  it('buys in what the city lacks', () => {
    const city = makeFlatCity();
    const market = place(city, 'market', 4, mainRoadY() + 1);
    refreshBuildingFlags(city);
    market.workers = 14;
    for (const good of [Good.Grain, Good.Timber, Good.Ore, Good.Wares]) city.reserves[good] = 0;
    const before = city.budget.gold;
    const result = tradeWithWorld(city, reserveCapacity(city));
    expect(result.importSpend).toBeGreaterThan(0);
    expect(city.reserves[Good.Grain]).toBeGreaterThan(0);
    expect(city.budget.gold).toBeLessThan(before);
  });

  it('will not import on an empty treasury', () => {
    const city = makeFlatCity();
    const market = place(city, 'market', 4, mainRoadY() + 1);
    refreshBuildingFlags(city);
    market.workers = 14;
    city.budget.gold = 0;
    for (const good of [Good.Grain, Good.Timber, Good.Ore, Good.Wares]) city.reserves[good] = 0;
    const result = tradeWithWorld(city, reserveCapacity(city));
    expect(result.importSpend).toBe(0);
  });

  it('brings travellers in, scaled by how well staffed the hub is', () => {
    const city = makeFlatCity();
    const docks = place(city, 'market', 4, mainRoadY() + 1);
    refreshBuildingFlags(city);
    docks.workers = 14;
    expect(tradeWithWorld(city, reserveCapacity(city)).travelers).toBeGreaterThan(0);
    docks.workers = 0;
    expect(tradeWithWorld(city, reserveCapacity(city)).travelers).toBe(0);
  });

  it('never lets reserves exceed the storage built', () => {
    const city = makeFlatCity();
    const market = place(city, 'market', 4, mainRoadY() + 1);
    refreshBuildingFlags(city);
    market.workers = 14;
    const capacity = reserveCapacity(city);
    city.reserves[Good.Grain] = capacity * 10;
    tradeWithWorld(city, capacity);
    expect(city.reserves[Good.Grain]).toBeLessThanOrEqual(capacity);
  });

  it('ships a producer’s surplus into the reserves', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    const mill = place(city, 'timber2', 3, y + 1);
    place(city, 'market', 6, y + 1);
    refreshBuildingFlags(city);
    mill.workers = 11;
    mill.stock[Good.Timber] = 200;
    const before = city.reserves[Good.Timber];
    runTrade(city);
    expect(city.reserves[Good.Timber]).toBeGreaterThan(before);
    expect(mill.stock[Good.Timber]).toBeLessThan(200);
  });
});

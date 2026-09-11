import { describe, expect, it } from 'vitest';
import { RoadType, Terrain, Zone } from '@/sim/types';
import { PARCEL_SIZE, buildingAtTile, isTileOwned, parcelAt, tileIndex } from '@/sim/city';
import { buyParcel, demolish, evaluatePlacement, placeBuilding, quoteParcel } from '@/sim/build';
import { getDef } from '@/data/buildings';
import { makeFlatCity, mainRoadY, zoneRect } from './helpers';

describe('placing a building', () => {
  it('accepts a clear plot fronting the road', () => {
    const city = makeFlatCity();
    const check = evaluatePlacement(city, 'well', 4, mainRoadY() + 1);
    expect(check.ok).toBe(true);
    expect(check.cost).toBe(getDef('well').cost);
  });

  it('insists on a road outside the door', () => {
    const city = makeFlatCity();
    const check = evaluatePlacement(city, 'well', 4, mainRoadY() + 4);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/road/i);
  });

  it('refuses land the city does not hold', () => {
    const city = makeFlatCity();
    expect(evaluatePlacement(city, 'well', city.width - 3, city.height - 3).reason).toMatch(/do not hold/i);
  });

  it('refuses ground that is already occupied', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    placeBuilding(city, 'well', 4, y + 1);
    expect(evaluatePlacement(city, 'well', 4, y + 1).reason).toMatch(/already stands/i);
    expect(evaluatePlacement(city, 'well', 4, y).reason).toMatch(/road/i);
    const wall = city.walls.find((w) => w.kind !== 'gate')!;
    expect(evaluatePlacement(city, 'well', wall.x, wall.y).reason).toMatch(/wall/i);
  });

  it('refuses uneven ground for a larger footprint', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    city.stats.population = 500;
    city.map.elevation[tileIndex(city, 5, y + 2)] = 5;
    expect(evaluatePlacement(city, 'chapel', 4, y + 1).reason).toMatch(/uneven/i);
  });

  it('holds grand buildings back until the city is big enough', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    city.stats.population = 10;
    expect(evaluatePlacement(city, 'chapel', 4, y + 1).reason).toMatch(/population/i);
    city.stats.population = 500;
    expect(evaluatePlacement(city, 'chapel', 4, y + 1).ok).toBe(true);
  });

  it('insists the docks are built against the water', () => {
    const city = makeFlatCity({ ownedParcels: 3, size: 48 });
    const y = mainRoadY(3);
    for (let x = 0; x < 24; x++) city.roads[tileIndex(city, x, y)] = RoadType.Cobble;
    city.stats.population = 5000;
    expect(evaluatePlacement(city, 'docks', 4, y + 1).reason).toMatch(/water/i);
    // Put the lake shore just beyond the far side of the same plot.
    for (let x = 3; x < 9; x++) city.map.terrain[tileIndex(city, x, y + 3)] = Terrain.ShallowWater;
    expect(evaluatePlacement(city, 'docks', 4, y + 1).ok).toBe(true);
  });

  it('insists a caravan post sits on the road out of the valley', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    city.stats.population = 5000;
    // The main street runs out through the western gate, so this qualifies.
    expect(evaluatePlacement(city, 'caravanserai', 4, y + 1).ok).toBe(true);

    // An isolated loop of street inside the walls does not.
    for (let x = 2; x < 6; x++) city.roads[tileIndex(city, x, y + 4)] = RoadType.Cobble;
    expect(evaluatePlacement(city, 'caravanserai', 3, y + 5).reason).toMatch(/valley/i);
  });

  it('refuses when the treasury is short', () => {
    const city = makeFlatCity();
    city.budget.gold = 10;
    expect(evaluatePlacement(city, 'well', 4, mainRoadY() + 1).reason).toMatch(/gold/i);
  });

  it('charges the treasury and registers every footprint tile', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    city.stats.population = 500;
    const before = city.budget.gold;
    expect(placeBuilding(city, 'chapel', 4, y + 1)).toBe(true);
    expect(city.budget.gold).toBe(before - getDef('chapel').cost);
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      expect(buildingAtTile(city, 4 + dx, y + 1 + dy)?.defId).toBe('chapel');
    }
  });

  it('clears any zoning paint beneath it', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    zoneRect(city, Zone.Residential, 4, y + 1, 2, 2);
    city.stats.population = 500;
    placeBuilding(city, 'chapel', 4, y + 1);
    expect(city.zones[tileIndex(city, 4, y + 1)]).toBe(Zone.None);
  });
});

describe('demolition', () => {
  it('clears a building and refunds nothing', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    placeBuilding(city, 'well', 4, y + 1);
    const before = city.budget.gold;
    const result = demolish(city, 4, y + 1);
    expect(result.ok).toBe(true);
    expect(buildingAtTile(city, 4, y + 1)).toBeNull();
    expect(city.budget.gold).toBeLessThan(before);
  });

  it('clears roads, then zoning, in that order', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    zoneRect(city, Zone.Residential, 4, y + 1, 1, 1);
    expect(demolish(city, 4, y).ok).toBe(true);
    expect(city.roads[tileIndex(city, 4, y)]).toBe(RoadType.None);
    expect(demolish(city, 4, y + 1).ok).toBe(true);
    expect(city.zones[tileIndex(city, 4, y + 1)]).toBe(Zone.None);
  });

  it('refuses to knock down the city wall by hand', () => {
    const city = makeFlatCity();
    const wall = city.walls.find((w) => w.kind !== 'gate')!;
    const result = demolish(city, wall.x, wall.y);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/wall/i);
  });

  it('reports when there is nothing to clear', () => {
    const city = makeFlatCity();
    expect(demolish(city, 4, 2).ok).toBe(false);
    expect(demolish(city, -5, -5).reason).toMatch(/outside/i);
  });
});

describe('annexing land', () => {
  it('quotes land and masonry separately', () => {
    const city = makeFlatCity({ ownedParcels: 2 });
    const quote = quoteParcel(city, 2, 0);
    expect(quote.ok).toBe(true);
    expect(quote.land).toBeGreaterThan(0);
    expect(quote.masonry).toBeGreaterThan(0);
    expect(quote.total).toBe(quote.land + quote.masonry);
  });

  it('refuses land the city already holds', () => {
    const city = makeFlatCity({ ownedParcels: 2 });
    expect(quoteParcel(city, 0, 0).reason).toMatch(/already/i);
  });

  it('refuses land that does not adjoin the city', () => {
    const city = makeFlatCity({ ownedParcels: 2 });
    expect(quoteParcel(city, 3, 3).reason).toMatch(/adjoin/i);
  });

  it('refuses land that cannot be settled', () => {
    const city = makeFlatCity({ ownedParcels: 2 });
    parcelAt(city, 2, 0)!.settleable = false;
    expect(quoteParcel(city, 2, 0).reason).toMatch(/water and stone/i);
  });

  it('takes the gold, claims the land and moves the wall', () => {
    const city = makeFlatCity({ ownedParcels: 2 });
    const quote = quoteParcel(city, 2, 0);
    const before = city.budget.gold;
    const result = buyParcel(city, 2, 0);

    expect(result.ok).toBe(true);
    expect(city.budget.gold).toBe(before - quote.total);
    expect(isTileOwned(city, 2 * PARCEL_SIZE + 1, 1)).toBe(true);
    expect(city.wallAt[tileIndex(city, 3 * PARCEL_SIZE - 1, 2)]).toBeGreaterThanOrEqual(0);
    expect(city.wallAt[tileIndex(city, 2 * PARCEL_SIZE - 1, 2)]).toBe(-1);
  });

  it('refuses when the treasury cannot cover land and walls together', () => {
    const city = makeFlatCity({ ownedParcels: 2 });
    const quote = quoteParcel(city, 2, 0);
    city.budget.gold = quote.total - 1;
    const result = buyParcel(city, 2, 0);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/gold/i);
    expect(isTileOwned(city, 2 * PARCEL_SIZE + 1, 1)).toBe(false);
  });

  it('leaves ownership untouched when only quoting', () => {
    const city = makeFlatCity({ ownedParcels: 2 });
    quoteParcel(city, 2, 0);
    expect(parcelAt(city, 2, 0)!.owned).toBe(false);
  });

  it('prices land further from the founding district higher', () => {
    const city = makeFlatCity({ ownedParcels: 2 });
    const near = parcelAt(city, 2, 0)!.price;
    const far = parcelAt(city, 3, 3)!.price;
    expect(far).toBeGreaterThan(near);
  });
});

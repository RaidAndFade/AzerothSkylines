import { describe, expect, it } from 'vitest';
import { Service, Zone } from '@/sim/types';
import { createBuilding, registerBuilding, tileIndex } from '@/sim/city';
import { distributeUtility, needsUtilities, utilityLevel } from '@/sim/utilities';
import { makeFlatCity, mainRoadY } from './helpers';

/** Put a row of houses along the south side of the main street. */
function addHouses(
  city: ReturnType<typeof makeFlatCity>,
  count: number,
  fromX = 2,
  roadY = mainRoadY(),
) {
  const y = roadY + 1;
  const houses = [];
  for (let i = 0; i < count; i++) {
    const building = createBuilding(city, 'house1', fromX + i, y);
    building.connected = true;
    registerBuilding(city, building);
    houses.push(building);
  }
  return houses;
}

describe('utility networks', () => {
  it('only plumbs dwellings, shops and workshops', () => {
    const city = makeFlatCity();
    const house = createBuilding(city, 'house1', 2, 2);
    const well = createBuilding(city, 'well', 4, 2);
    expect(needsUtilities(house)).toBe(true);
    expect(needsUtilities(well)).toBe(false);
  });

  it('reaches houses along the street from a well', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    const houses = addHouses(city, 5);
    const well = createBuilding(city, 'well', 2, y - 1);
    registerBuilding(city, well);

    const report = distributeUtility(city, Service.Water);
    expect(report.capacity).toBe(14);
    expect(report.demand).toBe(5);
    expect(report.served).toBe(5);
    for (const house of houses) expect(utilityLevel(city, house, Service.Water)).toBe(1);
  });

  it('leaves houses beyond the network range dry', () => {
    const city = makeFlatCity({ ownedParcels: 3, size: 48 });
    const y = mainRoadY(3);
    for (let x = 0; x < 24; x++) city.roads[tileIndex(city, x, y)] = 2;
    const near = createBuilding(city, 'house1', 2, y + 1);
    const far = createBuilding(city, 'house1', 22, y + 1);
    registerBuilding(city, near);
    registerBuilding(city, far);
    // A well with a short reach, right beside the near house.
    const well = createBuilding(city, 'well', 2, y - 1);
    registerBuilding(city, well);

    distributeUtility(city, Service.Water);
    expect(utilityLevel(city, near, Service.Water)).toBe(1);
    expect(utilityLevel(city, far, Service.Water)).toBe(0);
  });

  it('serves only as many buildings as its capacity allows', () => {
    const city = makeFlatCity({ ownedParcels: 3, size: 48 });
    const y = mainRoadY(3);
    for (let x = 0; x < 24; x++) city.roads[tileIndex(city, x, y)] = 2;
    addHouses(city, 16, 2, y);
    const well = createBuilding(city, 'well', 2, y - 1);
    registerBuilding(city, well);

    const report = distributeUtility(city, Service.Water);
    expect(report.demand).toBe(16);
    expect(report.connected).toBe(16);
    // One well covers fourteen buildings, no more.
    expect(report.served).toBe(14);
  });

  it('adds a second source to cover the overflow', () => {
    const city = makeFlatCity({ ownedParcels: 3, size: 48 });
    const y = mainRoadY(3);
    for (let x = 0; x < 24; x++) city.roads[tileIndex(city, x, y)] = 2;
    addHouses(city, 16, 2, y);
    registerBuilding(city, createBuilding(city, 'well', 2, y - 1));
    registerBuilding(city, createBuilding(city, 'well', 12, y - 1));

    const report = distributeUtility(city, Service.Water);
    expect(report.served).toBe(16);
  });

  it('never reaches a house with no street outside its door', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    const stranded = createBuilding(city, 'house1', 3, y + 4);
    registerBuilding(city, stranded);
    registerBuilding(city, createBuilding(city, 'well', 2, y - 1));

    const report = distributeUtility(city, Service.Water);
    expect(report.connected).toBe(0);
    expect(utilityLevel(city, stranded, Service.Water)).toBe(0);
  });

  it('runs drainage on its own separate network', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    const houses = addHouses(city, 3);
    registerBuilding(city, createBuilding(city, 'cesspit', 2, y - 1));

    distributeUtility(city, Service.Water);
    distributeUtility(city, Service.Sewage);
    for (const house of houses) {
      expect(utilityLevel(city, house, Service.Sewage)).toBe(1);
      // No well was built, so there is still no fresh water.
      expect(utilityLevel(city, house, Service.Water)).toBe(0);
    }
  });

  it('clears the field when the source is demolished', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    const houses = addHouses(city, 3);
    const well = createBuilding(city, 'well', 2, y - 1);
    registerBuilding(city, well);
    distributeUtility(city, Service.Water);
    expect(utilityLevel(city, houses[0], Service.Water)).toBe(1);

    city.buildings.delete(well.id);
    distributeUtility(city, Service.Water);
    expect(utilityLevel(city, houses[0], Service.Water)).toBe(0);
  });

  it('ignores abandoned buildings on both sides of the pipe', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    const houses = addHouses(city, 4);
    houses[0].abandoned = true;
    const well = createBuilding(city, 'well', 2, y - 1);
    well.abandoned = true;
    registerBuilding(city, well);

    const report = distributeUtility(city, Service.Water);
    expect(report.demand).toBe(3);
    expect(report.capacity).toBe(0);
    expect(report.served).toBe(0);
  });

  it('marks the served streets so the overlay can draw them', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    addHouses(city, 3);
    registerBuilding(city, createBuilding(city, 'well', 2, y - 1));
    distributeUtility(city, Service.Water);
    expect(city.coverage[Service.Water][tileIndex(city, 4, y)]).toBe(1);
    // But not streets outside the network.
    expect(city.coverage[Service.Water][tileIndex(city, 4, y + 5)]).toBe(0);
  });

  it('does not leak through a severed street', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    const houses = addHouses(city, 8);
    city.roads[tileIndex(city, 5, y)] = 0;
    registerBuilding(city, createBuilding(city, 'well', 2, y - 1));

    distributeUtility(city, Service.Water);
    expect(utilityLevel(city, houses[0], Service.Water)).toBe(1);
    expect(utilityLevel(city, houses[7], Service.Water)).toBe(0);
  });
});

describe('zone independence', () => {
  it('plumbs shops and workshops as readily as houses', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    const shop = createBuilding(city, 'shop1', 3, y + 1);
    const mill = createBuilding(city, 'timber1', 5, y + 1);
    registerBuilding(city, shop);
    registerBuilding(city, mill);
    city.zones[tileIndex(city, 3, y + 1)] = Zone.Commercial;
    registerBuilding(city, createBuilding(city, 'well', 2, y - 1));

    const report = distributeUtility(city, Service.Water);
    expect(report.served).toBe(2);
  });
});

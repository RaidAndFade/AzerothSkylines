import { describe, expect, it } from 'vitest';
import { Zone } from '@/sim/types';
import { buildingAtTile, createBuilding, registerBuilding, tileIndex } from '@/sim/city';
import {
  DECAY_DAYS,
  UPGRADE_MIN_AGE,
  buildQuota,
  chooseIndustryLine,
  findFootprint,
  isGrown,
  ladderFor,
  refreshBuildingFlags,
  startingDefFor,
  tryUpgrade,
  updateGrowth,
} from '@/sim/growth';
import { getDef } from '@/data/buildings';
import { makeFlatCity, mainRoadY, zoneRect } from './helpers';

describe('build quota', () => {
  it('builds nothing without demand', () => {
    expect(buildQuota(0, 500)).toBe(0);
    expect(buildQuota(0.05, 500)).toBe(0);
  });

  it('builds faster as demand and population rise', () => {
    expect(buildQuota(0.9, 1000)).toBeGreaterThan(buildQuota(0.3, 1000));
    expect(buildQuota(0.9, 1000)).toBeGreaterThan(buildQuota(0.9, 10));
  });

  it('always manages at least one when demand exists', () => {
    expect(buildQuota(0.1, 0)).toBeGreaterThanOrEqual(1);
  });
});

describe('developing zoned land', () => {
  it('raises buildings on zoned plots that front the street', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    zoneRect(city, Zone.Residential, 2, y + 1, 6, 1);
    city.demand.residential = 1;
    city.stats.population = 100;

    const report = updateGrowth(city);
    expect(report.built).toBeGreaterThan(0);
    expect(city.buildings.size).toBe(report.built);
    for (const building of city.buildings.values()) {
      expect(building.y).toBe(y + 1);
      expect(getDef(building.defId).zone).toBe(Zone.Residential);
    }
  });

  it('leaves plots with no street frontage empty', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    zoneRect(city, Zone.Residential, 2, y + 3, 6, 1);
    city.demand.residential = 1;
    city.stats.population = 100;

    expect(updateGrowth(city).built).toBe(0);
    expect(city.buildings.size).toBe(0);
  });

  it('builds nothing where there is no demand', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    zoneRect(city, Zone.Residential, 2, y + 1, 6, 1);
    city.demand.residential = 0;
    expect(updateGrowth(city).built).toBe(0);
  });

  it('starts every ladder at its first rung', () => {
    const city = makeFlatCity();
    expect(startingDefFor(city, Zone.Residential, 4, 4)).toBe('house1');
    expect(startingDefFor(city, Zone.Commercial, 4, 4)).toBe('shop1');
  });

  it('never puts two buildings on one plot', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    zoneRect(city, Zone.Residential, 2, y + 1, 6, 1);
    city.demand.residential = 1;
    city.stats.population = 400;
    for (let day = 0; day < 8; day++) updateGrowth(city);
    expect(city.buildings.size).toBeLessThanOrEqual(6);
  });
});

describe('choosing an industry', () => {
  it('turns fertile open ground to farming', () => {
    const city = makeFlatCity();
    city.map.fertility.fill(0.95);
    city.map.treeDensity.fill(0);
    city.map.oreRichness.fill(0);
    expect(chooseIndustryLine(city, 6, 6)).toBe('farm');
  });

  it('turns deep woodland to timber', () => {
    const city = makeFlatCity();
    city.map.fertility.fill(0.1);
    city.map.treeDensity.fill(1);
    city.map.oreRichness.fill(0);
    expect(chooseIndustryLine(city, 6, 6)).toBe('timber');
  });

  it('turns ore-rich stone to mining', () => {
    const city = makeFlatCity();
    city.map.fertility.fill(0.1);
    city.map.treeDensity.fill(0);
    city.map.oreRichness.fill(1);
    expect(chooseIndustryLine(city, 6, 6)).toBe('mine');
  });

  it('turns barren but well-supplied ground to crafting', () => {
    const city = makeFlatCity();
    city.map.fertility.fill(0.05);
    city.map.treeDensity.fill(0);
    city.map.oreRichness.fill(0.05);
    city.reserves.timber = 200;
    city.reserves.ore = 200;
    expect(chooseIndustryLine(city, 6, 6)).toBe('craft');
  });
});

describe('upgrading', () => {
  function houseReadyToUpgrade() {
    const city = makeFlatCity();
    const y = mainRoadY();
    zoneRect(city, Zone.Residential, 2, y + 1, 6, 2);
    const house = createBuilding(city, 'house1', 3, y + 1);
    house.connected = true;
    house.happiness = 0.9;
    house.age = UPGRADE_MIN_AGE + 1;
    house.residents = 5;
    registerBuilding(city, house);
    city.landValue.fill(0.9);
    city.demand.residential = 0.8;
    return { city, house };
  }

  it('moves a contented house up its ladder', () => {
    const { city, house } = houseReadyToUpgrade();
    expect(tryUpgrade(city, house)).toBe(true);
    const replacement = buildingAtTile(city, house.x, house.y);
    expect(replacement?.defId).toBe('house2');
    expect(replacement?.residents).toBe(5);
  });

  it('will not upgrade a young building', () => {
    const { city, house } = houseReadyToUpgrade();
    house.age = 1;
    expect(tryUpgrade(city, house)).toBe(false);
  });

  it('will not upgrade a miserable building', () => {
    const { city, house } = houseReadyToUpgrade();
    house.happiness = 0.2;
    expect(tryUpgrade(city, house)).toBe(false);
  });

  it('will not upgrade on cheap land', () => {
    const { city, house } = houseReadyToUpgrade();
    city.landValue.fill(0.1);
    expect(tryUpgrade(city, house)).toBe(false);
  });

  it('will not upgrade with no demand', () => {
    const { city, house } = houseReadyToUpgrade();
    city.demand.residential = 0;
    expect(tryUpgrade(city, house)).toBe(false);
  });

  it('stops at the top of the ladder', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    const manor = createBuilding(city, 'house4', 3, y + 1);
    manor.connected = true;
    manor.happiness = 1;
    manor.age = 100;
    registerBuilding(city, manor);
    city.landValue.fill(1);
    city.demand.residential = 1;
    expect(tryUpgrade(city, manor)).toBe(false);
  });

  it('knows each ladder and where a building sits on it', () => {
    const city = makeFlatCity();
    const mill = createBuilding(city, 'timber2', 2, 2);
    const ladder = ladderFor(mill);
    expect(ladder.ids).toEqual(['timber1', 'timber2', 'timber3']);
    expect(ladder.index).toBe(1);
  });
});

describe('finding room for a bigger footprint', () => {
  it('accepts a clear, zoned, street-facing square', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    zoneRect(city, Zone.Residential, 2, y + 1, 4, 2);
    const house = createBuilding(city, 'house1', 3, y + 1);
    registerBuilding(city, house);
    expect(findFootprint(city, house, 2, 2, Zone.Residential)).not.toBeNull();
  });

  it('refuses when a neighbour is in the way', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    zoneRect(city, Zone.Residential, 2, y + 1, 4, 2);
    const house = createBuilding(city, 'house1', 3, y + 1);
    registerBuilding(city, house);
    for (const x of [2, 3, 4]) {
      const blocker = createBuilding(city, 'house1', x, y + 2);
      registerBuilding(city, blocker);
    }
    const other = createBuilding(city, 'house1', 4, y + 1);
    registerBuilding(city, other);
    expect(findFootprint(city, house, 2, 2, Zone.Residential)).toBeNull();
  });

  it('refuses to spill onto unzoned land', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    zoneRect(city, Zone.Residential, 3, y + 1, 1, 1);
    const house = createBuilding(city, 'house1', 3, y + 1);
    registerBuilding(city, house);
    expect(findFootprint(city, house, 2, 2, Zone.Residential)).toBeNull();
  });

  it('returns the original anchor when the footprint is unchanged', () => {
    const city = makeFlatCity();
    const house = createBuilding(city, 'house1', 3, 4);
    expect(findFootprint(city, house, 1, 1, Zone.Residential)).toEqual({ x: 3, y: 4 });
  });
});

describe('decline', () => {
  it('abandons a house after a long run of misery', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    const house = createBuilding(city, 'house1', 3, y + 1);
    house.residents = 5;
    registerBuilding(city, house);
    refreshBuildingFlags(city);
    house.happiness = 0.05;

    for (let day = 0; day < DECAY_DAYS; day++) {
      updateGrowth(city);
      house.happiness = 0.05;
    }
    expect(house.abandoned).toBe(true);
    expect(house.residents).toBe(0);
  });

  it('eventually clears the ruin away', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    const house = createBuilding(city, 'house1', 3, y + 1);
    registerBuilding(city, house);
    refreshBuildingFlags(city);
    house.happiness = 0;
    for (let day = 0; day < 60; day++) {
      updateGrowth(city);
      if (city.buildings.size === 0) break;
    }
    expect(city.buildings.size).toBe(0);
    expect(city.buildingAt[tileIndex(city, 3, y + 1)]).toBe(-1);
  });

  it('recovers when conditions improve before the end', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    const house = createBuilding(city, 'house1', 3, y + 1);
    registerBuilding(city, house);
    refreshBuildingFlags(city);

    house.happiness = 0.05;
    for (let day = 0; day < 5; day++) updateGrowth(city);
    expect(house.decay).toBeGreaterThan(0);

    house.happiness = 0.8;
    for (let day = 0; day < 10; day++) updateGrowth(city);
    expect(house.abandoned).toBe(false);
    expect(house.decay).toBe(0);
  });

  it('abandons anything cut off from the road network', () => {
    const city = makeFlatCity();
    const house = createBuilding(city, 'house1', 3, 2);
    house.happiness = 1;
    registerBuilding(city, house);
    refreshBuildingFlags(city);
    expect(house.connected).toBe(false);
    for (let day = 0; day < DECAY_DAYS; day++) {
      updateGrowth(city);
      house.happiness = 1;
    }
    expect(house.abandoned).toBe(true);
  });
});

describe('isGrown', () => {
  it('separates zoned growth from placed civic buildings', () => {
    const city = makeFlatCity();
    expect(isGrown(createBuilding(city, 'house1', 1, 1))).toBe(true);
    expect(isGrown(createBuilding(city, 'chapel', 1, 1))).toBe(false);
  });
});

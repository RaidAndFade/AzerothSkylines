import { describe, expect, it } from 'vitest';
import { Service } from '@/sim/types';
import { createBuilding, registerBuilding, tileIndex } from '@/sim/city';
import {
  FLIGHT_THRESHOLD,
  WORKFORCE_RATIO,
  assignJobs,
  evaluateHappiness,
  taxPenalty,
  updateHappiness,
  updatePopulation,
} from '@/sim/population';
import { refreshBuildingFlags } from '@/sim/growth';
import { getDef } from '@/data/buildings';
import { makeFlatCity, mainRoadY } from './helpers';

function houseOn(city: ReturnType<typeof makeFlatCity>, x: number, defId = 'house1') {
  const y = mainRoadY() + 1;
  const house = createBuilding(city, defId, x, y);
  registerBuilding(city, house);
  refreshBuildingFlags(city);
  return house;
}

/** Give every service field full coverage, for an otherwise perfect city. */
function serveEverything(city: ReturnType<typeof makeFlatCity>) {
  for (const service of Object.values(Service)) city.coverage[service].fill(1);
  city.landValue.fill(0.8);
  city.pollution.fill(0);
}

describe('happiness', () => {
  it('is near zero for anything cut off from the road', () => {
    const city = makeFlatCity();
    const house = houseOn(city, 3);
    serveEverything(city);
    house.connected = false;
    expect(evaluateHappiness(city, house)).toBeLessThan(0.1);
  });

  it('is zero for a ruin', () => {
    const city = makeFlatCity();
    const house = houseOn(city, 3);
    house.abandoned = true;
    expect(evaluateHappiness(city, house)).toBe(0);
  });

  it('rises with the services reaching the door', () => {
    const city = makeFlatCity();
    const house = houseOn(city, 3);
    house.residents = 2;
    const bare = evaluateHappiness(city, house);
    serveEverything(city);
    expect(evaluateHappiness(city, house)).toBeGreaterThan(bare + 0.3);
  });

  it('falls with smoke over the street', () => {
    const city = makeFlatCity();
    const house = houseOn(city, 3);
    serveEverything(city);
    const clean = evaluateHappiness(city, house);
    city.pollution.fill(1);
    expect(evaluateHappiness(city, house)).toBeLessThan(clean);
  });

  it('falls as the tax rate climbs', () => {
    const city = makeFlatCity();
    const house = houseOn(city, 3);
    serveEverything(city);
    const tithe = evaluateHappiness(city, house);
    city.budget.taxRateResidential = 0.35;
    expect(evaluateHappiness(city, house)).toBeLessThan(tithe);
  });

  it('falls as a house fills up', () => {
    const city = makeFlatCity();
    const house = houseOn(city, 3);
    serveEverything(city);
    house.residents = 0;
    const roomy = evaluateHappiness(city, house);
    house.residents = getDef('house1').residents ?? 5;
    expect(evaluateHappiness(city, house)).toBeLessThan(roomy);
  });

  it('rewards a workshop that gets its deliveries', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    const forge = createBuilding(city, 'craft1', 3, y + 1);
    registerBuilding(city, forge);
    refreshBuildingFlags(city);
    serveEverything(city);
    forge.workers = 6;

    forge.supplyRatio = 0;
    const starved = evaluateHappiness(city, forge);
    forge.supplyRatio = 1;
    expect(evaluateHappiness(city, forge)).toBeGreaterThan(starved);
  });

  it('stays inside [0,1] under any conditions', () => {
    const city = makeFlatCity();
    const house = houseOn(city, 3);
    for (const pollution of [0, 1, 5]) {
      for (const rate of [0, 0.1, 0.5, 1]) {
        city.pollution.fill(pollution);
        city.budget.taxRateResidential = rate;
        const value = evaluateHappiness(city, house);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('charges no penalty for a tithe, and a steep one for extortion', () => {
    const city = makeFlatCity();
    const house = houseOn(city, 3);
    city.budget.taxRateResidential = 0.1;
    expect(taxPenalty(city, house)).toBe(0);
    city.budget.taxRateResidential = 0.4;
    expect(taxPenalty(city, house)).toBe(1);
  });

  it('eases toward the new value rather than jumping', () => {
    const city = makeFlatCity();
    const house = houseOn(city, 3);
    house.happiness = 0;
    serveEverything(city);
    updateHappiness(city);
    const first = house.happiness;
    updateHappiness(city);
    expect(first).toBeGreaterThan(0);
    expect(house.happiness).toBeGreaterThan(first);
    expect(first).toBeLessThan(0.6);
  });
});

describe('moving in and out', () => {
  it('fills empty houses when the city is attractive', () => {
    const city = makeFlatCity();
    const house = houseOn(city, 3);
    house.happiness = 0.9;
    city.demand.residential = 1;
    city.stats.happiness = 0.9;

    const report = updatePopulation(city);
    expect(report.arrivals).toBeGreaterThan(0);
    expect(house.residents).toBeGreaterThan(0);
    expect(report.housingCapacity).toBe(getDef('house1').residents);
  });

  it('never exceeds a house’s capacity', () => {
    const city = makeFlatCity();
    const house = houseOn(city, 3);
    house.happiness = 1;
    city.demand.residential = 1;
    city.stats.happiness = 1;
    for (let day = 0; day < 50; day++) updatePopulation(city);
    expect(house.residents).toBe(getDef('house1').residents);
  });

  it('empties a miserable house', () => {
    const city = makeFlatCity();
    const house = houseOn(city, 3);
    house.residents = 5;
    house.happiness = FLIGHT_THRESHOLD - 0.1;
    const report = updatePopulation(city);
    expect(report.departures).toBeGreaterThan(0);
    expect(house.residents).toBeLessThan(5);
  });

  it('brings nobody to a city nobody wants to live in', () => {
    const city = makeFlatCity();
    const house = houseOn(city, 3);
    house.happiness = 0.5;
    city.demand.residential = 0;
    city.stats.happiness = 0;
    expect(updatePopulation(city).arrivals).toBe(0);
  });

  it('ignores ruins when counting housing', () => {
    const city = makeFlatCity();
    const house = houseOn(city, 3);
    house.abandoned = true;
    expect(updatePopulation(city).housingCapacity).toBe(0);
  });
});

describe('jobs', () => {
  it('fills posts up to the size of the workforce', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    const shop = createBuilding(city, 'shop2', 3, y + 1);
    registerBuilding(city, shop);
    refreshBuildingFlags(city);

    const posts = getDef('shop2').jobs ?? 0;
    const { jobs, employed } = assignJobs(city, 100);
    expect(jobs).toBe(posts);
    expect(employed).toBe(posts);
    expect(shop.workers).toBe(posts);
  });

  it('leaves posts empty when there are too few workers', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    registerBuilding(city, createBuilding(city, 'shop4', 3, y + 1));
    refreshBuildingFlags(city);
    const { employed } = assignJobs(city, 10);
    expect(employed).toBe(Math.floor(10 * WORKFORCE_RATIO));
  });

  it('gives the best premises first pick of the labour', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    const good = createBuilding(city, 'shop2', 3, y + 1);
    const poor = createBuilding(city, 'shop2', 5, y + 1);
    registerBuilding(city, good);
    registerBuilding(city, poor);
    refreshBuildingFlags(city);
    good.happiness = 0.95;
    good.supplyRatio = 1;
    poor.happiness = 0.1;
    poor.supplyRatio = 0;

    assignJobs(city, 15);
    expect(good.workers).toBeGreaterThan(poor.workers);
  });

  it('offers no work in a ruin or a cut-off building', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    const ruin = createBuilding(city, 'shop2', 3, y + 1);
    ruin.abandoned = true;
    const stranded = createBuilding(city, 'shop2', 3, y + 5);
    registerBuilding(city, ruin);
    registerBuilding(city, stranded);
    refreshBuildingFlags(city);

    const { jobs, employed } = assignJobs(city, 200);
    expect(jobs).toBe(0);
    expect(employed).toBe(0);
    expect(ruin.workers).toBe(0);
    expect(stranded.workers).toBe(0);
  });

  it('does not count a well as a workplace', () => {
    const city = makeFlatCity();
    registerBuilding(city, createBuilding(city, 'well', 3, mainRoadY() + 1));
    refreshBuildingFlags(city);
    expect(assignJobs(city, 100).jobs).toBe(0);
  });
});

describe('coverage sampling', () => {
  it('reads services at the building’s own tile', () => {
    const city = makeFlatCity();
    const house = houseOn(city, 3);
    city.coverage[Service.Faith][tileIndex(city, house.x, house.y)] = 1;
    const withFaith = evaluateHappiness(city, house);
    city.coverage[Service.Faith][tileIndex(city, house.x, house.y)] = 0;
    expect(withFaith).toBeGreaterThan(evaluateHappiness(city, house));
  });
});

/**
 * End-to-end tests: play a city the way a player would and check that it
 * actually grows, employs, supplies and pays for itself.
 */
import { describe, expect, it } from 'vitest';
import { ALL_SERVICES, MONTH_NAMES, RoadType, Service, Zone } from '@/sim/types';
import {
  CityState,
  JOURNAL_LIMIT,
  createCity,
  logEvent,
  markJournalRead,
  tileIndex,
  unreadJournalCount,
} from '@/sim/city';
import {
  COMPLAINT_REPEAT_DAYS,
  Simulation,
  announceProgress,
  reviewComplaints,
} from '@/sim/simulation';
import { createTrafficQueue } from '@/sim/agents';
import { placeBuilding } from '@/sim/build';
import { getDef } from '@/data/buildings';
import { makeFlatCity, mainRoadY, ownParcelBlock, zoneRect } from './helpers';

/**
 * Lay out a small but complete town: a grid of streets, three zones, and
 * the water, drainage, guard and faith buildings a city needs.
 */
function buildStarterTown(): CityState {
  const city = makeFlatCity({ ownedParcels: 4, size: 48, gold: 400000 });
  ownParcelBlock(city, 4, 4);
  const span = 32;

  // A street grid: avenues every four tiles, in both directions.
  for (let x = 1; x < span - 1; x++) {
    for (const y of [4, 12, 20, 28]) city.roads[tileIndex(city, x, y)] = RoadType.Cobble;
  }
  for (let y = 1; y < span - 1; y++) {
    for (const x of [4, 12, 20, 28]) city.roads[tileIndex(city, x, y)] = RoadType.Cobble;
  }
  // And out through the western wall, to the world.
  city.roads[tileIndex(city, 0, 12)] = RoadType.Cobble;

  // Dwellings north, trade in the middle, crafting south and downwind.
  for (const y of [5, 6, 7, 10, 11]) zoneRect(city, Zone.Residential, 1, y, span - 2, 1);
  for (const y of [13, 14, 18, 19]) zoneRect(city, Zone.Commercial, 1, y, span - 2, 1);
  for (const y of [21, 22, 26, 27]) zoneRect(city, Zone.Industrial, 1, y, span - 2, 1);

  return city;
}

/**
 * Put the civic buildings in before the zoned land develops, the way a
 * player lays out a district: wells and drains first, then the guard.
 */
function addServices(city: CityState): void {
  // Grand buildings are gated on population; the founder plans ahead.
  const realPopulation = city.stats.population;
  city.stats.population = 400;
  for (const x of [2, 6, 10, 14, 18, 22, 26, 30]) {
    placeBuilding(city, 'well', x, 3);
    placeBuilding(city, 'well', x, 19);
    placeBuilding(city, 'cesspit', x, 21);
    placeBuilding(city, 'cesspit', x, 29);
    placeBuilding(city, 'guardpost', x, 11);
    placeBuilding(city, 'shrine', x, 13);
    placeBuilding(city, 'garden', x, 5);
  }
  placeBuilding(city, 'market', 5, 27);
  city.stats.population = realPopulation;
}

describe('a city that is played properly', () => {
  const city = buildStarterTown();
  const sim = new Simulation(city, createTrafficQueue());
  addServices(city);
  for (let day = 0; day < 300; day++) sim.runDay();

  it('attracts a real population', () => {
    expect(city.stats.population).toBeGreaterThan(500);
  });

  it('fills the housing it has, and then wants more land', () => {
    expect(city.stats.population).toBeGreaterThan(city.stats.housingCapacity * 0.9);
    expect(city.demand.residential).toBeGreaterThan(0.3);
  });

  it('builds in all three zones', () => {
    const byZone = { residential: 0, commercial: 0, industrial: 0 };
    for (const building of city.buildings.values()) {
      const zone = getDef(building.defId).zone;
      if (zone === Zone.Residential) byZone.residential++;
      else if (zone === Zone.Commercial) byZone.commercial++;
      else if (zone === Zone.Industrial) byZone.industrial++;
    }
    expect(byZone.residential).toBeGreaterThan(10);
    expect(byZone.commercial).toBeGreaterThan(4);
    expect(byZone.industrial).toBeGreaterThan(4);
  });

  it('improves buildings beyond their first rung', () => {
    let upgraded = 0;
    for (const building of city.buildings.values()) {
      if ((getDef(building.defId).level ?? 1) > 1) upgraded++;
    }
    expect(upgraded).toBeGreaterThan(5);
  });

  it('keeps its people reasonably content', () => {
    expect(city.stats.happiness).toBeGreaterThan(0.55);
  });

  it('pays its own way once it is established', () => {
    expect(city.budget.lastIncome).toBeGreaterThan(city.budget.lastUpkeep);
    expect(city.budget.gold).toBeGreaterThan(0);
  });

  it('keeps most people in work', () => {
    expect(city.stats.unemployment).toBeLessThan(0.35);
  });

  it('runs its water and drainage networks', () => {
    expect(city.stats.services[Service.Water]).toBeGreaterThan(0.8);
    expect(city.stats.services[Service.Sewage]).toBeGreaterThan(0.5);
    expect(city.stats.services[Service.Safety]).toBeGreaterThan(0.2);
  });

  it('runs a supply chain that actually moves goods', () => {
    const produced = Object.values(city.stats.goodsProduced).reduce((a, b) => a + b, 0);
    const consumed = Object.values(city.stats.goodsConsumed).reduce((a, b) => a + b, 0);
    expect(produced).toBeGreaterThan(0);
    expect(consumed).toBeGreaterThan(0);
  });

  it('puts traffic on the streets', () => {
    sim.update(3);
    expect(city.agents.length).toBeGreaterThan(0);
  });

  it('raises taxes that are worth raising', () => {
    expect(city.budget.lastIncome).toBeGreaterThan(0);
    expect(city.budget.lastUpkeep).toBeGreaterThan(0);
  });

  it('keeps every figure finite and sane', () => {
    const stats = city.stats;
    for (const value of [stats.population, stats.happiness, stats.landValue, stats.pollution, city.budget.gold]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(stats.happiness).toBeGreaterThanOrEqual(0);
    expect(stats.happiness).toBeLessThanOrEqual(1);
    expect(stats.population).toBeLessThanOrEqual(stats.housingCapacity);
  });

  it('never double-books a tile', () => {
    const occupied = new Map<number, number>();
    for (const building of city.buildings.values()) {
      for (let ty = building.y; ty < building.y + building.height; ty++) {
        for (let tx = building.x; tx < building.x + building.width; tx++) {
          const index = tileIndex(city, tx, ty);
          expect(occupied.has(index)).toBe(false);
          occupied.set(index, building.id);
          expect(city.buildingAt[index]).toBe(building.id);
        }
      }
    }
  });

  it('never builds on a road or a wall', () => {
    for (const building of city.buildings.values()) {
      for (let ty = building.y; ty < building.y + building.height; ty++) {
        for (let tx = building.x; tx < building.x + building.width; tx++) {
          const index = tileIndex(city, tx, ty);
          expect(city.roads[index]).toBe(RoadType.None);
          expect(city.wallAt[index]).toBe(-1);
        }
      }
    }
  });
});

describe('a city that is neglected', () => {
  it('empties out when nothing is provided', () => {
    const city = makeFlatCity({ ownedParcels: 3, size: 48, gold: 60000 });
    ownParcelBlock(city, 3, 3);
    const y = mainRoadY(3);
    for (let x = 0; x < 24; x++) city.roads[tileIndex(city, x, y)] = RoadType.Cobble;
    zoneRect(city, Zone.Residential, 1, y + 1, 20, 1);
    zoneRect(city, Zone.Industrial, 1, y - 1, 20, 1);

    const sim = new Simulation(city, createTrafficQueue());
    for (let day = 0; day < 60; day++) sim.runDay();
    const peak = city.stats.population;
    expect(peak).toBeGreaterThan(0);

    // Crushing taxes and no services at all.
    city.budget.taxRateResidential = 0.6;
    city.budget.taxRateCommercial = 0.6;
    city.budget.taxRateIndustrial = 0.6;
    for (let day = 0; day < 260; day++) sim.runDay();

    expect(city.stats.population).toBeLessThan(peak);
    expect(city.stats.abandonedCount).toBeGreaterThan(0);
  });
});

describe('the simulation clock', () => {
  it('turns real seconds into game days', () => {
    const city = makeFlatCity();
    const sim = new Simulation(city, createTrafficQueue());
    const start = city.clock.totalDays;
    sim.update(2.4);
    expect(city.clock.totalDays).toBe(start + 1);
  });

  it('stands still when paused', () => {
    const city = makeFlatCity();
    const sim = new Simulation(city, createTrafficQueue());
    sim.speed = 0;
    const start = city.clock.totalDays;
    sim.update(60);
    expect(city.clock.totalDays).toBe(start);
  });

  it('runs faster at higher speeds', () => {
    const slow = makeFlatCity();
    const fast = makeFlatCity();
    const slowSim = new Simulation(slow, createTrafficQueue());
    const fastSim = new Simulation(fast, createTrafficQueue());
    fastSim.speed = 3;
    slowSim.update(2.4);
    fastSim.update(2.4);
    expect(fast.clock.totalDays).toBeGreaterThan(slow.clock.totalDays);
  });

  it('caps catch-up so a long stall cannot freeze the game', () => {
    const city = makeFlatCity();
    const sim = new Simulation(city, createTrafficQueue());
    const start = city.clock.totalDays;
    sim.update(1000);
    expect(city.clock.totalDays - start).toBeLessThanOrEqual(4);
  });
});

describe('a freshly generated valley', () => {
  it('starts with a road, a wall and a gate, and survives being played', () => {
    const city = createCity({ width: 72, height: 72, seed: 'northshire' });
    const sim = new Simulation(city, createTrafficQueue());

    expect(city.walls.length).toBeGreaterThan(0);
    expect(city.walls.some((w) => w.kind === 'gate')).toBe(true);
    expect(city.walls.some((w) => w.kind === 'tower')).toBe(true);

    let roadTiles = 0;
    for (const road of city.roads) if (road !== RoadType.None) roadTiles++;
    expect(roadTiles).toBeGreaterThan(10);

    for (let day = 0; day < 60; day++) sim.runDay();
    expect(Number.isFinite(city.budget.gold)).toBe(true);
  });

  it('works for a range of seeds without throwing', () => {
    for (const seed of ['elwynn', 'goldshire', 'westbrook', 'jerod', 'stonecairn']) {
      const city = createCity({ width: 64, height: 64, seed });
      const sim = new Simulation(city, createTrafficQueue());
      expect(() => {
        for (let day = 0; day < 25; day++) sim.runDay();
        sim.update(5);
      }).not.toThrow();
    }
  });
});

describe('the Chronicle', () => {
  /**
   * A town with houses and streets but no shops, so commerce coverage sits
   * under its threshold for the whole run and never recovers.
   */
  function starvedTown(): { city: CityState; sim: Simulation } {
    const city = makeFlatCity({ ownedParcels: 3, size: 48, gold: 200000 });
    ownParcelBlock(city, 3, 3);
    const y = mainRoadY(3);
    for (let x = 0; x < 24; x++) city.roads[tileIndex(city, x, y)] = RoadType.Cobble;
    zoneRect(city, Zone.Residential, 1, y + 1, 20, 1);
    zoneRect(city, Zone.Residential, 1, y - 1, 20, 1);
    const sim = new Simulation(city, createTrafficQueue());
    return { city, sim };
  }

  function entriesSaying(city: CityState, fragment: string): number {
    return city.journal.filter((entry) => entry.text.includes(fragment)).length;
  }

  it('raises a standing shortage at most once a season', () => {
    const { city, sim } = starvedTown();
    for (let day = 0; day < 300; day++) sim.runDay();

    // Ten-day reviews over 300 days used to mean thirty identical lines.
    const complaints = city.journal.filter((entry) => entry.tone === 'bad');
    expect(complaints.length).toBeLessThanOrEqual(Math.ceil(300 / COMPLAINT_REPEAT_DAYS) + 1);
    for (const complaint of complaints) {
      expect(entriesSaying(city, complaint.text)).toBeLessThanOrEqual(
        Math.ceil(300 / COMPLAINT_REPEAT_DAYS) + 1,
      );
    }
  });

  it('says so when a shortage is put right', () => {
    const city = makeFlatCity({ ownedParcels: 3, size: 48, gold: 200000 });
    ownParcelBlock(city, 3, 3);
    city.stats.population = 400;
    // Water is by far the worst, so it is the one that gets raised.
    for (const service of ALL_SERVICES) city.stats.services[service] = 0.9;
    city.stats.services[Service.Water] = 0.1;
    reviewComplaints(city);
    expect(city.journal.at(-1)?.tone).toBe('bad');
    expect(city.journal.at(-1)?.text).toMatch(/wells/i);
    expect(city.complaints.water).toBeDefined();

    city.stats.services[Service.Water] = 0.95;
    reviewComplaints(city);
    expect(entriesSaying(city, 'draws clean water')).toBe(1);
    expect(city.complaints.water).toBeUndefined();
  });

  it('does not flip between complaint and relief on the threshold', () => {
    const city = makeFlatCity();
    city.stats.population = 400;
    for (const service of ALL_SERVICES) city.stats.services[service] = 0.9;

    // Water hovers either side of its threshold for two hundred days. Neither
    // crossing is decisive enough to count as put right, so relief is never
    // announced and the grievance is only ever re-raised on the season.
    for (let i = 0; i < 20; i++) {
      city.stats.services[Service.Water] = i % 2 === 0 ? 0.56 : 0.54;
      reviewComplaints(city);
      city.clock.totalDays += 10;
    }
    expect(city.journal.filter((entry) => entry.tone === 'good')).toHaveLength(0);
    expect(city.journal.filter((entry) => entry.tone === 'bad').length).toBeLessThanOrEqual(3);
  });

  it('announces a milestone once, and never again', () => {
    const city = makeFlatCity();
    city.stats.population = 200;
    announceProgress(city);
    expect(entriesSaying(city, 'now a Hamlet')).toBe(1);
    expect(entriesSaying(city, 'now a Village')).toBe(1);

    // Passing it again, and falling back through it, change nothing.
    for (const population of [200, 120, 60, 205]) {
      city.stats.population = population;
      announceProgress(city);
    }
    expect(entriesSaying(city, 'now a Hamlet')).toBe(1);
    expect(entriesSaying(city, 'now a Village')).toBe(1);
  });

  it('says when a gated building becomes available', () => {
    const city = makeFlatCity();
    city.stats.population = 119;
    announceProgress(city);
    expect(entriesSaying(city, "Lion's Pride Inn")).toBe(0);

    city.stats.population = 121;
    announceProgress(city);
    expect(entriesSaying(city, 'may now be built')).toBe(1);
    expect(entriesSaying(city, "Lion's Pride Inn")).toBe(1);

    city.stats.population = 160;
    announceProgress(city);
    expect(entriesSaying(city, "Lion's Pride Inn")).toBe(1);
    expect(entriesSaying(city, 'may now be built')).toBe(2);
  });

  it('stamps entries with the calendar, and marks them unread', () => {
    const city = makeFlatCity();
    city.clock.day = 24;
    city.clock.month = 4;
    city.clock.year = 26;
    logEvent(city, 'A thing happened.', 'bad');

    const entry = city.journal.at(-1);
    expect(entry?.dayOfMonth).toBe(24);
    expect(entry?.month).toBe(4);
    expect(entry?.year).toBe(26);
    expect(MONTH_NAMES[(entry?.month ?? 1) - 1]).toBe('Bloomrise');

    expect(unreadJournalCount(city, 'bad')).toBe(1);
    markJournalRead(city);
    expect(unreadJournalCount(city)).toBe(0);
  });

  it('keeps a bounded number of entries', () => {
    const city = makeFlatCity();
    for (let i = 0; i < JOURNAL_LIMIT + 40; i++) logEvent(city, `Entry ${i}`);
    expect(city.journal.length).toBe(JOURNAL_LIMIT);
    // The cap drops the oldest, not the newest.
    expect(city.journal.at(-1)?.text).toBe(`Entry ${JOURNAL_LIMIT + 39}`);
  });
});

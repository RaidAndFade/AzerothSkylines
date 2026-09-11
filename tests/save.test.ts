import { describe, expect, it } from 'vitest';
import { RoadType, Zone } from '@/sim/types';
import { createBuilding, createCity, purchasableParcels, registerBuilding, tileIndex } from '@/sim/city';
import { rebuildWalls } from '@/sim/walls';
import { buyParcel } from '@/sim/build';
import {
  SAVE_KEY,
  SAVE_VERSION,
  deserializeCity,
  hasSave,
  loadFromStorage,
  runLengthDecode,
  runLengthEncode,
  saveToStorage,
  serializeCity,
} from '@/sim/save';
import { Simulation } from '@/sim/simulation';
import { createTrafficQueue } from '@/sim/agents';
import { makeFlatCity, mainRoadY, zoneRect } from './helpers';

/** A trivial in-memory stand-in for localStorage. */
class MemoryStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

describe('run-length coding', () => {
  it('round-trips an array', () => {
    const source = new Uint8Array([0, 0, 0, 1, 1, 2, 0, 0]);
    const encoded = runLengthEncode(source);
    const decoded = runLengthDecode(encoded, new Uint8Array(source.length));
    expect(Array.from(decoded)).toEqual(Array.from(source));
  });

  it('compresses the long runs a city map is mostly made of', () => {
    const source = new Uint8Array(10000);
    source[5000] = 3;
    expect(runLengthEncode(source).length).toBe(6);
  });

  it('handles an empty array', () => {
    expect(runLengthEncode(new Uint8Array(0))).toEqual([]);
  });

  it('never writes past the end of the target', () => {
    const decoded = runLengthDecode([7, 1000], new Uint8Array(4));
    expect(Array.from(decoded)).toEqual([7, 7, 7, 7]);
  });
});

describe('saving and loading', () => {
  function playedCity() {
    const city = makeFlatCity({ ownedParcels: 2 });
    const y = mainRoadY();
    zoneRect(city, Zone.Residential, 2, y + 1, 6, 1);
    const house = createBuilding(city, 'house2', 3, y + 1);
    house.residents = 9;
    house.happiness = 0.77;
    house.stock = { grain: 4.5 };
    registerBuilding(city, house);
    city.budget.gold = 4321;
    city.budget.taxRateResidential = 0.17;
    city.clock.totalDays = 140;
    city.clock.month = 5;
    city.clock.year = 26;
    city.reserves.timber = 88;
    return city;
  }

  it('round-trips the parts of a city the player changed', () => {
    const city = playedCity();
    const restored = deserializeCity(serializeCity(city));

    expect(restored.width).toBe(city.width);
    expect(restored.budget.gold).toBe(4321);
    expect(restored.budget.taxRateResidential).toBe(0.17);
    expect(restored.clock.totalDays).toBe(140);
    expect(restored.clock.year).toBe(26);
    expect(restored.reserves.timber).toBe(88);
    expect(Array.from(restored.roads)).toEqual(Array.from(city.roads));
    expect(Array.from(restored.zones)).toEqual(Array.from(city.zones));
  });

  it('restores buildings, their occupants and their stock', () => {
    const city = playedCity();
    const restored = deserializeCity(serializeCity(city));

    expect(restored.buildings.size).toBe(city.buildings.size);
    const house = [...restored.buildings.values()][0];
    expect(house.defId).toBe('house2');
    expect(house.residents).toBe(9);
    expect(house.happiness).toBeCloseTo(0.77, 5);
    expect(house.stock.grain).toBe(4.5);
    // And the tile index is rebuilt, not just the list.
    expect(restored.buildingAt[tileIndex(restored, house.x, house.y)]).toBe(house.id);
  });

  it('regenerates identical terrain from the seed alone', () => {
    // Terrain is never stored: it is a pure function of the seed. This has to
    // be checked against a real generated valley rather than the flattened
    // test fixture, whose terrain is overwritten after generation.
    const city = createCity({ width: 64, height: 64, seed: 'northshire' });
    const data = serializeCity(city);
    expect(data.roads.length).toBeGreaterThan(0);
    const restored = deserializeCity(data);
    expect(Array.from(restored.map.terrain)).toEqual(Array.from(city.map.terrain));
    expect(Array.from(restored.map.elevation)).toEqual(Array.from(city.map.elevation));
    expect(restored.map.foundingSite).toEqual(city.map.foundingSite);
    expect(restored.map.foundingDistrict).toEqual(city.map.foundingDistrict);
  });

  it('restores which land the city holds, and rebuilds its wall', () => {
    const city = createCity({ width: 64, height: 64, seed: 'northshire' });
    rebuildWalls(city, false);
    // Annex a lot first, so the test covers ownership that is not just the
    // founding block, and a wall that has been pushed outward.
    const next = purchasableParcels(city)[0];
    expect(next).toBeDefined();
    expect(buyParcel(city, next.px, next.py).ok).toBe(true);

    const restored = deserializeCity(serializeCity(city));
    const ownedBefore = city.parcels.filter((p) => p.owned).map((p) => p.id);
    const ownedAfter = restored.parcels.filter((p) => p.owned).map((p) => p.id);
    expect(ownedAfter).toEqual(ownedBefore);
    expect(ownedAfter.length).toBeGreaterThan(4);
    expect(restored.walls.length).toBe(city.walls.length);
  });

  it('resumes cleanly: a restored city keeps simulating', () => {
    const city = playedCity();
    const restored = deserializeCity(serializeCity(city));
    const sim = new Simulation(restored, createTrafficQueue());
    expect(() => {
      for (let day = 0; day < 40; day++) sim.runDay();
    }).not.toThrow();
    expect(Number.isFinite(restored.budget.gold)).toBe(true);
  });

  it('refuses a save from another version', () => {
    const city = playedCity();
    const data = serializeCity(city);
    data.version = SAVE_VERSION + 7;
    expect(() => deserializeCity(data)).toThrow(/different version/i);
  });

  it('keeps a large city inside a sensible save size', () => {
    const city = makeFlatCity({ ownedParcels: 3, size: 64 });
    const y = mainRoadY(3);
    for (let x = 0; x < 24; x++) city.roads[tileIndex(city, x, y)] = RoadType.Cobble;
    for (let i = 0; i < 300; i++) {
      const building = createBuilding(city, 'house1', i % 20, 2 + Math.floor(i / 20));
      registerBuilding(city, building);
    }
    const json = JSON.stringify(serializeCity(city));
    // Comfortably inside the few megabytes a browser will hold.
    expect(json.length).toBeLessThan(1_000_000);
  });
});

describe('browser storage', () => {
  it('reports no save before anything is written', () => {
    const storage = new MemoryStorage();
    expect(hasSave(storage, SAVE_KEY)).toBe(false);
    expect(loadFromStorage(storage, SAVE_KEY)).toBeNull();
  });

  it('writes and reads a city back', () => {
    const storage = new MemoryStorage();
    const city = makeFlatCity();
    city.budget.gold = 777;
    expect(saveToStorage(city, storage, SAVE_KEY)).toBe(true);
    expect(hasSave(storage, SAVE_KEY)).toBe(true);
    expect(loadFromStorage(storage, SAVE_KEY)?.budget.gold).toBe(777);
  });

  it('reports failure rather than throwing when storage refuses', () => {
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    };
    expect(saveToStorage(makeFlatCity(), full, SAVE_KEY)).toBe(false);
  });

  it('returns null rather than throwing on a corrupt save', () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, '{ not json');
    expect(loadFromStorage(storage, SAVE_KEY)).toBeNull();
  });
});

/**
 * Saving and loading.
 *
 * The valley itself is never stored: terrain is a pure function of the seed,
 * so a save only has to carry what the player changed. Roads and zoning are
 * run-length encoded, which keeps a large city comfortably inside the size
 * a browser will hold in local storage.
 */
import { Agent, Building, Budget, Demand, GameClock, Good } from './types';
import { CityState, createCity, emptyStats, registerBuilding } from './city';
import { rebuildWalls } from './walls';
import { Rng } from '../core/rng';

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'azeroth-skylines-save';

export interface SaveData {
  version: number;
  seed: number;
  width: number;
  height: number;
  roads: number[];
  zones: number[];
  ownedParcels: number[];
  buildings: Building[];
  nextBuildingId: number;
  budget: Budget;
  clock: GameClock;
  demand: Demand;
  reserves: Record<Good, number>;
  journal: CityState['journal'];
  rngState: number;
}

/** Run-length encode a typed array as [value, count, value, count, ...]. */
export function runLengthEncode(data: ArrayLike<number>): number[] {
  const out: number[] = [];
  if (data.length === 0) return out;
  let value = data[0];
  let count = 1;
  for (let i = 1; i < data.length; i++) {
    if (data[i] === value) {
      count++;
      continue;
    }
    out.push(value, count);
    value = data[i];
    count = 1;
  }
  out.push(value, count);
  return out;
}

export function runLengthDecode(encoded: readonly number[], target: Uint8Array): Uint8Array {
  let offset = 0;
  for (let i = 0; i + 1 < encoded.length; i += 2) {
    const value = encoded[i];
    const count = encoded[i + 1];
    for (let n = 0; n < count && offset < target.length; n++) target[offset++] = value;
  }
  return target;
}

export function serializeCity(city: CityState): SaveData {
  return {
    version: SAVE_VERSION,
    seed: city.map.seed,
    width: city.width,
    height: city.height,
    roads: runLengthEncode(city.roads),
    zones: runLengthEncode(city.zones),
    ownedParcels: city.parcels.filter((parcel) => parcel.owned).map((parcel) => parcel.id),
    buildings: [...city.buildings.values()],
    nextBuildingId: city.nextBuildingId,
    budget: { ...city.budget },
    clock: { ...city.clock },
    demand: { ...city.demand },
    reserves: { ...city.reserves },
    journal: [...city.journal],
    rngState: city.rng.serialize(),
  };
}

/**
 * Rebuild a city from a save. Throws if the save is from a version this
 * build does not understand.
 */
export function deserializeCity(data: SaveData): CityState {
  if (data.version !== SAVE_VERSION) {
    throw new Error(`This save is from a different version of the game (${data.version}).`);
  }

  const city = createCity({ width: data.width, height: data.height, seed: data.seed });

  runLengthDecode(data.roads, city.roads);
  runLengthDecode(data.zones, city.zones);

  for (const parcel of city.parcels) parcel.owned = false;
  const owned = new Set(data.ownedParcels);
  for (const parcel of city.parcels) {
    if (owned.has(parcel.id)) parcel.owned = true;
  }

  city.buildings.clear();
  city.buildingAt.fill(-1);
  for (const building of data.buildings) {
    registerBuilding(city, { ...building, stock: { ...building.stock } });
  }
  city.nextBuildingId = data.nextBuildingId;

  Object.assign(city.budget, data.budget);
  Object.assign(city.clock, data.clock);
  Object.assign(city.demand, data.demand);
  Object.assign(city.reserves, data.reserves);
  city.journal = [...data.journal];
  city.stats = emptyStats();
  city.agents = [] as Agent[];
  city.nextAgentId = 1;
  (city as { rng: Rng }).rng = Rng.deserialize(data.rngState);

  city.walls = [];
  city.wallAt.fill(-1);
  rebuildWalls(city, false);

  // Everything derived is recomputed on the first simulated day.
  city.dirtyTiles.clear();
  return city;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Write a save. Returns false when storage is unavailable or full. */
export function saveToStorage(city: CityState, storage: StorageLike, key = SAVE_KEY): boolean {
  try {
    storage.setItem(key, JSON.stringify(serializeCity(city)));
    return true;
  } catch {
    return false;
  }
}

/** Read a save, or null when there is none (or it cannot be understood). */
export function loadFromStorage(storage: StorageLike, key = SAVE_KEY): CityState | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return deserializeCity(JSON.parse(raw) as SaveData);
  } catch {
    return null;
  }
}

export function hasSave(storage: StorageLike, key = SAVE_KEY): boolean {
  try {
    return storage.getItem(key) !== null;
  } catch {
    return false;
  }
}

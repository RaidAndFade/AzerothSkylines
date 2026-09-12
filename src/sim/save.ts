/**
 * Saving and loading.
 *
 * The valley itself is never stored: terrain is a pure function of the seed,
 * so a save only has to carry what the player changed. Roads and zoning are
 * run-length encoded, which keeps a large city comfortably inside the size
 * a browser will hold in local storage.
 */
import { Agent, Building, BuildingKind, Budget, Demand, GameClock, Good } from './types';
import { CityState, JournalEntry, createCity, emptyStats, registerBuilding } from './city';
import { DAYS_PER_MONTH, MONTHS_PER_YEAR } from './economy';
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
  /** Day each standing grievance was last raised; absent in older saves. */
  complaints?: Record<string, number>;
  /** Population high-water mark for announcements; absent in older saves. */
  announcedPopulation?: number;
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
    complaints: { ...city.complaints },
    announcedPopulation: city.announcedPopulation,
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
  city.journal = (data.journal ?? []).map((entry) => ({
    ...entry,
    // Entries in a save written before they carried a date have only the day
    // count; the calendar is a pure function of it, so fill it back in.
    ...(entry.month === undefined ? dateOf(data.clock, entry.day) : {}),
    unread: entry.unread ?? false,
  }));
  city.complaints = { ...data.complaints };
  // A save written before progress was tracked carries no high-water mark.
  // Derive one from the city as saved, so everything it has already grown
  // past is treated as announced rather than announced again on load.
  city.announcedPopulation = data.announcedPopulation ?? housedPopulation(data.buildings);
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

/**
 * The calendar date a given elapsed-day count falls on, worked out backwards
 * from a clock whose date is known. Epoch-free, so it stays correct whatever
 * year a city is founded in.
 */
function dateOf(clock: GameClock, totalDays: number): Pick<JournalEntry, 'dayOfMonth' | 'month' | 'year'> {
  const daysPerYear = DAYS_PER_MONTH * MONTHS_PER_YEAR;
  const now = clock.year * daysPerYear + (clock.month - 1) * DAYS_PER_MONTH + (clock.day - 1);
  const then = Math.max(0, now - (clock.totalDays - totalDays));
  return {
    dayOfMonth: (then % DAYS_PER_MONTH) + 1,
    month: (Math.floor(then / DAYS_PER_MONTH) % MONTHS_PER_YEAR) + 1,
    year: Math.floor(then / daysPerYear),
  };
}

/**
 * The people a saved city holds, without simulating it first. Counted the
 * same way `updatePopulation` counts them — dwellings only, and the folk
 * still in a derelict house included — so the mark this derives cannot come
 * out under the population the first simulated day reports and announce a
 * milestone the city passed long ago.
 */
function housedPopulation(buildings: readonly Building[]): number {
  let total = 0;
  for (const building of buildings) {
    if (building.kind === BuildingKind.Dwelling) total += building.residents;
  }
  return total;
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

/** The root city state and the tile helpers every system shares. */
import { Rng } from '../core/rng';
import { WorldMap, generateWorld, isTileBuildable } from './terrain';
import {
  ALL_GOODS,
  ALL_SERVICES,
  Agent,
  Budget,
  Building,
  BuildingKind,
  CityStats,
  Demand,
  GameClock,
  Good,
  Parcel,
  RoadType,
  Service,
  Terrain,
  WallSegment,
  Zone,
  isWater,
} from './types';
import { getDef } from '../data/buildings';

/** Tiles along one edge of a land parcel. */
export const PARCEL_SIZE = 8;
/** Parcels along one edge of the district the city is founded on. */
export const FOUNDING_DISTRICT_PARCELS = 2;
/** Base price of the first ring of land outside the founding district. */
export const PARCEL_BASE_PRICE = 420;
/** Gold per tile of curtain wall raised. */
export const WALL_COST_PER_TILE = 24;
/** Gold to demolish one tile of anything. */
export const DEMOLISH_COST_PER_TILE = 6;

export interface RoadCostTable {
  [RoadType.Path]: number;
  [RoadType.Cobble]: number;
  [RoadType.Avenue]: number;
}

export const ROAD_COST: RoadCostTable = {
  [RoadType.Path]: 4,
  [RoadType.Cobble]: 14,
  [RoadType.Avenue]: 38,
};

/** Gold per tile per day. Charged monthly, so these are small numbers. */
export const ROAD_UPKEEP: RoadCostTable = {
  [RoadType.Path]: 0.008,
  [RoadType.Cobble]: 0.035,
  [RoadType.Avenue]: 0.09,
};

export const ROAD_NAMES: Record<RoadType, string> = {
  [RoadType.None]: 'None',
  [RoadType.Path]: 'Footpath',
  [RoadType.Cobble]: 'Cobbled Street',
  [RoadType.Avenue]: 'Flagstone Avenue',
};

export interface CityState {
  readonly map: WorldMap;
  readonly width: number;
  readonly height: number;

  /** Road class per tile. */
  roads: Uint8Array;
  /** Zone paint per tile. */
  zones: Uint8Array;
  /** Building id occupying the tile, or -1. */
  buildingAt: Int32Array;
  /** Index into `walls` for the tile, or -1. */
  wallAt: Int32Array;

  buildings: Map<number, Building>;
  nextBuildingId: number;

  /** Parcel grid dimensions, in parcels. */
  parcelsWide: number;
  parcelsHigh: number;
  parcels: Parcel[];
  walls: WallSegment[];

  /** Coverage fields in [0,1], recomputed as the city changes. */
  coverage: Record<Service, Float32Array>;
  landValue: Float32Array;
  pollution: Float32Array;
  /** Road-network hop count from the nearest city gate; Infinity when cut off. */
  gateDistance: Float32Array;

  agents: Agent[];
  nextAgentId: number;

  demand: Demand;
  budget: Budget;
  stats: CityStats;
  clock: GameClock;

  /** Goods held collectively by trade hubs, available for distribution. */
  reserves: Record<Good, number>;

  rng: Rng;
  /** Set when tiles change, so the renderer knows to rebuild chunk caches. */
  dirtyTiles: Set<number>;
  /** Set when ownership changes, so walls are rebuilt on the next tick. */
  wallsDirty: boolean;
  /** Rolling log of notable events, newest last. */
  journal: { day: number; text: string; tone: 'good' | 'bad' | 'info' }[];
}

export interface CityOptions {
  width?: number;
  height?: number;
  seed?: number | string;
  startingGold?: number;
}

export function createCity(options: CityOptions = {}): CityState {
  const width = options.width ?? 112;
  const height = options.height ?? 112;
  const seed = options.seed ?? Math.floor(Math.random() * 0xffffffff);
  const map = generateWorld({
    width,
    height,
    seed,
    parcelSize: PARCEL_SIZE,
    districtParcels: FOUNDING_DISTRICT_PARCELS,
  });
  const rng = new Rng(map.seed ^ 0x2f6e2b1);
  const size = width * height;

  const coverage = Object.fromEntries(
    ALL_SERVICES.map((service) => [service, new Float32Array(size)]),
  ) as Record<Service, Float32Array>;

  const city: CityState = {
    map,
    width,
    height,
    roads: new Uint8Array(size),
    zones: new Uint8Array(size),
    buildingAt: new Int32Array(size).fill(-1),
    wallAt: new Int32Array(size).fill(-1),
    buildings: new Map(),
    nextBuildingId: 1,
    parcelsWide: Math.ceil(width / PARCEL_SIZE),
    parcelsHigh: Math.ceil(height / PARCEL_SIZE),
    parcels: [],
    walls: [],
    coverage,
    landValue: new Float32Array(size).fill(0.3),
    pollution: new Float32Array(size),
    gateDistance: new Float32Array(size).fill(Infinity),
    agents: [],
    nextAgentId: 1,
    demand: { residential: 0.75, commercial: 0.3, industrial: 0.35 },
    budget: {
      gold: options.startingGold ?? 6000,
      taxRateResidential: 0.1,
      taxRateCommercial: 0.1,
      taxRateIndustrial: 0.1,
      lastIncome: 0,
      lastUpkeep: 0,
      lastTrade: 0,
      incomeAccumulator: 0,
      upkeepAccumulator: 0,
      tradeAccumulator: 0,
    },
    stats: emptyStats(),
    clock: { totalDays: 0, day: 1, month: 1, year: 24, dayFraction: 0 },
    reserves: { [Good.Grain]: 60, [Good.Timber]: 40, [Good.Ore]: 20, [Good.Wares]: 30 },
    rng,
    dirtyTiles: new Set(),
    wallsDirty: true,
    journal: [],
  };

  initParcels(city);
  layKingsRoad(city);
  claimFoundingDistrict(city);
  return city;
}

export function emptyStats(): CityStats {
  return {
    population: 0,
    housingCapacity: 0,
    jobs: 0,
    employed: 0,
    unemployment: 0,
    happiness: 0.6,
    services: Object.fromEntries(ALL_SERVICES.map((s) => [s, 0])) as Record<Service, number>,
    goodsProduced: Object.fromEntries(ALL_GOODS.map((g) => [g, 0])) as Record<Good, number>,
    goodsConsumed: Object.fromEntries(ALL_GOODS.map((g) => [g, 0])) as Record<Good, number>,
    stockpile: Object.fromEntries(ALL_GOODS.map((g) => [g, 0])) as Record<Good, number>,
    pollution: 0,
    landValue: 0.3,
    travelers: 0,
    buildingCount: 0,
    abandonedCount: 0,
  };
}

// --- tile accessors ---------------------------------------------------------

export function tileIndex(city: { width: number }, x: number, y: number): number {
  return y * city.width + x;
}

export function inCity(city: CityState, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < city.width && y < city.height;
}

export function roadAt(city: CityState, x: number, y: number): RoadType {
  if (!inCity(city, x, y)) return RoadType.None;
  return city.roads[tileIndex(city, x, y)] as RoadType;
}

export function zoneAt(city: CityState, x: number, y: number): Zone {
  if (!inCity(city, x, y)) return Zone.None;
  return city.zones[tileIndex(city, x, y)] as Zone;
}

export function buildingIdAt(city: CityState, x: number, y: number): number {
  if (!inCity(city, x, y)) return -1;
  return city.buildingAt[tileIndex(city, x, y)];
}

export function buildingAtTile(city: CityState, x: number, y: number): Building | null {
  const id = buildingIdAt(city, x, y);
  return id < 0 ? null : city.buildings.get(id) ?? null;
}

/** True when the tile is free of roads, walls and buildings. */
export function isTileClear(city: CityState, x: number, y: number): boolean {
  if (!inCity(city, x, y)) return false;
  const i = tileIndex(city, x, y);
  return city.roads[i] === RoadType.None && city.buildingAt[i] < 0 && city.wallAt[i] < 0;
}

export function markDirty(city: CityState, x: number, y: number): void {
  if (inCity(city, x, y)) city.dirtyTiles.add(tileIndex(city, x, y));
}

export function markRectDirty(city: CityState, x: number, y: number, w: number, h: number): void {
  // Include a one-tile skirt: tall sprites overlap into neighbouring chunks.
  for (let ty = y - 1; ty <= y + h; ty++) {
    for (let tx = x - 1; tx <= x + w; tx++) markDirty(city, tx, ty);
  }
}

export function logEvent(
  city: CityState,
  text: string,
  tone: 'good' | 'bad' | 'info' = 'info',
): void {
  city.journal.push({ day: city.clock.totalDays, text, tone });
  if (city.journal.length > 60) city.journal.shift();
}

// --- parcels ----------------------------------------------------------------

function initParcels(city: CityState): void {
  const founding = city.map.foundingDistrict;
  let id = 0;
  for (let py = 0; py < city.parcelsHigh; py++) {
    for (let px = 0; px < city.parcelsWide; px++) {
      const distance = Math.max(Math.abs(px - founding.x), Math.abs(py - founding.y));
      city.parcels.push({
        id: id++,
        px,
        py,
        owned: false,
        price: Math.round(PARCEL_BASE_PRICE * (1 + distance * 0.38) ** 1.18),
        settleable: parcelIsSettleable(city, px, py),
      });
    }
  }
}

export function parcelCoordOf(x: number, y: number): { px: number; py: number } {
  return { px: Math.floor(x / PARCEL_SIZE), py: Math.floor(y / PARCEL_SIZE) };
}

export function parcelAt(city: CityState, px: number, py: number): Parcel | null {
  if (px < 0 || py < 0 || px >= city.parcelsWide || py >= city.parcelsHigh) return null;
  return city.parcels[py * city.parcelsWide + px];
}

export function parcelForTile(city: CityState, x: number, y: number): Parcel | null {
  const { px, py } = parcelCoordOf(x, y);
  return parcelAt(city, px, py);
}

export function isTileOwned(city: CityState, x: number, y: number): boolean {
  if (!inCity(city, x, y)) return false;
  return parcelForTile(city, x, y)?.owned ?? false;
}

/** A parcel is worth settling if enough of it is dry, buildable ground. */
function parcelIsSettleable(city: CityState, px: number, py: number): boolean {
  let buildable = 0;
  for (let y = py * PARCEL_SIZE; y < (py + 1) * PARCEL_SIZE; y++) {
    for (let x = px * PARCEL_SIZE; x < (px + 1) * PARCEL_SIZE; x++) {
      if (isTileBuildable(city.map, x, y)) buildable++;
    }
  }
  return buildable >= PARCEL_SIZE * PARCEL_SIZE * 0.5;
}

/** Parcels that touch an owned parcel and can therefore be annexed next. */
export function purchasableParcels(city: CityState): Parcel[] {
  const out: Parcel[] = [];
  for (const parcel of city.parcels) {
    if (parcel.owned || !parcel.settleable) continue;
    const neighbours = [
      parcelAt(city, parcel.px - 1, parcel.py),
      parcelAt(city, parcel.px + 1, parcel.py),
      parcelAt(city, parcel.px, parcel.py - 1),
      parcelAt(city, parcel.px, parcel.py + 1),
    ];
    if (neighbours.some((n) => n?.owned)) out.push(parcel);
  }
  return out;
}

/**
 * Claim the parcel block the generator chose. It is already known to be
 * workable ground, so this simply takes it.
 */
function claimFoundingDistrict(city: CityState): void {
  const { x: px, y: py } = city.map.foundingDistrict;
  for (let oy = 0; oy < city.map.districtParcels; oy++) {
    for (let ox = 0; ox < city.map.districtParcels; ox++) {
      const parcel = parcelAt(city, px + ox, py + oy);
      if (parcel) parcel.owned = true;
    }
  }
  city.wallsDirty = true;
}

// --- the king's road --------------------------------------------------------

/**
 * Stamp the generated king's road onto the tile map. This is the street the
 * city grows from, and the road every newcomer walks in along.
 */
function layKingsRoad(city: CityState): void {
  for (const p of city.map.kingsRoad) {
    if (!inCity(city, p.x, p.y)) continue;
    city.roads[tileIndex(city, p.x, p.y)] = RoadType.Cobble;
    markDirty(city, p.x, p.y);
  }
}

// --- buildings --------------------------------------------------------------

/** Every tile covered by a building's footprint. */
export function buildingTiles(building: Building): { x: number; y: number }[] {
  const tiles: { x: number; y: number }[] = [];
  for (let y = building.y; y < building.y + building.height; y++) {
    for (let x = building.x; x < building.x + building.width; x++) tiles.push({ x, y });
  }
  return tiles;
}

/** Centre of a building's footprint, in continuous tile coordinates. */
export function buildingCenter(building: Building): { x: number; y: number } {
  return { x: building.x + building.width / 2 - 0.5, y: building.y + building.height / 2 - 0.5 };
}

export function registerBuilding(city: CityState, building: Building): void {
  city.buildings.set(building.id, building);
  for (const tile of buildingTiles(building)) {
    if (inCity(city, tile.x, tile.y)) city.buildingAt[tileIndex(city, tile.x, tile.y)] = building.id;
  }
  markRectDirty(city, building.x, building.y, building.width, building.height);
}

export function removeBuilding(city: CityState, id: number): void {
  const building = city.buildings.get(id);
  if (!building) return;
  for (const tile of buildingTiles(building)) {
    if (inCity(city, tile.x, tile.y) && city.buildingAt[tileIndex(city, tile.x, tile.y)] === id) {
      city.buildingAt[tileIndex(city, tile.x, tile.y)] = -1;
    }
  }
  city.buildings.delete(id);
  markRectDirty(city, building.x, building.y, building.width, building.height);
  // Agents bound to a vanished building have nowhere to go.
  for (const agent of city.agents) {
    if (agent.targetBuilding === id) agent.targetBuilding = null;
    if (agent.homeBuilding === id) agent.homeBuilding = null;
  }
}

export function createBuilding(
  city: CityState,
  defId: string,
  x: number,
  y: number,
  facing = 0,
): Building {
  const def = getDef(defId);
  return {
    id: city.nextBuildingId++,
    defId,
    kind: def.kind,
    x,
    y,
    width: def.width,
    height: def.height,
    level: def.level ?? 1,
    variant: Math.floor(city.rng.next() * 1000),
    facing,
    residents: 0,
    workers: 0,
    stock: {},
    happiness: 0.55,
    supplyRatio: 0.5,
    age: 0,
    decay: 0,
    abandoned: false,
    connected: false,
    protected: false,
  };
}

/** All buildings of a given kind. */
export function buildingsOfKind(city: CityState, kind: BuildingKind): Building[] {
  const out: Building[] = [];
  for (const building of city.buildings.values()) if (building.kind === kind) out.push(building);
  return out;
}

/** True when at least one footprint tile borders water. */
export function touchesWater(city: CityState, x: number, y: number, w: number, h: number): boolean {
  for (let ty = y - 1; ty <= y + h; ty++) {
    for (let tx = x - 1; tx <= x + w; tx++) {
      const insideFootprint = tx >= x && tx < x + w && ty >= y && ty < y + h;
      if (insideFootprint) continue;
      if (!inCity(city, tx, ty)) continue;
      if (isWater(city.map.terrain[tileIndex(city, tx, ty)] as Terrain)) return true;
    }
  }
  return false;
}

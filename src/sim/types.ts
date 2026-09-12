/** Core data model for the city simulation. */

/** Terrain classes produced by map generation. */
export enum Terrain {
  DeepWater = 0,
  ShallowWater = 1,
  Sand = 2,
  Grass = 3,
  Meadow = 4,
  Forest = 5,
  Rock = 6,
  Snow = 7,
}

export const WATER_TERRAIN = new Set([Terrain.DeepWater, Terrain.ShallowWater]);

/** Whether a tile class can carry roads, walls or buildings. */
export function isBuildable(terrain: Terrain): boolean {
  return terrain === Terrain.Grass || terrain === Terrain.Meadow || terrain === Terrain.Forest || terrain === Terrain.Sand;
}

export function isWater(terrain: Terrain): boolean {
  return terrain === Terrain.DeepWater || terrain === Terrain.ShallowWater;
}

/** Zones the player paints. Named for Stormwind's districts. */
export enum Zone {
  None = 0,
  /** Dwellings — "Old Town" cottages through to stone manors. */
  Residential = 1,
  /** Shops and stalls — the Trade District. */
  Commercial = 2,
  /** Farms, mills, mines and forges — the Dwarven District's workshops. */
  Industrial = 3,
}

export const ZONE_NAMES: Record<Zone, string> = {
  [Zone.None]: 'Unzoned',
  [Zone.Residential]: 'Dwellings',
  [Zone.Commercial]: 'Trade',
  [Zone.Industrial]: 'Crafting',
};

/** Road classes. Paths are foot-only; roads carry carts. */
export enum RoadType {
  None = 0,
  /** Packed dirt footpath — cheap, pedestrians only. */
  Path = 1,
  /** Cobbled street — the workhorse road. */
  Cobble = 2,
  /** Wide flagstone avenue — higher capacity, raises land value. */
  Avenue = 3,
}

/** Goods moved by the supply chain. */
export enum Good {
  Grain = 'grain',
  Timber = 'timber',
  Ore = 'ore',
  Wares = 'wares',
}

export const ALL_GOODS: readonly Good[] = [Good.Grain, Good.Timber, Good.Ore, Good.Wares];

export const GOOD_LABELS: Record<Good, string> = {
  [Good.Grain]: 'Grain',
  [Good.Timber]: 'Timber',
  [Good.Ore]: 'Ore',
  [Good.Wares]: 'Wares',
};

/** Base market price per unit, used by markets and docks for trade. */
export const GOOD_BASE_PRICE: Record<Good, number> = {
  [Good.Grain]: 6,
  [Good.Timber]: 9,
  [Good.Ore]: 14,
  [Good.Wares]: 26,
};

/** What a building fundamentally is. Drives simulation behaviour. */
export enum BuildingKind {
  /** Grown on a residential zone; houses villagers. */
  Dwelling = 'dwelling',
  /** Grown on a commercial zone; consumes wares and grain, employs villagers. */
  Shop = 'shop',
  /** Grown on an industrial zone; extracts or crafts goods. */
  Workshop = 'workshop',
  /** Player-placed service building. */
  Service = 'service',
  /** Player-placed trade hub connected to the outside world. */
  TradeHub = 'tradeHub',
  /** Structural pieces of the city wall. */
  Fortification = 'fortification',
}

/** Service categories that feed into happiness. */
export enum Service {
  Water = 'water',
  Sewage = 'sewage',
  Safety = 'safety',
  Faith = 'faith',
  Leisure = 'leisure',
  Commerce = 'commerce',
}

export const ALL_SERVICES: readonly Service[] = [
  Service.Water,
  Service.Sewage,
  Service.Safety,
  Service.Faith,
  Service.Leisure,
  Service.Commerce,
];

export const SERVICE_LABELS: Record<Service, string> = {
  [Service.Water]: 'Fresh Water',
  [Service.Sewage]: 'Sanitation',
  [Service.Safety]: 'Protection',
  [Service.Faith]: 'The Light',
  [Service.Leisure]: 'Merriment',
  [Service.Commerce]: 'Goods at Market',
};

/** How much each service contributes to a dwelling's contentment. */
export const SERVICE_WEIGHT: Record<Service, number> = {
  [Service.Water]: 1.5,
  [Service.Sewage]: 1.2,
  [Service.Safety]: 1.1,
  [Service.Faith]: 0.7,
  [Service.Leisure]: 0.7,
  [Service.Commerce]: 1.0,
};

/** A placed or grown structure. */
export interface Building {
  id: number;
  defId: string;
  kind: BuildingKind;
  /** Anchor tile (north-west corner of the footprint). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Growth level for zoned buildings; 1 for player-placed ones. */
  level: number;
  /** Visual variant index, so identical defs do not look identical. */
  variant: number;
  /** Which way the building faces (index into DIRECTIONS). */
  facing: number;
  /** Villagers living here (dwellings). */
  residents: number;
  /** Filled jobs (shops and workshops). */
  workers: number;
  /** Goods held on site. */
  stock: Partial<Record<Good, number>>;
  /** Rolling contentment in [0,1]; drives upgrades and abandonment. */
  happiness: number;
  /** Fraction of demanded goods actually delivered recently, [0,1]. */
  supplyRatio: number;
  /** Game-days since construction. */
  age: number;
  /** Consecutive days of misery; triggers abandonment. */
  decay: number;
  /** True once the building has been abandoned and awaits demolition. */
  abandoned: boolean;
  /** Whether the building currently has road access. */
  connected: boolean;
  /** Whether the tile is inside the city walls. */
  protected: boolean;
}

/** Immutable design data for a building type. */
export interface BuildingDef {
  id: string;
  name: string;
  kind: BuildingKind;
  /** Zone the building grows on, if it is grown rather than placed. */
  zone?: Zone;
  /** Growth level within its zone (1..4). */
  level?: number;
  width: number;
  height: number;
  /** Gold to build. Zoned buildings are financed by their owners (cost 0). */
  cost: number;
  /** Gold per game-month to maintain. */
  upkeep: number;
  /** Dwelling capacity. */
  residents?: number;
  /** Jobs offered. */
  jobs?: number;
  /** Goods produced per day at full staffing. */
  produces?: Partial<Record<Good, number>>;
  /** Goods consumed per day at full staffing. */
  consumes?: Partial<Record<Good, number>>;
  /** Services provided, with radius in tiles and strength in [0,1]. */
  provides?: Partial<Record<Service, { radius: number; strength: number }>>;
  /** Utility network role: pushes water or drainage along the road network. */
  utility?: { type: Service.Water | Service.Sewage; capacity: number; networkRange: number };
  /** Trade hub behaviour: outside-world commerce and visitors. */
  trade?: { capacity: number; travelersPerDay: number; priceBonus: number };
  /** Sewage or smoke produced, polluting nearby land. */
  pollution?: number;
  /** Effect on the surrounding land value, positive or negative. */
  landValue?: number;
  /** Terrain this building must be adjacent to (docks need water). */
  requiresWaterAdjacency?: boolean;
  /** Must touch the map edge road network (caravan posts). */
  requiresMapEdge?: boolean;
  /** Short flavour line shown in the build menu. */
  description: string;
  /** Unlock threshold: minimum population before it appears. */
  unlockPopulation?: number;
}

/** A rectangular block of land the player can buy to extend the walls. */
export interface Parcel {
  id: number;
  /** Parcel grid coordinates (not tile coordinates). */
  px: number;
  py: number;
  owned: boolean;
  /** Gold price; rises with distance from the founding parcel. */
  price: number;
  /** False when the parcel is all water or mountain and cannot be settled. */
  settleable: boolean;
}

/** A segment of the city wall, derived from the owned parcel boundary. */
export interface WallSegment {
  x: number;
  y: number;
  /** Bitmask of DIRECTIONS this wall piece connects to. */
  connections: number;
  kind: 'wall' | 'tower' | 'gate';
  /** Orientation for gates: 0 = north-south passage, 1 = east-west. */
  orientation: number;
}

/** Live moving entity drawn on the map. */
export interface Agent {
  id: number;
  kind: AgentKind;
  /** Continuous tile-space position. */
  x: number;
  y: number;
  /** Current path as tile coordinates, consumed from index `step`. */
  path: number[];
  step: number;
  speed: number;
  /** Facing angle in radians, for which way the figure is turned. */
  heading: number;
  variant: number;
  /** Building the agent is travelling to, if any. */
  targetBuilding: number | null;
  /** Home building, for villagers. */
  homeBuilding: number | null;
  /** Cargo carried by a cart. */
  cargo: { good: Good; amount: number } | null;
  /** Seconds before the agent despawns if it cannot progress. */
  patience: number;
  /** Journeys still to make before the agent goes home and vanishes. */
  errands: number;
}

export enum AgentKind {
  /** A villager on foot going about their day. */
  Peasant = 'peasant',
  /** A goods cart hauling between buildings. */
  Cart = 'cart',
  /** A city guard patrolling the walls. */
  Guard = 'guard',
  /** A visitor arriving from outside the city. */
  Traveler = 'traveler',
}

/** Demand for each zone type, in [0,1]. */
export interface Demand {
  residential: number;
  commercial: number;
  industrial: number;
}

/** Running financial figures for the current month. */
export interface Budget {
  gold: number;
  taxRateResidential: number;
  taxRateCommercial: number;
  taxRateIndustrial: number;
  /** Last completed month's figures, for the HUD. */
  lastIncome: number;
  lastUpkeep: number;
  lastTrade: number;
  /**
   * Trade settles daily against the treasury, so this is not money waiting
   * to be paid — it is the running total of what trade has already moved
   * this month, drained by `settleMonth` into `lastTrade` for the ledger.
   */
  tradeAccumulator: number;
}

/** Aggregate city statistics recomputed each simulation day. */
export interface CityStats {
  population: number;
  housingCapacity: number;
  jobs: number;
  employed: number;
  unemployment: number;
  happiness: number;
  services: Record<Service, number>;
  goodsProduced: Record<Good, number>;
  goodsConsumed: Record<Good, number>;
  stockpile: Record<Good, number>;
  pollution: number;
  landValue: number;
  travelers: number;
  buildingCount: number;
  abandonedCount: number;
}

/** In-game calendar. */
export interface GameClock {
  /** Total elapsed game-days. */
  totalDays: number;
  day: number;
  month: number;
  year: number;
  /** Fraction of the current day elapsed, [0,1). */
  dayFraction: number;
}

export const MONTH_NAMES = [
  'Frostwane',
  'Thawtide',
  'Seedfall',
  'Bloomrise',
  'Sunmead',
  'Highsummer',
  'Goldharvest',
  'Emberfall',
  'Leafturn',
  'Hallowfall',
  'Longnight',
  'Deepwinter',
];

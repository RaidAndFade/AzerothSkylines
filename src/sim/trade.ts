/**
 * Goods, hauliers and the wider world.
 *
 * Workshops produce, shops consume, and carts carry the difference between
 * them. Whatever the city cannot use or supply itself passes through the
 * markets, caravan posts and docks that link Elwynn to the kingdom.
 */
import { clamp01 } from '../core/math';
import { ALL_GOODS, Building, BuildingKind, GOOD_BASE_PRICE, Good } from './types';
import { CityState, buildingCenter, logEvent, tileIndex } from './city';
import { getDef } from '../data/buildings';
import { doorTile } from './roads';
import { DIRECTIONS } from '../core/grid';

/** Days of stock a consumer tries to keep on hand. */
export const BUFFER_DAYS = 3;
/** Beyond this many tiles, a haul is not worth making without a hub. */
export const MAX_HAUL_DISTANCE = 46;
/** The merchants' cut on anything bought from or sold to the outside world. */
export const TRADE_MARGIN = 0.26;
/** Share of stock above the buffer a producer will ship out per day. */
export const EXPORT_RATE = 0.55;

export interface Delivery {
  from: number;
  to: number;
  good: Good;
  amount: number;
}

export interface TradeReport {
  produced: Record<Good, number>;
  consumed: Record<Good, number>;
  deliveries: Delivery[];
  importSpend: number;
  exportIncome: number;
  travelers: number;
}

/**
 * Label each road tile with its connected component, so two buildings can be
 * checked for "can a cart actually get between these" without pathfinding.
 */
export function computeRoadComponents(city: CityState): Int32Array {
  const labels = new Int32Array(city.width * city.height).fill(-1);
  let next = 0;
  const queue: number[] = [];

  for (let y = 0; y < city.height; y++) {
    for (let x = 0; x < city.width; x++) {
      const start = tileIndex(city, x, y);
      if (city.roads[start] === 0 || labels[start] >= 0) continue;
      const label = next++;
      labels[start] = label;
      queue.length = 0;
      queue.push(start);
      for (let head = 0; head < queue.length; head++) {
        const i = queue[head];
        const cx = i % city.width;
        const cy = (i / city.width) | 0;
        for (const d of DIRECTIONS) {
          const nx = cx + d.x;
          const ny = cy + d.y;
          if (nx < 0 || ny < 0 || nx >= city.width || ny >= city.height) continue;
          const ni = tileIndex(city, nx, ny);
          if (city.roads[ni] === 0 || labels[ni] >= 0) continue;
          const step = Math.abs(city.map.elevation[ni] - city.map.elevation[i]);
          if (step > 2) continue;
          labels[ni] = label;
          queue.push(ni);
        }
      }
    }
  }
  return labels;
}

function componentOf(city: CityState, labels: Int32Array, building: Building): number {
  const door = doorTile(city, building);
  if (!door) return -1;
  return labels[tileIndex(city, door.x, door.y)];
}

function stockOf(building: Building, good: Good): number {
  return building.stock[good] ?? 0;
}

function addStock(building: Building, good: Good, amount: number): void {
  building.stock[good] = Math.max(0, stockOf(building, good) + amount);
}

/** How much of each good a building wants to receive per day. */
export function dailyNeed(building: Building): Partial<Record<Good, number>> {
  const def = getDef(building.defId);
  if (!def.consumes) return {};
  const jobs = def.jobs ?? 0;
  const staffing = jobs > 0 ? clamp01(0.25 + (building.workers / jobs) * 0.75) : 1;
  const need: Partial<Record<Good, number>> = {};
  for (const good of ALL_GOODS) {
    const rate = def.consumes[good];
    if (rate) need[good] = rate * staffing;
  }
  return need;
}

/** Total storage the city's trade hubs provide. */
export function reserveCapacity(city: CityState): number {
  let capacity = 40;
  for (const building of city.buildings.values()) {
    if (building.abandoned) continue;
    const trade = getDef(building.defId).trade;
    if (trade) capacity += trade.capacity;
  }
  return capacity;
}

/** The best price bonus any hub in the city can offer. */
export function bestPriceBonus(city: CityState): number {
  let bonus = 0;
  for (const building of city.buildings.values()) {
    if (building.abandoned) continue;
    const trade = getDef(building.defId).trade;
    if (trade && trade.priceBonus > bonus) bonus = trade.priceBonus;
  }
  return bonus;
}

/**
 * One day of production, consumption and haulage.
 */
export function runTrade(city: CityState): TradeReport {
  const produced = emptyLedger();
  const consumed = emptyLedger();
  const deliveries: Delivery[] = [];
  const labels = computeRoadComponents(city);

  const producers = new Map<Good, Building[]>();
  const consumers: Building[] = [];
  const hubs: Building[] = [];

  for (const building of city.buildings.values()) {
    if (building.abandoned) continue;
    const def = getDef(building.defId);
    if (def.trade) hubs.push(building);
    if (def.produces) {
      for (const good of ALL_GOODS) {
        if (!def.produces[good]) continue;
        const list = producers.get(good);
        if (list) list.push(building);
        else producers.set(good, [building]);
      }
    }
    if (def.consumes) consumers.push(building);
  }

  // --- 1. Production -------------------------------------------------------
  for (const [, list] of producers) {
    for (const building of list) {
      if (building.workers === 0 || !building.connected) continue;
      const def = getDef(building.defId);
      const staffing = def.jobs ? clamp01(building.workers / def.jobs) : 1;
      if (staffing <= 0) continue;

      // Crafting halls can only make what their inputs allow.
      let inputRatio = 1;
      if (def.consumes) {
        for (const good of ALL_GOODS) {
          const rate = def.consumes[good];
          if (!rate) continue;
          const wanted = rate * staffing;
          inputRatio = Math.min(inputRatio, wanted > 0 ? clamp01(stockOf(building, good) / wanted) : 1);
        }
      }
      if (def.consumes) {
        for (const good of ALL_GOODS) {
          const rate = def.consumes[good];
          if (!rate) continue;
          const used = rate * staffing * inputRatio;
          addStock(building, good, -used);
          consumed[good] += used;
        }
      }

      for (const good of ALL_GOODS) {
        const rate = def.produces?.[good];
        if (!rate) continue;
        const made = rate * staffing * inputRatio;
        addStock(building, good, made);
        produced[good] += made;
      }
      building.supplyRatio = clamp01(building.supplyRatio * 0.5 + inputRatio * 0.5);
    }
  }

  // --- 2. Haulage: fill every consumer's buffer ----------------------------
  for (const consumer of consumers) {
    if (!consumer.connected) {
      consumer.supplyRatio = Math.max(0, consumer.supplyRatio - 0.25);
      continue;
    }
    const need = dailyNeed(consumer);
    const goods = Object.keys(need) as Good[];
    if (goods.length === 0) continue;

    let satisfied = 0;
    for (const good of goods) {
      const perDay = need[good] ?? 0;
      if (perDay <= 0) continue;
      const target = perDay * BUFFER_DAYS;
      let shortfall = target - stockOf(consumer, good);
      if (shortfall > 0) {
        shortfall -= haulFromProducers(city, labels, consumer, good, shortfall, producers.get(good) ?? [], deliveries);
      }
      if (shortfall > 0) shortfall -= drawFromReserves(city, consumer, good, shortfall, deliveries);
      satisfied += clamp01(stockOf(consumer, good) / Math.max(0.001, perDay));
    }
    const ratio = clamp01(satisfied / goods.length);
    consumer.supplyRatio = clamp01(consumer.supplyRatio * 0.55 + ratio * 0.45);
  }

  // --- 3. Shops and inns sell their stock to the citizens -------------------
  for (const consumer of consumers) {
    if (consumer.kind !== BuildingKind.Shop && getDef(consumer.defId).kind !== BuildingKind.Service) continue;
    const need = dailyNeed(consumer);
    for (const good of Object.keys(need) as Good[]) {
      const wanted = need[good] ?? 0;
      const sold = Math.min(wanted, stockOf(consumer, good));
      addStock(consumer, good, -sold);
      consumed[good] += sold;
    }
  }

  // --- 4. Surplus flows to the hubs ---------------------------------------
  const capacity = reserveCapacity(city);
  for (const [good, list] of producers) {
    for (const building of list) {
      if (!building.connected) continue;
      const def = getDef(building.defId);
      const keep = (def.produces?.[good] ?? 0) * BUFFER_DAYS;
      const surplus = stockOf(building, good) - keep;
      if (surplus <= 0.01) continue;
      const room = capacity - city.reserves[good];
      if (room <= 0) continue;
      const shipped = Math.min(surplus * EXPORT_RATE, room);
      if (shipped <= 0.01) continue;
      addStock(building, good, -shipped);
      city.reserves[good] += shipped;
      const hub = nearestConnected(city, labels, building, hubs);
      if (hub) deliveries.push({ from: building.id, to: hub.id, good: good as Good, amount: shipped });
    }
  }

  // --- 5. The outside world ------------------------------------------------
  const world = tradeWithWorld(city, capacity);

  return {
    produced,
    consumed,
    deliveries,
    importSpend: world.importSpend,
    exportIncome: world.exportIncome,
    travelers: world.travelers,
  };
}

function emptyLedger(): Record<Good, number> {
  return { [Good.Grain]: 0, [Good.Timber]: 0, [Good.Ore]: 0, [Good.Wares]: 0 };
}

/** Pull goods straight from the nearest producers that a cart can reach. */
function haulFromProducers(
  city: CityState,
  labels: Int32Array,
  consumer: Building,
  good: Good,
  wanted: number,
  candidates: Building[],
  deliveries: Delivery[],
): number {
  if (candidates.length === 0 || wanted <= 0) return 0;
  const component = componentOf(city, labels, consumer);
  if (component < 0) return 0;
  const here = buildingCenter(consumer);

  const reachable = candidates
    .filter((producer) => producer.id !== consumer.id && producer.connected && stockOf(producer, good) > 0.05)
    .map((producer) => {
      const there = buildingCenter(producer);
      return { producer, distance: Math.hypot(there.x - here.x, there.y - here.y) };
    })
    .filter((entry) => entry.distance <= MAX_HAUL_DISTANCE && componentOf(city, labels, entry.producer) === component)
    .sort((a, b) => a.distance - b.distance);

  let moved = 0;
  for (const entry of reachable) {
    if (moved >= wanted) break;
    const def = getDef(entry.producer.defId);
    // Producers hold back enough to keep their own works running.
    const keep = (def.produces?.[good] ?? 0) * 1.2;
    const available = Math.max(0, stockOf(entry.producer, good) - keep);
    if (available <= 0.05) continue;
    const amount = Math.min(available, wanted - moved);
    addStock(entry.producer, good, -amount);
    addStock(consumer, good, amount);
    deliveries.push({ from: entry.producer.id, to: consumer.id, good, amount });
    moved += amount;
  }
  return moved;
}

/** Draw from the city's hub reserves when local producers cannot supply. */
function drawFromReserves(
  city: CityState,
  consumer: Building,
  good: Good,
  wanted: number,
  deliveries: Delivery[],
): number {
  const available = city.reserves[good];
  if (available <= 0.05 || wanted <= 0) return 0;
  const amount = Math.min(available, wanted);
  city.reserves[good] -= amount;
  consumer.stock[good] = stockOf(consumer, good) + amount;
  deliveries.push({ from: -1, to: consumer.id, good, amount });
  return amount;
}

function nearestConnected(
  city: CityState,
  labels: Int32Array,
  from: Building,
  candidates: Building[],
): Building | null {
  const component = componentOf(city, labels, from);
  if (component < 0) return null;
  const here = buildingCenter(from);
  let best: Building | null = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    if (componentOf(city, labels, candidate) !== component) continue;
    const there = buildingCenter(candidate);
    const distance = Math.hypot(there.x - here.x, there.y - here.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

interface WorldTrade {
  importSpend: number;
  exportIncome: number;
  travelers: number;
}

/**
 * Sell the surplus and buy the shortfall. Without a hub the city is on its
 * own: nothing goes out and nothing comes in.
 */
export function tradeWithWorld(city: CityState, capacity: number): WorldTrade {
  const hubs = [...city.buildings.values()].filter(
    (b) => !b.abandoned && b.connected && getDef(b.defId).trade,
  );
  if (hubs.length === 0) return { importSpend: 0, exportIncome: 0, travelers: 0 };

  const bonus = bestPriceBonus(city);
  const margin = Math.max(0.04, TRADE_MARGIN - bonus);
  let importSpend = 0;
  let exportIncome = 0;

  for (const good of ALL_GOODS) {
    const held = city.reserves[good];
    const exportFloor = capacity * 0.7;
    if (held > exportFloor) {
      const amount = (held - exportFloor) * 0.6;
      const income = amount * GOOD_BASE_PRICE[good] * (1 - margin);
      city.reserves[good] -= amount;
      exportIncome += income;
    } else if (held < capacity * 0.18) {
      // Restock, but never spend the city into ruin.
      const wanted = capacity * 0.35 - held;
      const unitPrice = GOOD_BASE_PRICE[good] * (1 + margin);
      const affordable = Math.max(0, city.budget.gold * 0.12) / unitPrice;
      const amount = Math.min(wanted, affordable);
      if (amount > 0.05) {
        city.reserves[good] += amount;
        importSpend += amount * unitPrice;
      }
    }
    city.reserves[good] = Math.min(city.reserves[good], capacity);
  }

  let travelers = 0;
  for (const hub of hubs) {
    const trade = getDef(hub.defId).trade;
    if (!trade) continue;
    const staffing = clamp01(hub.workers / Math.max(1, getDef(hub.defId).jobs ?? 1));
    travelers += trade.travelersPerDay * staffing;
  }

  city.budget.tradeAccumulator += exportIncome - importSpend;
  city.budget.gold += exportIncome - importSpend;

  if (exportIncome > 400 && city.rng.chance(0.12)) {
    logEvent(city, `Merchant caravans paid ${Math.round(exportIncome)} gold for the city's surplus.`, 'good');
  }

  return { importSpend, exportIncome, travelers: Math.round(travelers) };
}

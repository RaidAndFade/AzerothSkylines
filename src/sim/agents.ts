/**
 * Everything that moves: villagers on the paths, carts on the streets,
 * guards on their rounds, and travellers arriving from beyond the valley.
 *
 * Agents are purely presentational — the economy is settled in `trade.ts` —
 * but they are driven by the same data, so the traffic you see is the
 * traffic the city is actually generating.
 */
import { Agent, AgentKind, Building, BuildingKind, Good, RoadType } from './types';
import { CityState, buildingCenter, inCity, roadAt, tileIndex } from './city';
import { carriesCarts, doorTile, findRoadPath, roadSpeed } from './roads';
import { getDef } from '../data/buildings';
import type { Delivery } from './trade';

/** Hard ceiling on simultaneous agents, to keep the frame budget honest. */
export const MAX_AGENTS = 220;
/**
 * Carts on the road at once. Every delivery could have one, but a city of
 * any size makes far more deliveries than the streets can legibly show, so
 * the traffic is a representative sample rather than a full census.
 */
export const MAX_CARTS = 20;
/** Pathfinding calls allowed per simulation step. */
export const PATH_BUDGET_PER_STEP = 8;
/** Seconds an agent may spend stuck before it gives up and vanishes. */
export const AGENT_PATIENCE = 40;

const BASE_SPEED: Record<AgentKind, number> = {
  [AgentKind.Peasant]: 1.5,
  [AgentKind.Cart]: 2.0,
  [AgentKind.Guard]: 1.35,
  [AgentKind.Traveler]: 1.7,
};

/** Deliveries waiting to be dramatised as carts on the road. */
export interface TrafficQueue {
  pending: Delivery[];
}

export function createTrafficQueue(): TrafficQueue {
  return { pending: [] };
}

/** Advance every agent along its path. */
export function updateAgents(city: CityState, dt: number): void {
  const survivors: Agent[] = [];
  for (const agent of city.agents) {
    if (stepAgent(city, agent, dt)) survivors.push(agent);
  }
  city.agents = survivors;
}

function stepAgent(city: CityState, agent: Agent, dt: number): boolean {
  agent.patience -= dt;
  if (agent.patience <= 0) return false;
  if (agent.step >= agent.path.length) return false;

  const targetIndex = agent.path[agent.step];
  const tx = targetIndex % city.width;
  const ty = (targetIndex / city.width) | 0;

  const dx = tx - agent.x;
  const dy = ty - agent.y;
  const distance = Math.hypot(dx, dy);

  if (distance < 0.06) {
    agent.step++;
    if (agent.step >= agent.path.length) return onArrival(city, agent);
    return true;
  }

  const tile = roadAt(city, Math.round(agent.x), Math.round(agent.y));
  const speed = agent.speed * roadSpeed(tile);
  const travel = Math.min(distance, speed * dt);
  agent.x += (dx / distance) * travel;
  agent.y += (dy / distance) * travel;
  agent.heading = Math.atan2(dy, dx);
  return true;
}

/**
 * What an agent does once it gets where it was going. Villagers run several
 * errands before going home, which is what keeps a steady, believable
 * number of people on the streets rather than a trickle of one-way trips.
 */
function onArrival(city: CityState, agent: Agent): boolean {
  if (agent.kind === AgentKind.Guard) {
    // Guards keep walking their round for as long as the city stands.
    return reroute(city, agent, randomPatrolTarget(city), AGENT_PATIENCE * 3);
  }

  if (agent.errands <= 0) return false;
  agent.errands -= 1;

  const next = agent.errands === 0 && agent.homeBuilding !== null
    ? doorTile(city, city.buildings.get(agent.homeBuilding) as Building)
    : errandTarget(city, agent);
  return reroute(city, agent, next, AGENT_PATIENCE * 2);
}

/** Send an agent off on a fresh path, or let it go if there is nowhere to go. */
function reroute(
  city: CityState,
  agent: Agent,
  target: { x: number; y: number } | null,
  patience: number,
): boolean {
  if (!target) return false;
  const from = { x: Math.round(agent.x), y: Math.round(agent.y) };
  const path = findRoadPath(city, from, target, { maxNodes: 1600 });
  if (!path || path.length < 2) return false;
  agent.path = path;
  agent.step = 0;
  agent.patience = patience;
  return true;
}

/** Somewhere worth walking to: a shop, a workplace, a well, a shrine. */
function errandTarget(city: CityState, agent: Agent): { x: number; y: number } | null {
  const options = pickBuildings(
    city,
    (b) =>
      b.connected &&
      !b.abandoned &&
      b.id !== agent.targetBuilding &&
      (b.kind === BuildingKind.Shop ||
        b.kind === BuildingKind.Workshop ||
        b.kind === BuildingKind.Service ||
        b.kind === BuildingKind.TradeHub),
  );
  if (options.length === 0) return null;
  const target = city.rng.pick(options);
  agent.targetBuilding = target.id;
  return doorTile(city, target);
}

/** Turn the day's deliveries into carts, up to the traffic budget. */
export function spawnDeliveryCarts(queue: TrafficQueue, deliveries: Delivery[]): void {
  // Keep the backlog short: stale deliveries would put carts on the road
  // for journeys the city made minutes ago.
  const room = 24 - queue.pending.length;
  if (room <= 0) return;
  const shown = deliveries.filter((delivery) => delivery.from >= 0);
  if (shown.length === 0) return;
  // Spread the sample across the day's deliveries rather than taking the
  // first few, which would always be the same corner of the city.
  const stride = Math.max(1, Math.floor(shown.length / room));
  for (let i = 0; i < shown.length && queue.pending.length < 24; i += stride) {
    queue.pending.push(shown[i]);
  }
}

/**
 * Top the streets up with traffic. Called on a fixed cadence rather than
 * every frame so the pathfinding cost is predictable.
 */
export function maintainAgents(city: CityState, queue: TrafficQueue): void {
  let budget = PATH_BUDGET_PER_STEP;

  // Carts first: they represent real economic activity.
  while (budget > 0 && queue.pending.length > 0 && countKind(city, AgentKind.Cart) < MAX_CARTS) {
    const delivery = queue.pending.shift() as Delivery;
    const from = city.buildings.get(delivery.from);
    const to = city.buildings.get(delivery.to);
    if (!from || !to) continue;
    budget--;
    spawnCart(city, from, to, delivery.good);
  }

  const targetPeasants = Math.min(150, Math.floor(city.stats.population / 6));
  while (budget > 0 && countKind(city, AgentKind.Peasant) < targetPeasants && city.agents.length < MAX_AGENTS) {
    budget--;
    if (!spawnPeasant(city)) break;
  }

  const targetGuards = Math.min(22, countGuardPosts(city) * 2);
  while (budget > 0 && countKind(city, AgentKind.Guard) < targetGuards && city.agents.length < MAX_AGENTS) {
    budget--;
    if (!spawnGuard(city)) break;
  }

  const targetTravelers = Math.min(30, Math.round(city.stats.travelers));
  while (budget > 0 && countKind(city, AgentKind.Traveler) < targetTravelers && city.agents.length < MAX_AGENTS) {
    budget--;
    if (!spawnTraveler(city)) break;
  }
}

function countKind(city: CityState, kind: AgentKind): number {
  let count = 0;
  for (const agent of city.agents) if (agent.kind === kind) count++;
  return count;
}

function countGuardPosts(city: CityState): number {
  let count = 0;
  for (const building of city.buildings.values()) {
    if (building.abandoned) continue;
    const def = getDef(building.defId);
    if (def.provides?.safety) count++;
  }
  return count;
}

function newAgent(city: CityState, kind: AgentKind, x: number, y: number, path: number[]): Agent {
  return {
    id: city.nextAgentId++,
    kind,
    x,
    y,
    path,
    step: 0,
    speed: BASE_SPEED[kind] * (0.85 + city.rng.next() * 0.3),
    heading: 0,
    variant: city.rng.int(0, 5),
    targetBuilding: null,
    homeBuilding: null,
    cargo: null,
    patience: AGENT_PATIENCE,
    errands: 0,
  };
}

function spawnCart(city: CityState, from: Building, to: Building, good: Good): boolean {
  const start = doorTile(city, from);
  const end = doorTile(city, to);
  if (!start || !end) return false;
  if (!carriesCarts(roadAt(city, start.x, start.y))) return false;
  const path = findRoadPath(city, start, end, { cartsOnly: true, maxNodes: 2500 });
  if (!path || path.length < 2) return false;

  const agent = newAgent(city, AgentKind.Cart, start.x, start.y, path);
  agent.targetBuilding = to.id;
  agent.homeBuilding = from.id;
  agent.cargo = { good, amount: 1 };
  agent.patience = AGENT_PATIENCE * 2;
  city.agents.push(agent);
  return true;
}

function spawnPeasant(city: CityState): boolean {
  const homes = pickBuildings(city, (b) => b.kind === BuildingKind.Dwelling && b.residents > 0 && b.connected);
  if (homes.length === 0) return false;
  const home = city.rng.pick(homes);

  const destinations = pickBuildings(
    city,
    (b) =>
      b.id !== home.id &&
      b.connected &&
      !b.abandoned &&
      (b.kind === BuildingKind.Shop || b.kind === BuildingKind.Workshop || b.kind === BuildingKind.Service || b.kind === BuildingKind.TradeHub),
  );
  if (destinations.length === 0) return false;

  const start = doorTile(city, home);
  const target = city.rng.pick(destinations);
  const end = doorTile(city, target);
  if (!start || !end) return false;

  const path = findRoadPath(city, start, end, { maxNodes: 2000 });
  if (!path || path.length < 2) return false;

  const agent = newAgent(city, AgentKind.Peasant, start.x, start.y, path);
  agent.homeBuilding = home.id;
  agent.targetBuilding = target.id;
  agent.patience = AGENT_PATIENCE * 2;
  agent.errands = city.rng.int(2, 5);
  city.agents.push(agent);
  return true;
}

function spawnGuard(city: CityState): boolean {
  const start = randomPatrolTarget(city);
  const end = randomPatrolTarget(city);
  if (!start || !end) return false;
  const path = findRoadPath(city, start, end, { maxNodes: 1800 });
  if (!path || path.length < 2) return false;
  const agent = newAgent(city, AgentKind.Guard, start.x, start.y, path);
  agent.patience = AGENT_PATIENCE * 3;
  city.agents.push(agent);
  return true;
}

/** Guards walk the streets nearest the wall, where they can see trouble coming. */
function randomPatrolTarget(city: CityState): { x: number; y: number } | null {
  if (city.walls.length === 0) return null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const wall = city.rng.pick(city.walls);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = wall.x + dx;
        const y = wall.y + dy;
        if (!inCity(city, x, y)) continue;
        if (roadAt(city, x, y) === RoadType.None) continue;
        return { x, y };
      }
    }
  }
  return null;
}

/** Travellers walk in through a gate and make for a hub or an inn. */
function spawnTraveler(city: CityState): boolean {
  const gates = city.walls.filter((w) => w.kind === 'gate');
  const entry = gates.length > 0
    ? city.rng.pick(gates)
    : { x: city.map.roadEntry.x, y: city.map.roadEntry.y };
  if (roadAt(city, entry.x, entry.y) === RoadType.None) return false;

  const attractions = pickBuildings(
    city,
    (b) => b.connected && !b.abandoned && (b.kind === BuildingKind.TradeHub || getDef(b.defId).provides?.leisure !== undefined),
  );
  if (attractions.length === 0) return false;
  const target = city.rng.pick(attractions);
  const end = doorTile(city, target);
  if (!end) return false;

  const path = findRoadPath(city, { x: entry.x, y: entry.y }, end, { maxNodes: 3000 });
  if (!path || path.length < 2) return false;

  const agent = newAgent(city, AgentKind.Traveler, entry.x, entry.y, path);
  agent.targetBuilding = target.id;
  agent.patience = AGENT_PATIENCE * 3;
  // Visitors see a sight or two before they move on.
  agent.errands = city.rng.int(1, 3);
  city.agents.push(agent);
  return true;
}

function pickBuildings(city: CityState, predicate: (b: Building) => boolean): Building[] {
  const out: Building[] = [];
  for (const building of city.buildings.values()) if (predicate(building)) out.push(building);
  return out;
}

/** Drop every agent whose route no longer exists (roads were torn up). */
export function revalidateAgents(city: CityState): void {
  city.agents = city.agents.filter((agent) => {
    for (let i = agent.step; i < Math.min(agent.path.length, agent.step + 4); i++) {
      const index = agent.path[i];
      if (city.roads[index] === RoadType.None) return false;
    }
    return true;
  });
}

/** Continuous-space position of an agent, for the renderer. */
export function agentPosition(agent: Agent): { x: number; y: number } {
  return { x: agent.x, y: agent.y };
}

/** Where a cart is headed, for tooltips. */
export function agentDestination(city: CityState, agent: Agent): Building | null {
  return agent.targetBuilding === null ? null : city.buildings.get(agent.targetBuilding) ?? null;
}

export { buildingCenter, tileIndex };

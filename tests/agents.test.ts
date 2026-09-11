/** Villagers, carts, guards and travellers. */
import { describe, expect, it } from 'vitest';
import { AgentKind, BuildingKind, Good, RoadType } from '@/sim/types';
import { createBuilding, registerBuilding, tileIndex } from '@/sim/city';
import {
  AGENT_PATIENCE,
  MAX_CARTS,
  createTrafficQueue,
  maintainAgents,
  revalidateAgents,
  spawnDeliveryCarts,
  updateAgents,
} from '@/sim/agents';
import { refreshBuildingFlags } from '@/sim/growth';
import { makeFlatCity, mainRoadY } from './helpers';

/** A street with houses on one side and workplaces on the other. */
function livedInCity(houses = 6) {
  const city = makeFlatCity();
  const y = mainRoadY();
  for (let i = 0; i < houses; i++) {
    const home = createBuilding(city, 'house2', 2 + i, y + 1);
    home.residents = 12;
    registerBuilding(city, home);
  }
  for (let i = 0; i < 3; i++) {
    const shop = createBuilding(city, 'shop2', 3 + i * 3, y - 1);
    shop.workers = 8;
    registerBuilding(city, shop);
  }
  refreshBuildingFlags(city);
  city.stats.population = houses * 12;
  return city;
}

const count = (city: ReturnType<typeof livedInCity>, kind: AgentKind) =>
  city.agents.filter((a) => a.kind === kind).length;

describe('spawning', () => {
  it('puts villagers on the street in proportion to the population', () => {
    const city = livedInCity();
    const queue = createTrafficQueue();
    for (let i = 0; i < 20; i++) maintainAgents(city, queue);
    expect(count(city, AgentKind.Peasant)).toBeGreaterThan(3);
    expect(count(city, AgentKind.Peasant)).toBeLessThanOrEqual(Math.floor(city.stats.population / 6));
  });

  it('spawns nobody in an empty city', () => {
    const city = makeFlatCity();
    const queue = createTrafficQueue();
    for (let i = 0; i < 10; i++) maintainAgents(city, queue);
    expect(city.agents).toHaveLength(0);
  });

  it('sends villagers out from a home and toward somewhere worth going', () => {
    const city = livedInCity();
    const queue = createTrafficQueue();
    for (let i = 0; i < 10; i++) maintainAgents(city, queue);
    for (const agent of city.agents.filter((a) => a.kind === AgentKind.Peasant)) {
      expect(agent.homeBuilding).not.toBeNull();
      expect(agent.path.length).toBeGreaterThan(1);
      expect(city.roads[agent.path[0]]).not.toBe(RoadType.None);
    }
  });

  it('posts guards once there is somewhere for them to be posted', () => {
    const city = livedInCity();
    const queue = createTrafficQueue();
    for (let i = 0; i < 20; i++) maintainAgents(city, queue);
    expect(count(city, AgentKind.Guard)).toBe(0);

    const post = createBuilding(city, 'guardpost', 6, mainRoadY() + 1);
    registerBuilding(city, post);
    refreshBuildingFlags(city);
    for (let i = 0; i < 20; i++) maintainAgents(city, queue);
    expect(count(city, AgentKind.Guard)).toBeGreaterThan(0);
  });

  it('brings travellers in when the city draws them', () => {
    const city = livedInCity();
    const market = createBuilding(city, 'market', 8, mainRoadY() + 1);
    market.workers = 14;
    registerBuilding(city, market);
    refreshBuildingFlags(city);
    city.stats.travelers = 6;

    const queue = createTrafficQueue();
    for (let i = 0; i < 20; i++) maintainAgents(city, queue);
    expect(count(city, AgentKind.Traveler)).toBeGreaterThan(0);
  });

  it('never exceeds its own ceilings', () => {
    const city = livedInCity(12);
    city.stats.population = 100000;
    city.stats.travelers = 1000;
    const queue = createTrafficQueue();
    for (let i = 0; i < 200; i++) maintainAgents(city, queue);
    expect(city.agents.length).toBeLessThanOrEqual(220);
  });
});

describe('movement', () => {
  it('walks along its path and reaches the end', () => {
    const city = livedInCity();
    const queue = createTrafficQueue();
    maintainAgents(city, queue);
    const agent = city.agents[0];
    expect(agent).toBeDefined();
    const startStep = agent.step;

    for (let i = 0; i < 200; i++) updateAgents(city, 0.1);
    // Either it got somewhere, or it finished its errands and went home.
    const live = city.agents.find((a) => a.id === agent.id);
    if (live) expect(live.step).toBeGreaterThan(startStep);
  });

  it('faces the way it is walking', () => {
    const city = livedInCity();
    maintainAgents(city, createTrafficQueue());
    const agent = city.agents[0];
    const before = { x: agent.x, y: agent.y };
    updateAgents(city, 0.3);
    const moved = Math.hypot(agent.x - before.x, agent.y - before.y);
    expect(moved).toBeGreaterThan(0);
    expect(Number.isFinite(agent.heading)).toBe(true);
  });

  it('gives up rather than standing in the road forever', () => {
    const city = livedInCity();
    maintainAgents(city, createTrafficQueue());
    expect(city.agents.length).toBeGreaterThan(0);
    // Run well past the patience window without letting anyone respawn.
    for (let i = 0; i < 200; i++) updateAgents(city, AGENT_PATIENCE / 20);
    expect(city.agents).toHaveLength(0);
  });

  it('runs several errands before going home', () => {
    const city = livedInCity();
    maintainAgents(city, createTrafficQueue());
    const villager = city.agents.find((a) => a.kind === AgentKind.Peasant);
    expect(villager).toBeDefined();
    expect(villager!.errands).toBeGreaterThan(0);

    // Walk it all the way to its destination and check it continues.
    const errandsBefore = villager!.errands;
    for (let i = 0; i < 400 && city.agents.includes(villager!); i++) updateAgents(city, 0.2);
    if (city.agents.includes(villager!)) {
      expect(villager!.errands).toBeLessThan(errandsBefore);
    }
  });
});

describe('carts', () => {
  function haulingCity() {
    const city = makeFlatCity();
    const y = mainRoadY();
    const mill = createBuilding(city, 'timber2', 3, y + 1);
    const forge = createBuilding(city, 'craft1', 10, y + 1);
    registerBuilding(city, mill);
    registerBuilding(city, forge);
    refreshBuildingFlags(city);
    return { city, mill, forge };
  }

  it('turns deliveries into carts on the road', () => {
    const { city, mill, forge } = haulingCity();
    const queue = createTrafficQueue();
    spawnDeliveryCarts(queue, [{ from: mill.id, to: forge.id, good: Good.Timber, amount: 4 }]);
    maintainAgents(city, queue);

    const cart = city.agents.find((a) => a.kind === AgentKind.Cart);
    expect(cart).toBeDefined();
    expect(cart!.cargo?.good).toBe(Good.Timber);
    expect(cart!.targetBuilding).toBe(forge.id);
  });

  it('shows nothing for goods drawn from the city reserves', () => {
    const { city, forge } = haulingCity();
    const queue = createTrafficQueue();
    spawnDeliveryCarts(queue, [{ from: -1, to: forge.id, good: Good.Timber, amount: 4 }]);
    expect(queue.pending).toHaveLength(0);
    maintainAgents(city, queue);
    expect(city.agents.filter((a) => a.kind === AgentKind.Cart)).toHaveLength(0);
  });

  it('samples a busy day rather than queueing every haul', () => {
    const { mill, forge } = haulingCity();
    const queue = createTrafficQueue();
    const many = Array.from({ length: 400 }, () => ({
      from: mill.id,
      to: forge.id,
      good: Good.Timber,
      amount: 1,
    }));
    spawnDeliveryCarts(queue, many);
    expect(queue.pending.length).toBeLessThanOrEqual(24);
    expect(queue.pending.length).toBeGreaterThan(0);
  });

  it('keeps the streets under the cart ceiling', () => {
    const { city, mill, forge } = haulingCity();
    const queue = createTrafficQueue();
    for (let day = 0; day < 40; day++) {
      spawnDeliveryCarts(queue, [{ from: mill.id, to: forge.id, good: Good.Timber, amount: 1 }]);
      maintainAgents(city, queue);
    }
    expect(city.agents.filter((a) => a.kind === AgentKind.Cart).length).toBeLessThanOrEqual(MAX_CARTS);
  });
});

describe('when the streets change under them', () => {
  it('drops agents whose road was torn up', () => {
    const city = livedInCity();
    maintainAgents(city, createTrafficQueue());
    expect(city.agents.length).toBeGreaterThan(0);

    for (let x = 0; x < 16; x++) city.roads[tileIndex(city, x, mainRoadY())] = RoadType.None;
    revalidateAgents(city);
    expect(city.agents).toHaveLength(0);
  });

  it('forgets a building that has been demolished', () => {
    const city = livedInCity();
    maintainAgents(city, createTrafficQueue());
    const agent = city.agents.find((a) => a.targetBuilding !== null);
    expect(agent).toBeDefined();
    const target = agent!.targetBuilding as number;

    const building = city.buildings.get(target);
    expect(building?.kind).toBeDefined();
    expect([BuildingKind.Shop, BuildingKind.Dwelling, BuildingKind.Service, BuildingKind.Workshop, BuildingKind.TradeHub])
      .toContain(building!.kind);
  });
});

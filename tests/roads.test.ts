import { describe, expect, it } from 'vitest';
import { RoadType, Terrain } from '@/sim/types';
import { tileIndex } from '@/sim/city';
import {
  BRIDGE_COST_MULTIPLIER,
  computeGateDistance,
  countRoads,
  doorTile,
  evaluateRoadPlacement,
  findRoadPath,
  hasRoadAccess,
  placeRoad,
  removeRoad,
  roadConnectionMask,
  roadSpeed,
  roadsConnect,
} from '@/sim/roads';
import { ROAD_COST } from '@/sim/city';
import { makeFlatCity, mainRoadY } from './helpers';

describe('road placement rules', () => {
  it('refuses land the city does not hold', () => {
    const city = makeFlatCity();
    const check = evaluateRoadPlacement(city, city.width - 2, city.height - 2, RoadType.Cobble);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/do not hold/i);
  });

  it('refuses a tile the wall stands on', () => {
    const city = makeFlatCity();
    const wall = city.walls.find((w) => w.kind !== 'gate');
    expect(wall).toBeDefined();
    const check = evaluateRoadPlacement(city, wall!.x, wall!.y, RoadType.Cobble);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/wall/i);
  });

  it('refuses to repave with the same class', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    expect(evaluateRoadPlacement(city, 3, y, RoadType.Cobble).ok).toBe(false);
  });

  it('charges only the difference when upgrading', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    const check = evaluateRoadPlacement(city, 3, y, RoadType.Avenue);
    expect(check.ok).toBe(true);
    expect(check.cost).toBe(ROAD_COST[RoadType.Avenue] - ROAD_COST[RoadType.Cobble]);
  });

  it('never bridges deep water', () => {
    const city = makeFlatCity();
    city.map.terrain[tileIndex(city, 2, 2)] = Terrain.DeepWater;
    const check = evaluateRoadPlacement(city, 2, 2, RoadType.Cobble);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/deep/i);
  });

  it('bridges shallow water with cobbles, at a premium', () => {
    const city = makeFlatCity();
    city.map.terrain[tileIndex(city, 2, 2)] = Terrain.ShallowWater;
    const check = evaluateRoadPlacement(city, 2, 2, RoadType.Cobble);
    expect(check.ok).toBe(true);
    expect(check.isBridge).toBe(true);
    expect(check.cost).toBe(ROAD_COST[RoadType.Cobble] * BRIDGE_COST_MULTIPLIER);
  });

  it('will not run a footpath across water', () => {
    const city = makeFlatCity();
    city.map.terrain[tileIndex(city, 2, 2)] = Terrain.ShallowWater;
    expect(evaluateRoadPlacement(city, 2, 2, RoadType.Path).ok).toBe(false);
  });

  it('charges the treasury and lays the road', () => {
    const city = makeFlatCity();
    const before = city.budget.gold;
    expect(placeRoad(city, 3, 2, RoadType.Cobble)).toBe(true);
    expect(city.roads[tileIndex(city, 3, 2)]).toBe(RoadType.Cobble);
    expect(city.budget.gold).toBe(before - ROAD_COST[RoadType.Cobble]);
  });

  it('declines when the treasury cannot cover it', () => {
    const city = makeFlatCity();
    city.budget.gold = 1;
    expect(placeRoad(city, 3, 2, RoadType.Cobble)).toBe(false);
    expect(city.roads[tileIndex(city, 3, 2)]).toBe(RoadType.None);
  });

  it('removes roads', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    expect(removeRoad(city, 3, y)).toBe(true);
    expect(city.roads[tileIndex(city, 3, y)]).toBe(RoadType.None);
    expect(removeRoad(city, 3, y)).toBe(false);
  });
});

describe('auto-tiling and connectivity', () => {
  it('packs neighbours into a N/E/S/W bitmask', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    // A straight east-west run connects east and west only.
    expect(roadConnectionMask(city, 5, y)).toBe(0b1010);
    placeRoad(city, 5, y - 1, RoadType.Cobble);
    expect(roadConnectionMask(city, 5, y)).toBe(0b1011);
  });

  it('reports no mask on an empty tile', () => {
    const city = makeFlatCity();
    expect(roadConnectionMask(city, 5, 1)).toBe(0);
  });

  it('breaks the connection over a cliff', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    expect(roadsConnect(city, 4, y, 5, y)).toBe(true);
    city.map.elevation[tileIndex(city, 5, y)] = 6;
    expect(roadsConnect(city, 4, y, 5, y)).toBe(false);
  });

  it('ranks road classes by speed', () => {
    expect(roadSpeed(RoadType.Avenue)).toBeGreaterThan(roadSpeed(RoadType.Cobble));
    expect(roadSpeed(RoadType.Cobble)).toBeGreaterThan(roadSpeed(RoadType.Path));
    expect(roadSpeed(RoadType.Path)).toBeGreaterThan(roadSpeed(RoadType.None));
  });

  it('counts roads by class', () => {
    const city = makeFlatCity();
    const counts = countRoads(city);
    expect(counts[RoadType.Cobble]).toBe(16);
    expect(counts[RoadType.Avenue]).toBe(0);
  });
});

describe('pathfinding', () => {
  it('finds a route along a straight street', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    const path = findRoadPath(city, { x: 1, y }, { x: 12, y });
    expect(path).not.toBeNull();
    expect(path).toHaveLength(12);
    expect(path![0]).toBe(tileIndex(city, 1, y));
    expect(path![path!.length - 1]).toBe(tileIndex(city, 12, y));
  });

  it('returns null when the street is severed', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    removeRoad(city, 6, y);
    expect(findRoadPath(city, { x: 1, y }, { x: 12, y })).toBeNull();
  });

  it('returns null when either end is off the road network', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    expect(findRoadPath(city, { x: 1, y: 1 }, { x: 12, y })).toBeNull();
    expect(findRoadPath(city, { x: 1, y }, { x: 12, y: 1 })).toBeNull();
  });

  it('refuses to route a cart down a footpath', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    for (let x = 0; x < 16; x++) city.roads[tileIndex(city, x, y + 2)] = RoadType.Path;
    city.roads[tileIndex(city, 0, y + 1)] = RoadType.Path;
    const walking = findRoadPath(city, { x: 2, y: y + 2 }, { x: 10, y: y + 2 });
    expect(walking).not.toBeNull();
    const hauling = findRoadPath(city, { x: 2, y: y + 2 }, { x: 10, y: y + 2 }, { cartsOnly: true });
    expect(hauling).toBeNull();
  });

  it('gives up gracefully when the node budget runs out', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    expect(findRoadPath(city, { x: 0, y }, { x: 15, y }, { maxNodes: 2 })).toBeNull();
  });
});

describe('gate distance', () => {
  it('counts hops outward from the city gates', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    computeGateDistance(city);
    const gate = city.walls.find((w) => w.kind === 'gate');
    expect(gate).toBeDefined();
    expect(city.gateDistance[tileIndex(city, gate!.x, gate!.y)]).toBe(0);
    // Every tile of the through street is reachable.
    for (let x = 0; x < 16; x++) {
      expect(Number.isFinite(city.gateDistance[tileIndex(city, x, y)])).toBe(true);
    }
  });

  it('leaves disconnected streets at infinity', () => {
    const city = makeFlatCity();
    city.roads[tileIndex(city, 3, 1)] = RoadType.Cobble;
    computeGateDistance(city);
    expect(city.gateDistance[tileIndex(city, 3, 1)]).toBe(Infinity);
  });
});

describe('building frontage', () => {
  it('finds the door of a building beside the road', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    const building = {
      id: 1, defId: 'house1', kind: 'dwelling', x: 4, y: y + 1, width: 1, height: 1,
    } as never;
    expect(hasRoadAccess(city, building)).toBe(true);
    expect(doorTile(city, building)).toEqual({ x: 4, y });
  });

  it('reports no access for an inland plot', () => {
    const city = makeFlatCity();
    const building = { id: 1, defId: 'house1', kind: 'dwelling', x: 4, y: 1, width: 1, height: 1 } as never;
    expect(hasRoadAccess(city, building)).toBe(false);
    expect(doorTile(city, building)).toBeNull();
  });
});

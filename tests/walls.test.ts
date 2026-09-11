import { describe, expect, it } from 'vitest';
import { PARCEL_SIZE, WALL_COST_PER_TILE, isTileOwned, parcelAt, tileIndex } from '@/sim/city';
import { GATE_COST_MULTIPLIER, planWalls, rebuildWalls, wallStats } from '@/sim/walls';
import { RoadType, Terrain } from '@/sim/types';
import { makeFlatCity, mainRoadY } from './helpers';

describe('the curtain wall', () => {
  it('rings the land the city holds, and nothing else', () => {
    const city = makeFlatCity({ ownedParcels: 2 });
    const span = 2 * PARCEL_SIZE;
    for (const segment of city.walls) {
      expect(isTileOwned(city, segment.x, segment.y)).toBe(true);
      const onEdge =
        segment.x === 0 || segment.y === 0 || segment.x === span - 1 || segment.y === span - 1;
      expect(onEdge, `wall at ${segment.x},${segment.y}`).toBe(true);
    }
  });

  it('walls every exposed boundary tile', () => {
    const city = makeFlatCity({ ownedParcels: 2 });
    const span = 2 * PARCEL_SIZE;
    // A 16x16 block has 16*4 - 4 = 60 boundary tiles.
    expect(city.walls).toHaveLength(span * 4 - 4);
  });

  it('leaves the interior clear to build on', () => {
    const city = makeFlatCity({ ownedParcels: 2 });
    for (let y = 1; y < 2 * PARCEL_SIZE - 1; y++) {
      for (let x = 1; x < 2 * PARCEL_SIZE - 1; x++) {
        expect(city.wallAt[tileIndex(city, x, y)]).toBe(-1);
      }
    }
  });

  it('opens a gatehouse wherever a road crosses', () => {
    const city = makeFlatCity({ ownedParcels: 2 });
    const y = mainRoadY(2);
    const gates = city.walls.filter((w) => w.kind === 'gate');
    expect(gates.length).toBeGreaterThan(0);
    // The through street leaves by the west and east walls.
    expect(gates.some((g) => g.x === 0 && g.y === y)).toBe(true);
    expect(gates.some((g) => g.x === 2 * PARCEL_SIZE - 1 && g.y === y)).toBe(true);
    // The passage runs east-west, the way the road does.
    for (const gate of gates) expect(gate.orientation).toBe(1);
  });

  it('puts a tower on every corner', () => {
    const city = makeFlatCity({ ownedParcels: 2 });
    const span = 2 * PARCEL_SIZE;
    const corners = [
      { x: 0, y: 0 },
      { x: span - 1, y: 0 },
      { x: 0, y: span - 1 },
      { x: span - 1, y: span - 1 },
    ];
    for (const corner of corners) {
      const index = city.wallAt[tileIndex(city, corner.x, corner.y)];
      expect(index).toBeGreaterThanOrEqual(0);
      expect(city.walls[index].kind).toBe('tower');
    }
  });

  it('needs no wall across deep water', () => {
    const city = makeFlatCity({ ownedParcels: 2 });
    city.map.terrain[tileIndex(city, 0, 2)] = Terrain.DeepWater;
    rebuildWalls(city, false);
    expect(city.wallAt[tileIndex(city, 0, 2)]).toBe(-1);
  });

  it('pushes outward when a neighbouring parcel is annexed', () => {
    const city = makeFlatCity({ ownedParcels: 2 });
    const before = city.walls.length;
    const parcel = parcelAt(city, 2, 0);
    expect(parcel).toBeDefined();
    parcel!.owned = true;
    rebuildWalls(city, false);

    // The old eastern wall is now interior ground.
    expect(city.wallAt[tileIndex(city, 2 * PARCEL_SIZE - 1, 2)]).toBe(-1);
    // And a new wall stands on the far side of the new parcel.
    expect(city.wallAt[tileIndex(city, 3 * PARCEL_SIZE - 1, 2)]).toBeGreaterThanOrEqual(0);
    expect(city.walls.length).toBeGreaterThan(before);
  });

  it('prices only the stonework that is actually new', () => {
    const city = makeFlatCity({ ownedParcels: 2 });
    // Nothing has changed, so nothing is owed.
    expect(planWalls(city).cost).toBe(0);

    const parcel = parcelAt(city, 2, 0);
    parcel!.owned = true;
    const plan = planWalls(city);
    expect(plan.cost).toBeGreaterThan(0);
    expect(plan.newTiles + plan.newTowers + plan.newGates).toBeGreaterThan(0);
  });

  it('charges gatehouses more than plain wall', () => {
    const city = makeFlatCity({ ownedParcels: 1 });
    city.walls = [];
    city.wallAt.fill(-1);
    const plan = planWalls(city);
    const expected =
      plan.newTiles * WALL_COST_PER_TILE +
      plan.newTowers * WALL_COST_PER_TILE * 3 +
      plan.newGates * WALL_COST_PER_TILE * GATE_COST_MULTIPLIER;
    expect(plan.cost).toBe(Math.round(expected));
  });

  it('summarises what stands', () => {
    const city = makeFlatCity({ ownedParcels: 2 });
    const stats = wallStats(city);
    expect(stats.walls + stats.towers + stats.gates).toBe(city.walls.length);
    expect(stats.towers).toBeGreaterThanOrEqual(4);
  });

  it('rebuilds idempotently', () => {
    const city = makeFlatCity({ ownedParcels: 2 });
    const first = city.walls.map((w) => `${w.x},${w.y},${w.kind}`);
    rebuildWalls(city, false);
    const second = city.walls.map((w) => `${w.x},${w.y},${w.kind}`);
    expect(second).toEqual(first);
  });

  it('turns a wall tile into a gate when a road is driven through it', () => {
    const city = makeFlatCity({ ownedParcels: 2 });
    const span = 2 * PARCEL_SIZE;
    // A spur running south out of the city, crossing the southern wall.
    city.roads[tileIndex(city, 4, span - 2)] = RoadType.Cobble;
    city.roads[tileIndex(city, 4, span - 1)] = RoadType.Cobble;
    rebuildWalls(city, false);
    const index = city.wallAt[tileIndex(city, 4, span - 1)];
    expect(city.walls[index].kind).toBe('gate');
    expect(city.walls[index].orientation).toBe(0);
  });
});

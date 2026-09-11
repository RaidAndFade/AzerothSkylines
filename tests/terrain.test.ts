import { describe, expect, it } from 'vitest';
import { MAX_ELEVATION, elevationAt, generateWorld, isTileBuildable, terrainAt, treesOnTile } from '@/sim/terrain';
import { Terrain, isWater } from '@/sim/types';

const world = generateWorld({ width: 80, height: 80, seed: 'goldshire' });

describe('generateWorld', () => {
  it('is reproducible from a seed', () => {
    const again = generateWorld({ width: 80, height: 80, seed: 'goldshire' });
    expect(Array.from(again.elevation)).toEqual(Array.from(world.elevation));
    expect(Array.from(again.terrain)).toEqual(Array.from(world.terrain));
    expect(again.foundingSite).toEqual(world.foundingSite);
  });

  it('produces a different valley for a different seed', () => {
    const other = generateWorld({ width: 80, height: 80, seed: 'westfall' });
    expect(Array.from(other.terrain)).not.toEqual(Array.from(world.terrain));
  });

  it('keeps every elevation within the supported range', () => {
    for (const value of world.elevation) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(MAX_ELEVATION);
    }
  });

  it('contains both water and workable land', () => {
    let water = 0;
    let buildable = 0;
    for (let i = 0; i < world.terrain.length; i++) {
      if (isWater(world.terrain[i] as Terrain)) water++;
      else buildable++;
    }
    expect(water).toBeGreaterThan(world.terrain.length * 0.02);
    expect(buildable).toBeGreaterThan(world.terrain.length * 0.4);
  });

  it('grows woodland, as an Elwynn valley should', () => {
    let forest = 0;
    for (const t of world.terrain) if (t === Terrain.Forest) forest++;
    expect(forest).toBeGreaterThan(world.terrain.length * 0.05);
  });

  it('puts the water level at elevation zero', () => {
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        if (isWater(terrainAt(world, x, y))) expect(elevationAt(world, x, y)).toBe(0);
      }
    }
  });

  it('reads out-of-bounds tiles as deep water rather than throwing', () => {
    expect(terrainAt(world, -1, 5)).toBe(Terrain.DeepWater);
    expect(terrainAt(world, world.width, 5)).toBe(Terrain.DeepWater);
    expect(elevationAt(world, -1, -1)).toBe(0);
  });
});

describe('the founding site and the king’s road', () => {
  it('sits on buildable ground away from the valley edge', () => {
    const { x, y } = world.foundingSite;
    expect(isTileBuildable(world, x, y)).toBe(true);
    expect(Math.min(x, y, world.width - 1 - x, world.height - 1 - y)).toBeGreaterThan(5);
  });

  it('has an apron of buildable land around it for the first district', () => {
    let buildable = 0;
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        if (isTileBuildable(world, world.foundingSite.x + dx, world.foundingSite.y + dy)) buildable++;
      }
    }
    expect(buildable).toBeGreaterThanOrEqual(60);
  });

  it('enters from the edge of the valley', () => {
    const entry = world.roadEntry;
    const onEdge = entry.x === 0 || entry.y === 0 || entry.x === world.width - 1 || entry.y === world.height - 1;
    expect(onEdge).toBe(true);
  });

  it('runs unbroken from the entry to the founding site', () => {
    const road = world.kingsRoad;
    expect(road.length).toBeGreaterThan(4);
    expect(road[0]).toEqual(world.roadEntry);
    expect(road[road.length - 1]).toEqual(world.foundingSite);
    for (let i = 1; i < road.length; i++) {
      const step = Math.abs(road[i].x - road[i - 1].x) + Math.abs(road[i].y - road[i - 1].y);
      expect(step).toBe(1);
    }
  });

  it('is level and dry along its whole length', () => {
    for (const point of world.kingsRoad) {
      expect(isWater(terrainAt(world, point.x, point.y))).toBe(false);
    }
    for (let i = 1; i < world.kingsRoad.length; i++) {
      const a = world.kingsRoad[i - 1];
      const b = world.kingsRoad[i];
      expect(Math.abs(elevationAt(world, a.x, a.y) - elevationAt(world, b.x, b.y))).toBeLessThanOrEqual(1);
    }
  });
});

describe('treesOnTile', () => {
  it('is stable across calls, so foliage never shimmers', () => {
    for (let i = 0; i < 40; i++) {
      const x = 10 + i;
      const y = 20 + (i % 7);
      expect(treesOnTile(world, x, y)).toEqual(treesOnTile(world, x, y));
    }
  });

  it('places no trees on open water', () => {
    for (let y = 0; y < world.height; y += 3) {
      for (let x = 0; x < world.width; x += 3) {
        if (isWater(terrainAt(world, x, y))) expect(treesOnTile(world, x, y)).toHaveLength(0);
      }
    }
  });

  it('keeps tree offsets inside their tile', () => {
    let found = 0;
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        for (const tree of treesOnTile(world, x, y)) {
          found++;
          expect(Math.abs(tree.ox)).toBeLessThanOrEqual(0.5);
          expect(Math.abs(tree.oy)).toBeLessThanOrEqual(0.5);
          expect(tree.scale).toBeGreaterThan(0.5);
        }
      }
    }
    expect(found).toBeGreaterThan(100);
  });
});

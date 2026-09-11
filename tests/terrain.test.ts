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

describe('the founding district', () => {
  it('is a block of workable ground, not a river crossing', () => {
    for (let seed = 0; seed < 24; seed++) {
      const valley = generateWorld({ width: 96, height: 96, seed: `seed-${seed}`, parcelSize: 8, districtParcels: 2 });
      const x0 = valley.foundingDistrict.x * 8;
      const y0 = valley.foundingDistrict.y * 8;
      let buildable = 0;
      let deep = 0;
      for (let y = y0; y < y0 + 16; y++) {
        for (let x = x0; x < x0 + 16; x++) {
          if (isTileBuildable(valley, x, y)) buildable++;
          if (terrainAt(valley, x, y) === Terrain.DeepWater) deep++;
        }
      }
      expect(buildable / 256, `seed ${seed} buildable`).toBeGreaterThan(0.7);
      expect(deep / 256, `seed ${seed} deep water`).toBeLessThan(0.1);
    }
  });

  it('puts the founding site on buildable ground inside its own district', () => {
    for (let seed = 0; seed < 12; seed++) {
      const valley = generateWorld({ width: 96, height: 96, seed: `d-${seed}`, parcelSize: 8, districtParcels: 2 });
      const x0 = valley.foundingDistrict.x * 8;
      const y0 = valley.foundingDistrict.y * 8;
      expect(valley.foundingSite.x).toBeGreaterThanOrEqual(x0);
      expect(valley.foundingSite.x).toBeLessThan(x0 + 16);
      expect(valley.foundingSite.y).toBeGreaterThanOrEqual(y0);
      expect(valley.foundingSite.y).toBeLessThan(y0 + 16);
      expect(isTileBuildable(valley, valley.foundingSite.x, valley.foundingSite.y)).toBe(true);
    }
  });
});

describe('generator robustness', () => {
  it('yields a playable valley for every seed it is given', () => {
    for (let seed = 0; seed < 24; seed++) {
      const valley = generateWorld({ width: 96, height: 96, seed: `seed-${seed}` });
      let water = 0;
      let land = 0;
      let forest = 0;
      for (const t of valley.terrain) {
        if (isWater(t as Terrain)) water++;
        else land++;
        if (t === Terrain.Forest) forest++;
      }
      const total = valley.terrain.length;
      expect(isTileBuildable(valley, valley.foundingSite.x, valley.foundingSite.y), `seed ${seed}`).toBe(true);
      expect(water / total, `seed ${seed} water`).toBeGreaterThan(0.02);
      expect(land / total, `seed ${seed} land`).toBeGreaterThan(0.45);
      expect(forest / total, `seed ${seed} woodland`).toBeGreaterThan(0.03);
      for (let i = 1; i < valley.kingsRoad.length; i++) {
        const step =
          Math.abs(valley.kingsRoad[i].x - valley.kingsRoad[i - 1].x) +
          Math.abs(valley.kingsRoad[i].y - valley.kingsRoad[i - 1].y);
        expect(step, `seed ${seed} road`).toBe(1);
      }
    }
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

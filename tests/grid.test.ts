import { describe, expect, it } from 'vitest';
import { DIRECTIONS, Grid, ScalarGrid, forRect, key, tilesInRadius, unkey } from '@/core/grid';

describe('Grid', () => {
  it('fills from a constant or a factory', () => {
    const constant = new Grid<number>(3, 2, 7);
    expect(constant.get(2, 1)).toBe(7);
    const computed = new Grid<number>(3, 2, (x, y) => x * 10 + y);
    expect(computed.get(2, 1)).toBe(21);
  });

  it('returns the fallback outside its bounds instead of throwing', () => {
    const grid = new Grid<string>(2, 2, 'a');
    expect(grid.get(-1, 0, 'edge')).toBe('edge');
    expect(grid.get(5, 5, 'edge')).toBe('edge');
    expect(grid.inBounds(1, 1)).toBe(true);
    expect(grid.inBounds(2, 1)).toBe(false);
  });

  it('ignores writes outside its bounds', () => {
    const grid = new Grid<number>(2, 2, 0);
    grid.set(9, 9, 5);
    expect(grid.raw().every((v) => v === 0)).toBe(true);
  });

  it('maps into a new grid of the same shape', () => {
    const grid = new Grid<number>(2, 2, (x) => x);
    const doubled = grid.map((v) => v * 2);
    expect(doubled.get(1, 0)).toBe(2);
    expect(doubled.width).toBe(2);
  });
});

describe('ScalarGrid', () => {
  it('accumulates, maxes and scales', () => {
    const grid = new ScalarGrid(4, 4);
    grid.add(1, 1, 5);
    grid.add(1, 1, 3);
    expect(grid.get(1, 1)).toBe(8);
    grid.max(1, 1, 4);
    expect(grid.get(1, 1)).toBe(8);
    grid.max(1, 1, 12);
    expect(grid.get(1, 1)).toBe(12);
    grid.scale(0.5);
    expect(grid.get(1, 1)).toBe(6);
  });

  it('treats out-of-bounds reads as zero', () => {
    const grid = new ScalarGrid(2, 2, 3);
    expect(grid.get(-1, 0)).toBe(0);
    expect(grid.get(0, 0)).toBe(3);
  });
});

describe('coordinate helpers', () => {
  it('packs and unpacks coordinates', () => {
    for (const point of [{ x: 0, y: 0 }, { x: 111, y: 87 }, { x: 4095, y: 200 }]) {
      expect(unkey(key(point.x, point.y))).toEqual(point);
    }
  });

  it('lists cardinal directions in N, E, S, W order', () => {
    expect(DIRECTIONS).toEqual([
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
    ]);
  });

  it('visits every tile of a rectangle exactly once', () => {
    const seen: string[] = [];
    forRect(2, 3, 2, 2, (x, y) => seen.push(`${x},${y}`));
    expect(seen.sort()).toEqual(['2,3', '2,4', '3,3', '3,4']);
  });

  it('returns radius tiles nearest-first and within the radius', () => {
    const tiles = tilesInRadius(10, 10, 2.5);
    expect(tiles[0]).toEqual({ x: 10, y: 10 });
    for (const tile of tiles) {
      expect(Math.hypot(tile.x - 10, tile.y - 10)).toBeLessThanOrEqual(2.5);
    }
  });
});

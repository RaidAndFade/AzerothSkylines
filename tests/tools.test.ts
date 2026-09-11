/** The tool layer: what a tap or a drag resolves to before it is committed. */
import { describe, expect, it } from 'vitest';
import { RoadType, Zone } from '@/sim/types';
import { PARCEL_SIZE, tileIndex } from '@/sim/city';
import {
  applyTool,
  defaultTool,
  elbowPath,
  quoteTool,
  rectangle,
  tilesForDrag,
  toolDraws,
  toolHint,
} from '@/ui/tools';
import { makeFlatCity, mainRoadY, zoneRect } from './helpers';

const road = (over: Partial<ReturnType<typeof defaultTool>> = {}) => ({
  ...defaultTool(),
  kind: 'road' as const,
  ...over,
});

describe('drag geometry', () => {
  it('runs an elbow along the longer axis first', () => {
    const path = elbowPath({ x: 0, y: 0 }, { x: 3, y: 2 });
    expect(path[0]).toEqual({ x: 0, y: 0 });
    expect(path[path.length - 1]).toEqual({ x: 3, y: 2 });
    // Horizontal leg first, because the horizontal distance is greater.
    expect(path[1]).toEqual({ x: 1, y: 0 });
  });

  it('runs the other way when the drag is mostly vertical', () => {
    const path = elbowPath({ x: 0, y: 0 }, { x: 2, y: 5 });
    expect(path[1]).toEqual({ x: 0, y: 1 });
    expect(path[path.length - 1]).toEqual({ x: 2, y: 5 });
  });

  it('never leaves a gap in the run', () => {
    for (const end of [{ x: 6, y: 1 }, { x: -4, y: 3 }, { x: 2, y: -7 }, { x: 0, y: 0 }]) {
      const path = elbowPath({ x: 5, y: 5 }, { x: end.x + 5, y: end.y + 5 });
      for (let i = 1; i < path.length; i++) {
        const step = Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y);
        expect(step).toBe(1);
      }
    }
  });

  it('handles a drag that goes nowhere', () => {
    expect(elbowPath({ x: 4, y: 4 }, { x: 4, y: 4 })).toEqual([{ x: 4, y: 4 }]);
  });

  it('fills a rectangle whichever corner the drag started from', () => {
    const forward = rectangle({ x: 1, y: 1 }, { x: 3, y: 2 });
    const backward = rectangle({ x: 3, y: 2 }, { x: 1, y: 1 });
    expect(forward).toHaveLength(6);
    expect(backward).toEqual(forward);
  });

  it('gives roads an elbow and zoning a rectangle', () => {
    const start = { x: 0, y: 0 };
    const end = { x: 2, y: 2 };
    expect(tilesForDrag(road(), start, end)).toHaveLength(5);
    expect(tilesForDrag({ ...defaultTool(), kind: 'zone' }, start, end)).toHaveLength(9);
    expect(tilesForDrag({ ...defaultTool(), kind: 'build' }, start, end)).toEqual([end]);
  });

  it('knows which tools draw rather than pan', () => {
    expect(toolDraws(road())).toBe(true);
    expect(toolDraws({ ...defaultTool(), kind: 'zone' })).toBe(true);
    expect(toolDraws({ ...defaultTool(), kind: 'demolish' })).toBe(true);
    expect(toolDraws(defaultTool())).toBe(false);
    expect(toolDraws({ ...defaultTool(), kind: 'build' })).toBe(false);
  });

  it('has a hint for every tool', () => {
    for (const kind of ['inspect', 'road', 'zone', 'build', 'demolish', 'land'] as const) {
      expect(toolHint({ ...defaultTool(), kind }).length).toBeGreaterThan(10);
    }
  });
});

describe('quoting a tool before it commits', () => {
  it('prices a road run and marks each tile legal or not', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    const tiles = elbowPath({ x: 3, y: y + 1 }, { x: 6, y: y + 1 });
    const quote = quoteTool(city, road(), tiles);
    expect(quote.count).toBe(4);
    expect(quote.cost).toBe(4 * 14);
    expect(quote.preview.tiles.every((t) => t.ok)).toBe(true);
  });

  it('marks illegal tiles and reports why', () => {
    const city = makeFlatCity();
    const quote = quoteTool(city, road(), [
      { x: 3, y: 2 },
      { x: city.width - 2, y: city.height - 2 },
    ]);
    expect(quote.count).toBe(1);
    expect(quote.preview.tiles[1].ok).toBe(false);
    expect(quote.reason).toMatch(/do not hold/i);
  });

  it('prices zoning per tile and ignores plots it cannot paint', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    // The middle row is the road, which cannot be zoned.
    const quote = quoteTool(city, { ...defaultTool(), kind: 'zone', zone: Zone.Residential }, rectangle({ x: 3, y: y - 1 }, { x: 5, y: y + 1 }));
    expect(quote.count).toBe(6);
    expect(quote.cost).toBe(18);
  });

  it('outlines the whole footprint when placing a building', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    city.stats.population = 500;
    const quote = quoteTool(city, { ...defaultTool(), kind: 'build', buildDefId: 'chapel' }, [{ x: 4, y: y + 1 }]);
    expect(quote.preview.rect).toEqual({ x: 4, y: y + 1, width: 2, height: 2, ok: true });
    expect(quote.preview.tiles).toHaveLength(4);
    expect(quote.cost).toBe(1150);
  });

  it('outlines the whole lot when buying land', () => {
    const city = makeFlatCity({ ownedParcels: 2 });
    const quote = quoteTool(city, { ...defaultTool(), kind: 'land' }, [{ x: 2 * PARCEL_SIZE + 3, y: 3 }]);
    expect(quote.preview.rect?.width).toBe(PARCEL_SIZE);
    expect(quote.count).toBe(1);
    expect(quote.cost).toBeGreaterThan(0);
  });

  it('marks demolition only where there is something to clear', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    const quote = quoteTool(city, { ...defaultTool(), kind: 'demolish' }, [
      { x: 4, y },
      { x: 4, y: y + 3 },
    ]);
    expect(quote.preview.tiles[0].ok).toBe(true);
    expect(quote.preview.tiles[1].ok).toBe(false);
    expect(quote.count).toBe(1);
  });
});

describe('committing a tool', () => {
  it('lays a road run and reports what it did', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    const result = applyTool(city, road(), elbowPath({ x: 3, y: y + 1 }, { x: 6, y: y + 1 }));
    expect(result.applied).toBe(4);
    expect(result.spent).toBe(4 * 14);
    expect(result.tone).toBe('good');
    expect(city.roads[tileIndex(city, 5, y + 1)]).toBe(RoadType.Cobble);
  });

  it('explains itself when nothing can be done', () => {
    const city = makeFlatCity();
    const result = applyTool(city, road(), [{ x: city.width - 2, y: city.height - 2 }]);
    expect(result.applied).toBe(0);
    expect(result.tone).toBe('bad');
    expect(result.message).toMatch(/do not hold/i);
  });

  it('paints zoning and charges for it', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    const before = city.budget.gold;
    const result = applyTool(city, { ...defaultTool(), kind: 'zone', zone: Zone.Commercial }, rectangle({ x: 3, y: y + 1 }, { x: 5, y: y + 1 }));
    expect(result.applied).toBe(3);
    expect(city.budget.gold).toBe(before - 9);
    expect(city.zones[tileIndex(city, 4, y + 1)]).toBe(Zone.Commercial);
  });

  it('places a building and refuses a second on the same plot', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    const tool = { ...defaultTool(), kind: 'build' as const, buildDefId: 'well' };
    expect(applyTool(city, tool, [{ x: 4, y: y + 1 }]).applied).toBe(1);
    const second = applyTool(city, tool, [{ x: 4, y: y + 1 }]);
    expect(second.applied).toBe(0);
    expect(second.message).toMatch(/already stands/i);
  });

  it('clears what it can and says how much', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    zoneRect(city, Zone.Residential, 3, y + 1, 3, 1);
    const result = applyTool(city, { ...defaultTool(), kind: 'demolish' }, rectangle({ x: 3, y: y + 1 }, { x: 5, y: y + 1 }));
    expect(result.applied).toBe(3);
    expect(city.zones[tileIndex(city, 4, y + 1)]).toBe(Zone.None);
  });

  it('does nothing at all for the inspect tool', () => {
    const city = makeFlatCity();
    const before = city.budget.gold;
    expect(applyTool(city, defaultTool(), [{ x: 4, y: 4 }]).applied).toBe(0);
    expect(city.budget.gold).toBe(before);
  });
});

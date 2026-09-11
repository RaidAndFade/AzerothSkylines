import { describe, expect, it } from 'vitest';
import { RoadType, Terrain, Zone } from '@/sim/types';
import { tileIndex } from '@/sim/city';
import {
  ZONE_COST_PER_TILE,
  canZone,
  developableTiles,
  frontageFacing,
  hasStreetFrontage,
  setZone,
  zoneCounts,
} from '@/sim/zoning';
import { makeFlatCity, mainRoadY, zoneRect } from './helpers';

describe('zoning rules', () => {
  it('accepts owned, empty, buildable ground', () => {
    const city = makeFlatCity();
    expect(canZone(city, 4, mainRoadY() + 1, Zone.Residential).ok).toBe(true);
  });

  it('refuses land the city does not hold', () => {
    const city = makeFlatCity();
    const check = canZone(city, city.width - 2, city.height - 2, Zone.Residential);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/do not hold/i);
  });

  it('refuses water and mountain', () => {
    const city = makeFlatCity();
    city.map.terrain[tileIndex(city, 3, 2)] = Terrain.DeepWater;
    city.map.terrain[tileIndex(city, 4, 2)] = Terrain.Rock;
    expect(canZone(city, 3, 2, Zone.Residential).ok).toBe(false);
    expect(canZone(city, 4, 2, Zone.Residential).ok).toBe(false);
  });

  it('refuses roads and walls', () => {
    const city = makeFlatCity();
    expect(canZone(city, 4, mainRoadY(), Zone.Residential).reason).toMatch(/road/i);
    const wall = city.walls.find((w) => w.kind !== 'gate')!;
    expect(canZone(city, wall.x, wall.y, Zone.Residential).reason).toMatch(/wall/i);
  });

  it('refuses to repaint the same zone', () => {
    const city = makeFlatCity();
    const y = mainRoadY() + 1;
    setZone(city, 4, y, Zone.Residential);
    expect(canZone(city, 4, y, Zone.Residential).ok).toBe(false);
  });

  it('charges for paint and records the zone', () => {
    const city = makeFlatCity();
    const y = mainRoadY() + 1;
    const before = city.budget.gold;
    expect(setZone(city, 4, y, Zone.Commercial)).toBe(ZONE_COST_PER_TILE);
    expect(city.zones[tileIndex(city, 4, y)]).toBe(Zone.Commercial);
    expect(city.budget.gold).toBe(before - ZONE_COST_PER_TILE);
  });

  it('clears zoning for free', () => {
    const city = makeFlatCity();
    const y = mainRoadY() + 1;
    setZone(city, 4, y, Zone.Commercial);
    const before = city.budget.gold;
    expect(setZone(city, 4, y, Zone.None)).toBe(0);
    expect(city.budget.gold).toBe(before);
    expect(city.zones[tileIndex(city, 4, y)]).toBe(Zone.None);
  });

  it('will not paint when the treasury is empty', () => {
    const city = makeFlatCity();
    city.budget.gold = 0;
    expect(setZone(city, 4, mainRoadY() + 1, Zone.Residential)).toBe(0);
  });
});

describe('street frontage', () => {
  it('recognises a plot beside the road', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    expect(hasStreetFrontage(city, 4, y + 1)).toBe(true);
    expect(hasStreetFrontage(city, 4, y + 3)).toBe(false);
  });

  it('checks the whole footprint of a larger building', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    expect(hasStreetFrontage(city, 4, y + 1, 2, 2)).toBe(true);
    expect(hasStreetFrontage(city, 4, y + 2, 2, 2)).toBe(false);
  });

  it('faces buildings toward their street', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    // A plot south of the road faces north.
    expect(frontageFacing(city, 4, y + 1)).toBe(0);
    // A plot north of the road faces south.
    expect(frontageFacing(city, 4, y - 1)).toBe(2);
  });
});

describe('zone bookkeeping', () => {
  it('lists only developable plots', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    zoneRect(city, Zone.Residential, 2, y + 1, 4, 3);
    const tiles = developableTiles(city, Zone.Residential);
    // Only the row that actually touches the road can develop.
    expect(tiles).toHaveLength(4);
    for (const index of tiles) expect(Math.floor(index / city.width)).toBe(y + 1);
  });

  it('excludes plots already built on', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    zoneRect(city, Zone.Residential, 2, y + 1, 4, 1);
    city.buildingAt[tileIndex(city, 3, y + 1)] = 99;
    expect(developableTiles(city, Zone.Residential)).toHaveLength(3);
  });

  it('counts painted tiles by zone', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    zoneRect(city, Zone.Residential, 2, y + 1, 4, 2);
    zoneRect(city, Zone.Industrial, 2, y - 2, 3, 1);
    const counts = zoneCounts(city);
    expect(counts[Zone.Residential]).toBe(8);
    expect(counts[Zone.Industrial]).toBe(3);
    expect(counts[Zone.Commercial]).toBe(0);
  });

  it('never paints over a road', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    zoneRect(city, Zone.Residential, 2, y - 1, 4, 3);
    for (let x = 2; x < 6; x++) {
      expect(city.roads[tileIndex(city, x, y)]).toBe(RoadType.Cobble);
      expect(city.zones[tileIndex(city, x, y)]).toBe(Zone.None);
    }
  });
});

/**
 * The canopy inside the walls.
 *
 * Land the city holds has been cleared. That is derived from ownership at
 * read time rather than written into the terrain, so these tests care as
 * much about what stays untouched as about what reads as zero.
 */
import { describe, expect, it } from 'vitest';
import {
  PARCEL_SIZE,
  createCity,
  parcelAt,
  parcelForTile,
  standingTreesOnTile,
  tileIndex,
  treeDensityAt,
} from '@/sim/city';
import { buyParcel, quoteParcel } from '@/sim/build';
import { computeLandValue } from '@/sim/services';
import { deserializeCity, serializeCity } from '@/sim/save';
import { makeFlatCity } from './helpers';

/** A wooded valley with a real generated map, so ownership is the only edit. */
function woodedCity() {
  return createCity({ width: 48, height: 48, seed: 'elwynn-canopy', startingGold: 200000 });
}

/** The first tile of a parcel. */
function parcelOrigin(px: number, py: number): { x: number; y: number } {
  return { x: px * PARCEL_SIZE, y: py * PARCEL_SIZE };
}

describe('treeDensityAt', () => {
  it('reads zero on land the city holds', () => {
    const city = makeFlatCity();
    city.map.treeDensity.fill(0.9);
    expect(treeDensityAt(city, 4, 4)).toBe(0);
  });

  it('leaves the wild canopy alone', () => {
    const city = makeFlatCity();
    city.map.treeDensity.fill(0.9);
    expect(treeDensityAt(city, 24, 24)).toBeCloseTo(0.9, 6);
  });

  it('does not mutate the terrain it is derived from', () => {
    const city = makeFlatCity();
    city.map.treeDensity.fill(0.9);
    treeDensityAt(city, 4, 4);
    expect(city.map.treeDensity[tileIndex(city, 4, 4)]).toBeCloseTo(0.9, 6);
  });

  it('reads zero off the edge of the map', () => {
    const city = makeFlatCity();
    city.map.treeDensity.fill(0.9);
    expect(treeDensityAt(city, -1, 4)).toBe(0);
    expect(treeDensityAt(city, 4, city.height)).toBe(0);
  });
});

describe('the founding district', () => {
  it('opens with no forest standing inside it', () => {
    const city = woodedCity();
    const { x: px, y: py } = city.map.foundingDistrict;
    let standing = 0;
    for (let oy = 0; oy < city.map.districtParcels * PARCEL_SIZE; oy++) {
      for (let ox = 0; ox < city.map.districtParcels * PARCEL_SIZE; ox++) {
        const x = px * PARCEL_SIZE + ox;
        const y = py * PARCEL_SIZE + oy;
        standing += standingTreesOnTile(city, x, y).length;
      }
    }
    expect(standing).toBe(0);
  });

  it('still has woodland beyond it to expand into', () => {
    const city = woodedCity();
    let wild = 0;
    for (let y = 0; y < city.height; y++) {
      for (let x = 0; x < city.width; x++) {
        if (!parcelForTile(city, x, y)?.owned) wild += standingTreesOnTile(city, x, y).length;
      }
    }
    expect(wild).toBeGreaterThan(0);
  });
});

describe('annexing a parcel', () => {
  it('clears the trees on the ground it takes', () => {
    const city = woodedCity();
    const { x: fx, y: fy } = city.map.foundingDistrict;

    // The first neighbouring parcel that can be bought and has trees on it.
    let target: { px: number; py: number } | null = null;
    for (const [px, py] of [
      [fx + city.map.districtParcels, fy],
      [fx - 1, fy],
      [fx, fy + city.map.districtParcels],
      [fx, fy - 1],
    ]) {
      if (!quoteParcel(city, px, py).ok) continue;
      const origin = parcelOrigin(px, py);
      let density = 0;
      for (let oy = 0; oy < PARCEL_SIZE; oy++) {
        for (let ox = 0; ox < PARCEL_SIZE; ox++) {
          density += treeDensityAt(city, origin.x + ox, origin.y + oy);
        }
      }
      if (density > 0) {
        target = { px, py };
        break;
      }
    }
    expect(target).not.toBeNull();
    if (!target) return;
    const { px, py } = target;
    const origin = parcelOrigin(px, py);
    const rawDensity = city.map.treeDensity[tileIndex(city, origin.x, origin.y)];

    expect(buyParcel(city, px, py).ok).toBe(true);

    let standing = 0;
    for (let oy = 0; oy < PARCEL_SIZE; oy++) {
      for (let ox = 0; ox < PARCEL_SIZE; ox++) {
        standing += standingTreesOnTile(city, origin.x + ox, origin.y + oy).length;
      }
    }
    expect(standing).toBe(0);
    // The land itself is unchanged: only who holds it moved.
    expect(city.map.treeDensity[tileIndex(city, origin.x, origin.y)]).toBeCloseTo(rawDensity, 6);
  });
});

describe('saving and loading', () => {
  it('keeps the felled land felled, and the wild canopy wild', () => {
    const city = woodedCity();
    const wild: { x: number; y: number; density: number }[] = [];
    for (let y = 0; y < city.height; y += 5) {
      for (let x = 0; x < city.width; x += 5) {
        wild.push({ x, y, density: treeDensityAt(city, x, y) });
      }
    }

    const loaded = deserializeCity(JSON.parse(JSON.stringify(serializeCity(city))));

    for (const sample of wild) {
      expect(treeDensityAt(loaded, sample.x, sample.y)).toBeCloseTo(sample.density, 6);
    }

    const { x: px, y: py } = loaded.map.foundingDistrict;
    const origin = parcelOrigin(px, py);
    expect(treeDensityAt(loaded, origin.x, origin.y)).toBe(0);
    expect(standingTreesOnTile(loaded, origin.x, origin.y)).toHaveLength(0);
  });
});

describe('land value', () => {
  /** Land value eases toward its target, so settle it before reading. */
  function settledValue(density: number, x: number, y: number): number {
    const city = makeFlatCity();
    city.map.treeDensity.fill(density);
    for (let i = 0; i < 40; i++) computeLandValue(city);
    return city.landValue[tileIndex(city, x, y)];
  }

  it('pays no amenity for a forest that was felled to build on', () => {
    // Tile (4,4) is inside the owned block.
    expect(settledValue(1, 4, 4)).toBeCloseTo(settledValue(0, 4, 4), 6);
  });

  it('still pays it for standing woodland outside the walls', () => {
    expect(settledValue(1, 24, 24)).toBeGreaterThan(settledValue(0, 24, 24));
  });
});

describe('ownership is the only thing that clears land', () => {
  it('brings the trees back if a parcel is somehow given up', () => {
    const city = makeFlatCity();
    city.map.treeDensity.fill(0.9);
    const parcel = parcelAt(city, 0, 0);
    expect(parcel?.owned).toBe(true);
    expect(treeDensityAt(city, 4, 4)).toBe(0);
    parcel!.owned = false;
    expect(treeDensityAt(city, 4, 4)).toBeCloseTo(0.9, 6);
  });
});

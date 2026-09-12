/** The pure parts of the renderer: projection, palette maths and the camera. */
import { describe, expect, it } from 'vitest';
import {
  ELEVATION_STEP,
  HALF_HEIGHT,
  HALF_WIDTH,
  TILE_HEIGHT,
  TILE_WIDTH,
  depthOf,
  tileDiamond,
  tileRectBounds,
  tileToWorld,
  worldToTile,
} from '@/render/iso';
import { PALETTE, ROOF_SETS, hexToRgb, mix, rgbToHex, shade, withAlpha } from '@/render/palette';
import { Camera, MAX_ZOOM, MIN_ZOOM } from '@/render/camera';
import { buildingDepth, directionOf, sampleElevation, scatterDepth } from '@/render/renderer';
import {
  expand,
  footprintCorners,
  gableRidge,
  hipApex,
  leftToRight,
  midpoint,
  raise,
} from '@/render/shapes';
import { makeFlatCity } from './helpers';
import { tileIndex } from '@/sim/city';

describe('isometric projection', () => {
  it('keeps the classic 2:1 diamond', () => {
    expect(TILE_WIDTH / TILE_HEIGHT).toBe(2);
    expect(HALF_WIDTH).toBe(TILE_WIDTH / 2);
    expect(HALF_HEIGHT).toBe(TILE_HEIGHT / 2);
  });

  it('puts the origin tile at the origin', () => {
    expect(tileToWorld(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('sends tile +x down-right and tile +y down-left', () => {
    expect(tileToWorld(1, 0)).toEqual({ x: HALF_WIDTH, y: HALF_HEIGHT });
    expect(tileToWorld(0, 1)).toEqual({ x: -HALF_WIDTH, y: HALF_HEIGHT });
  });

  it('lifts higher ground up the screen', () => {
    expect(tileToWorld(3, 3, 2).y).toBe(tileToWorld(3, 3, 0).y - 2 * ELEVATION_STEP);
  });

  it('round-trips through worldToTile at a known elevation', () => {
    for (const point of [{ x: 0, y: 0 }, { x: 7, y: 3 }, { x: 12, y: 40 }]) {
      for (const elevation of [0, 3, 7]) {
        const world = tileToWorld(point.x, point.y, elevation);
        const back = worldToTile(world.x, world.y, elevation);
        expect(back.x).toBeCloseTo(point.x, 6);
        expect(back.y).toBeCloseTo(point.y, 6);
      }
    }
  });

  it('draws a diamond around the tile centre', () => {
    const corners = tileDiamond(2, 5, 1);
    const centre = tileToWorld(2, 5, 1);
    expect(corners).toHaveLength(4);
    expect(corners[0]).toEqual({ x: centre.x, y: centre.y - HALF_HEIGHT });
    expect(corners[1]).toEqual({ x: centre.x + HALF_WIDTH, y: centre.y });
    expect(corners[2]).toEqual({ x: centre.x, y: centre.y + HALF_HEIGHT });
    expect(corners[3]).toEqual({ x: centre.x - HALF_WIDTH, y: centre.y });
  });

  it('orders depth so nearer tiles sort later', () => {
    expect(depthOf(1, 1)).toBeGreaterThan(depthOf(0, 1));
    expect(depthOf(0, 2)).toBe(depthOf(1, 1));
    // Height breaks the tie, so a building on a hill draws over the slope.
    expect(depthOf(1, 1, 2)).toBeGreaterThan(depthOf(1, 1, 0));
  });

  it('bounds a rectangle of tiles', () => {
    const bounds = tileRectBounds(0, 0, 2, 2);
    expect(bounds.left).toBeLessThan(bounds.right);
    expect(bounds.top).toBeLessThan(bounds.bottom);
    expect(bounds.right - bounds.left).toBeGreaterThanOrEqual(2 * TILE_WIDTH);
  });
});

describe('palette maths', () => {
  it('round-trips hex and rgb', () => {
    for (const hex of ['#000000', '#ffffff', '#2c6bae', '#e8be55']) {
      const { r, g, b } = hexToRgb(hex);
      expect(rgbToHex(r, g, b)).toBe(hex);
    }
  });

  it('lightens and darkens without leaving the range', () => {
    for (const hex of [PALETTE.grass, PALETTE.roofBlue, '#000000', '#ffffff']) {
      for (const amount of [-1, -0.4, 0, 0.4, 1]) {
        const result = shade(hex, amount);
        expect(result).toMatch(/^#[0-9a-f]{6}$/);
        const { r, g, b } = hexToRgb(result);
        for (const channel of [r, g, b]) {
          expect(channel).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(255);
        }
      }
    }
    expect(shade('#808080', 1)).toBe('#ffffff');
    expect(shade('#808080', -1)).toBe('#000000');
  });

  it('mixes between two colours', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('writes an rgba string', () => {
    expect(withAlpha('#2c6bae', 0.5)).toBe('rgba(44, 107, 174, 0.5)');
  });

  it('gives every roof set a light, main and dark tone in order', () => {
    for (const set of Object.values(ROOF_SETS)) {
      const light = hexToRgb(set.light);
      const main = hexToRgb(set.main);
      const dark = hexToRgb(set.dark);
      const luma = (c: { r: number; g: number; b: number }) => c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
      expect(luma(light)).toBeGreaterThan(luma(main));
      expect(luma(main)).toBeGreaterThan(luma(dark));
    }
  });
});

describe('camera', () => {
  function camera(): Camera {
    const cam = new Camera();
    cam.resize(800, 600);
    cam.setWorldBounds(100, 100);
    return cam;
  }

  it('maps world to screen and back', () => {
    const cam = camera();
    cam.zoom = 1.3;
    cam.centreOnTile(30, 30);
    const screen = cam.worldToScreen(120, -40);
    const world = cam.screenToWorld(screen.x, screen.y);
    expect(world.x).toBeCloseTo(120, 6);
    expect(world.y).toBeCloseTo(-40, 6);
  });

  it('puts its centre at the middle of the viewport', () => {
    const cam = camera();
    cam.centreOnTile(20, 20);
    const centre = cam.worldToScreen(cam.x, cam.y);
    expect(centre.x).toBeCloseTo(400, 6);
    expect(centre.y).toBeCloseTo(300, 6);
  });

  it('pans opposite to the drag, so the map follows the finger', () => {
    const cam = camera();
    cam.centreOnTile(50, 50);
    const before = cam.x;
    cam.panByScreen(100, 0);
    expect(cam.x).toBeLessThan(before);
  });

  it('keeps the point under a pinch fixed while zooming', () => {
    const cam = camera();
    cam.centreOnTile(50, 50);
    const anchor = { x: 600, y: 200 };
    const before = cam.screenToWorld(anchor.x, anchor.y);
    cam.zoomAt(anchor.x, anchor.y, 1.6);
    const after = cam.screenToWorld(anchor.x, anchor.y);
    expect(after.x).toBeCloseTo(before.x, 4);
    expect(after.y).toBeCloseTo(before.y, 4);
  });

  it('clamps the zoom range', () => {
    const cam = camera();
    for (let i = 0; i < 40; i++) cam.zoomAt(400, 300, 2);
    expect(cam.zoom).toBe(MAX_ZOOM);
    for (let i = 0; i < 80; i++) cam.zoomAt(400, 300, 0.5);
    expect(cam.zoom).toBe(MIN_ZOOM);
  });

  it('will not wander far off the map', () => {
    const cam = camera();
    for (let i = 0; i < 200; i++) cam.panByScreen(500, 500);
    const bounds = cam.visibleWorldRect();
    expect(Number.isFinite(bounds.left)).toBe(true);
    expect(cam.x).toBeGreaterThan(-1e6);
  });

  it('reports a visible tile range inside the map', () => {
    const cam = camera();
    cam.centreOnTile(50, 50);
    const range = cam.visibleTileRect(100, 100);
    expect(range.x0).toBeGreaterThanOrEqual(0);
    expect(range.y0).toBeGreaterThanOrEqual(0);
    expect(range.x1).toBeLessThanOrEqual(99);
    expect(range.y1).toBeLessThanOrEqual(99);
    expect(range.x1).toBeGreaterThan(range.x0);
  });

  it('culls boxes outside the view', () => {
    const cam = camera();
    cam.centreOnTile(50, 50);
    expect(cam.isVisible(cam.x - 10, cam.y - 10, cam.x + 10, cam.y + 10)).toBe(true);
    expect(cam.isVisible(cam.x + 1e5, cam.y, cam.x + 1e5 + 10, cam.y + 10)).toBe(false);
  });
});

describe('draw order', () => {
  it('sorts a multi-tile building on its far corner, not its anchor', () => {
    const hall = { x: 5, y: 5, width: 3, height: 3 };
    // The anchor has the smallest x + y of the nine tiles it covers, so
    // sorting there loses to everything standing on the other eight.
    expect(buildingDepth(hall, 0)).toBeGreaterThan(depthOf(hall.x, hall.y));
    expect(buildingDepth(hall, 0)).toBe(depthOf(7, 7));
    for (const covered of [[6, 5], [5, 6], [6, 6], [7, 6], [6, 7]]) {
      expect(buildingDepth(hall, 0)).toBeGreaterThan(depthOf(covered[0], covered[1]));
    }
  });

  it('leaves a one-tile building sorting exactly where it stands', () => {
    expect(buildingDepth({ x: 4, y: 9, width: 1, height: 1 }, 2)).toBe(depthOf(4, 9, 2));
  });

  it('keeps height in the sort key', () => {
    expect(buildingDepth({ x: 3, y: 3, width: 1, height: 1 }, 4)).toBeGreaterThan(
      buildingDepth({ x: 3, y: 3, width: 1, height: 1 }, 0),
    );
  });

  it('sorts a tree from where it actually stands within its tile', () => {
    const south = scatterDepth(4, 4, { ox: 0, oy: 0.35 }, 0);
    const centre = scatterDepth(4, 4, { ox: 0, oy: 0 }, 0);
    const north = scatterDepth(4, 4, { ox: 0, oy: -0.35 }, 0);
    // Nudged toward the south corner it stands in front of its own tile.
    expect(south).toBeGreaterThan(centre);
    expect(north).toBeLessThan(centre);
    expect(centre).toBe(depthOf(4, 4));
  });

  it('does not change a tree’s depth when it is nudged along its own diagonal', () => {
    // East-west on screen moves a tree along the diagonal it already sorts
    // on, so its depth must not move with it.
    expect(scatterDepth(4, 4, { ox: 0.4, oy: 0 }, 0)).toBeCloseTo(depthOf(4, 4), 6);
    expect(scatterDepth(4, 4, { ox: -0.4, oy: 0 }, 0)).toBeCloseTo(depthOf(4, 4), 6);
  });

  it('separates two people standing on the same tile', () => {
    // Both round to tile (6, 6); their order must come from where they are,
    // not from whichever happens to sit earlier in the agent array.
    expect(depthOf(6.4, 6.4, 0)).toBeGreaterThan(depthOf(5.6, 5.6, 0));
  });
});

describe('sampling height under a walker', () => {
  it('reads the tile height on flat ground', () => {
    const city = makeFlatCity();
    expect(sampleElevation(city, 4, 4)).toBe(1);
    expect(sampleElevation(city, 4.5, 4.5)).toBe(1);
  });

  it('rises smoothly across a step instead of popping at the boundary', () => {
    const city = makeFlatCity();
    city.map.elevation[tileIndex(city, 5, 4)] = 5;
    // Walking from (4,4) at height 1 to (5,4) at height 5.
    expect(sampleElevation(city, 4, 4)).toBe(1);
    expect(sampleElevation(city, 4.5, 4)).toBeCloseTo(3, 6);
    expect(sampleElevation(city, 5, 4)).toBe(5);
    // Monotonic all the way across, so the sprite never jumps.
    let previous = -Infinity;
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const height = sampleElevation(city, 4 + t, 4);
      expect(height).toBeGreaterThanOrEqual(previous);
      previous = height;
    }
  });

  it('stays inside the map at the edges', () => {
    const city = makeFlatCity();
    expect(Number.isFinite(sampleElevation(city, 0, 0))).toBe(true);
    expect(Number.isFinite(sampleElevation(city, city.width - 0.2, city.height - 0.2))).toBe(true);
  });
});

describe('agent facing', () => {
  it('maps a heading onto one of the four drawn directions', () => {
    // Tile +x reads as south-east on screen, tile +y as south-west.
    expect(directionOf(0)).toBe(1);
    expect(directionOf(Math.PI / 2)).toBe(2);
    expect(directionOf(Math.PI)).toBe(3);
    expect(directionOf(-Math.PI / 2)).toBe(0);
  });

  it('always returns a drawable direction', () => {
    for (let angle = -Math.PI; angle <= Math.PI; angle += 0.05) {
      const direction = directionOf(angle);
      expect(direction).toBeGreaterThanOrEqual(0);
      expect(direction).toBeLessThan(4);
    }
  });
});

describe('roof geometry', () => {
  // The plate a roof is built on: a 2x2 footprint with 30px walls.
  const top = raise(footprintCorners(2, 2), 30);
  const roofHeight = 18;
  const overhang = 5;

  it('runs a gable ridge between the midpoints of the edges it spans', () => {
    const [north, east, south, west] = expand(top, overhang);
    const along = gableRidge(top, roofHeight, 0, overhang);
    expect(along.start.x).toBeCloseTo(midpoint(north, west).x, 6);
    expect(along.start.y).toBeCloseTo(midpoint(north, west).y - roofHeight, 6);
    expect(along.end.x).toBeCloseTo(midpoint(east, south).x, 6);

    const across = gableRidge(top, roofHeight, 1, overhang);
    expect(across.start.x).toBeCloseTo(midpoint(north, east).x, 6);
    expect(across.end.x).toBeCloseTo(midpoint(west, south).x, 6);
  });

  it('peaks a gable over the middle of the roof, whichever way the ridge runs', () => {
    // A stack stands on the ridge, so the ridge has to be over the house
    // rather than out on an edge: its middle is the very point a hip roof
    // of the same pitch peaks at.
    const [, east, , west] = expand(top, overhang);
    const apex = hipApex(top, roofHeight, overhang);
    for (const axis of [0, 1] as const) {
      const { start, end } = gableRidge(top, roofHeight, axis, overhang);
      expect(midpoint(start, end).x).toBeCloseTo(apex.x, 6);
      expect(midpoint(start, end).y).toBeCloseTo(apex.y, 6);
      for (const point of [start, end]) {
        expect(point.x).toBeGreaterThan(west.x);
        expect(point.x).toBeLessThan(east.x);
      }
    }
  });

  it('puts a hip roof apex over the centre of the eaves', () => {
    const eaves = expand(top, overhang);
    const apex = hipApex(top, roofHeight, overhang);
    expect(apex.x).toBeCloseTo((eaves[1].x + eaves[3].x) / 2, 6);
    expect(apex.y).toBeCloseTo((eaves[0].y + eaves[2].y) / 2 - roofHeight, 6);
    // Above the near eave, so a stack mounted behind the peak still shows.
    expect(apex.y).toBeLessThan(eaves[2].y);
  });

  it('orders a roofline left to right, whichever way the ridge runs', () => {
    const eaves = expand(top, overhang);
    for (const axis of [0, 1] as const) {
      const { start, end } = gableRidge(top, roofHeight, axis, overhang);
      const line = leftToRight([eaves[3], start, end, eaves[1]]);
      for (let i = 1; i < line.length; i++) {
        expect(line[i].x).toBeGreaterThanOrEqual(line[i - 1].x);
      }
      // The ends of the line are the eaves; the ridge is what sits between.
      expect(line[0]).toBe(eaves[3]);
      expect(line[3]).toBe(eaves[1]);
    }
  });
});

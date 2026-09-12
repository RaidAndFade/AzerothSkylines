/**
 * The pure parts of the renderer: world-space maths, the camera, the colour
 * helpers, and the geometry kit everything in the valley is built from.
 * Nothing here needs a browser or a GL context.
 */
import { describe, expect, it } from 'vitest';
import {
  MeshBuilder,
  blend,
  box,
  colour,
  cone,
  lathe,
  point,
  ridgedRoof,
  spheroid,
  tone,
} from '@/render/meshBuilder';
import { PALETTE, ROOF_SETS, hexToRgb, mix, rgbToHex, shade, withAlpha } from '@/render/palette';
import { Camera, MAX_ZOOM, MIN_ZOOM, REFERENCE_DISTANCE } from '@/render/camera';
import { boxInFrustum, frustumPlanes, lookAt, mat4, multiply, perspective, transformPoint } from '@/render/mat4';
import { groundAt, highestGround, lowestGround, tileCentre, tileAt } from '@/render/world';
import {
  MAX_GROUND_SLOPE,
  TERRAIN_HEIGHT,
  WATER_HEIGHT,
  generateWorld,
  surfaceHeight,
  surfaceNormal,
  tileHeight,
} from '@/sim/terrain';
import { makeFlatCity } from './helpers';
import { tileIndex } from '@/sim/city';

describe('world space', () => {
  it('puts a tile centre at the middle of its own square', () => {
    expect(tileCentre(0, 0)).toEqual({ x: 0.5, z: 0.5 });
    expect(tileCentre(4, 7)).toEqual({ x: 4.5, z: 7.5 });
  });

  it('maps a world position back to the tile it falls in', () => {
    expect(tileAt(0.1, 0.9)).toEqual({ x: 0, y: 0 });
    expect(tileAt(4.5, 7.5)).toEqual({ x: 4, y: 7 });
    expect(tileAt(4.999, 7.001)).toEqual({ x: 4, y: 7 });
  });

  it('reads the ground under a tile from the height field', () => {
    const city = makeFlatCity();
    // makeFlatCity levels the whole valley at half the height range.
    expect(groundAt(city.map, 5, 5)).toBeCloseTo(TERRAIN_HEIGHT * 0.5, 4);
    expect(tileHeight(city.map, 5, 5)).toBeCloseTo(TERRAIN_HEIGHT * 0.5, 4);
  });

  it('brackets a footprint between its highest and lowest ground', () => {
    const city = makeFlatCity();
    city.map.heightField[tileIndex(city, 6, 6)] = 0.7;
    const high = highestGround(city.map, 4, 4, 4, 4);
    const low = lowestGround(city.map, 4, 4, 4, 4);
    expect(high).toBeGreaterThan(low);
    expect(low).toBeLessThanOrEqual(TERRAIN_HEIGHT * 0.5 + 1e-6);
  });
});

describe('the ground surface', () => {
  const world = generateWorld({ width: 64, height: 64, seed: 'render-valley' });

  it('has no slope anywhere steeper than the cap, so there are no cliffs', () => {
    for (let y = 0; y < world.height - 1; y++) {
      for (let x = 0; x < world.width - 1; x++) {
        const here = tileHeight(world, x, y);
        expect(Math.abs(tileHeight(world, x + 1, y) - here)).toBeLessThanOrEqual(MAX_GROUND_SLOPE + 1e-4);
        expect(Math.abs(tileHeight(world, x, y + 1) - here)).toBeLessThanOrEqual(MAX_GROUND_SLOPE + 1e-4);
      }
    }
  });

  it('is continuous: no step between one sample and the next', () => {
    let worst = 0;
    for (let y = 4; y < 40; y++) {
      for (let x = 4; x < 40; x++) {
        for (let t = 0; t < 1; t += 0.125) {
          const a = surfaceHeight(world, x + t, y + 0.5);
          const b = surfaceHeight(world, x + t + 0.125, y + 0.5);
          worst = Math.max(worst, Math.abs(b - a) * 8);
        }
      }
    }
    // The spline may overshoot the tile-to-tile cap a little, but nowhere
    // near enough to read as a step, let alone a cliff.
    expect(worst).toBeLessThan(MAX_GROUND_SLOPE * 1.6);
  });

  it('passes exactly through the height field at tile centres', () => {
    for (const [x, y] of [[10, 10], [21, 33], [50, 7]]) {
      expect(surfaceHeight(world, x + 0.5, y + 0.5)).toBeCloseTo(
        world.heightField[y * world.width + x] * TERRAIN_HEIGHT,
        4,
      );
    }
  });

  it('gives every point an upward normal', () => {
    for (let y = 2; y < 60; y += 7) {
      for (let x = 2; x < 60; x += 7) {
        const normal = surfaceNormal(world, x + 0.5, y + 0.5);
        expect(normal.y).toBeGreaterThan(0.6);
        expect(Math.hypot(normal.x, normal.y, normal.z)).toBeCloseTo(1, 5);
      }
    }
  });

  it('clamps at the edges rather than falling away', () => {
    expect(surfaceHeight(world, -20, -20)).toBeCloseTo(surfaceHeight(world, 0.5, 0.5), 4);
    expect(Number.isFinite(surfaceHeight(world, world.width + 40, world.height + 40))).toBe(true);
  });

  it('puts the waterline where the terrain generator says it is', () => {
    expect(WATER_HEIGHT).toBeGreaterThan(0);
    expect(WATER_HEIGHT).toBeLessThan(TERRAIN_HEIGHT);
  });
});

describe('palette', () => {
  it('round-trips hex and rgb', () => {
    for (const hex of ['#000000', '#ffffff', '#3f6b72', '#c9a227']) {
      const { r, g, b } = hexToRgb(hex);
      expect(rgbToHex(r, g, b)).toBe(hex);
    }
  });

  it('lightens and darkens without leaving the range', () => {
    for (const hex of [PALETTE.grass, PALETTE.thatch, '#000000', '#ffffff']) {
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
    expect(withAlpha('#3f6b72', 0.5)).toBe('rgba(63, 107, 114, 0.5)');
  });

  it('gives every roofing a light, main and dark tone in order', () => {
    for (const set of Object.values(ROOF_SETS)) {
      const luma = (hex: string): number => {
        const c = hexToRgb(hex);
        return c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
      };
      expect(luma(set.light)).toBeGreaterThan(luma(set.main));
      expect(luma(set.main)).toBeGreaterThan(luma(set.dark));
    }
  });

  it('stays muted, as a fourteenth-century landscape was', () => {
    // Nothing in the ground or the buildings should be a saturated primary.
    const earthy = [
      PALETTE.grass, PALETTE.meadow, PALETTE.thatch, PALETTE.tile,
      PALETTE.limewash, PALETTE.oak, PALETTE.water, PALETTE.stoneSlate,
    ];
    for (const hex of earthy) {
      const { r, g, b } = hexToRgb(hex);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const saturation = max === 0 ? 0 : (max - min) / max;
      expect(saturation, hex).toBeLessThan(0.62);
    }
  });

  it('converts to linear light monotonically', () => {
    const dark = colour('#202020');
    const light = colour('#e0e0e0');
    expect(light.r).toBeGreaterThan(dark.r);
    expect(tone(dark, 0.5).r).toBeGreaterThan(dark.r);
    expect(tone(light, -0.5).r).toBeLessThan(light.r);
    expect(blend(dark, light, 0).r).toBeCloseTo(dark.r, 6);
    expect(blend(dark, light, 1).r).toBeCloseTo(light.r, 6);
  });
});

describe('camera', () => {
  function camera(): Camera {
    const cam = new Camera();
    cam.resize(800, 600);
    cam.setWorldBounds(100, 100);
    cam.centreOnTile(50, 50);
    cam.update();
    return cam;
  }

  it('reads zoom as the inverse of distance', () => {
    const cam = camera();
    cam.distance = REFERENCE_DISTANCE;
    expect(cam.zoom).toBeCloseTo(1, 6);
    cam.zoom = 2;
    expect(cam.distance).toBeCloseTo(REFERENCE_DISTANCE / 2, 6);
  });

  it('projects a world point and finds it again on the ground', () => {
    const cam = camera();
    const screen = cam.worldToScreen(50.5, cam.groundHeight, 50.5);
    expect(screen.behind).toBe(false);
    // The target is by definition at the middle of the viewport.
    expect(screen.x).toBeCloseTo(400, 3);
    expect(screen.y).toBeCloseTo(300, 3);
  });

  it('sends the ray through the middle of the screen at the target', () => {
    const cam = camera();
    const hit = cam.groundPoint(400, 300);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBeCloseTo(cam.x, 2);
    expect(hit!.z).toBeCloseTo(cam.z, 2);
  });

  it('keeps its axes orthonormal however it is turned', () => {
    const cam = camera();
    for (const yaw of [0, 1, -2.4, 3.1]) {
      for (const pitch of [0.2, 0.7, 1.3]) {
        cam.yaw = yaw;
        cam.pitch = pitch;
        const { forward, right, up } = cam.basis();
        for (const v of [forward, right, up]) {
          expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 6);
        }
        expect(forward.x * right.x + forward.y * right.y + forward.z * right.z).toBeCloseTo(0, 6);
        expect(forward.x * up.x + forward.y * up.y + forward.z * up.z).toBeCloseTo(0, 6);
        expect(right.x * up.x + right.y * up.y + right.z * up.z).toBeCloseTo(0, 6);
      }
    }
  });

  it('pans so the country follows the finger', () => {
    const cam = camera();
    cam.yaw = 0;
    cam.pitch = Math.PI / 2 - 0.001;
    const before = { x: cam.x, z: cam.z };
    cam.panByScreen(60, 0);
    // Looking down the +Z axis, screen right is -X, so the target goes +X.
    expect(cam.x).toBeGreaterThan(before.x);
    cam.panByScreen(-60, 0);
    expect(cam.x).toBeCloseTo(before.x, 4);
    cam.panByScreen(0, 60);
    expect(cam.z).toBeGreaterThan(before.z);
  });

  it('turns with an orbit drag and keeps the tilt in range', () => {
    const cam = camera();
    const yaw = cam.yaw;
    cam.orbitByScreen(100, 0);
    expect(cam.yaw).not.toBeCloseTo(yaw, 3);
    for (let i = 0; i < 200; i++) cam.orbitByScreen(0, 100);
    expect(cam.pitch).toBeLessThanOrEqual(1.4);
    for (let i = 0; i < 400; i++) cam.orbitByScreen(0, -100);
    expect(cam.pitch).toBeGreaterThanOrEqual(0.17);
  });

  it('clamps how far in and out it will go', () => {
    const cam = camera();
    for (let i = 0; i < 40; i++) cam.zoomAt(400, 300, 2);
    expect(cam.zoom).toBeCloseTo(MAX_ZOOM, 5);
    for (let i = 0; i < 80; i++) cam.zoomAt(400, 300, 0.5);
    expect(cam.zoom).toBeCloseTo(MIN_ZOOM, 5);
  });

  it('will not wander far off the valley', () => {
    const cam = camera();
    for (let i = 0; i < 200; i++) cam.panByScreen(500, 500);
    expect(cam.x).toBeLessThanOrEqual(106);
    expect(cam.z).toBeLessThanOrEqual(106);
    for (let i = 0; i < 400; i++) cam.panByScreen(-500, -500);
    expect(cam.x).toBeGreaterThanOrEqual(-6);
    expect(cam.z).toBeGreaterThanOrEqual(-6);
  });

  it('rides the relief, so a hill does not put the town off screen', () => {
    const city = makeFlatCity();
    const cam = new Camera();
    cam.resize(800, 600);
    cam.setWorldBounds(city.width, city.height, city.map);
    cam.centreOnTile(5, 5);
    const low = cam.groundHeight;
    city.map.heightField.fill(0.8);
    cam.centreOnTile(6, 6);
    expect(cam.groundHeight).toBeGreaterThan(low);
  });
});

describe('frustum culling', () => {
  it('keeps what is in front of the camera and drops what is behind', () => {
    const view = mat4();
    const projection = mat4();
    const viewProjection = mat4();
    perspective(projection, 0.86, 4 / 3, 0.6, 400);
    lookAt(view, { x: 0, y: 10, z: -20 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    multiply(viewProjection, projection, view);
    const planes = frustumPlanes(viewProjection, new Float32Array(24));

    expect(boxInFrustum(planes, -2, -1, -2, 2, 3, 2)).toBe(true);
    // Well behind the eye.
    expect(boxInFrustum(planes, -2, -1, -80, 2, 3, -70)).toBe(false);
    // Far out to one side.
    expect(boxInFrustum(planes, 400, -1, -2, 420, 3, 2)).toBe(false);
  });

  it('projects a point to the middle of the view when it is the target', () => {
    const view = mat4();
    const projection = mat4();
    const viewProjection = mat4();
    perspective(projection, 0.86, 1, 0.6, 400);
    lookAt(view, { x: 0, y: 10, z: -20 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    multiply(viewProjection, projection, view);
    const p = transformPoint(viewProjection, 0, 0, 0);
    expect(p.x / p.w).toBeCloseTo(0, 6);
    expect(p.y / p.w).toBeCloseTo(0, 6);
    expect(p.w).toBeGreaterThan(0);
  });
});

describe('the geometry kit', () => {
  it('writes ten floats per vertex and three indices per triangle', () => {
    const mesh = new MeshBuilder(8, 8);
    mesh.tri(point(0, 0, 0), point(1, 0, 0), point(0, 0, 1), colour('#ffffff'));
    expect(mesh.vertexData()).toHaveLength(30);
    expect(mesh.indexData()).toHaveLength(3);
  });

  it('tracks the bounds of everything it is given', () => {
    const mesh = new MeshBuilder();
    box(mesh, 2, 1, 3, 2, 4, 2, colour(PALETTE.limewash));
    expect(mesh.minX).toBeCloseTo(1, 5);
    expect(mesh.maxX).toBeCloseTo(3, 5);
    expect(mesh.minY).toBeCloseTo(1, 5);
    expect(mesh.maxY).toBeCloseTo(5, 5);
    expect(mesh.minZ).toBeCloseTo(2, 5);
    expect(mesh.maxZ).toBeCloseTo(4, 5);
  });

  it('gives every vertex a unit normal', () => {
    const mesh = new MeshBuilder();
    box(mesh, 0, 0, 0, 1, 1, 1, colour(PALETTE.oak), { taper: 0.2 });
    lathe(mesh, 0, 0, [{ y: 0, radius: 0.4 }, { y: 1, radius: 0.2 }], 8, colour(PALETTE.rubble), {
      capTop: true,
      capBottom: true,
    });
    spheroid(mesh, 0, 2, 0, 0.5, 0.4, 8, 4, colour(PALETTE.canopy));
    cone(mesh, 0, 3, 0, 0.4, 0.8, 8, colour(PALETTE.lead));
    ridgedRoof(mesh, 0, 4, 0, 2, 1.4, 0.7, 0.3, colour(PALETTE.thatch), { ridgeColour: colour(PALETTE.thatchLight) });

    const data = mesh.vertexData();
    for (let i = 0; i < data.length; i += 10) {
      const length = Math.hypot(data[i + 3], data[i + 4], data[i + 5]);
      expect(length).toBeCloseTo(1, 4);
      // Occlusion is a weight, so it has to stay in range.
      expect(data[i + 9]).toBeGreaterThanOrEqual(0);
      expect(data[i + 9]).toBeLessThanOrEqual(1);
    }
  });

  it('indexes only vertices it has written', () => {
    const mesh = new MeshBuilder();
    spheroid(mesh, 0, 0, 0, 1, 1, 9, 5, colour(PALETTE.canopy));
    const vertices = mesh.vertexData().length / 10;
    for (const index of mesh.indexData()) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(vertices);
    }
  });

  it('gives a gable roof vertical ends and a hipped one sloping ones', () => {
    const gable = new MeshBuilder();
    ridgedRoof(gable, 0, 0, 0, 2, 1, 0.8, 0, colour(PALETTE.thatch));
    const hip = new MeshBuilder();
    ridgedRoof(hip, 0, 0, 0, 2, 1, 0.8, 1, colour(PALETTE.thatch));
    // A full hip pulls the ridge in to a point, so its ridge is shorter.
    expect(ridgeLength(hip)).toBeLessThan(ridgeLength(gable));
    expect(ridgeLength(gable)).toBeGreaterThan(1.5);
  });

  it('oversails the eaves past the wall below, so a house is not a box', () => {
    const mesh = new MeshBuilder();
    ridgedRoof(mesh, 0, 0, 0, 2, 2, 0.8, 0, colour(PALETTE.thatch), { overhang: 0.2 });
    expect(mesh.maxX).toBeGreaterThan(1.05);
    expect(mesh.maxZ).toBeGreaterThan(1.05);
  });

  it('stamps a template in scaled and turned, and keeps its size', () => {
    const template = new MeshBuilder();
    // A lathe is inscribed in its radius, so measure against the template
    // rather than against the ideal sphere it approximates.
    spheroid(template, 0, 0, 0, 1, 1, 10, 5, colour(PALETTE.canopy));

    const world = new MeshBuilder();
    world.appendTransformed(template, 5, 2, 7, 1.1, 2, 0);
    // Height is unaffected by a turn about the vertical axis.
    expect(world.maxY - world.minY).toBeCloseTo((template.maxY - template.minY) * 2, 5);
    expect(world.minY).toBeCloseTo(2 + template.minY * 2, 5);
    // And the plan is a rotation, so its radius about the stamp is preserved.
    const data = world.vertexData();
    let widest = 0;
    for (let i = 0; i < data.length; i += 10) {
      widest = Math.max(widest, Math.hypot(data[i] - 5, data[i + 2] - 7));
      expect(Math.hypot(data[i + 3], data[i + 4], data[i + 5])).toBeCloseTo(1, 4);
    }
    expect(widest).toBeCloseTo(Math.max(template.maxX, template.maxZ) * 2, 5);
  });
});

/** How long the ridge of a roof mesh is, along its longest axis. */
function ridgeLength(mesh: MeshBuilder): number {
  const data = mesh.vertexData();
  let top = -Infinity;
  for (let i = 0; i < data.length; i += 10) top = Math.max(top, data[i + 1]);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < data.length; i += 10) {
    if (data[i + 1] < top - 1e-4) continue;
    min = Math.min(min, data[i]);
    max = Math.max(max, data[i]);
  }
  return max - min;
}

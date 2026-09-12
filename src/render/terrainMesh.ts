/**
 * The ground, as geometry.
 *
 * The valley is one continuous surface. Its vertices are taken from the
 * spline in `sim/terrain`, several to a tile, and their normals from the
 * same spline rather than from the triangles, so neighbouring chunks meet
 * without a seam and no tile edge ever shows as a crease. Colour is
 * interpolated between tile classes for the same reason: a hard boundary
 * between grass and woodland would put the grid straight back on screen.
 *
 * Nothing here steps. The generator has already capped every gradient, so
 * the surface this builds is walkable everywhere — there is no cliff face to
 * draw, and so no cliff geometry in this file.
 */
import { Terrain, isWater } from '../sim/types';
import {
  WATER_HEIGHT,
  WorldMap,
  surfaceHeight,
  surfaceNormal,
} from '../sim/terrain';
import { MeshBuilder, Rgb, blend, colour, tone } from './meshBuilder';
import { PALETTE } from './palette';
import { clamp01, lerp, smoothstep } from '../core/math';
import { hash2 } from '../core/rng';

/** Tiles along one edge of a mesh chunk. */
export const CHUNK_TILES = 16;
/**
 * Vertices per tile edge. Two is enough over the valley itself; the country
 * carried out to the horizon is built at one, since nobody is ever standing
 * on it and the haze has most of it anyway.
 */
export const NEAR_SUBDIVISIONS = 2;
export const FAR_SUBDIVISIONS = 1;

/**
 * How far past the valley the ground is carried. Far enough that the eye
 * never finds the edge of the world: at the widest view the haze closes in
 * well before the country runs out.
 */
export const WORLD_MARGIN = 112;

/** The ground colour of each terrain class, and what shows through on a slope. */
interface GroundTone {
  flat: string;
  steep: string;
}

const GROUND_TONES: Record<Terrain, GroundTone> = {
  [Terrain.DeepWater]: { flat: '#2E3A34', steep: '#2E3A34' },
  [Terrain.ShallowWater]: { flat: '#6A6B52', steep: '#7A7358' },
  [Terrain.Sand]: { flat: PALETTE.sand, steep: PALETTE.gravel },
  [Terrain.Grass]: { flat: PALETTE.grass, steep: PALETTE.mud },
  [Terrain.Meadow]: { flat: PALETTE.meadow, steep: PALETTE.ploughed },
  [Terrain.Forest]: { flat: PALETTE.forestFloor, steep: PALETTE.mudDark },
  [Terrain.Rock]: { flat: PALETTE.moor, steep: PALETTE.chalkDark },
  [Terrain.Snow]: { flat: PALETTE.snow, steep: PALETTE.chalk },
};

/**
 * The per-tile ground colour of a valley, baked once.
 *
 * Three floats per tile for the flat colour and three for what the subsoil
 * shows on a slope; the mesh interpolates between tiles, and then between
 * the pair, by how steep the ground is where the vertex sits.
 */
export class GroundPalette {
  readonly width: number;
  readonly height: number;
  private readonly flat: Float32Array;
  private readonly steep: Float32Array;

  constructor(map: WorldMap) {
    this.width = map.width;
    this.height = map.height;
    const cells = map.width * map.height;
    this.flat = new Float32Array(cells * 3);
    this.steep = new Float32Array(cells * 3);

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const i = y * map.width + x;
        const kind = map.terrain[i] as Terrain;
        const tones = GROUND_TONES[kind] ?? GROUND_TONES[Terrain.Grass];
        let flat = colour(tones.flat);
        const steep = colour(tones.steep);

        // Wet ground is lusher; dry ground goes to hay. Higher ground is
        // thinner and greyer. Both are already smooth across the map, so
        // they vary the turf without any per-tile noise to give away tiles.
        if (!isWater(kind)) {
          const wet = map.moisture[i];
          flat = blend(flat, colour(PALETTE.stubble), clamp01(0.42 - wet) * 0.5);
          flat = blend(flat, colour(PALETTE.meadowLight), clamp01(wet - 0.55) * 0.5);
          flat = blend(flat, colour(PALETTE.moor), smoothstep(0.58, 0.92, map.heightField[i]) * 0.55);
          // A dry hawthorn-scrub tint where the wood thins out.
          flat = blend(flat, colour(PALETTE.canopyPale), clamp01(map.treeDensity[i]) * 0.18);
          // A patch-to-patch drift, so two fields are never the same green.
          flat = tone(flat, (hash2(x >> 2, y >> 2, map.seed ^ 0x51a3) - 0.5) * 0.07);
        }

        this.flat[i * 3] = flat.r;
        this.flat[i * 3 + 1] = flat.g;
        this.flat[i * 3 + 2] = flat.b;
        this.steep[i * 3] = steep.r;
        this.steep[i * 3 + 1] = steep.g;
        this.steep[i * 3 + 2] = steep.b;
      }
    }
  }

  /** Bilinear sample of the flat and slope colours at a world position. */
  sample(worldX: number, worldZ: number, steepness: number, out: Rgb): Rgb {
    const fx = worldX - 0.5;
    const fz = worldZ - 0.5;
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const tx = fx - x0;
    const tz = fz - z0;

    const cx = (v: number) => (v < 0 ? 0 : v > this.width - 1 ? this.width - 1 : v);
    const cz = (v: number) => (v < 0 ? 0 : v > this.height - 1 ? this.height - 1 : v);
    const i00 = cz(z0) * this.width + cx(x0);
    const i10 = cz(z0) * this.width + cx(x0 + 1);
    const i01 = cz(z0 + 1) * this.width + cx(x0);
    const i11 = cz(z0 + 1) * this.width + cx(x0 + 1);

    const w00 = (1 - tx) * (1 - tz);
    const w10 = tx * (1 - tz);
    const w01 = (1 - tx) * tz;
    const w11 = tx * tz;

    for (let channel = 0; channel < 3; channel++) {
      const flat =
        this.flat[i00 * 3 + channel] * w00 +
        this.flat[i10 * 3 + channel] * w10 +
        this.flat[i01 * 3 + channel] * w01 +
        this.flat[i11 * 3 + channel] * w11;
      const steep =
        this.steep[i00 * 3 + channel] * w00 +
        this.steep[i10 * 3 + channel] * w10 +
        this.steep[i01 * 3 + channel] * w01 +
        this.steep[i11 * 3 + channel] * w11;
      const value = lerp(flat, steep, steepness);
      if (channel === 0) out.r = value;
      else if (channel === 1) out.g = value;
      else out.b = value;
    }
    return out;
  }
}

/**
 * Build one chunk of ground. Chunk coordinates may run outside the valley:
 * the height field clamps at its edges, so the country simply carries on to
 * the horizon instead of stopping at a wall.
 */
export function buildTerrainChunk(
  map: WorldMap,
  palette: GroundPalette,
  chunkX: number,
  chunkZ: number,
  mesh: MeshBuilder,
  subdivisions: number = NEAR_SUBDIVISIONS,
): void {
  mesh.reset();
  const step = 1 / subdivisions;
  const span = CHUNK_TILES * subdivisions;
  const x0 = chunkX * CHUNK_TILES;
  const z0 = chunkZ * CHUNK_TILES;

  const rows: number[][] = [];
  const normal = { x: 0, y: 1, z: 0 };
  const tint: Rgb = { r: 0, g: 0, b: 0 };

  for (let row = 0; row <= span; row++) {
    const ring: number[] = [];
    const worldZ = z0 + row * step;
    for (let column = 0; column <= span; column++) {
      const worldX = x0 + column * step;
      const y = surfaceHeight(map, worldX, worldZ);
      surfaceNormal(map, worldX, worldZ, normal);

      // How much the subsoil shows: bare earth on a bank, turf on the level.
      const steepness = smoothstep(0.93, 0.55, normal.y);
      palette.sample(worldX, worldZ, steepness, tint);

      // A hollow sees less of the sky than a shoulder does. Comparing the
      // point with the average of the ground around it is a cheap stand-in
      // for the real thing, and it is what gives the relief its depth.
      // Distant country is hazed over long before this would show, so it
      // is not worth the four extra samples out there.
      let occlusion = 0.86;
      if (subdivisions >= NEAR_SUBDIVISIONS) {
        const around =
          (surfaceHeight(map, worldX - 2.2, worldZ) +
            surfaceHeight(map, worldX + 2.2, worldZ) +
            surfaceHeight(map, worldX, worldZ - 2.2) +
            surfaceHeight(map, worldX, worldZ + 2.2)) *
          0.25;
        occlusion = clamp01(0.72 + (y - around) * 0.3);
      }

      ring.push(mesh.vertex(worldX, y, worldZ, normal.x, normal.y, normal.z, tint, occlusion));
    }
    rows.push(ring);
  }

  for (let row = 0; row < span; row++) {
    for (let column = 0; column < span; column++) {
      mesh.quadIndices(
        rows[row][column],
        rows[row][column + 1],
        rows[row + 1][column + 1],
        rows[row + 1][column],
      );
    }
  }
}

/**
 * Build the water surface over one chunk: a flat sheet at the waterline,
 * wherever the ground beneath it is lower. Depth is carried in the vertex
 * alpha, so the shader can thin the water out over a shoal.
 */
export function buildWaterChunk(
  map: WorldMap,
  chunkX: number,
  chunkZ: number,
  mesh: MeshBuilder,
  step = 0.5,
): void {
  mesh.reset();
  const span = Math.round(CHUNK_TILES / step);
  const x0 = chunkX * CHUNK_TILES;
  const z0 = chunkZ * CHUNK_TILES;

  const deep = colour(PALETTE.waterDeep);
  const shallow = colour(PALETTE.waterShallow);
  const bed = new Float32Array((span + 1) * (span + 1));
  let anyWater = false;
  for (let row = 0; row <= span; row++) {
    for (let column = 0; column <= span; column++) {
      const h = surfaceHeight(map, x0 + column * step, z0 + row * step);
      bed[row * (span + 1) + column] = h;
      if (h < WATER_HEIGHT) anyWater = true;
    }
  }
  if (!anyWater) return;

  const rows: number[][] = [];
  for (let row = 0; row <= span; row++) {
    const ring: number[] = [];
    for (let column = 0; column <= span; column++) {
      const depth = clamp01((WATER_HEIGHT - bed[row * (span + 1) + column]) / 2.6);
      const tint = blend(shallow, deep, depth);
      ring.push(
        mesh.vertex(
          x0 + column * step,
          WATER_HEIGHT,
          z0 + row * step,
          0,
          1,
          0,
          tint,
          depth,
        ),
      );
    }
    rows.push(ring);
  }

  for (let row = 0; row < span; row++) {
    for (let column = 0; column < span; column++) {
      const index = row * (span + 1) + column;
      // Only lay water where at least one corner of the quad is submerged,
      // so the sheet ends at the shore rather than at the chunk boundary.
      const wet =
        bed[index] < WATER_HEIGHT ||
        bed[index + 1] < WATER_HEIGHT ||
        bed[index + span + 1] < WATER_HEIGHT ||
        bed[index + span + 2] < WATER_HEIGHT;
      if (!wet) continue;
      mesh.quadIndices(
        rows[row][column],
        rows[row][column + 1],
        rows[row + 1][column + 1],
        rows[row + 1][column],
      );
    }
  }
}

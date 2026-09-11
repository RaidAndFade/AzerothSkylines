/**
 * Value-noise and fractal-Brownian-motion helpers used by map generation.
 *
 * A hand-rolled noise implementation keeps the bundle dependency-free and,
 * more importantly, keeps terrain fully reproducible from a world seed.
 */
import { Rng } from './rng';
import { lerp, smoothstep } from './math';

const TABLE_SIZE = 512;
const TABLE_MASK = 255;

export class ValueNoise2D {
  private readonly permutation: Uint8Array;
  private readonly gradients: Float32Array;

  constructor(seed: number | string) {
    const rng = new Rng(seed);
    const perm = new Uint8Array(TABLE_SIZE);
    const base: number[] = [];
    for (let i = 0; i < 256; i++) base.push(i);
    rng.shuffle(base);
    for (let i = 0; i < TABLE_SIZE; i++) perm[i] = base[i & TABLE_MASK];
    this.permutation = perm;

    // One random value per lattice point, indexed through the permutation.
    this.gradients = new Float32Array(256);
    for (let i = 0; i < 256; i++) this.gradients[i] = rng.next();
  }

  private lattice(x: number, y: number): number {
    const index = this.permutation[(this.permutation[x & TABLE_MASK] + (y & TABLE_MASK)) & TABLE_MASK];
    return this.gradients[index];
  }

  /** Smooth value noise in [0, 1]. */
  sample(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = smoothstep(0, 1, x - x0);
    const ty = smoothstep(0, 1, y - y0);

    const v00 = this.lattice(x0, y0);
    const v10 = this.lattice(x0 + 1, y0);
    const v01 = this.lattice(x0, y0 + 1);
    const v11 = this.lattice(x0 + 1, y0 + 1);

    return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), ty);
  }

  /**
   * Layered noise. `octaves` controls detail, `persistence` how quickly each
   * octave fades, `lacunarity` how quickly frequency rises.
   */
  fbm(x: number, y: number, octaves = 4, persistence = 0.5, lacunarity = 2): number {
    let amplitude = 1;
    let frequency = 1;
    let total = 0;
    let normalization = 0;
    for (let i = 0; i < octaves; i++) {
      total += this.sample(x * frequency, y * frequency) * amplitude;
      normalization += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }
    return normalization === 0 ? 0 : total / normalization;
  }

  /**
   * Absolute-valued fbm, which produces the sharp creases that read as
   * mountain ridges. Returns [0, 1] where 1 is a ridge crest.
   */
  ridged(x: number, y: number, octaves = 4, persistence = 0.5, lacunarity = 2): number {
    let amplitude = 1;
    let frequency = 1;
    let total = 0;
    let normalization = 0;
    for (let i = 0; i < octaves; i++) {
      const signed = this.sample(x * frequency, y * frequency) * 2 - 1;
      total += (1 - Math.abs(signed)) * amplitude;
      normalization += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }
    return normalization === 0 ? 0 : total / normalization;
  }
}

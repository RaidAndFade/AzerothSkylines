/**
 * Deterministic pseudo-random number generation.
 *
 * Every system that needs randomness (map generation, building variants,
 * villager names, agent wander) draws from a seeded stream so that a given
 * world seed always reproduces the same city. That determinism is what makes
 * the simulation testable.
 */

/** A small, fast, well-distributed 32-bit PRNG. */
export class Rng {
  private state: number;

  constructor(seed: number | string) {
    this.state = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    // Avoid the degenerate all-zero state.
    if (this.state === 0) this.state = 0x9e3779b9;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    // mulberry32
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** True with the given probability. */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** Uniformly pick one element. Throws on an empty list. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty list');
    return items[Math.floor(this.next() * items.length)];
  }

  /**
   * Pick one element using positive weights. Entries with weight <= 0 are
   * never chosen; if every weight is <= 0 the first element is returned.
   */
  pickWeighted<T>(items: readonly T[], weightOf: (item: T) => number): T {
    if (items.length === 0) throw new Error('Rng.pickWeighted: empty list');
    let total = 0;
    for (const item of items) total += Math.max(0, weightOf(item));
    if (total <= 0) return items[0];
    let roll = this.next() * total;
    for (const item of items) {
      roll -= Math.max(0, weightOf(item));
      if (roll <= 0) return item;
    }
    return items[items.length - 1];
  }

  /** In-place Fisher-Yates shuffle. Returns the same array for chaining. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  /** Derive an independent, reproducible child stream. */
  fork(salt: number): Rng {
    return new Rng((Math.imul(this.state ^ salt, 0x85ebca6b) ^ (salt << 7)) >>> 0);
  }

  /** Snapshot the internal state so a save file can resume the same stream. */
  serialize(): number {
    return this.state;
  }

  static deserialize(state: number): Rng {
    const rng = new Rng(1);
    rng.state = state >>> 0;
    return rng;
  }
}

/** FNV-1a, so string seeds like "Elwynn" behave like numeric ones. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Stable hash of two integers, for "random but fixed per tile" lookups. */
export function hash2(x: number, y: number, seed = 0): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

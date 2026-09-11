import { describe, expect, it } from 'vitest';
import { Rng, hash2, hashString } from '@/core/rng';

describe('Rng', () => {
  it('produces the same stream for the same seed', () => {
    const a = new Rng(1234);
    const b = new Rng(1234);
    const first = Array.from({ length: 20 }, () => a.next());
    const second = Array.from({ length: 20 }, () => b.next());
    expect(first).toEqual(second);
  });

  it('produces different streams for different seeds', () => {
    const a = new Rng('Elwynn');
    const b = new Rng('Westfall');
    expect(a.next()).not.toBe(b.next());
  });

  it('stays within [0,1)', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('respects integer bounds inclusively', () => {
    const rng = new Rng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(rng.int(3, 6));
    expect([...seen].sort()).toEqual([3, 4, 5, 6]);
  });

  it('never picks a zero-weight option', () => {
    const rng = new Rng(5);
    const items = ['a', 'b', 'c'];
    const weights: Record<string, number> = { a: 0, b: 1, c: 0 };
    for (let i = 0; i < 200; i++) {
      expect(rng.pickWeighted(items, (item) => weights[item])).toBe('b');
    }
  });

  it('falls back to the first item when all weights are zero', () => {
    const rng = new Rng(5);
    expect(rng.pickWeighted(['x', 'y'], () => 0)).toBe('x');
  });

  it('shuffles without losing or duplicating elements', () => {
    const rng = new Rng(42);
    const items = Array.from({ length: 50 }, (_, i) => i);
    const shuffled = rng.shuffle([...items]);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
    expect(shuffled).not.toEqual(items);
  });

  it('forks into independent but reproducible streams', () => {
    const parent = new Rng(11);
    const a = parent.fork(1).next();
    const b = parent.fork(2).next();
    expect(a).not.toBe(b);
    expect(new Rng(11).fork(1).next()).toBe(a);
  });

  it('round-trips through serialization', () => {
    const rng = new Rng(2024);
    rng.next();
    rng.next();
    const restored = Rng.deserialize(rng.serialize());
    expect(restored.next()).toBe(Rng.deserialize(rng.serialize()).next());
  });

  it('throws rather than returning undefined for empty lists', () => {
    const rng = new Rng(1);
    expect(() => rng.pick([])).toThrow();
    expect(() => rng.pickWeighted([], () => 1)).toThrow();
  });
});

describe('hashing', () => {
  it('hashes strings deterministically', () => {
    expect(hashString('Stormwind')).toBe(hashString('Stormwind'));
    expect(hashString('Stormwind')).not.toBe(hashString('Stormwnid'));
  });

  it('hashes coordinate pairs into [0,1)', () => {
    for (let x = 0; x < 40; x++) {
      for (let y = 0; y < 40; y++) {
        const value = hash2(x, y, 17);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    }
    expect(hash2(3, 9, 1)).toBe(hash2(3, 9, 1));
    expect(hash2(3, 9, 1)).not.toBe(hash2(9, 3, 1));
  });
});

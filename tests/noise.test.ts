import { describe, expect, it } from 'vitest';
import { ValueNoise2D } from '@/core/noise';

describe('ValueNoise2D', () => {
  const noise = new ValueNoise2D('elwynn');

  it('is deterministic for a given seed', () => {
    const other = new ValueNoise2D('elwynn');
    for (let i = 0; i < 50; i++) {
      expect(noise.sample(i * 0.37, i * 0.71)).toBe(other.sample(i * 0.37, i * 0.71));
    }
  });

  it('stays within [0,1] for sample, fbm and ridged', () => {
    for (let x = -20; x < 20; x += 0.37) {
      for (let y = -20; y < 20; y += 0.53) {
        expect(noise.sample(x, y)).toBeGreaterThanOrEqual(0);
        expect(noise.sample(x, y)).toBeLessThanOrEqual(1);
        expect(noise.fbm(x, y)).toBeGreaterThanOrEqual(0);
        expect(noise.fbm(x, y)).toBeLessThanOrEqual(1);
        expect(noise.ridged(x, y)).toBeGreaterThanOrEqual(0);
        expect(noise.ridged(x, y)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is continuous: nearby samples are close together', () => {
    let worst = 0;
    for (let i = 0; i < 200; i++) {
      const x = i * 0.13;
      const y = i * 0.29;
      worst = Math.max(worst, Math.abs(noise.sample(x, y) - noise.sample(x + 0.01, y + 0.01)));
    }
    expect(worst).toBeLessThan(0.1);
  });

  it('varies across the plane rather than returning a constant', () => {
    const values = new Set<number>();
    for (let i = 0; i < 100; i++) values.add(Math.round(noise.fbm(i * 1.7, i * 2.3) * 1000));
    expect(values.size).toBeGreaterThan(20);
  });

  it('produces different fields for different seeds', () => {
    const other = new ValueNoise2D('westfall');
    expect(noise.sample(4.5, 7.25)).not.toBe(other.sample(4.5, 7.25));
  });
});

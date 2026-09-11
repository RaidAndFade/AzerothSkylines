import { describe, expect, it } from 'vitest';
import {
  approach,
  average,
  clamp,
  clamp01,
  distance,
  inverseLerp,
  lerp,
  manhattan,
  round,
  smoothstep,
  sum,
} from '@/core/math';

describe('numeric helpers', () => {
  it('clamps', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-2, 0, 10)).toBe(0);
    expect(clamp(14, 0, 10)).toBe(10);
    expect(clamp01(1.4)).toBe(1);
    expect(clamp01(-0.4)).toBe(0);
  });

  it('interpolates, and inverts the interpolation', () => {
    expect(lerp(10, 20, 0.5)).toBe(15);
    expect(lerp(10, 20, 0)).toBe(10);
    expect(inverseLerp(10, 20, 15)).toBe(0.5);
    // Clamped, and safe when the ends coincide.
    expect(inverseLerp(10, 20, 40)).toBe(1);
    expect(inverseLerp(7, 7, 7)).toBe(0);
  });

  it('smoothsteps between its edges', () => {
    expect(smoothstep(0, 1, 0)).toBe(0);
    expect(smoothstep(0, 1, 1)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 6);
    // Flat at both ends, steep in the middle.
    expect(smoothstep(0, 1, 0.1)).toBeLessThan(0.1);
    expect(smoothstep(0, 1, 0.9)).toBeGreaterThan(0.9);
    // Reversed edges count down instead of up.
    expect(smoothstep(1, 0, 0)).toBe(1);
  });

  it('approaches a target without overshooting', () => {
    let value = 0;
    for (let i = 0; i < 200; i++) value = approach(value, 10, 4, 1 / 60);
    expect(value).toBeGreaterThan(9.9);
    expect(value).toBeLessThanOrEqual(10);
    // A zero rate never moves.
    expect(approach(3, 10, 0, 1)).toBe(3);
  });

  it('measures distance both ways', () => {
    expect(distance(0, 0, 3, 4)).toBe(5);
    expect(manhattan(0, 0, 3, 4)).toBe(7);
  });

  it('rounds to a fixed number of decimals', () => {
    expect(round(1.23456)).toBe(1.23);
    expect(round(1.23456, 3)).toBe(1.235);
    expect(round(1.5, 0)).toBe(2);
  });

  it('sums and averages, including the empty case', () => {
    expect(sum([1, 2, 3])).toBe(6);
    expect(sum([])).toBe(0);
    expect(average([2, 4])).toBe(3);
    expect(average([])).toBe(0);
  });
});

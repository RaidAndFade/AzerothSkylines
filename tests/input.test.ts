/** Reading a wheel event: is this a mouse notch, a pinch, or a scroll? */
import { describe, expect, it } from 'vitest';
import { WheelIntent, wheelNotches, wheelZooms } from '@/ui/input';

const wheel = (over: Partial<WheelIntent> = {}): WheelIntent => ({
  ctrlKey: false,
  deltaMode: 0,
  deltaX: 0,
  deltaY: 0,
  ...over,
});

describe('what a wheel event means', () => {
  it('zooms on a mouse wheel notch', () => {
    // Chromium sends a notch as a round 100 pixels on one axis.
    expect(wheelZooms(wheel({ deltaY: 100 }))).toBe(true);
    expect(wheelZooms(wheel({ deltaY: -100 }))).toBe(true);
  });

  it('zooms when the browser reports lines or pages, as Firefox does', () => {
    expect(wheelZooms(wheel({ deltaMode: 1, deltaY: 3 }))).toBe(true);
    expect(wheelZooms(wheel({ deltaMode: 2, deltaY: 1 }))).toBe(true);
  });

  it('zooms on a trackpad pinch, which arrives as ctrl+wheel', () => {
    expect(wheelZooms(wheel({ ctrlKey: true, deltaY: -4.5 }))).toBe(true);
  });

  it('pans on a plain two-finger trackpad scroll', () => {
    expect(wheelZooms(wheel({ deltaY: 12.5 }))).toBe(false);
    expect(wheelZooms(wheel({ deltaY: 8 }))).toBe(false);
    // Any horizontal component at all means a trackpad, not a wheel.
    expect(wheelZooms(wheel({ deltaX: 3, deltaY: 120 }))).toBe(false);
  });

  it('caps how far one event can zoom, so momentum cannot bottom out', () => {
    expect(wheelNotches(wheel({ deltaY: 100 }))).toBe(1);
    expect(wheelNotches(wheel({ deltaY: -100 }))).toBe(-1);
    expect(wheelNotches(wheel({ deltaY: 4000 }))).toBe(4);
    expect(wheelNotches(wheel({ deltaMode: 1, deltaY: -30 }))).toBe(-4);
  });
});

// @vitest-environment jsdom
/**
 * The HUD panel's redraw guard.
 *
 * An open panel is rebuilt from scratch whenever its figures move. That is
 * fine sixty times a game-day and fatal under a finger: a control rebuilt
 * mid-gesture is removed from the document, and the drag dies with it. These
 * tests pin the three things that keep that from happening — nothing is
 * redrawn while the panel is held, nothing is redrawn for a frame in which
 * no figure moved, and a redraw still arrives once the hand is off and the
 * figures have moved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hud, HudCallbacks, PANEL_SETTLE_MS } from '@/ui/hud';
import { defaultTool } from '@/ui/tools';
import { CityState } from '@/sim/city';
import { Zone } from '@/sim/types';
import { makeFlatCity } from './helpers';

interface Harness {
  hud: Hud;
  root: HTMLElement;
  city: CityState;
  taxChanges: { zone: Zone; rate: number }[];
}

/** A hand-wound clock, so a test decides when the settle window has passed. */
let clock = 0;

function setup(): Harness {
  const city = makeFlatCity();
  const root = document.createElement('div');
  document.body.appendChild(root);

  const taxChanges: { zone: Zone; rate: number }[] = [];
  const callbacks: HudCallbacks = {
    onToolChange: () => {},
    onSpeedChange: () => {},
    onOverlayChange: () => {},
    onTaxChange: (zone, rate) => {
      taxChanges.push({ zone, rate });
      if (zone === Zone.Commercial) city.budget.taxRateCommercial = rate;
      else if (zone === Zone.Industrial) city.budget.taxRateIndustrial = rate;
      else city.budget.taxRateResidential = rate;
    },
    onTakeLoan: () => {},
    onBuyParcel: () => {},
    onNewCity: () => {},
    onSave: () => {},
    onLoad: () => {},
    onToggleZones: () => {},
    onToggleEdgeScroll: () => {},
    onFocusBuilding: () => {},
  };

  const hud = new Hud(root, defaultTool(), callbacks);
  hud.attachCity(city);
  return { hud, root, city, taxChanges };
}

function panelBody(root: HTMLElement): HTMLElement {
  const body = root.querySelector('.panel-body');
  if (!body) throw new Error('the panel has no body');
  return body as HTMLElement;
}

function sliders(root: HTMLElement): HTMLInputElement[] {
  return Array.from(root.querySelectorAll<HTMLInputElement>('input[type="range"]'));
}

/** Counts the rebuilds of the panel body between `take` calls. */
function watchRebuilds(root: HTMLElement): { take: () => number; stop: () => void } {
  const observer = new MutationObserver(() => {});
  observer.observe(panelBody(root), { childList: true });
  return {
    take: () => observer.takeRecords().length,
    stop: () => observer.disconnect(),
  };
}

/** Press the panel, the way a finger reaching for a control does. */
function press(node: Element): void {
  node.dispatchEvent(new Event('pointerdown', { bubbles: true }));
}

function release(): void {
  window.dispatchEvent(new Event('pointerup'));
}

/** Move something the panel draws from, so a redraw is due. */
function aDayPasses(city: CityState): void {
  city.clock.totalDays += 1;
}

beforeEach(() => {
  clock = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('the treasury panel', () => {
  it('keeps the tithe slider through a drag, and the drag reaches the rate', () => {
    const { hud, root, city, taxChanges } = setup();
    hud.togglePanel('budget');

    const slider = sliders(root)[0];
    expect(slider).toBeDefined();

    press(slider);
    for (let step = 11; step <= 30; step++) {
      slider.value = String(step);
      slider.dispatchEvent(new Event('input'));
      // The city runs on underneath, so a redraw would be due every frame.
      aDayPasses(city);
      hud.update(city);
      expect(root.contains(slider)).toBe(true);
    }
    release();

    expect(taxChanges).toHaveLength(20);
    expect(city.budget.taxRateResidential).toBeCloseTo(0.3, 5);
    expect(slider.value).toBe('30');
  });

  it('rebuilds nothing while the panel is held', () => {
    const { hud, root, city } = setup();
    hud.togglePanel('budget');
    const rebuilds = watchRebuilds(root);

    press(sliders(root)[0]);
    for (let frame = 0; frame < 30; frame++) {
      aDayPasses(city);
      clock += 16;
      hud.update(city);
    }

    expect(rebuilds.take()).toBe(0);
    rebuilds.stop();
  });

  it('waits out the settle window after the hand comes off', () => {
    const { hud, root, city } = setup();
    hud.togglePanel('budget');
    const rebuilds = watchRebuilds(root);

    press(sliders(root)[0]);
    release();
    aDayPasses(city);

    // A tap that ends is still a tap: the panel holds still for a moment so
    // the release is not stolen from the control underneath it.
    clock += PANEL_SETTLE_MS - 1;
    hud.update(city);
    expect(rebuilds.take()).toBe(0);

    clock += 1;
    hud.update(city);
    expect(rebuilds.take()).toBeGreaterThan(0);
    rebuilds.stop();
  });

  it('does not touch the panel on a frame where nothing moved', () => {
    const { hud, root, city } = setup();
    hud.togglePanel('budget');
    const rebuilds = watchRebuilds(root);

    for (let frame = 0; frame < 60; frame++) {
      clock += 16;
      hud.update(city);
    }

    expect(rebuilds.take()).toBe(0);
    rebuilds.stop();
  });

  it('still redraws once a figure has moved and the panel is free', () => {
    const { hud, root, city } = setup();
    hud.togglePanel('budget');
    const rebuilds = watchRebuilds(root);

    aDayPasses(city);
    hud.update(city);

    expect(rebuilds.take()).toBeGreaterThan(0);
    rebuilds.stop();
  });
});

describe('the panels that hold still', () => {
  it('leaves the views and the menu alone as the city runs', () => {
    for (const panel of ['overlays', 'menu'] as const) {
      const { hud, root, city } = setup();
      hud.togglePanel(panel);
      const rebuilds = watchRebuilds(root);

      for (let frame = 0; frame < 30; frame++) {
        aDayPasses(city);
        clock += 16;
        hud.update(city);
      }

      expect(rebuilds.take()).toBe(0);
      rebuilds.stop();
      document.body.innerHTML = '';
    }
  });
});

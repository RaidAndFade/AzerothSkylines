import { describe, expect, it } from 'vitest';
import { DemandInputs, computeDemandTargets, updateDemand } from '@/sim/demand';
import { Zone } from '@/sim/types';
import { makeFlatCity, zoneRect, mainRoadY } from './helpers';

function baseline(overrides: Partial<DemandInputs> = {}): DemandInputs {
  return {
    population: 400,
    housingCapacity: 440,
    happiness: 0.7,
    jobs: 260,
    employed: 240,
    shopJobs: 68,
    workshopJobs: 40,
    shopSupply: 0.7,
    workshopSupply: 0.7,
    reserveFill: 0.6,
    taxResidential: 0.1,
    taxCommercial: 0.1,
    taxIndustrial: 0.1,
    zonedResidential: 80,
    zonedCommercial: 30,
    zonedIndustrial: 35,
    exportPull: 0.2,
    ...overrides,
  };
}

describe('demand model', () => {
  it('always returns values in [0,1]', () => {
    const extremes: Partial<DemandInputs>[] = [
      {},
      { happiness: 0, population: 0, housingCapacity: 0, jobs: 0, employed: 0 },
      { happiness: 1, taxResidential: 0, taxCommercial: 0, taxIndustrial: 0 },
      { taxResidential: 1, taxCommercial: 1, taxIndustrial: 1 },
      { population: 100000, housingCapacity: 1 },
    ];
    for (const overrides of extremes) {
      const demand = computeDemandTargets(baseline(overrides));
      for (const value of [demand.residential, demand.commercial, demand.industrial]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('raises residential demand as the city grows happier', () => {
    const sad = computeDemandTargets(baseline({ happiness: 0.2 }));
    const glad = computeDemandTargets(baseline({ happiness: 0.95 }));
    expect(glad.residential).toBeGreaterThan(sad.residential);
  });

  it('suppresses residential demand when houses stand empty', () => {
    const full = computeDemandTargets(baseline({ population: 400, housingCapacity: 420 }));
    const empty = computeDemandTargets(baseline({ population: 200, housingCapacity: 800 }));
    expect(empty.residential).toBeLessThan(full.residential);
  });

  it('draws newcomers toward spare jobs', () => {
    const noWork = computeDemandTargets(baseline({ jobs: 240, employed: 240 }));
    const hiring = computeDemandTargets(baseline({ jobs: 400, employed: 240 }));
    expect(hiring.residential).toBeGreaterThan(noWork.residential);
  });

  it('lets a brand-new settlement grow regardless', () => {
    const fresh = computeDemandTargets(
      baseline({ population: 5, housingCapacity: 40, happiness: 0.3, jobs: 0, employed: 0 }),
    );
    expect(fresh.residential).toBeGreaterThanOrEqual(0.5);
  });

  it('punishes every zone for heavy taxes', () => {
    const light = computeDemandTargets(baseline());
    const heavy = computeDemandTargets(
      baseline({ taxResidential: 0.32, taxCommercial: 0.32, taxIndustrial: 0.32 }),
    );
    expect(heavy.residential).toBeLessThan(light.residential);
    expect(heavy.commercial).toBeLessThan(light.commercial);
    expect(heavy.industrial).toBeLessThan(light.industrial);
  });

  it('wants shops when the city is under-served', () => {
    const served = computeDemandTargets(baseline({ shopJobs: 200 }));
    const starved = computeDemandTargets(baseline({ shopJobs: 4 }));
    expect(starved.commercial).toBeGreaterThan(served.commercial);
  });

  it('holds commerce back in a settlement with no customers', () => {
    const tiny = computeDemandTargets(baseline({ population: 10, shopJobs: 0 }));
    expect(tiny.commercial).toBeLessThanOrEqual(0.3);
  });

  it('wants workshops when goods are scarce', () => {
    const plenty = computeDemandTargets(baseline({ shopSupply: 1, workshopSupply: 1 }));
    const scarce = computeDemandTargets(baseline({ shopSupply: 0, workshopSupply: 0 }));
    expect(scarce.industrial).toBeGreaterThan(plenty.industrial);
  });

  it('stops calling for premises that cannot be staffed', () => {
    const staffed = computeDemandTargets(baseline({ jobs: 260, employed: 250, shopJobs: 4, workshopJobs: 4 }));
    const idle = computeDemandTargets(baseline({ jobs: 2600, employed: 250, shopJobs: 4, workshopJobs: 4 }));
    expect(idle.commercial).toBeLessThan(staffed.commercial);
    expect(idle.industrial).toBeLessThan(staffed.industrial);
  });

  it('wants workshops when the docks are busy', () => {
    const quiet = computeDemandTargets(baseline({ exportPull: 0 }));
    const busy = computeDemandTargets(baseline({ exportPull: 1 }));
    expect(busy.industrial).toBeGreaterThan(quiet.industrial);
  });

  it('takes the edge off demand when far more land is zoned than needed', () => {
    const measured = computeDemandTargets(baseline({ zonedResidential: 40 }));
    const reckless = computeDemandTargets(baseline({ zonedResidential: 4000 }));
    expect(reckless.residential).toBeLessThan(measured.residential);
  });

  it('handles an empty city without dividing by zero', () => {
    const empty = computeDemandTargets(
      baseline({ population: 0, housingCapacity: 0, jobs: 0, employed: 0, shopJobs: 0, workshopJobs: 0 }),
    );
    expect(Number.isFinite(empty.residential)).toBe(true);
    expect(Number.isFinite(empty.commercial)).toBe(true);
    expect(Number.isFinite(empty.industrial)).toBe(true);
  });
});

describe('updateDemand', () => {
  it('eases the bars toward their target rather than snapping', () => {
    const city = makeFlatCity();
    city.demand.residential = 0;
    city.stats.population = 300;
    city.stats.housingCapacity = 310;
    city.stats.happiness = 0.9;
    city.stats.jobs = 300;
    city.stats.employed = 150;

    const first = updateDemand(city).residential;
    const second = updateDemand(city).residential;
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
    expect(first).toBeLessThan(0.9);
  });

  it('reads painted zoning out of the city', () => {
    const city = makeFlatCity();
    const y = mainRoadY();
    zoneRect(city, Zone.Residential, 2, y + 1, 6, 1);
    expect(() => updateDemand(city)).not.toThrow();
    expect(city.demand.residential).toBeGreaterThanOrEqual(0);
  });
});

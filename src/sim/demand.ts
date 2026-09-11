/**
 * Zone demand.
 *
 * Demand is what the player reads to know what the city wants next. It is
 * driven by contentment first: a happy, well-served city attracts people,
 * people need shops, and shops need workshops behind them.
 */
import { clamp01, lerp } from '../core/math';
import { ALL_GOODS, BuildingKind, Demand, Zone } from './types';
import { CityState } from './city';
import { getDef } from '../data/buildings';
import { zoneCounts } from './zoning';
import { reserveCapacity } from './trade';
import { WORKFORCE_RATIO } from './population';

/** How fast the demand bars move toward their target each day. */
export const DEMAND_SMOOTHING = 0.18;
/** Shop jobs the city wants per resident. */
export const SHOP_JOBS_PER_RESIDENT = 0.17;
/** Workshop jobs the city wants per resident. */
export const WORKSHOP_JOBS_PER_RESIDENT = 0.22;
/** Tiles of a zone that may be painted before over-zoning is even considered. */
export const ZONING_ALLOWANCE = 90;

export interface DemandInputs {
  population: number;
  housingCapacity: number;
  happiness: number;
  jobs: number;
  employed: number;
  shopJobs: number;
  workshopJobs: number;
  /** How well stocked the city's shops are, in [0,1]. */
  shopSupply: number;
  /** How well supplied the city's workshops are, in [0,1]. */
  workshopSupply: number;
  /** How full the trade hubs' stores are, in [0,1]. */
  reserveFill: number;
  taxResidential: number;
  taxCommercial: number;
  taxIndustrial: number;
  zonedResidential: number;
  zonedCommercial: number;
  zonedIndustrial: number;
  exportPull: number;
}

/**
 * Pure demand model, kept separate from the city state so the balance can
 * be reasoned about and tested directly.
 */
export function computeDemandTargets(inputs: DemandInputs): Demand {
  const {
    population,
    housingCapacity,
    happiness,
    jobs,
    employed,
    shopJobs,
    workshopJobs,
    shopSupply,
    workshopSupply,
    reserveFill,
    exportPull,
  } = inputs;

  const workforce = population * WORKFORCE_RATIO;
  const vacancy = housingCapacity > 0 ? (housingCapacity - population) / housingCapacity : 0;
  const spareJobs = clamp01((jobs - employed) / Math.max(6, workforce * 0.35));
  const unemployment = workforce > 0 ? clamp01((workforce - employed) / workforce) : 0;
  // The essential brake on building more premises: if the ones that already
  // stand cannot find staff, the city does not need more of them.
  const jobVacancy = jobs > 0 ? clamp01((jobs - employed) / jobs) : 0;

  // --- Dwellings -----------------------------------------------------------
  // People come for work and contentment, and stay away from empty, sour towns.
  let residential =
    0.3 +
    happiness * 0.55 +
    spareJobs * 0.4 -
    clamp01(vacancy * 2.1) * 0.65 -
    taxDrag(inputs.taxResidential) * 0.5 -
    unemployment * 0.35;

  // --- Trade ---------------------------------------------------------------
  // Shops follow customers, but only if there are goods to put on the shelves.
  const wantedShopJobs = population * SHOP_JOBS_PER_RESIDENT;
  const shopSaturation = wantedShopJobs > 0 ? clamp01(shopJobs / wantedShopJobs) : 1;
  let commercial =
    (1 - shopSaturation) * 0.85 +
    happiness * 0.2 +
    shopSupply * 0.22 +
    reserveFill * 0.1 -
    jobVacancy * 0.55 -
    taxDrag(inputs.taxCommercial) * 0.5 -
    0.12;
  if (population < 25) commercial = Math.min(commercial, 0.3);

  // --- Crafting ------------------------------------------------------------
  // Workshops answer to the shops in front of them and the ports beyond.
  const wantedWorkshopJobs = population * WORKSHOP_JOBS_PER_RESIDENT;
  const workshopSaturation = wantedWorkshopJobs > 0 ? clamp01(workshopJobs / wantedWorkshopJobs) : 1;
  // Scarcity is measured where it bites — on the shelves and at the forge —
  // rather than from an abstract stockpile that is never quite full.
  const scarcity = clamp01(1 - (shopSupply + workshopSupply) / 2);
  let industrial =
    (1 - workshopSaturation) * 0.7 +
    scarcity * 0.4 +
    exportPull * 0.3 +
    unemployment * 0.2 -
    jobVacancy * 0.6 -
    taxDrag(inputs.taxIndustrial) * 0.5 -
    0.12;
  if (population < 15) industrial = Math.min(industrial, 0.3);

  // Zoning far ahead of the city's needs damps demand: paint is not a plan.
  residential -= oversupplyDrag(inputs.zonedResidential, population * 0.09);
  commercial -= oversupplyDrag(inputs.zonedCommercial, population * 0.035);
  industrial -= oversupplyDrag(inputs.zonedIndustrial, population * 0.04);

  // Whatever else is true, a brand-new settlement always has room for its
  // first families — otherwise the opening minutes of a game deadlock.
  if (population < 40) residential = Math.max(residential, 0.55);

  return {
    residential: clamp01(residential),
    commercial: clamp01(commercial),
    industrial: clamp01(industrial),
  };
}

/** Taxes above a tithe bite into demand. */
function taxDrag(rate: number): number {
  return clamp01((rate - 0.09) / 0.24);
}

/**
 * Painting far more land than the city can fill takes the edge off demand.
 * The allowance is deliberately generous: laying out a district before the
 * people arrive is normal play, not over-zoning.
 */
function oversupplyDrag(zonedTiles: number, wantedTiles: number): number {
  if (zonedTiles <= 0) return 0;
  const ratio = zonedTiles / Math.max(ZONING_ALLOWANCE, wantedTiles);
  return clamp01((ratio - 2.5) / 6) * 0.3;
}

/** Gather the live inputs from the city and ease the demand bars toward them. */
export function updateDemand(city: CityState): Demand {
  let shopJobs = 0;
  let workshopJobs = 0;
  let shopSupply = 0;
  let shopCount = 0;
  let workshopSupply = 0;
  let workshopCount = 0;

  for (const building of city.buildings.values()) {
    if (building.abandoned) continue;
    const def = getDef(building.defId);
    if (building.kind === BuildingKind.Shop) {
      shopJobs += def.jobs ?? 0;
      shopSupply += building.supplyRatio;
      shopCount++;
    } else if (building.kind === BuildingKind.Workshop) {
      workshopJobs += def.jobs ?? 0;
      // Extractive workshops have no inputs, so they are always "supplied";
      // only the crafting halls can actually run short.
      if (def.consumes) {
        workshopSupply += building.supplyRatio;
        workshopCount++;
      }
    }
  }

  const zoned = zoneCounts(city);
  const capacity = reserveCapacity(city);
  const stored = ALL_GOODS.reduce((total, good) => total + city.reserves[good], 0);
  const reserveFill = capacity > 0 ? clamp01(stored / (capacity * ALL_GOODS.length)) : 0;

  const targets = computeDemandTargets({
    population: city.stats.population,
    housingCapacity: city.stats.housingCapacity,
    happiness: city.stats.happiness,
    jobs: city.stats.jobs,
    employed: city.stats.employed,
    shopJobs,
    workshopJobs,
    // With nothing built yet, treat the city as adequately supplied so that
    // demand is driven by what is missing rather than by a division by zero.
    shopSupply: shopCount > 0 ? shopSupply / shopCount : 0.6,
    workshopSupply: workshopCount > 0 ? workshopSupply / workshopCount : 0.6,
    reserveFill,
    taxResidential: city.budget.taxRateResidential,
    taxCommercial: city.budget.taxRateCommercial,
    taxIndustrial: city.budget.taxRateIndustrial,
    zonedResidential: zoned[Zone.Residential],
    zonedCommercial: zoned[Zone.Commercial],
    zonedIndustrial: zoned[Zone.Industrial],
    exportPull: city.stats.travelers > 0 ? clamp01(city.stats.travelers / 40) : 0,
  });

  city.demand.residential = lerp(city.demand.residential, targets.residential, DEMAND_SMOOTHING);
  city.demand.commercial = lerp(city.demand.commercial, targets.commercial, DEMAND_SMOOTHING);
  city.demand.industrial = lerp(city.demand.industrial, targets.industrial, DEMAND_SMOOTHING);
  return city.demand;
}

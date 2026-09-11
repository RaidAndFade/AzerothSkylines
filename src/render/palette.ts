/**
 * The colour language of the game.
 *
 * Stormwind reads as warm white stone under saturated blue slate, set in
 * the deep greens of Elwynn Forest. Everything here is hand-picked to sit
 * together, and the helpers below keep shading consistent across terrain,
 * buildings and walls.
 */

export const PALETTE = {
  // --- Stormwind masonry --------------------------------------------------
  stoneLight: '#F0E7D6',
  stone: '#DCCFB8',
  stoneMid: '#C2B296',
  stoneDark: '#9C8C72',
  stoneShadow: '#77694F',

  // --- Roofs, by district -------------------------------------------------
  roofBlue: '#2C6BAE',
  roofBlueLight: '#4C92D8',
  roofBlueDark: '#1B4577',
  roofRed: '#A3382F',
  roofRedLight: '#C75A48',
  roofRedDark: '#6C221D',
  roofViolet: '#6B4A8F',
  roofVioletLight: '#8D6BB3',
  roofVioletDark: '#452D60',
  roofGreen: '#3F7A4A',
  roofGreenLight: '#5C9C65',
  roofGreenDark: '#28522F',

  // --- Humble building materials -----------------------------------------
  thatch: '#C9A860',
  thatchLight: '#E0C481',
  thatchDark: '#96783E',
  timber: '#6B4A2C',
  timberLight: '#8A6339',
  timberDark: '#432C19',
  plaster: '#E8DCC4',
  plasterShade: '#CDBE9F',

  // --- Elwynn ground ------------------------------------------------------
  grass: '#6EA33E',
  grassLight: '#85BC4D',
  grassDark: '#527D2D',
  meadow: '#8CBE52',
  meadowLight: '#A5D267',
  forestFloor: '#4A7A33',
  forestFloorDark: '#385E27',
  canopy: '#2F6B36',
  canopyLight: '#448A45',
  canopyDark: '#1E4A26',
  canopyAutumn: '#7A6B2A',

  sand: '#D9C48F',
  sandDark: '#B8A070',
  dirt: '#A08556',
  dirtDark: '#7B6540',

  rock: '#8D8579',
  rockLight: '#A9A196',
  rockDark: '#635C52',
  snow: '#EFEFE9',
  snowShade: '#CFD3D6',

  // --- Water --------------------------------------------------------------
  waterDeep: '#1D5680',
  water: '#2B7BA6',
  waterLight: '#49A2C6',
  waterShallow: '#63BBD4',
  waterFoam: '#CFEDF3',

  // --- Roads --------------------------------------------------------------
  cobble: '#8F8779',
  cobbleLight: '#A8A092',
  cobbleDark: '#6D665A',
  flagstone: '#B9AE99',
  flagstoneLight: '#D2C8B4',
  flagstoneDark: '#8E8471',
  path: '#A9915F',
  pathDark: '#87724A',

  // --- Interface ----------------------------------------------------------
  gold: '#F0C44A',
  goldDark: '#B88A1E',
  parchment: '#F3E7CC',
  parchmentDark: '#D9C69C',
  ink: '#3A2E1E',
  alliance: '#2C6BAE',
  allianceLight: '#5FA0DC',
  crimson: '#B03A2E',
  emerald: '#3E8E5A',

  // --- Zone paint ---------------------------------------------------------
  zoneResidential: '#4E9E4A',
  zoneCommercial: '#3C7FC4',
  zoneIndustrial: '#C4923C',

  shadow: 'rgba(20, 16, 10, 0.28)',
} as const;

export type PaletteColor = keyof typeof PALETTE;

/** Parse '#rrggbb' into components. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = parseInt(hex.slice(1), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${((1 << 24) | (clamp(r) << 16) | (clamp(g) << 8) | clamp(b)).toString(16).slice(1)}`;
}

/** Lighten (amount > 0) or darken (amount < 0) a colour, in [-1, 1]. */
export function shade(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  if (amount >= 0) {
    return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
  }
  const factor = 1 + amount;
  return rgbToHex(r * factor, g * factor, b * factor);
}

/** Blend two colours; t = 0 gives `a`, t = 1 gives `b`. */
export function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex(ca.r + (cb.r - ca.r) * t, ca.g + (cb.g - ca.g) * t, ca.b + (cb.b - ca.b) * t);
}

export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Roof colours for each Stormwind district, keyed the way the build menu
 * groups buildings. The blue of the Trade District is the city's signature.
 */
export const ROOF_SETS = {
  blue: { main: PALETTE.roofBlue, light: PALETTE.roofBlueLight, dark: PALETTE.roofBlueDark },
  red: { main: PALETTE.roofRed, light: PALETTE.roofRedLight, dark: PALETTE.roofRedDark },
  violet: { main: PALETTE.roofViolet, light: PALETTE.roofVioletLight, dark: PALETTE.roofVioletDark },
  green: { main: PALETTE.roofGreen, light: PALETTE.roofGreenLight, dark: PALETTE.roofGreenDark },
  thatch: { main: PALETTE.thatch, light: PALETTE.thatchLight, dark: PALETTE.thatchDark },
  stone: { main: PALETTE.stoneMid, light: PALETTE.stone, dark: PALETTE.stoneDark },
} as const;

export type RoofSet = keyof typeof ROOF_SETS;

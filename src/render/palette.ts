/**
 * The colour language of the game: England, around 1300.
 *
 * Nothing here is saturated, because nothing in a fourteenth-century
 * landscape was. Walls are lime, daub, flint and oolitic limestone; roofs
 * are wheat straw, oak shingle, stone slate and — on the richest buildings —
 * clay tile and lead. The country is pasture green going to hay in high
 * summer, hedged in hawthorn, under the thin grey-blue light of an island
 * climate. The brightest thing in view is usually a limewashed gable.
 *
 * Every colour is written as '#rrggbb' here and converted to linear floats
 * once, in `meshBuilder`, so the lighting adds up the way daylight does.
 */

export const PALETTE = {
  // --- Masonry ------------------------------------------------------------
  /** Oolitic limestone, the ashlar of a parish church or a gatehouse. */
  limestone: '#C3BCA6',
  limestoneLight: '#D6D0BC',
  limestoneDark: '#9D9681',
  /** Knapped flint with lime mortar, the common walling of the east. */
  flint: '#736F68',
  flintLight: '#908B82',
  flintDark: '#4E4B46',
  /** Rubble stone and fieldstone, what a farmstead is footed on. */
  rubble: '#9A8F7C',
  rubbleDark: '#6E6556',
  /** Sandstone, warmer and softer, used for dressings. */
  sandstone: '#B6A37D',

  // --- Walling ------------------------------------------------------------
  /** Limewashed daub: the wall of nearly every building in the town. */
  limewash: '#DCD4BD',
  limewashShade: '#C0B69B',
  /** Unlimed daub, on the poorest cottages. */
  daub: '#BFAE8B',
  daubShade: '#A08F6E',
  /** Oak, weathered to silver-brown in the rain. */
  oak: '#4C3A27',
  oakLight: '#61492F',
  oakDark: '#2E2319',
  /** Riven oak boards, for barn walls and cart beds. */
  board: '#6B5437',
  boardDark: '#4A3926',

  // --- Roofing ------------------------------------------------------------
  /** Wheat-straw thatch, fresh and weathered. */
  thatch: '#A08248',
  thatchLight: '#BE9E62',
  thatchDark: '#6E5932',
  /** Clay tile, iron-rich and muted — never pillar-box red. */
  tile: '#96563F',
  tileLight: '#AE6C50',
  tileDark: '#66392A',
  /** Stone slate: Horsham, Collyweston, Cotswold. */
  stoneSlate: '#8A8377',
  stoneSlateLight: '#A39B8D',
  stoneSlateDark: '#625C53',
  /** Oak shingle, greying with age. */
  shingle: '#7A6B52',
  shingleLight: '#95856A',
  shingleDark: '#544836',
  /** Lead, on a cathedral roof or a spire. */
  lead: '#60625F',
  leadLight: '#7E807C',
  leadDark: '#3F413E',

  // --- The country --------------------------------------------------------
  grass: '#6E7A46',
  grassLight: '#84904F',
  grassDark: '#545E35',
  /** Water meadow and pasture, a touch bluer and lusher. */
  meadow: '#77864A',
  meadowLight: '#8E9C59',
  /** Hay and stubble in Goldharvest. */
  stubble: '#A89A62',
  /** The floor of an oak wood, mostly leaf litter. */
  forestFloor: '#4E5536',
  forestFloorDark: '#3A4029',
  /** Oak and ash canopy. */
  canopy: '#4B5A32',
  canopyLight: '#5E6F3E',
  canopyDark: '#343F23',
  /** Hawthorn and birch, lighter and greyer. */
  canopyPale: '#6A7448',
  /** A field maple on the turn. */
  canopyAutumn: '#8A7534',
  /** Scots pine, almost blue in shadow. */
  canopyPine: '#3B4A36',

  /** Ploughed earth: the ridge and furrow of an open field. */
  ploughed: '#6F5C43',
  ploughedLight: '#866F51',
  /** Standing corn. */
  corn: '#B5A25F',

  sand: '#C2B18A',
  sandDark: '#A2916C',
  /** River gravel and a muddy bank. */
  gravel: '#9A8D75',
  mud: '#7A6A52',
  mudDark: '#5C4F3C',

  chalk: '#BDB8A4',
  chalkDark: '#8E8A78',
  moor: '#6E6A52',
  moorDark: '#514E3C',
  snow: '#E4E4DE',
  snowShade: '#C2C6C8',

  // --- Water --------------------------------------------------------------
  /** An English river: green-grey, never Mediterranean blue. */
  waterDeep: '#2F545C',
  water: '#3F6B72',
  waterLight: '#557F84',
  waterShallow: '#77A098',
  waterFoam: '#CBD6CC',

  // --- Ways ---------------------------------------------------------------
  /** A packed-earth footpath, worn down to the subsoil. */
  path: '#9C8358',
  pathDark: '#75603C',
  /** Cobbles: water-rounded stones set in sand, pale and dusty. */
  cobble: '#A39C90',
  cobbleLight: '#BAB3A6',
  cobbleDark: '#6F6961',
  /** Dressed flagstones, laid only where the town can afford them. */
  flagstone: '#B8B2A1',
  flagstoneLight: '#CFC9B7',
  flagstoneDark: '#857F70',

  // --- Interface ----------------------------------------------------------
  /** Gold leaf and ochre, off a manuscript initial. */
  gold: '#C9A227',
  goldDark: '#8E6F14',
  parchment: '#E8DCC0',
  parchmentDark: '#CBBB96',
  /** Oak-gall ink. */
  ink: '#2B2318',
  /** Woad blue, the one good dye. */
  woad: '#3A5A7A',
  woadLight: '#5A7C9C',
  /** Madder red. */
  madder: '#8E3A2E',
  /** Verdigris. */
  verdigris: '#3E7A5E',

  // --- Zone paint ---------------------------------------------------------
  zoneResidential: '#59A05C',
  /** Violet-leaning, so an empty plot is never mistaken for water. */
  zoneCommercial: '#6A6FB0',
  zoneIndustrial: '#BC8730',

  shadow: 'rgba(24, 22, 16, 0.3)',
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
 * The roofing a building can be covered in, poorest first. What a town can
 * afford to put over its head is the clearest sign of how it is doing, so
 * these climb: straw, shingle, stone, tile, lead.
 */
export const ROOF_SETS = {
  thatch: { main: PALETTE.thatch, light: PALETTE.thatchLight, dark: PALETTE.thatchDark },
  shingle: { main: PALETTE.shingle, light: PALETTE.shingleLight, dark: PALETTE.shingleDark },
  stoneSlate: { main: PALETTE.stoneSlate, light: PALETTE.stoneSlateLight, dark: PALETTE.stoneSlateDark },
  tile: { main: PALETTE.tile, light: PALETTE.tileLight, dark: PALETTE.tileDark },
  lead: { main: PALETTE.lead, light: PALETTE.leadLight, dark: PALETTE.leadDark },
  limestone: { main: PALETTE.limestone, light: PALETTE.limestoneLight, dark: PALETTE.limestoneDark },
} as const;

export type RoofSet = keyof typeof ROOF_SETS;

/** What each roofing is made of, for the way it is laid and lit. */
export const ROOF_TEXTURE: Record<RoofSet, 'thatch' | 'shingle' | 'slate' | 'tile' | 'lead' | 'stone'> = {
  thatch: 'thatch',
  shingle: 'shingle',
  stoneSlate: 'slate',
  tile: 'tile',
  lead: 'lead',
  limestone: 'stone',
};

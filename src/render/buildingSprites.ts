/**
 * Procedural building artwork.
 *
 * Each building is drawn once into an offscreen canvas and then blitted, so
 * the cost of all this detail is paid on first sight and never again. The
 * styles climb from Elwynn's thatch and daub through Goldshire half-timber
 * to the white granite and blue slate of Stormwind proper.
 */
import { HALF_HEIGHT, HALF_WIDTH } from './iso';
import { PALETTE, ROOF_SETS, RoofSet, mix, shade, withAlpha } from './palette';
import { MaterialName, paintFace } from './materials';
import { light } from './light';
import {
  OUTLINE,
  Point,
  Skin,
  banner,
  castShadow,
  centroid,
  clipAboveRoofline,
  coneRoof,
  cylinder,
  expand,
  fillFace,
  footprintCorners,
  gableRidge,
  gableRoof,
  groundShadow,
  hipApex,
  hipRoof,
  insetFootprint,
  isoBox,
  leftToRight,
  lerpPoint,
  midpoint,
  polygon,
  raise,
  strokeSilhouette,
  windowRow,
} from './shapes';
import { hash2 } from '../core/rng';
import { getDef } from '../data/buildings';

export interface Sprite {
  canvas: HTMLCanvasElement;
  /** Pixel offset from the sprite's left edge to the footprint's north corner. */
  originX: number;
  originY: number;
}

/** Extra decoration a style can carry. */
export type Feature =
  | 'chimney'
  | 'smokestack'
  | 'banner'
  | 'sign'
  | 'porch'
  | 'fence'
  | 'field'
  | 'crates'
  | 'waterwheel'
  | 'headframe'
  | 'spire'
  | 'crenellations'
  | 'awning'
  | 'stall'
  | 'well'
  | 'garden'
  | 'fountain'
  | 'pier'
  | 'waggon'
  | 'arches'
  | 'rose'
  | 'brazier'
  | 'water'
  | 'lists'
  | 'pavilions'
  | 'ruin';

export interface BuildingStyle {
  wall: string;
  /** Overrides the material inferred from the wall colour. */
  wallMaterial?: MaterialName;
  /** Exposed timber framing, drawn over the plaster. */
  timbered?: boolean;
  roof: RoofSet;
  roofShape: 'gable' | 'hip' | 'cone' | 'flat' | 'none';
  wallHeight: number;
  roofHeight: number;
  features: Feature[];
  /** Colour of lit windows. */
  windows?: string;
}

const STONE = PALETTE.stone;
const WHITE_STONE = PALETTE.stoneLight;
const PLASTER = PALETTE.plaster;

/**
 * How each building in the catalogue is drawn. Keeping this as data rather
 * than forty bespoke functions is what makes the set feel like one city.
 */
export const BUILDING_STYLES: Record<string, BuildingStyle> = {
  // --- Dwellings ----------------------------------------------------------
  house1: { wall: PLASTER, roof: 'thatch', roofShape: 'gable', wallHeight: 26, roofHeight: 15, features: ['chimney', 'fence'], windows: '#F4D98A' },
  house2: { wall: PLASTER, timbered: true, roof: 'red', roofShape: 'gable', wallHeight: 30, roofHeight: 17, features: ['chimney', 'porch'], windows: '#F7DE93' },
  house3: { wall: WHITE_STONE, roof: 'blue', roofShape: 'gable', wallHeight: 40, roofHeight: 20, features: ['chimney', 'banner'], windows: '#F7DE93' },
  house4: { wall: WHITE_STONE, roof: 'blue', roofShape: 'hip', wallHeight: 46, roofHeight: 26, features: ['banner', 'spire', 'chimney'], windows: '#F7DE93' },

  // --- Trade --------------------------------------------------------------
  shop1: { wall: PALETTE.timberLight, roof: 'red', roofShape: 'gable', wallHeight: 15, roofHeight: 12, features: ['stall', 'awning'] },
  shop2: { wall: PLASTER, timbered: true, roof: 'red', roofShape: 'gable', wallHeight: 30, roofHeight: 16, features: ['sign', 'awning'], windows: '#F7DE93' },
  shop3: { wall: WHITE_STONE, roof: 'blue', roofShape: 'gable', wallHeight: 40, roofHeight: 19, features: ['sign', 'banner'], windows: '#F7DE93' },
  shop4: { wall: WHITE_STONE, roof: 'blue', roofShape: 'hip', wallHeight: 48, roofHeight: 26, features: ['banner', 'sign', 'awning'], windows: '#F7DE93' },

  // --- Farming ------------------------------------------------------------
  farm1: { wall: PALETTE.timber, roof: 'thatch', roofShape: 'gable', wallHeight: 22, roofHeight: 13, features: ['field', 'fence'] },
  farm2: { wall: PALETTE.timber, roof: 'thatch', roofShape: 'gable', wallHeight: 28, roofHeight: 16, features: ['field', 'fence', 'crates'] },
  farm3: { wall: PLASTER, timbered: true, roof: 'red', roofShape: 'hip', wallHeight: 32, roofHeight: 19, features: ['field', 'fence', 'crates'] },

  // --- Timber -------------------------------------------------------------
  timber1: { wall: PALETTE.timber, roof: 'green', roofShape: 'gable', wallHeight: 20, roofHeight: 12, features: ['crates', 'fence'] },
  timber2: { wall: PALETTE.timber, roof: 'green', roofShape: 'gable', wallHeight: 26, roofHeight: 15, features: ['waterwheel', 'crates'] },
  timber3: { wall: PALETTE.timberLight, roof: 'green', roofShape: 'gable', wallHeight: 34, roofHeight: 18, features: ['waterwheel', 'crates', 'chimney'] },

  // --- Mining -------------------------------------------------------------
  mine1: { wall: PALETTE.timber, roof: 'thatch', roofShape: 'flat', wallHeight: 14, roofHeight: 8, features: ['headframe', 'crates'] },
  mine2: { wall: PALETTE.timberLight, roof: 'green', roofShape: 'gable', wallHeight: 22, roofHeight: 13, features: ['headframe', 'crates'] },
  mine3: { wall: STONE, roof: 'violet', roofShape: 'gable', wallHeight: 30, roofHeight: 16, features: ['headframe', 'crates', 'smokestack'] },

  // --- Crafting -----------------------------------------------------------
  craft1: { wall: STONE, roof: 'red', roofShape: 'gable', wallHeight: 24, roofHeight: 14, features: ['smokestack', 'crates'], windows: '#FF9A3C' },
  craft2: { wall: STONE, roof: 'red', roofShape: 'gable', wallHeight: 32, roofHeight: 17, features: ['smokestack', 'crates', 'sign'], windows: '#FF9A3C' },
  craft3: { wall: PALETTE.stoneMid, roof: 'violet', roofShape: 'gable', wallHeight: 40, roofHeight: 21, features: ['smokestack', 'crates'], windows: '#FF9A3C' },

  // --- Water and drainage -------------------------------------------------
  well: { wall: STONE, roof: 'red', roofShape: 'none', wallHeight: 0, roofHeight: 0, features: ['well'] },
  cistern: { wall: WHITE_STONE, roof: 'stone', roofShape: 'flat', wallHeight: 26, roofHeight: 10, features: ['arches', 'water'] },
  reservoir: { wall: WHITE_STONE, roof: 'stone', roofShape: 'flat', wallHeight: 20, roofHeight: 8, features: ['arches', 'water', 'fountain'] },
  cesspit: { wall: PALETTE.timber, roof: 'thatch', roofShape: 'none', wallHeight: 8, roofHeight: 0, features: ['well', 'fence'] },
  canal: { wall: PALETTE.stoneMid, roof: 'stone', roofShape: 'flat', wallHeight: 14, roofHeight: 6, features: ['arches', 'water'] },
  sewerworks: { wall: PALETTE.stoneMid, roof: 'violet', roofShape: 'hip', wallHeight: 28, roofHeight: 17, features: ['arches', 'smokestack'] },

  // --- The guard ----------------------------------------------------------
  guardpost: { wall: WHITE_STONE, roof: 'blue', roofShape: 'cone', wallHeight: 40, roofHeight: 22, features: ['crenellations', 'brazier'] },
  barracks: { wall: WHITE_STONE, roof: 'blue', roofShape: 'gable', wallHeight: 36, roofHeight: 19, features: ['banner', 'crenellations'], windows: '#F7DE93' },
  garrison: { wall: WHITE_STONE, roof: 'blue', roofShape: 'hip', wallHeight: 52, roofHeight: 28, features: ['banner', 'spire', 'crenellations'], windows: '#F7DE93' },

  // --- The Light ----------------------------------------------------------
  shrine: { wall: WHITE_STONE, roof: 'blue', roofShape: 'cone', wallHeight: 16, roofHeight: 14, features: ['brazier'] },
  chapel: { wall: WHITE_STONE, roof: 'blue', roofShape: 'gable', wallHeight: 40, roofHeight: 22, features: ['spire', 'rose'], windows: '#9FD8F0' },
  cathedral: { wall: WHITE_STONE, roof: 'blue', roofShape: 'gable', wallHeight: 64, roofHeight: 34, features: ['spire', 'rose', 'banner'], windows: '#9FD8F0' },

  // --- Merriment ----------------------------------------------------------
  garden: { wall: PALETTE.grass, roof: 'green', roofShape: 'none', wallHeight: 0, roofHeight: 0, features: ['garden'] },
  fountain: { wall: WHITE_STONE, roof: 'blue', roofShape: 'none', wallHeight: 0, roofHeight: 0, features: ['fountain', 'garden'] },
  inn: { wall: PLASTER, timbered: true, roof: 'red', roofShape: 'gable', wallHeight: 40, roofHeight: 21, features: ['sign', 'chimney', 'porch'], windows: '#FFCB6B' },
  tourney: { wall: PALETTE.grass, roof: 'red', roofShape: 'none', wallHeight: 0, roofHeight: 0, features: ['lists', 'pavilions', 'fence'] },
  keep: { wall: WHITE_STONE, roof: 'blue', roofShape: 'hip', wallHeight: 68, roofHeight: 34, features: ['spire', 'banner', 'crenellations'], windows: '#F7DE93' },

  // --- Trade with the world ----------------------------------------------
  market: { wall: PALETTE.timberLight, roof: 'blue', roofShape: 'gable', wallHeight: 16, roofHeight: 13, features: ['stall', 'awning', 'crates'] },
  caravanserai: { wall: PLASTER, roof: 'violet', roofShape: 'hip', wallHeight: 28, roofHeight: 20, features: ['waggon', 'crates', 'banner'] },
  docks: { wall: PALETTE.timber, roof: 'blue', roofShape: 'gable', wallHeight: 28, roofHeight: 20, features: ['pier', 'crates'] },
};

const DEFAULT_STYLE: BuildingStyle = {
  wall: STONE,
  roof: 'red',
  roofShape: 'gable',
  wallHeight: 26,
  roofHeight: 20,
  features: [],
};

/** What each roof set is actually made of. */
const ROOF_MATERIAL: Record<RoofSet, MaterialName> = {
  blue: 'slate',
  red: 'slate',
  violet: 'slate',
  green: 'shingle',
  thatch: 'thatch',
  stone: 'whitestone',
};

/** The material a wall is built from, inferred from its colour. */
function wallMaterialOf(style: BuildingStyle): MaterialName {
  if (style.wallMaterial) return style.wallMaterial;
  switch (style.wall) {
    case WHITE_STONE:
      return 'whitestone';
    case STONE:
    case PALETTE.stoneMid:
    case PALETTE.stoneDark:
      return 'granite';
    case PLASTER:
      return 'plaster';
    case PALETTE.timber:
    case PALETTE.timberLight:
      return 'plank';
    case PALETTE.grass:
      return 'plain';
    default:
      return 'plaster';
  }
}

/**
 * Shift a material's colour a little per variant: no two thatched roofs in
 * a village have weathered to quite the same straw.
 */
function weather(base: string, variant: number, amount: number): string {
  const drift = ((variant * 2654435761) % 1000) / 1000 - 0.5;
  return mix(base, drift > 0 ? '#FFF2CE' : '#4A4032', Math.abs(drift) * 2 * amount);
}

const PADDING = 14;
/**
 * How far a building is set back from the edge of its lot, in pixels across
 * the footprint. It leaves a garden around a cottage and barely touches a
 * cathedral.
 */
const LOT_INSET = 7;
const cache = new Map<string, Sprite>();

export function clearSpriteCache(): void {
  cache.clear();
}

/**
 * Fetch (and, on first use, draw) the sprite for a building.
 * `abandoned` swaps in the derelict treatment.
 */
/** Distinct drawings kept per definition. Each is a few kilobytes. */
export const VARIANT_COUNT = 6;

export function getBuildingSprite(
  defId: string,
  variant: number,
  facing: number,
  abandoned = false,
): Sprite {
  const index = variant % VARIANT_COUNT;
  const key = `${defId}|${index}|${facing % 4}|${abandoned ? 'r' : 'w'}`;
  const existing = cache.get(key);
  if (existing) return existing;
  const sprite = drawBuilding(defId, index, facing % 4, abandoned);
  cache.set(key, sprite);
  return sprite;
}

function drawBuilding(defId: string, variant: number, facing: number, abandoned: boolean): Sprite {
  const def = getDef(defId);
  const style = BUILDING_STYLES[defId] ?? DEFAULT_STYLE;
  const roof = ROOF_SETS[style.roof];

  // Variants nudge the proportions, turn the ridge and weather the roof, so
  // a street of the same house type does not read as a row of clones.
  const jitter = 0.88 + (variant / VARIANT_COUNT) * 0.26;
  const wallHeight = Math.round(style.wallHeight * jitter);
  const roofHeight = Math.round(style.roofHeight * jitter);
  const extra = style.features.includes('spire') ? roofHeight * 1.6 : style.features.includes('headframe') ? 46 : 18;
  const totalHeight = wallHeight + roofHeight + extra;

  const spanW = (def.width + def.height) * HALF_WIDTH;
  const spanH = (def.width + def.height) * HALF_HEIGHT;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(spanW + PADDING * 2);
  canvas.height = Math.ceil(spanH + totalHeight + PADDING * 2);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is unavailable');

  const originX = def.height * HALF_WIDTH + PADDING;
  const originY = totalHeight + PADDING;
  ctx.translate(originX, originY);
  ctx.lineJoin = 'round';

  const lot = footprintCorners(def.width, def.height);
  // The building itself stands inside its lot, leaving ground around it.
  const corners = insetFootprint(lot, LOT_INSET);
  const centre = { x: (corners[1].x + corners[3].x) / 2, y: (corners[0].y + corners[2].y) / 2 };

  groundShadow(ctx, { x: centre.x, y: centre.y + 2 }, spanW * 0.4, spanH * 0.4, 0.24);

  // Ground-level decoration covers the whole lot, not just the building.
  if (style.features.includes('field')) drawField(ctx, lot, variant);
  if (style.features.includes('garden')) drawGarden(ctx, lot, variant);
  if (style.features.includes('pier')) drawPier(ctx, lot);
  if (style.features.includes('lists')) drawArena(ctx, lot);

  const context: DrawContext = {
    ctx,
    corners,
    centre,
    style,
    roof,
    roofSkin: {
      material: ROOF_MATERIAL[style.roof],
      color: weather(roof.main, variant, 0.14),
      seed: variant * 17 + 3,
    },
    wallSkin: {
      material: wallMaterialOf(style),
      color: weather(style.wall, variant + 2, 0.07),
      seed: variant * 11,
    },
    wallHeight,
    roofHeight,
    variant,
    facing,
    def,
  };

  if (style.roofShape === 'none') {
    drawGroundOnlyBuilding(context);
  } else {
    drawMainMass(context);
  }

  for (const feature of style.features) drawFeature(context, feature);

  if (abandoned) drawRuin(ctx, corners, wallHeight);

  const sprite = { canvas, originX, originY };
  return sprite;
}

interface DrawContext {
  ctx: CanvasRenderingContext2D;
  corners: Point[];
  centre: Point;
  style: BuildingStyle;
  roof: { main: string; light: string; dark: string };
  /** What the roof is made of, ready to hand to a shape. */
  roofSkin: Skin;
  /** What the walls are made of. */
  wallSkin: Skin;
  wallHeight: number;
  roofHeight: number;
  variant: number;
  facing: number;
  def: { width: number; height: number };
}

/** Walls, roof, timber framing and windows: the body of a building. */
function drawMainMass(context: DrawContext): void {
  const { ctx, corners, style, roofSkin, wallSkin, wallHeight, roofHeight, facing, def, variant } = context;

  // The shadow the whole mass throws, laid down before anything is built.
  castShadow(ctx, corners, wallHeight + roofHeight * 0.6, 0.18);

  // Grander buildings sit on a plinth, which reads as weight.
  const plinth = plinthHeight(wallHeight);
  let base = wallFootprint(context);
  if (plinth > 0) {
    base = isoBox(ctx, base, plinth, {
      material: 'granite',
      color: PALETTE.stoneMid,
      seed: variant,
    });
  }

  const top = isoBox(ctx, base, wallHeight, wallSkin);

  if (style.timbered) drawTimberFraming(ctx, base, wallHeight);
  if (style.windows) {
    windowRow(ctx, base[3], base[2], wallHeight, Math.max(1, def.height), style.windows);
    windowRow(ctx, base[1], base[2], wallHeight, Math.max(1, def.width), style.windows);
  }
  drawDoor(ctx, base, wallHeight, facing);

  const overhang = roofOverhang(context);
  switch (style.roofShape) {
    case 'hip':
      hipRoof(ctx, top, roofHeight, roofSkin, overhang);
      break;
    case 'cone': {
      const cone = coneGeometry(context, top);
      coneRoof(ctx, cone.centre, cone.radiusX, cone.radiusY, roofHeight, roofSkin);
      break;
    }
    case 'flat':
      drawFlatRoof(ctx, top, roofSkin, overhang);
      break;
    default:
      gableRoof(ctx, top, roofHeight, roofSkin, gableAxis(context), overhang);
      break;
  }
}

// --- Roof geometry ----------------------------------------------------------
//
// The roof is drawn by `drawMainMass` and stood on by the features that
// follow it, so where it sits is worked out here once and read by both.

/** Grander buildings sit on a plinth, which the roof has to clear. */
function plinthHeight(wallHeight: number): number {
  return wallHeight > 34 ? 5 : 0;
}

/** The footprint the walls stand on, widened where there is a plinth. */
function wallFootprint(context: DrawContext): Point[] {
  return plinthHeight(context.wallHeight) > 0 ? expand(context.corners, 2) : context.corners;
}

/** The corners of the wall head — the plate the roof is built on. */
function wallTop(context: DrawContext): Point[] {
  return raise(wallFootprint(context), context.wallHeight + plinthHeight(context.wallHeight));
}

/** How far the roof oversails the wall below it. */
function roofOverhang(context: DrawContext): number {
  if (context.style.roofShape === 'gable') {
    return context.def.width * context.def.height > 1 ? 5 : 3;
  }
  return context.style.roofShape === 'flat' ? 4 : 5;
}

/** Which way a gable's ridge runs: along the long side, or by variant. */
function gableAxis(context: DrawContext): 0 | 1 {
  const { def, variant } = context;
  if (def.width === def.height) return (variant % 2) as 0 | 1;
  return def.width > def.height ? 0 : 1;
}

function coneGeometry(
  context: DrawContext,
  top: Point[],
): { centre: Point; radiusX: number; radiusY: number } {
  const { def } = context;
  return {
    centre: { x: (top[1].x + top[3].x) / 2, y: (top[0].y + top[2].y) / 2 },
    radiusX: (def.width + def.height) * HALF_WIDTH * 0.36,
    radiusY: HALF_HEIGHT * 0.6,
  };
}

/** A place on the roof for something that has to stand on it. */
interface RoofMount {
  /** A point on the roof surface itself. */
  anchor: Point;
  /** How far below the anchor the foot is buried, so it leaves no gap. */
  sink: number;
  /**
   * The roofline that hides the foot, ordered left to right. Anything below
   * it is behind roof the viewer can see, so it is clipped away instead of
   * being painted over the slope.
   */
  cut?: Point[];
}

/**
 * Where a stack meets the roof. `along` runs 0..1 from one end of the ridge
 * to the other; on a roof that peaks at a point it picks a side instead.
 */
function roofMount(context: DrawContext, along: number): RoofMount {
  const { style, roofHeight, centre, wallHeight } = context;
  const top = wallTop(context);
  const overhang = roofOverhang(context);
  const eaves = expand(top, overhang);
  const [north, east, , west] = eaves;

  switch (style.roofShape) {
    case 'hip': {
      const apex = hipApex(top, roofHeight, overhang);
      // Behind the peak, so the near slopes cut the foot of the stack.
      const back = midpoint(north, along < 0.5 ? east : west);
      return {
        anchor: lerpPoint(apex, back, 0.3),
        sink: roofHeight * 0.8,
        cut: leftToRight([west, apex, east]),
      };
    }
    case 'cone': {
      const cone = coneGeometry(context, top);
      const tip = { x: cone.centre.x, y: cone.centre.y - roofHeight };
      return {
        anchor: lerpPoint(tip, cone.centre, 0.3),
        sink: roofHeight * 0.5,
        cut: leftToRight([
          { x: cone.centre.x - cone.radiusX, y: cone.centre.y },
          tip,
          { x: cone.centre.x + cone.radiusX, y: cone.centre.y },
        ]),
      };
    }
    case 'flat':
      // No slope to emerge from: the stack stands on the parapet instead.
      return { anchor: lerpPoint(centroid(eaves), north, 0.7 - along * 0.3), sink: 4 };
    case 'none':
      return { anchor: { x: centre.x, y: centre.y - wallHeight }, sink: 0 };
    default: {
      const { start, end } = gableRidge(top, roofHeight, gableAxis(context), overhang);
      return {
        anchor: lerpPoint(start, end, along),
        sink: roofHeight,
        cut: leftToRight([west, start, end, east]),
      };
    }
  }
}

/** Wells, gardens and fountains have no walls to speak of. */
function drawGroundOnlyBuilding(context: DrawContext): void {
  const { ctx, corners } = context;
  fillFace(ctx, corners, withAlpha(PALETTE.dirt, 0.35), false);
}

function drawFlatRoof(ctx: CanvasRenderingContext2D, top: Point[], skin: Skin, overhang = 4): void {
  const eaves = expand(top, overhang);
  paintFace(ctx, eaves, skin.material, skin.color, { surface: 'top', seed: skin.seed, occlude: false });
  strokeSilhouette(ctx, eaves);
}

/** The dark exposed beams of a Goldshire half-timbered wall. */
function drawTimberFraming(ctx: CanvasRenderingContext2D, base: Point[], wallHeight: number): void {
  ctx.save();
  ctx.strokeStyle = PALETTE.timberDark;
  ctx.lineWidth = 2.2;
  for (const [from, to] of [
    [base[3], base[2]],
    [base[1], base[2]],
  ]) {
    // Sill, lintel and the uprights between them.
    for (const level of [0.28, 0.86]) {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y - wallHeight * level);
      ctx.lineTo(to.x, to.y - wallHeight * level);
      ctx.stroke();
    }
    for (let i = 0; i <= 3; i++) {
      const point = lerpPoint(from, to, i / 3);
      ctx.beginPath();
      ctx.moveTo(point.x, point.y - wallHeight * 0.28);
      ctx.lineTo(point.x, point.y - wallHeight * 0.86);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** A door on whichever street-facing wall the building turns toward. */
function drawDoor(ctx: CanvasRenderingContext2D, base: Point[], wallHeight: number, facing: number): void {
  // Only the south-west and south-east walls are visible, so the door goes
  // on whichever of the two is closer to the way the building faces.
  const onSouthEast = facing === 1 || facing === 2;
  const from = onSouthEast ? base[1] : base[3];
  const to = base[2];
  const centre = lerpPoint(from, to, 0.5);
  const width = 6;
  const height = wallHeight * 0.6;

  ctx.beginPath();
  ctx.moveTo(centre.x - width / 2, centre.y - 1);
  ctx.lineTo(centre.x + width / 2, centre.y - 1 + (onSouthEast ? -3 : 3));
  ctx.lineTo(centre.x + width / 2, centre.y - height + (onSouthEast ? -3 : 3));
  ctx.lineTo(centre.x - width / 2, centre.y - height);
  ctx.closePath();
  ctx.fillStyle = PALETTE.timberDark;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.stroke();
}

// --- Features ---------------------------------------------------------------

function drawFeature(context: DrawContext, feature: Feature): void {
  switch (feature) {
    case 'chimney':
      drawChimney(context, 6, PALETTE.stoneMid);
      break;
    case 'smokestack':
      drawChimney(context, 9, PALETTE.stoneDark, true);
      break;
    case 'banner':
      drawBanners(context);
      break;
    case 'sign':
      drawSign(context);
      break;
    case 'porch':
      drawPorch(context);
      break;
    case 'fence':
      drawFence(context);
      break;
    case 'crates':
      drawCrates(context);
      break;
    case 'waterwheel':
      drawWaterwheel(context);
      break;
    case 'headframe':
      drawHeadframe(context);
      break;
    case 'spire':
      drawSpire(context);
      break;
    case 'crenellations':
      drawCrenellations(context);
      break;
    case 'awning':
      drawAwning(context);
      break;
    case 'stall':
      drawStalls(context);
      break;
    case 'well':
      drawWell(context);
      break;
    case 'fountain':
      drawFountain(context);
      break;
    case 'waggon':
      drawWaggon(context);
      break;
    case 'arches':
      drawArches(context);
      break;
    case 'rose':
      drawRoseWindow(context);
      break;
    case 'brazier':
      drawBrazier(context);
      break;
    case 'water':
      drawWaterSurface(context);
      break;
    case 'lists':
      drawLists(context);
      break;
    case 'pavilions':
      drawPavilions(context);
      break;
    default:
      break;
  }
}

/**
 * A chimney stack. It is planted on the ridge and sunk into the roof, so it
 * emerges from the slope with no gap under it and the roof's own silhouette
 * cuts its foot — a detail on the roofline, not a post standing behind the
 * house.
 */
function drawChimney(context: DrawContext, width: number, color: string, smoking = false): void {
  const { ctx, roofHeight, variant } = context;
  const mount = roofMount(context, 0.32 + (variant % 2) * 0.26);
  const anchor = mount.anchor;
  const base = anchor.y + mount.sink;
  // How far the stack stands proud of the roof it came out of.
  const clearance = smoking ? Math.max(15, roofHeight * 0.9) : Math.max(10, roofHeight * 0.6);
  const stackTop = anchor.y - clearance;
  const colors = {
    left: light(color, 'left'),
    right: light(color, 'right'),
    top: light(color, 'top'),
  };
  const half = width / 2;
  const skew = width * 0.3;

  ctx.save();
  if (mount.cut) clipAboveRoofline(ctx, mount.cut);
  fillFace(ctx, [
    { x: anchor.x - half, y: stackTop },
    { x: anchor.x, y: stackTop + skew },
    { x: anchor.x, y: base },
    { x: anchor.x - half, y: base - skew },
  ], colors.left);
  fillFace(ctx, [
    { x: anchor.x + half, y: stackTop },
    { x: anchor.x, y: stackTop + skew },
    { x: anchor.x, y: base },
    { x: anchor.x + half, y: base - skew },
  ], colors.right);
  fillFace(ctx, [
    { x: anchor.x - half, y: stackTop },
    { x: anchor.x, y: stackTop - skew },
    { x: anchor.x + half, y: stackTop },
    { x: anchor.x, y: stackTop + skew },
  ], colors.top);
  ctx.restore();

  if (smoking) {
    ctx.fillStyle = 'rgba(210, 205, 196, 0.42)';
    for (let i = 0; i < 3; i++) {
      const puff = stackTop - 7 - i * 10;
      ctx.beginPath();
      ctx.arc(anchor.x + i * 3, puff, 4.5 + i * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawBanners(context: DrawContext): void {
  const { ctx, corners, wallHeight, def } = context;
  // One banner per visible wall on a modest building; a pair on a grand one.
  const spots = def.width * def.height > 1 ? [0.26, 0.74] : [0.5];
  for (const [a, b] of [[corners[3], corners[2]], [corners[1], corners[2]]]) {
    for (const t of spots) {
      const point = lerpPoint(a, b, t);
      banner(ctx, { x: point.x, y: point.y - wallHeight * 0.9 }, 7, 15, PALETTE.alliance, PALETTE.gold);
    }
  }
}

function drawSign(context: DrawContext): void {
  const { ctx, corners, wallHeight, variant } = context;
  const anchor = lerpPoint(corners[3], corners[2], 0.24);
  const y = anchor.y - wallHeight * 0.78;

  ctx.strokeStyle = PALETTE.timberDark;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(anchor.x, y);
  ctx.lineTo(anchor.x - 11, y - 3);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(anchor.x - 11, y - 3);
  ctx.lineTo(anchor.x - 11, y + 8);
  ctx.stroke();

  const colors = [PALETTE.roofRed, PALETTE.alliance, PALETTE.emerald, PALETTE.goldDark];
  ctx.beginPath();
  ctx.ellipse(anchor.x - 11, y + 12, 6, 5, 0, 0, Math.PI * 2);
  ctx.fillStyle = colors[variant % colors.length];
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawPorch(context: DrawContext): void {
  const { ctx, corners, wallHeight } = context;
  const from = lerpPoint(corners[3], corners[2], 0.35);
  const to = lerpPoint(corners[3], corners[2], 0.75);
  const depth = 7;
  const roofY = wallHeight * 0.72;

  const outer = [
    { x: from.x - depth, y: from.y + depth * 0.5 },
    { x: to.x - depth, y: to.y + depth * 0.5 },
  ];
  fillFace(ctx, [
    { x: from.x, y: from.y - roofY },
    { x: to.x, y: to.y - roofY },
    { x: outer[1].x, y: outer[1].y - roofY + 4 },
    { x: outer[0].x, y: outer[0].y - roofY + 4 },
  ], PALETTE.timberLight);

  ctx.strokeStyle = PALETTE.timberDark;
  ctx.lineWidth = 2;
  for (const post of outer) {
    ctx.beginPath();
    ctx.moveTo(post.x, post.y);
    ctx.lineTo(post.x, post.y - roofY + 4);
    ctx.stroke();
  }
}

function drawFence(context: DrawContext): void {
  const { ctx, corners } = context;
  ctx.strokeStyle = PALETTE.timber;
  ctx.lineWidth = 1.6;
  for (const [a, b] of [[corners[3], corners[2]], [corners[1], corners[2]]]) {
    const from = { x: a.x, y: a.y + 3 };
    const to = { x: b.x, y: b.y + 3 };
    ctx.beginPath();
    ctx.moveTo(from.x, from.y - 5);
    ctx.lineTo(to.x, to.y - 5);
    ctx.stroke();
    for (let i = 0; i <= 5; i++) {
      const post = lerpPoint(from, to, i / 5);
      ctx.beginPath();
      ctx.moveTo(post.x, post.y);
      ctx.lineTo(post.x, post.y - 8);
      ctx.stroke();
    }
  }
}

/** Ploughed strips of wheat and pumpkin beside a farmstead. */
function drawField(ctx: CanvasRenderingContext2D, corners: Point[], variant: number): void {
  fillFace(ctx, corners, PALETTE.dirt, false);
  const stripes = 7;
  ctx.strokeStyle = withAlpha(PALETTE.dirtDark, 0.8);
  ctx.lineWidth = 2;
  for (let i = 1; i < stripes; i++) {
    const a = lerpPoint(corners[0], corners[1], i / stripes);
    const b = lerpPoint(corners[3], corners[2], i / stripes);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  // A scatter of crops on top of the furrows.
  const crop = variant % 2 === 0 ? PALETTE.thatch : PALETTE.meadow;
  for (let i = 0; i < 26; i++) {
    const u = hash2(i, variant, 7);
    const v = hash2(variant, i, 13);
    const edgeA = lerpPoint(corners[0], corners[1], u);
    const edgeB = lerpPoint(corners[3], corners[2], u);
    const point = lerpPoint(edgeA, edgeB, v);
    ctx.fillStyle = crop;
    ctx.fillRect(point.x - 1, point.y - 3, 2, 4);
  }
}

function drawGarden(ctx: CanvasRenderingContext2D, corners: Point[], variant: number): void {
  fillFace(ctx, corners, PALETTE.grassLight, false);
  fillFace(ctx, expand(corners, -4), PALETTE.forestFloor, false);
  const blooms = ['#E8E2F0', '#F2D65C', '#D9799B', '#8FD0E8'];
  for (let i = 0; i < 22; i++) {
    const u = hash2(i * 3, variant, 21);
    const v = hash2(variant, i * 5, 31);
    const edgeA = lerpPoint(corners[0], corners[1], 0.15 + u * 0.7);
    const edgeB = lerpPoint(corners[3], corners[2], 0.15 + u * 0.7);
    const point = lerpPoint(edgeA, edgeB, 0.15 + v * 0.7);
    ctx.beginPath();
    ctx.arc(point.x, point.y - 2, 1.8, 0, Math.PI * 2);
    ctx.fillStyle = blooms[i % blooms.length];
    ctx.fill();
  }
}

function drawCrates(context: DrawContext): void {
  const { ctx, corners, variant } = context;
  const spot = lerpPoint(corners[3], corners[2], 0.16);
  for (let i = 0; i < 3; i++) {
    const x = spot.x + 4 + i * 7 + (variant % 2) * 2;
    const y = spot.y + 4 - i * 2;
    const size = 6;
    fillFace(ctx, [
      { x, y: y - size },
      { x: x + size, y: y - size + size * 0.5 },
      { x: x + size, y: y + size * 0.5 },
      { x, y },
    ], PALETTE.timberLight);
    fillFace(ctx, [
      { x, y: y - size },
      { x: x - size, y: y - size + size * 0.5 },
      { x: x - size, y: y + size * 0.5 },
      { x, y },
    ], PALETTE.timber);
  }
}

function drawWaterwheel(context: DrawContext): void {
  const { ctx, corners, wallHeight } = context;
  const anchor = lerpPoint(corners[3], corners[2], 0.12);
  const cx = anchor.x - 8;
  const cy = anchor.y - wallHeight * 0.35;
  const radius = 13;

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = PALETTE.timberDark;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.62, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * radius * 0.6, cy + Math.sin(angle) * radius * 0.6);
    ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = PALETTE.timber;
    ctx.stroke();
  }
}

/** The winding gear over a Fargodeep shaft. */
function drawHeadframe(context: DrawContext): void {
  const { ctx, corners, wallHeight } = context;
  const anchor = lerpPoint(corners[3], corners[2], 0.2);
  const baseY = anchor.y - wallHeight * 0.1;
  const height = 40;
  const spread = 11;

  ctx.strokeStyle = PALETTE.timberDark;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(anchor.x - spread, baseY);
  ctx.lineTo(anchor.x, baseY - height);
  ctx.lineTo(anchor.x + spread, baseY);
  ctx.stroke();

  ctx.lineWidth = 2;
  for (const level of [0.35, 0.68]) {
    ctx.beginPath();
    ctx.moveTo(anchor.x - spread * (1 - level), baseY - height * level);
    ctx.lineTo(anchor.x + spread * (1 - level), baseY - height * level);
    ctx.stroke();
  }

  // The pulley wheel at the top.
  ctx.beginPath();
  ctx.arc(anchor.x, baseY - height - 2, 5, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.rock;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.4;
  ctx.stroke();
}

/** A slender blue-roofed tower, the silhouette of Stormwind. */
function drawSpire(context: DrawContext): void {
  const { ctx, corners, roof, wallHeight, roofHeight, style } = context;
  const anchor = lerpPoint(corners[0], corners[3], 0.5);
  const baseY = anchor.y + 6;
  const towerHeight = wallHeight * 1.25;
  const radius = 9;

  const top = cylinder(ctx, { x: anchor.x, y: baseY }, radius, radius * 0.5, towerHeight, {
    material: 'whitestone',
    color: style.wall,
    seed: context.variant,
  });
  coneRoof(ctx, top, radius + 2, radius * 0.55, roofHeight * 1.5, {
    material: ROOF_MATERIAL[style.roof],
    color: roof.main,
    seed: context.variant,
  });

  // A pennant on the finial.
  ctx.strokeStyle = PALETTE.stoneDark;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(top.x, top.y - roofHeight * 1.5);
  ctx.lineTo(top.x, top.y - roofHeight * 1.5 - 10);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(top.x, top.y - roofHeight * 1.5 - 10);
  ctx.lineTo(top.x + 9, top.y - roofHeight * 1.5 - 7);
  ctx.lineTo(top.x, top.y - roofHeight * 1.5 - 4);
  ctx.closePath();
  ctx.fillStyle = PALETTE.gold;
  ctx.fill();
}

/**
 * A crenellated parapet round the wall head. It only belongs where the roof
 * does not overhang it; on a pitched roof the merlons would poke out from
 * under the eaves, so those buildings get a plain string course instead.
 */
function drawCrenellations(context: DrawContext): void {
  const { ctx, corners, wallHeight, style, wallSkin, variant } = context;
  const top = raise(corners, wallHeight);
  const pitched = style.roofShape === 'gable' || style.roofShape === 'hip';

  if (pitched) {
    // A moulded band under the eaves: martial, but out of the roof's way.
    for (const [a, b] of [[top[3], top[2]], [top[1], top[2]]]) {
      ctx.strokeStyle = withAlpha(PALETTE.stoneMid, 0.85);
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y + 3);
      ctx.lineTo(b.x, b.y + 3);
      ctx.stroke();
      ctx.strokeStyle = withAlpha('#FFF6E0', 0.3);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y + 1.6);
      ctx.lineTo(b.x, b.y + 1.6);
      ctx.stroke();
    }
    return;
  }

  for (const [a, b] of [[top[3], top[2]], [top[1], top[2]]]) {
    const merlons = 4;
    for (let i = 0; i < merlons; i++) {
      const centre = (i + 0.5) / merlons;
      const from = lerpPoint(a, b, Math.max(0, centre - 0.13));
      const to = lerpPoint(a, b, Math.min(1, centre + 0.13));
      const height = 7;
      paintFace(
        ctx,
        [
          { x: from.x, y: from.y - height },
          { x: to.x, y: to.y - height },
          { x: to.x, y: to.y },
          { x: from.x, y: from.y },
        ],
        wallSkin.material,
        wallSkin.color,
        { surface: a === top[3] ? 'left' : 'right', seed: variant + i, occlude: false },
      );
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y - height);
      ctx.lineTo(to.x, to.y - height);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
  }
}

function drawAwning(context: DrawContext): void {
  const { ctx, corners, wallHeight, variant } = context;
  const from = lerpPoint(corners[3], corners[2], 0.15);
  const to = lerpPoint(corners[3], corners[2], 0.85);
  const y = wallHeight * 0.72 + 4;
  const depth = 9;

  const stripes = 6;
  for (let i = 0; i < stripes; i++) {
    const a = lerpPoint(from, to, i / stripes);
    const b = lerpPoint(from, to, (i + 1) / stripes);
    fillFace(ctx, [
      { x: a.x, y: a.y - y },
      { x: b.x, y: b.y - y },
      { x: b.x - depth, y: b.y - y + depth * 0.6 },
      { x: a.x - depth, y: a.y - y + depth * 0.6 },
    ], i % 2 === (variant % 2) ? PALETTE.roofRedLight : PALETTE.parchment, false);
  }
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  polygon(ctx, [
    { x: from.x, y: from.y - y },
    { x: to.x, y: to.y - y },
    { x: to.x - depth, y: to.y - y + depth * 0.6 },
    { x: from.x - depth, y: from.y - y + depth * 0.6 },
  ]);
  ctx.stroke();
}

/** Trestle tables under canvas: a market in full cry. */
function drawStalls(context: DrawContext): void {
  const { ctx, corners, def, variant } = context;
  const count = Math.max(2, def.width * def.height);
  for (let i = 0; i < count; i++) {
    const u = 0.2 + ((i * 0.37 + variant * 0.13) % 0.6);
    const v = 0.2 + ((i * 0.61 + variant * 0.29) % 0.6);
    const edgeA = lerpPoint(corners[0], corners[1], u);
    const edgeB = lerpPoint(corners[3], corners[2], u);
    const spot = lerpPoint(edgeA, edgeB, v);

    fillFace(ctx, [
      { x: spot.x, y: spot.y - 14 },
      { x: spot.x + 10, y: spot.y - 9 },
      { x: spot.x, y: spot.y - 4 },
      { x: spot.x - 10, y: spot.y - 9 },
    ], i % 2 === 0 ? PALETTE.roofRedLight : PALETTE.alliance);
    ctx.fillStyle = PALETTE.timber;
    ctx.fillRect(spot.x - 7, spot.y - 6, 14, 3);
  }
}

function drawWell(context: DrawContext): void {
  const { ctx, centre, style } = context;
  const top = cylinder(ctx, { x: centre.x, y: centre.y + 4 }, 12, 6, 11, {
    material: 'granite',
    color: style.wall,
    seed: context.variant,
  });

  ctx.beginPath();
  ctx.ellipse(top.x, top.y, 8, 4, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#22384A';
  ctx.fill();

  // Posts and a little shingled cap.
  ctx.strokeStyle = PALETTE.timberDark;
  ctx.lineWidth = 2.2;
  for (const dx of [-10, 10]) {
    ctx.beginPath();
    ctx.moveTo(top.x + dx, top.y);
    ctx.lineTo(top.x + dx, top.y - 16);
    ctx.stroke();
  }
  fillFace(ctx, [
    { x: top.x, y: top.y - 26 },
    { x: top.x + 14, y: top.y - 15 },
    { x: top.x, y: top.y - 12 },
    { x: top.x - 14, y: top.y - 15 },
  ], PALETTE.roofRed);
}

function drawFountain(context: DrawContext): void {
  const { ctx, centre } = context;
  ctx.beginPath();
  ctx.ellipse(centre.x, centre.y + 2, 22, 11, 0, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.stoneLight;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(centre.x, centre.y + 2, 17, 8, 0, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.waterLight;
  ctx.fill();

  // A lion on a plinth, spilling water.
  cylinder(ctx, { x: centre.x, y: centre.y }, 5, 2.5, 12, { material: 'whitestone', color: PALETTE.stone });
  ctx.beginPath();
  ctx.ellipse(centre.x, centre.y - 15, 5, 6, 0, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.gold;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
}

function drawWaggon(context: DrawContext): void {
  const { ctx, corners } = context;
  const spot = lerpPoint(corners[3], corners[2], 0.2);
  const x = spot.x - 6;
  const y = spot.y + 2;

  fillFace(ctx, [
    { x: x - 12, y: y - 10 },
    { x: x + 12, y: y - 16 },
    { x: x + 12, y: y - 6 },
    { x: x - 12, y },
  ], PALETTE.parchment);
  ctx.fillStyle = PALETTE.timberDark;
  for (const dx of [-8, 8]) {
    ctx.beginPath();
    ctx.arc(x + dx, y + (dx > 0 ? -4 : 2), 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** The arcades that carry Stormwind's aqueducts and canals. */
function drawArches(context: DrawContext): void {
  const { ctx, corners, wallHeight, style } = context;
  ctx.fillStyle = shade(style.wall, -0.3);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  for (const [a, b] of [[corners[3], corners[2]], [corners[1], corners[2]]]) {
    const count = 3;
    for (let i = 0; i < count; i++) {
      const point = lerpPoint(a, b, (i + 0.5) / count);
      const top = point.y - wallHeight * 0.62;
      ctx.beginPath();
      ctx.moveTo(point.x - 5, point.y - 2);
      ctx.lineTo(point.x - 5, top);
      ctx.arc(point.x, top, 5, Math.PI, 0);
      ctx.lineTo(point.x + 5, point.y - 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }
}

function drawRoseWindow(context: DrawContext): void {
  const { ctx, corners, wallHeight } = context;
  const centre = lerpPoint(corners[3], corners[2], 0.5);
  const y = centre.y - wallHeight * 0.62;

  ctx.beginPath();
  ctx.arc(centre.x, y, 9, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.alliance;
  ctx.fill();
  ctx.strokeStyle = PALETTE.stoneDark;
  ctx.lineWidth = 1.6;
  ctx.stroke();

  ctx.strokeStyle = PALETTE.stoneLight;
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(centre.x, y);
    ctx.lineTo(centre.x + Math.cos(angle) * 9, y + Math.sin(angle) * 9);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(centre.x, y, 3, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.gold;
  ctx.fill();
}

/** Open water held inside a stone tank or channel. */
function drawWaterSurface(context: DrawContext): void {
  const { ctx, corners, wallHeight } = context;
  const top = raise(expand(corners, -7), wallHeight);
  fillFace(ctx, top, PALETTE.water, false);
  fillFace(ctx, expand(top, -3), PALETTE.waterLight, false);
  ctx.strokeStyle = withAlpha(PALETTE.waterFoam, 0.55);
  ctx.lineWidth = 1.6;
  for (let i = 1; i < 4; i++) {
    const a = lerpPoint(top[0], top[1], i / 4);
    const b = lerpPoint(top[3], top[2], i / 4);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

/** The sanded ground of a tourney field, inside its rail. */
function drawArena(ctx: CanvasRenderingContext2D, corners: Point[]): void {
  fillFace(ctx, corners, PALETTE.grassLight, false);
  const track = expand(corners, -10);
  fillFace(ctx, track, PALETTE.sand, false);
  fillFace(ctx, expand(track, -8), PALETTE.sandDark, false);
}

/** The rail down the middle of the lists, where the charge is run. */
function drawLists(context: DrawContext): void {
  const { ctx, corners } = context;
  const from = lerpPoint(lerpPoint(corners[0], corners[3], 0.5), lerpPoint(corners[1], corners[2], 0.5), 0.22);
  const to = lerpPoint(lerpPoint(corners[0], corners[3], 0.5), lerpPoint(corners[1], corners[2], 0.5), 0.78);

  ctx.strokeStyle = PALETTE.timberLight;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y - 6);
  ctx.lineTo(to.x, to.y - 6);
  ctx.stroke();
  ctx.strokeStyle = PALETTE.timberDark;
  ctx.lineWidth = 2;
  for (let i = 0; i <= 6; i++) {
    const post = lerpPoint(from, to, i / 6);
    ctx.beginPath();
    ctx.moveTo(post.x, post.y);
    ctx.lineTo(post.x, post.y - 8);
    ctx.stroke();
  }
}

/** Striped pavilions pitched around the field, with the champions' colours. */
function drawPavilions(context: DrawContext): void {
  const { ctx, corners, variant } = context;
  const colors = [PALETTE.alliance, PALETTE.roofRed, PALETTE.roofViolet, PALETTE.emerald];
  const spots = [
    lerpPoint(corners[3], corners[0], 0.3),
    lerpPoint(corners[3], corners[2], 0.28),
    lerpPoint(corners[1], corners[2], 0.3),
    lerpPoint(corners[1], corners[0], 0.32),
  ];

  spots.forEach((spot, index) => {
    const color = colors[(index + variant) % colors.length];
    const height = 26;
    const radius = 11;
    // Canvas walls.
    fillFace(ctx, [
      { x: spot.x - radius, y: spot.y - height * 0.45 },
      { x: spot.x + radius, y: spot.y - height * 0.45 },
      { x: spot.x + radius, y: spot.y },
      { x: spot.x - radius, y: spot.y },
    ], PALETTE.parchment);
    // Striped conical roof.
    coneRoof(ctx, { x: spot.x, y: spot.y - height * 0.45 }, radius + 2, 4, height * 0.6, {
      material: 'canvas',
      color,
      seed: index * 5,
    });
    // A pennant on the pole.
    ctx.fillStyle = PALETTE.gold;
    ctx.beginPath();
    ctx.moveTo(spot.x, spot.y - height * 1.05);
    ctx.lineTo(spot.x + 7, spot.y - height * 1.05 + 3);
    ctx.lineTo(spot.x, spot.y - height * 1.05 + 6);
    ctx.closePath();
    ctx.fill();
  });
}

function drawBrazier(context: DrawContext): void {
  const { ctx, corners } = context;
  const spot = lerpPoint(corners[3], corners[2], 0.82);
  const x = spot.x - 4;
  const y = spot.y + 2;

  ctx.strokeStyle = PALETTE.rockDark;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - 10);
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(x, y - 11, 5, 2.6, 0, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.rock;
  ctx.fill();

  const flame = ctx.createRadialGradient(x, y - 15, 0, x, y - 15, 8);
  flame.addColorStop(0, '#FFE9A8');
  flame.addColorStop(0.5, '#FF9A3C');
  flame.addColorStop(1, 'rgba(255, 120, 40, 0)');
  ctx.beginPath();
  ctx.arc(x, y - 15, 8, 0, Math.PI * 2);
  ctx.fillStyle = flame;
  ctx.fill();
}

/** Timber jetties running out over the water. */
function drawPier(ctx: CanvasRenderingContext2D, corners: Point[]): void {
  fillFace(ctx, expand(corners, 6), PALETTE.timber, false);
  ctx.strokeStyle = PALETTE.timberDark;
  ctx.lineWidth = 1.2;
  const planks = 9;
  for (let i = 1; i < planks; i++) {
    const a = lerpPoint(corners[0], corners[1], i / planks);
    const b = lerpPoint(corners[3], corners[2], i / planks);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

/** Boarded windows, a sagging roof and weeds: an abandoned plot. */
function drawRuin(ctx: CanvasRenderingContext2D, corners: Point[], wallHeight: number): void {
  ctx.save();
  polygon(ctx, [
    { x: corners[0].x, y: corners[0].y - wallHeight * 2.4 },
    { x: corners[1].x, y: corners[1].y - wallHeight * 2.4 },
    corners[2],
    corners[3],
  ]);
  ctx.clip();
  ctx.fillStyle = 'rgba(58, 46, 30, 0.36)';
  ctx.fillRect(-200, -300, 500, 600);
  ctx.restore();

  // Boards nailed across the front.
  ctx.strokeStyle = PALETTE.timberDark;
  ctx.lineWidth = 2.4;
  const from = lerpPoint(corners[3], corners[2], 0.3);
  const to = lerpPoint(corners[3], corners[2], 0.7);
  for (const level of [0.3, 0.55]) {
    ctx.beginPath();
    ctx.moveTo(from.x - 2, from.y - wallHeight * level);
    ctx.lineTo(to.x + 2, to.y - wallHeight * (level + 0.08));
    ctx.stroke();
  }

  // Weeds pushing through the threshold.
  ctx.strokeStyle = mix(PALETTE.grassDark, PALETTE.dirt, 0.3);
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 8; i++) {
    const point = lerpPoint(corners[3], corners[2], 0.15 + i * 0.09);
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(point.x + (i % 2 ? 2 : -2), point.y - 6);
    ctx.stroke();
  }
}

export { midpoint };

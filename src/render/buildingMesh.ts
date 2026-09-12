/**
 * Buildings, as geometry.
 *
 * A building is assembled from the style table: a plinth footed on the
 * ground, a frame or a wall above it, an upper floor that may oversail on a
 * jetty, a steeply pitched roof with overhanging eaves and a capped ridge,
 * and whatever the style hangs on it — a chimney, a shop sign, a dovecote,
 * a spire.
 *
 * Two rules keep the town from reading as a pile of blocks. Nothing is a
 * bare box: walls are battered, eaves oversail, ridges are rounded, towers
 * and spires are lathes. And nothing floats or tilts: the floor is set at
 * the highest ground under the footprint and the plinth skirts down to the
 * lowest, so a house on a slope sits into the hill the way a real one does.
 */
import { Building } from '../sim/types';
import { WorldMap } from '../sim/terrain';
import { BuildingStyle, Feature, WallMaterial, styleFor } from '../data/styles';
import { getDef } from '../data/buildings';
import { PALETTE, ROOF_SETS } from './palette';
import {
  MeshBuilder,
  Rgb,
  blend,
  box,
  colour,
  cone,
  lathe,
  point,
  ridgedRoof,
  spheroid,
  tone,
} from './meshBuilder';
import { highestGround, lowestGround } from './world';
import { hash2 } from '../core/rng';
import { lerp } from '../core/math';

/** How many distinct drawings are kept per definition. */
export const VARIANT_COUNT = 6;

/** The colour of each walling material, and what its plinth is footed in. */
const WALL_COLOURS: Record<WallMaterial, { wall: string; trim: string }> = {
  daub: { wall: PALETTE.daub, trim: PALETTE.oak },
  limewash: { wall: PALETTE.limewash, trim: PALETTE.oak },
  frame: { wall: PALETTE.limewash, trim: PALETTE.oak },
  board: { wall: PALETTE.board, trim: PALETTE.oakDark },
  flint: { wall: PALETTE.flint, trim: PALETTE.limestone },
  rubble: { wall: PALETTE.rubble, trim: PALETTE.rubbleDark },
  limestone: { wall: PALETTE.limestone, trim: PALETTE.limestoneDark },
  none: { wall: PALETTE.grass, trim: PALETTE.rubble },
};

/** A deterministic stream of variation for one building. */
class Dice {
  private n = 0;
  constructor(private readonly seed: number) {}
  next(): number {
    return hash2(this.n++, 17, this.seed);
  }
  range(low: number, high: number): number {
    return low + this.next() * (high - low);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}

export interface BuildingPlacement {
  /** Footprint in tiles. */
  x: number;
  y: number;
  width: number;
  height: number;
  defId: string;
  variant: number;
  facing: number;
  abandoned: boolean;
}

export function placementOf(building: Building): BuildingPlacement {
  return {
    x: building.x,
    y: building.y,
    width: building.width,
    height: building.height,
    defId: building.defId,
    variant: building.variant,
    facing: building.facing,
    abandoned: building.abandoned,
  };
}

/**
 * Add one building to a batch.
 *
 * `floor` and `base` may be supplied when the caller already knows them —
 * the catalogue sheet draws on flat ground — otherwise they are read off the
 * relief.
 */
export function addBuilding(
  mesh: MeshBuilder,
  map: WorldMap | null,
  placement: BuildingPlacement,
  options: { floor?: number; base?: number } = {},
): void {
  const style = styleFor(placement.defId);
  const def = getDef(placement.defId);
  const dice = new Dice((placement.variant + 1) * 2654435761 + hashString(placement.defId));

  const inset = style.inset ?? 0.16;
  const footWidth = Math.max(0.4, placement.width - inset * 2);
  const footDepth = Math.max(0.4, placement.height - inset * 2);
  const cx = placement.x + placement.width / 2;
  const cz = placement.y + placement.height / 2;

  const floor =
    options.floor ??
    (map ? highestGround(map, placement.x, placement.y, placement.width, placement.height) : 0);
  const base =
    options.base ??
    (map ? lowestGround(map, placement.x, placement.y, placement.width, placement.height) : 0);

  // A quarter turn per facing, so a building's front follows its street.
  const yaw = (placement.facing % 4) * (Math.PI / 2);

  // Hold a building in proportion to the plot it stands on. A two-storey
  // town house on a single tile would otherwise come out taller than it is
  // wide by three to one, which reads as a tower rather than a house. The
  // cap only bites on small plots; a minster on nine tiles keeps its height.
  const slenderness = 1.9;
  const wallHeight = Math.min(style.wallHeight, Math.min(footWidth, footDepth) * slenderness);

  const materials = WALL_COLOURS[style.wall];
  // No two roofs in a village have weathered to the same straw, and no two
  // gables have been limewashed in the same year.
  const weather = dice.next() - 0.5;
  const damp = dice.next() - 0.5;
  let wallColour = tone(colour(materials.wall), weather * 0.2);
  let timberColour = tone(colour(materials.trim), damp * 0.18);
  const roofSet = ROOF_SETS[style.roof];
  let roofColour = blend(
    tone(colour(roofSet.main), weather * 0.26),
    colour(style.roof === 'thatch' ? PALETTE.moorDark : PALETTE.flint),
    Math.max(0, damp) * 0.22,
  );

  if (placement.abandoned) {
    // Lime washes off, straw goes black, timber silvers.
    const rot = colour(PALETTE.mudDark);
    wallColour = blend(wallColour, rot, 0.45);
    timberColour = blend(timberColour, rot, 0.4);
    roofColour = blend(roofColour, rot, 0.55);
  }

  // --- The plinth: stone footings, skirting down to the ground behind ------
  const plinthDrop = Math.max(0.14, floor - base + 0.18);
  const plinthColour = colour(style.wall === 'none' ? PALETTE.rubbleDark : materials.trim);
  if (style.wall !== 'none') {
    box(
      mesh,
      cx,
      floor - plinthDrop,
      cz,
      footWidth + 0.1,
      plinthDrop + 0.12,
      footDepth + 0.1,
      blend(colour(PALETTE.rubble), plinthColour, 0.4),
      { taper: 0.04, yaw, skipBottom: true, footOcclusion: 0.3 },
    );
  }

  const wallTop = floor + wallHeight;

  // --- Walls --------------------------------------------------------------
  if (wallHeight > 0.01 && style.wall !== 'none') {
    if (style.jetty) {
      // Ground floor, then an upper floor oversailing it on joist ends.
      const split = wallHeight * 0.52;
      addWall(mesh, style, cx, floor + 0.12, cz, footWidth, split, footDepth, yaw, wallColour, timberColour, dice, false);
      const over = 0.13;
      addJoists(mesh, cx, floor + 0.12 + split, cz, footWidth, footDepth, over, yaw, timberColour);
      addWall(
        mesh, style, cx, floor + 0.12 + split, cz,
        footWidth + over * 2, wallHeight - split, footDepth + over * 2,
        yaw, wallColour, timberColour, dice, true,
      );
    } else {
      addWall(mesh, style, cx, floor + 0.12, cz, footWidth, wallHeight, footDepth, yaw, wallColour, timberColour, dice, true);
    }
  }

  // --- Roof ---------------------------------------------------------------
  const roofWidth = style.jetty ? footWidth + 0.26 : footWidth;
  const roofDepth = style.jetty ? footDepth + 0.26 : footDepth;
  const ridgeColour =
    style.roof === 'thatch' ? tone(roofColour, 0.1) : colour(roofSet.light);

  switch (style.roofShape) {
    case 'gable':
    case 'halfHip':
    case 'hip': {
      const hip = style.roofShape === 'hip' ? 1 : style.roofShape === 'halfHip' ? 0.34 : 0;
      // Thatch is laid thick and rolls over the eaves; tile and slate sit
      // closer to the wall.
      const overhang = style.roof === 'thatch' ? 0.2 : 0.13;
      ridgedRoof(mesh, cx, wallTop, cz, roofWidth, roofDepth, style.roofHeight, hip, roofColour, {
        yaw,
        overhang,
        ridgeColour,
        gableColour: style.wall === 'frame' ? wallColour : tone(wallColour, -0.08),
      });
      if (style.roof === 'thatch') {
        // A thatcher finishes the eaves with a rolled edge and spars.
        addEaveRoll(mesh, cx, wallTop, cz, roofWidth, roofDepth, overhang, yaw, tone(roofColour, -0.08));
      }
      break;
    }
    case 'cone':
      cone(mesh, cx, wallTop, cz, Math.min(roofWidth, roofDepth) * 0.62, style.roofHeight, 14, roofColour);
      break;
    case 'flat':
      box(mesh, cx, wallTop, cz, roofWidth + 0.08, style.roofHeight, roofDepth + 0.08, colour(roofSet.main), {
        yaw,
        skipBottom: true,
        capTint: 0.06,
      });
      break;
    default:
      break;
  }

  // --- Dressing -----------------------------------------------------------
  const context: FeatureContext = {
    mesh,
    cx,
    cz,
    floor,
    wallTop,
    ridge: wallTop + style.roofHeight,
    width: footWidth,
    depth: footDepth,
    plotWidth: placement.width,
    plotDepth: placement.height,
    yaw,
    style,
    dice,
    wallColour,
    timberColour,
    roofColour,
    abandoned: placement.abandoned,
  };
  for (const feature of style.features) addFeature(context, feature);
  void def;
}

function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * One storey of wall.
 *
 * A framed wall is built as it was built: posts at the corners, a mid rail,
 * studs between, and daub panels set back behind them. The members are thin
 * slabs standing proud of the infill, so the frame casts its own shadow
 * across the panel rather than being painted on.
 */
function addWall(
  mesh: MeshBuilder,
  style: BuildingStyle,
  cx: number,
  baseY: number,
  cz: number,
  width: number,
  height: number,
  depth: number,
  yaw: number,
  wallColour: Rgb,
  timberColour: Rgb,
  dice: Dice,
  upper: boolean,
): void {
  const masonry = style.wall === 'flint' || style.wall === 'rubble' || style.wall === 'limestone';
  box(mesh, cx, baseY, cz, width, height, depth, wallColour, {
    yaw,
    taper: masonry ? 0.035 : 0.012,
    skipBottom: true,
    skipTop: true,
    footOcclusion: masonry ? 0.5 : 0.58,
  });

  if (style.wall === 'frame') {
    addFrame(mesh, cx, baseY, cz, width, height, depth, yaw, timberColour, dice);
  } else if (style.wall === 'board') {
    addBoarding(mesh, cx, baseY, cz, width, height, depth, yaw, timberColour);
  } else if (masonry) {
    addQuoins(mesh, cx, baseY, cz, width, height, depth, yaw, tone(wallColour, 0.12));
  }

  if (style.windows && style.windows !== 'none') {
    addWindows(mesh, style.windows, cx, baseY, cz, width, height, depth, yaw, timberColour, upper);
  }
  if (!upper) addDoor(mesh, cx, baseY, cz, width, height, depth, yaw, timberColour);
}

/** Corner posts, rails and studs, standing proud of the daub. */
function addFrame(
  mesh: MeshBuilder,
  cx: number,
  baseY: number,
  cz: number,
  width: number,
  height: number,
  depth: number,
  yaw: number,
  timber: Rgb,
  dice: Dice,
): void {
  const thickness = 0.055;
  const post = 0.1;
  const proud = 0.03;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const place = (ox: number, oz: number, y: number, w: number, h: number, d: number): void => {
    box(
      mesh,
      cx + ox * cos + oz * sin,
      y,
      cz + oz * cos - ox * sin,
      w,
      h,
      d,
      timber,
      { yaw, skipBottom: true, footOcclusion: 0.7 },
    );
  };

  const hw = width / 2;
  const hd = depth / 2;
  // Corner posts.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      place(sx * hw, sz * hd, baseY, post + proud, height, post + proud);
    }
  }
  // Wall plate and sill, all the way round.
  for (const y of [baseY + 0.02, baseY + height - thickness]) {
    place(0, -hd, y, width + proud, thickness * 1.5, thickness + proud);
    place(0, hd, y, width + proud, thickness * 1.5, thickness + proud);
    place(-hw, 0, y, thickness + proud, thickness * 1.5, depth + proud);
    place(hw, 0, y, thickness + proud, thickness * 1.5, depth + proud);
  }
  // Studs, spaced about a foot and a half apart as a close-studded front.
  const studs = Math.max(1, Math.round(width / 0.3));
  for (let i = 1; i < studs; i++) {
    const ox = -hw + (width * i) / studs;
    place(ox, -hd, baseY, thickness, height, thickness + proud);
    place(ox, hd, baseY, thickness, height, thickness + proud);
  }
  const sideStuds = Math.max(1, Math.round(depth / 0.3));
  for (let i = 1; i < sideStuds; i++) {
    const oz = -hd + (depth * i) / sideStuds;
    place(-hw, oz, baseY, thickness + proud, height, thickness);
    place(hw, oz, baseY, thickness + proud, height, thickness);
  }
  // A curved brace in one bay, the way a carpenter would steady a frame.
  if (height > 0.8 && dice.chance(0.7)) {
    const steps = 5;
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const ox = lerp(-hw + 0.12, 0, t);
      const y = baseY + lerp(0.06, height * 0.62, t);
      place(ox, -hd, y, 0.12, thickness * 1.6, thickness + proud);
    }
  }
}

/** Riven oak boarding, laid vertically with a gap between the boards. */
function addBoarding(
  mesh: MeshBuilder,
  cx: number,
  baseY: number,
  cz: number,
  width: number,
  height: number,
  depth: number,
  yaw: number,
  timber: Rgb,
): void {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const boards = Math.max(2, Math.round(width / 0.2));
  const hw = width / 2;
  const hd = depth / 2;
  for (let i = 0; i <= boards; i++) {
    const ox = -hw + (width * i) / boards;
    for (const oz of [-hd, hd]) {
      box(
        mesh,
        cx + ox * cos + oz * sin,
        baseY,
        cz + oz * cos - ox * sin,
        0.07,
        height,
        0.03,
        tone(timber, ((i % 3) - 1) * 0.06),
        { yaw, skipBottom: true, skipTop: true, footOcclusion: 0.65 },
      );
    }
  }
}

/** Dressed stone at the corners of a rubble or flint wall. */
function addQuoins(
  mesh: MeshBuilder,
  cx: number,
  baseY: number,
  cz: number,
  width: number,
  height: number,
  depth: number,
  yaw: number,
  stone: Rgb,
): void {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const courses = Math.max(2, Math.floor(height / 0.2));
  const hw = width / 2;
  const hd = depth / 2;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (let c = 0; c < courses; c++) {
        const wide = c % 2 === 0;
        const ox = sx * hw;
        const oz = sz * hd;
        box(
          mesh,
          cx + ox * cos + oz * sin,
          baseY + (c * height) / courses,
          cz + oz * cos - ox * sin,
          wide ? 0.2 : 0.1,
          height / courses - 0.012,
          wide ? 0.1 : 0.2,
          tone(stone, ((c % 3) - 1) * 0.05),
          { yaw, skipBottom: true, footOcclusion: 0.7 },
        );
      }
    }
  }
}

/** The joist ends an oversailing upper floor rests on. */
function addJoists(
  mesh: MeshBuilder,
  cx: number,
  y: number,
  cz: number,
  width: number,
  depth: number,
  over: number,
  yaw: number,
  timber: Rgb,
): void {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const count = Math.max(2, Math.round(width / 0.26));
  for (let i = 0; i <= count; i++) {
    const ox = -width / 2 + (width * i) / count;
    for (const sz of [-1, 1]) {
      const oz = (sz * depth) / 2 + sz * over * 0.5;
      box(
        mesh,
        cx + ox * cos + oz * sin,
        y - 0.07,
        cz + oz * cos - ox * sin,
        0.075,
        0.075,
        over + 0.06,
        timber,
        { yaw, footOcclusion: 0.45 },
      );
    }
  }
  // The bressummer: the beam the upper wall actually sits on.
  for (const sz of [-1, 1]) {
    const oz = (sz * (depth + over * 2)) / 2;
    box(
      mesh,
      cx + oz * sin,
      y - 0.02,
      cz + oz * cos,
      width + over * 2 + 0.04,
      0.09,
      0.07,
      tone(timber, 0.05),
      { yaw, footOcclusion: 0.5 },
    );
  }
}

/** Shuttered openings, stone mullions, or church lancets. */
function addWindows(
  mesh: MeshBuilder,
  kind: 'shutter' | 'mullion' | 'lancet',
  cx: number,
  baseY: number,
  cz: number,
  width: number,
  height: number,
  depth: number,
  yaw: number,
  timber: Rgb,
  upper: boolean,
): void {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const dark = colour('#241C12');
  const glass = colour(kind === 'lancet' ? '#6E7C6A' : '#3A3426');
  const count = Math.max(1, Math.round(width / 0.62));
  const openingWidth = kind === 'lancet' ? 0.14 : 0.2;
  const openingHeight = kind === 'lancet' ? Math.min(height * 0.6, 0.9) : Math.min(height * 0.42, 0.36);
  const sill = baseY + (upper ? height * 0.34 : height * 0.4);
  if (openingHeight < 0.08) return;

  for (let i = 0; i < count; i++) {
    const ox = -width / 2 + (width * (i + 0.5)) / count;
    for (const sz of [-1, 1]) {
      const oz = (sz * depth) / 2;
      const wx = cx + ox * cos + oz * sin;
      const wz = cz + oz * cos - ox * sin;
      // The opening itself, recessed into the wall.
      box(mesh, wx, sill, wz, openingWidth, openingHeight, 0.05, blend(dark, glass, 0.5), {
        yaw,
        footOcclusion: 0.34,
        skipBottom: true,
      });
      // Frame, and a mullion down the middle of the wider sort.
      box(mesh, wx, sill - 0.035, wz, openingWidth + 0.09, 0.04, 0.085, tone(timber, 0.1), { yaw, footOcclusion: 0.5 });
      box(mesh, wx, sill + openingHeight, wz, openingWidth + 0.09, 0.04, 0.085, tone(timber, 0.06), { yaw, footOcclusion: 0.6 });
      if (kind !== 'shutter') {
        box(mesh, wx, sill, wz, 0.035, openingHeight, 0.08, tone(timber, 0.16), { yaw, footOcclusion: 0.5 });
      }
      if (kind === 'lancet') {
        // The pointed head of the light.
        const headTop = sill + openingHeight + 0.12;
        mesh.tri(
          point(wx - (openingWidth / 2) * cos, sill + openingHeight, wz + (openingWidth / 2) * sin),
          point(wx + (openingWidth / 2) * cos, sill + openingHeight, wz - (openingWidth / 2) * sin),
          point(wx, headTop, wz),
          blend(dark, glass, 0.5),
          0.5,
        );
      }
    }
  }
}

/** A plank door with a frame, on the side the building faces. */
function addDoor(
  mesh: MeshBuilder,
  cx: number,
  baseY: number,
  cz: number,
  width: number,
  height: number,
  depth: number,
  yaw: number,
  timber: Rgb,
): void {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const doorHeight = Math.min(height * 0.72, 0.62);
  if (doorHeight < 0.2) return;
  // Off to one side, as a cottage door is: the hearth wants the other half.
  const ox = -width * 0.18;
  const oz = depth / 2;
  const wx = cx + ox * cos + oz * sin;
  const wz = cz + oz * cos - ox * sin;
  box(mesh, wx, baseY, wz, 0.26, doorHeight, 0.06, tone(timber, -0.12), {
    yaw,
    footOcclusion: 0.3,
    skipBottom: true,
  });
  // Lintel and jambs, standing proud.
  box(mesh, wx, baseY + doorHeight, wz, 0.36, 0.06, 0.1, tone(timber, 0.12), { yaw, footOcclusion: 0.5 });
  for (const sx of [-1, 1]) {
    box(mesh, wx + sx * 0.15 * cos, baseY, wz - sx * 0.15 * sin, 0.05, doorHeight, 0.1, tone(timber, 0.08), {
      yaw,
      footOcclusion: 0.4,
    });
  }
  // A worn stone threshold.
  box(mesh, wx + 0.03 * sin, baseY - 0.04, wz + 0.03 * cos, 0.34, 0.05, 0.14, colour(PALETTE.limestoneDark), {
    yaw,
    footOcclusion: 0.35,
  });
}

/** The rolled straw edge a thatcher finishes the eaves with. */
function addEaveRoll(
  mesh: MeshBuilder,
  cx: number,
  eaveY: number,
  cz: number,
  width: number,
  depth: number,
  overhang: number,
  yaw: number,
  c: Rgb,
): void {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const hw = width / 2 + overhang;
  const hd = depth / 2 + overhang;
  for (const sz of [-1, 1]) {
    const oz = sz * hd;
    box(mesh, cx + oz * sin, eaveY - 0.05, cz + oz * cos, width + overhang * 2, 0.11, 0.1, c, {
      yaw,
      footOcclusion: 0.55,
    });
  }
  for (const sx of [-1, 1]) {
    const ox = sx * hw;
    box(mesh, cx + ox * cos, eaveY - 0.05, cz - ox * sin, 0.1, 0.11, depth + overhang * 2, c, {
      yaw,
      footOcclusion: 0.55,
    });
  }
}

// --- features ---------------------------------------------------------------

interface FeatureContext {
  mesh: MeshBuilder;
  cx: number;
  cz: number;
  floor: number;
  wallTop: number;
  ridge: number;
  width: number;
  depth: number;
  plotWidth: number;
  plotDepth: number;
  yaw: number;
  style: BuildingStyle;
  dice: Dice;
  wallColour: Rgb;
  timberColour: Rgb;
  roofColour: Rgb;
  abandoned: boolean;
}

/** Rotate an offset in the building's own frame into world space. */
function local(c: FeatureContext, ox: number, oz: number): { x: number; z: number } {
  const cos = Math.cos(c.yaw);
  const sin = Math.sin(c.yaw);
  return { x: c.cx + ox * cos + oz * sin, z: c.cz + oz * cos - ox * sin };
}

function addFeature(c: FeatureContext, feature: Feature): void {
  const mesh = c.mesh;
  switch (feature) {
    case 'chimney': {
      // Brick or rubble stack, breaking the ridge off-centre.
      const at = local(c, c.width * 0.28, -c.depth * 0.1);
      const stack = colour(PALETTE.tileDark);
      box(mesh, at.x, c.wallTop - 0.1, at.z, 0.22, c.ridge - c.wallTop + 0.34, 0.22, stack, {
        yaw: c.yaw,
        taper: 0.12,
        skipBottom: true,
        footOcclusion: 0.45,
      });
      // A corbelled cap, so the stack does not end as a flat cut.
      box(mesh, at.x, c.ridge + 0.22, at.z, 0.3, 0.06, 0.3, tone(stack, 0.1), { yaw: c.yaw, footOcclusion: 0.7 });
      box(mesh, at.x, c.ridge + 0.28, at.z, 0.2, 0.08, 0.2, tone(stack, -0.1), { yaw: c.yaw, skipTop: true });
      break;
    }
    case 'smokehood': {
      // A poor cottage had no chimney: smoke left through a louvre in the roof.
      const at = local(c, 0, 0);
      const louvre = colour(PALETTE.oakDark);
      box(mesh, at.x, c.ridge - 0.06, at.z, 0.24, 0.16, 0.24, louvre, { yaw: c.yaw, skipBottom: true });
      cone(mesh, at.x, c.ridge + 0.1, at.z, 0.18, 0.16, 8, tone(c.roofColour, -0.06));
      break;
    }
    case 'kiln': {
      const at = local(c, -c.width * 0.45 - 0.24, c.depth * 0.2);
      const clay = colour(PALETTE.tileDark);
      lathe(
        mesh,
        at.x,
        at.z,
        [
          { y: c.floor, radius: 0.34 },
          { y: c.floor + 0.3, radius: 0.32 },
          { y: c.floor + 0.62, radius: 0.2 },
          { y: c.floor + 0.76, radius: 0.13 },
        ],
        12,
        clay,
        { capTop: true, tintByHeight: 0.14 },
      );
      break;
    }
    case 'tower': {
      // A round stair turret, taller than the roof it is attached to.
      const at = local(c, c.width * 0.42, c.depth * 0.42);
      const stone = colour(PALETTE.limestone);
      const top = c.ridge + 0.55;
      lathe(
        mesh,
        at.x,
        at.z,
        [
          { y: c.floor - 0.1, radius: 0.34 },
          { y: c.floor + 0.12, radius: 0.3 },
          { y: top, radius: 0.27 },
          { y: top + 0.07, radius: 0.31 },
        ],
        14,
        stone,
        { tintByHeight: 0.1 },
      );
      addCrenellations(mesh, at.x, top + 0.07, at.z, 0.31, 14, tone(stone, 0.06));
      cone(mesh, at.x, top + 0.16, at.z, 0.26, 0.5, 14, colour(PALETTE.lead));
      break;
    }
    case 'spire': {
      const at = local(c, 0, -c.depth * 0.42);
      const stone = colour(PALETTE.limestone);
      const towerTop = c.ridge + 0.9;
      box(mesh, at.x, c.floor, at.z, 0.62, towerTop - c.floor, 0.62, stone, {
        yaw: c.yaw,
        taper: 0.05,
        skipBottom: true,
        footOcclusion: 0.45,
      });
      addSquareCrenellations(mesh, at.x, towerTop, at.z, 0.66, c.yaw, tone(stone, 0.06));
      cone(mesh, at.x, towerTop + 0.1, at.z, 0.33, c.style.roofHeight * 2.6 + 0.8, 10, colour(PALETTE.lead));
      break;
    }
    case 'crenellations':
      addSquareCrenellations(mesh, c.cx, c.wallTop, c.cz, Math.max(c.width, c.depth) + 0.08, c.yaw, tone(c.wallColour, 0.1));
      break;
    case 'buttress': {
      // Stepped buttresses down the long sides, as a stone wall needs.
      const count = Math.max(2, Math.round(c.width / 0.8));
      for (let i = 0; i <= count; i++) {
        const ox = -c.width / 2 + (c.width * i) / count;
        for (const sz of [-1, 1]) {
          const at = local(c, ox, (sz * c.depth) / 2 + sz * 0.14);
          const h = (c.wallTop - c.floor) * 0.78;
          box(mesh, at.x, c.floor - 0.1, at.z, 0.22, h, 0.3, tone(c.wallColour, -0.04), {
            yaw: c.yaw,
            taper: 0.25,
            skipBottom: true,
            footOcclusion: 0.4,
          });
          // The weathered set-off at the top.
          const ridgeAt = local(c, ox, (sz * c.depth) / 2 + sz * 0.1);
          box(mesh, ridgeAt.x, c.floor - 0.1 + h, ridgeAt.z, 0.2, 0.14, 0.2, tone(c.wallColour, 0.08), {
            yaw: c.yaw,
            taper: 0.6,
          });
        }
      }
      break;
    }
    case 'rose': {
      // A wheel window in the gable end.
      const at = local(c, 0, c.depth / 2 + 0.03);
      const stone = tone(c.wallColour, 0.1);
      const glass = colour('#4A5560');
      lathe(
        mesh,
        at.x,
        at.z,
        [
          { y: c.wallTop + 0.1, radius: 0.01 },
          { y: c.wallTop + 0.1, radius: 0.3 },
        ],
        14,
        glass,
        {},
      );
      for (let s = 0; s < 8; s++) {
        const angle = (s / 8) * Math.PI * 2;
        box(
          mesh,
          at.x + Math.cos(angle) * 0.15 * Math.cos(c.yaw),
          c.wallTop + 0.1 + Math.sin(angle) * 0.15,
          at.z - Math.cos(angle) * 0.15 * Math.sin(c.yaw),
          0.05,
          0.05,
          0.05,
          stone,
          { yaw: c.yaw },
        );
      }
      break;
    }
    case 'arcade': {
      // An open arcade along the front: a market hall, or a conduit house.
      const bays = Math.max(2, Math.round(c.width / 0.55));
      for (let i = 0; i <= bays; i++) {
        const ox = -c.width / 2 + (c.width * i) / bays;
        const at = local(c, ox, c.depth / 2 + 0.1);
        lathe(
          mesh,
          at.x,
          at.z,
          [
            { y: c.floor, radius: 0.1 },
            { y: c.floor + 0.08, radius: 0.08 },
            { y: c.wallTop - 0.16, radius: 0.07 },
            { y: c.wallTop - 0.06, radius: 0.11 },
          ],
          8,
          tone(c.wallColour, -0.08),
          { tintByHeight: 0.1 },
        );
      }
      break;
    }
    case 'porch': {
      const at = local(c, 0, c.depth / 2 + 0.22);
      const postColour = tone(c.timberColour, 0.04);
      for (const sx of [-1, 1]) {
        const post = local(c, sx * 0.24, c.depth / 2 + 0.32);
        box(mesh, post.x, c.floor, post.z, 0.07, 0.62, 0.07, postColour, { yaw: c.yaw, footOcclusion: 0.4 });
      }
      ridgedRoof(mesh, at.x, c.floor + 0.62, at.z, 0.66, 0.46, 0.22, 0, c.roofColour, {
        yaw: c.yaw,
        overhang: 0.07,
        gableColour: tone(c.roofColour, -0.1),
      });
      break;
    }
    case 'awning': {
      // The shop's shutter, let down on props to make a counter.
      const at = local(c, 0, c.depth / 2 + 0.26);
      const cloth = colour(PALETTE.stubble);
      mesh.quad(
        point(at.x - 0.42 * Math.cos(c.yaw), c.floor + 0.68, at.z + 0.42 * Math.sin(c.yaw)),
        point(at.x + 0.42 * Math.cos(c.yaw), c.floor + 0.68, at.z - 0.42 * Math.sin(c.yaw)),
        point(c.cx + (c.depth / 2 + 0.06) * Math.sin(c.yaw) + 0.42 * Math.cos(c.yaw), c.floor + 0.84, c.cz + (c.depth / 2 + 0.06) * Math.cos(c.yaw) - 0.42 * Math.sin(c.yaw)),
        point(c.cx + (c.depth / 2 + 0.06) * Math.sin(c.yaw) - 0.42 * Math.cos(c.yaw), c.floor + 0.84, c.cz + (c.depth / 2 + 0.06) * Math.cos(c.yaw) + 0.42 * Math.sin(c.yaw)),
        cloth,
        0.8,
      );
      for (const sx of [-1, 1]) {
        const prop = local(c, sx * 0.4, c.depth / 2 + 0.28);
        box(mesh, prop.x, c.floor, prop.z, 0.04, 0.68, 0.04, c.timberColour, { yaw: c.yaw, footOcclusion: 0.4 });
      }
      break;
    }
    case 'stall': {
      // A trestle with goods on it.
      const at = local(c, 0, -c.depth / 2 - 0.3);
      const bench = colour(PALETTE.board);
      box(mesh, at.x, c.floor + 0.26, at.z, Math.max(0.5, c.width * 0.8), 0.05, 0.32, bench, { yaw: c.yaw });
      for (const sx of [-1, 1]) {
        const leg = local(c, sx * (Math.max(0.5, c.width * 0.8) / 2 - 0.06), -c.depth / 2 - 0.3);
        box(mesh, leg.x, c.floor, leg.z, 0.05, 0.26, 0.26, tone(bench, -0.12), { yaw: c.yaw, footOcclusion: 0.35 });
      }
      for (let i = 0; i < 3; i++) {
        const goods = local(c, -0.16 + i * 0.16, -c.depth / 2 - 0.3);
        spheroid(mesh, goods.x, c.floor + 0.35, goods.z, 0.07, 0.055, 8, 4, colour(i % 2 === 0 ? PALETTE.corn : PALETTE.madder));
      }
      break;
    }
    case 'sign': {
      // An ale-stake or a painted board on a wrought bracket.
      const at = local(c, c.width / 2 + 0.02, c.depth / 2 - 0.18);
      box(mesh, at.x, c.wallTop - 0.22, at.z, 0.3, 0.04, 0.04, colour(PALETTE.oakDark), { yaw: c.yaw });
      const boardAt = local(c, c.width / 2 + 0.2, c.depth / 2 - 0.18);
      box(mesh, boardAt.x, c.wallTop - 0.52, boardAt.z, 0.22, 0.26, 0.03, colour(PALETTE.madder), {
        yaw: c.yaw,
        footOcclusion: 0.8,
      });
      break;
    }
    case 'banner': {
      const at = local(c, -c.width / 2 - 0.04, c.depth / 2 - 0.1);
      box(mesh, at.x, c.wallTop - 0.1, at.z, 0.04, 0.52, 0.04, colour(PALETTE.oakDark), { yaw: c.yaw });
      const cloth = local(c, -c.width / 2 - 0.04, c.depth / 2 - 0.1);
      box(mesh, cloth.x, c.wallTop - 0.06, cloth.z, 0.025, 0.4, 0.26, colour(PALETTE.woad), {
        yaw: c.yaw,
        footOcclusion: 0.85,
      });
      break;
    }
    case 'dovecote': {
      const at = local(c, -c.plotWidth * 0.34, -c.plotDepth * 0.34);
      const stone = colour(PALETTE.rubble);
      lathe(
        mesh,
        at.x,
        at.z,
        [
          { y: c.floor, radius: 0.24 },
          { y: c.floor + 0.56, radius: 0.22 },
        ],
        12,
        stone,
        { tintByHeight: 0.1 },
      );
      cone(mesh, at.x, c.floor + 0.56, at.z, 0.27, 0.3, 12, c.roofColour);
      break;
    }
    case 'fence': {
      addFence(mesh, c, colour(PALETTE.oak));
      break;
    }
    case 'hedge': {
      addHedge(mesh, c);
      break;
    }
    case 'field': {
      addField(mesh, c);
      break;
    }
    case 'garden': {
      // A croft: beds, a few herbs, a bush.
      const bed = colour(PALETTE.ploughed);
      for (let i = 0; i < 3; i++) {
        const at = local(c, -c.plotWidth * 0.3 + i * 0.2, c.plotDepth * 0.3);
        box(mesh, at.x, c.floor - 0.02, at.z, 0.14, 0.06, Math.min(0.7, c.plotDepth * 0.5), bed, {
          yaw: c.yaw,
          footOcclusion: 0.55,
        });
      }
      const bush = local(c, c.plotWidth * 0.3, c.plotDepth * 0.3);
      spheroid(mesh, bush.x, c.floor + 0.12, bush.z, 0.2, 0.16, 8, 4, colour(PALETTE.canopyPale), { squash: 0.3 });
      break;
    }
    case 'trough': {
      const at = local(c, c.plotWidth * 0.3, -c.plotDepth * 0.28);
      const stone = colour(PALETTE.rubbleDark);
      box(mesh, at.x, c.floor, at.z, 0.5, 0.16, 0.2, stone, { yaw: c.yaw, footOcclusion: 0.4 });
      box(mesh, at.x, c.floor + 0.12, at.z, 0.42, 0.04, 0.13, colour(PALETTE.water), { yaw: c.yaw });
      break;
    }
    case 'well': {
      const stone = colour(PALETTE.rubble);
      lathe(
        mesh,
        c.cx,
        c.cz,
        [
          { y: c.floor - 0.05, radius: 0.34 },
          { y: c.floor + 0.3, radius: 0.3 },
          { y: c.floor + 0.36, radius: 0.32 },
        ],
        14,
        stone,
        { tintByHeight: 0.12 },
      );
      lathe(mesh, c.cx, c.cz, [{ y: c.floor + 0.28, radius: 0.24 }], 14, colour('#1A1D1C'), {});
      mesh.fan(
        Array.from({ length: 14 }, (_, s) => {
          const angle = (s / 14) * Math.PI * 2;
          return point(c.cx + Math.cos(angle) * 0.23, c.floor + 0.3, c.cz + Math.sin(angle) * 0.23);
        }),
        colour('#14181A'),
        point(0, 1, 0),
        0.25,
      );
      // Posts and a windlass over it.
      for (const sx of [-1, 1]) {
        const post = local(c, sx * 0.28, 0);
        box(mesh, post.x, c.floor + 0.3, post.z, 0.07, 0.6, 0.07, colour(PALETTE.oak), { yaw: c.yaw });
      }
      const beam = local(c, 0, 0);
      box(mesh, beam.x, c.floor + 0.86, beam.z, 0.68, 0.07, 0.08, colour(PALETTE.oakLight), { yaw: c.yaw });
      ridgedRoof(mesh, beam.x, c.floor + 0.9, beam.z, 0.76, 0.56, 0.22, 0, colour(PALETTE.shingle), {
        yaw: c.yaw,
        overhang: 0.08,
      });
      break;
    }
    case 'cross': {
      // A wayside or market cross on a stepped base.
      const stone = colour(PALETTE.limestone);
      for (let step = 0; step < 3; step++) {
        const size = 0.9 - step * 0.2;
        box(mesh, c.cx, c.floor + step * 0.11, c.cz, size, 0.12, size, tone(stone, -0.05 + step * 0.03), {
          yaw: c.yaw,
          footOcclusion: 0.4,
        });
      }
      lathe(
        mesh,
        c.cx,
        c.cz,
        [
          { y: c.floor + 0.33, radius: 0.12 },
          { y: c.floor + 1.25, radius: 0.07 },
        ],
        8,
        stone,
        { tintByHeight: 0.12 },
      );
      box(mesh, c.cx, c.floor + 1.25, c.cz, 0.3, 0.07, 0.07, stone, { yaw: c.yaw });
      box(mesh, c.cx, c.floor + 1.25, c.cz, 0.07, 0.26, 0.07, stone, { yaw: c.yaw });
      break;
    }
    case 'brazier': {
      const at = local(c, 0, c.depth / 2 + 0.3);
      const iron = colour('#35302A');
      lathe(
        mesh,
        at.x,
        at.z,
        [
          { y: c.floor, radius: 0.06 },
          { y: c.floor + 0.36, radius: 0.08 },
          { y: c.floor + 0.46, radius: 0.17 },
        ],
        10,
        iron,
        {},
      );
      if (!c.abandoned) {
        spheroid(mesh, at.x, c.floor + 0.52, at.z, 0.13, 0.14, 8, 4, colour('#C06A22'), { squash: 0.2 });
      }
      break;
    }
    case 'water': {
      // An open tank or conduit basin.
      const basin = colour(PALETTE.water);
      box(mesh, c.cx, c.wallTop + 0.01, c.cz, c.width - 0.22, 0.05, c.depth - 0.22, basin, { yaw: c.yaw });
      break;
    }
    case 'crates': {
      for (let i = 0; i < 3; i++) {
        const at = local(c, -c.plotWidth * 0.32 + i * 0.26, -c.plotDepth * 0.3 + (i % 2) * 0.2);
        const size = 0.2 + (i % 2) * 0.05;
        box(mesh, at.x, c.floor, at.z, size, size * 0.85, size, colour(PALETTE.board), {
          yaw: c.yaw + i * 0.3,
          footOcclusion: 0.4,
        });
      }
      // A couple of barrels, which is how most things travelled.
      const barrel = local(c, c.plotWidth * 0.3, -c.plotDepth * 0.3);
      lathe(
        mesh,
        barrel.x,
        barrel.z,
        [
          { y: c.floor, radius: 0.1 },
          { y: c.floor + 0.12, radius: 0.13 },
          { y: c.floor + 0.3, radius: 0.1 },
        ],
        10,
        colour(PALETTE.oakLight),
        { capTop: true },
      );
      break;
    }
    case 'waggon': {
      addWaggon(mesh, c);
      break;
    }
    case 'waterwheel': {
      addWaterwheel(mesh, c);
      break;
    }
    case 'headframe': {
      // A windlass over a shaft, with a spoil heap beside it.
      const at = local(c, -c.plotWidth * 0.3, c.plotDepth * 0.3);
      const timberColour = colour(PALETTE.oak);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const leg = local(c, -c.plotWidth * 0.3 + sx * 0.18, c.plotDepth * 0.3 + sz * 0.18);
          box(mesh, leg.x, c.floor, leg.z, 0.06, 0.9, 0.06, timberColour, { yaw: c.yaw, footOcclusion: 0.4 });
        }
      }
      box(mesh, at.x, c.floor + 0.9, at.z, 0.44, 0.07, 0.44, timberColour, { yaw: c.yaw });
      spheroid(mesh, at.x, c.floor + 0.06, at.z, 0.34, 0.18, 10, 4, colour(PALETTE.mudDark), { squash: 0.4 });
      break;
    }
    case 'pier': {
      addPier(mesh, c);
      break;
    }
    case 'lists': {
      // A tilting ground: a rail down the middle, rammed earth either side.
      const ground = colour(PALETTE.mud);
      box(mesh, c.cx, c.floor - 0.02, c.cz, c.plotWidth - 0.3, 0.05, c.plotDepth - 0.3, ground, {
        yaw: c.yaw,
        footOcclusion: 0.6,
      });
      const rail = colour(PALETTE.board);
      box(mesh, c.cx, c.floor + 0.3, c.cz, c.plotWidth - 0.9, 0.07, 0.09, rail, { yaw: c.yaw });
      const posts = Math.max(2, Math.round((c.plotWidth - 0.9) / 0.6));
      for (let i = 0; i <= posts; i++) {
        const at = local(c, -(c.plotWidth - 0.9) / 2 + ((c.plotWidth - 0.9) * i) / posts, 0);
        box(mesh, at.x, c.floor, at.z, 0.08, 0.34, 0.08, tone(rail, -0.1), { yaw: c.yaw, footOcclusion: 0.4 });
      }
      break;
    }
    case 'pavilions': {
      for (let i = 0; i < 3; i++) {
        const at = local(c, -c.plotWidth * 0.3 + i * (c.plotWidth * 0.3), -c.plotDepth * 0.34);
        const cloth = [PALETTE.madder, PALETTE.woad, PALETTE.verdigris][i % 3];
        lathe(
          mesh,
          at.x,
          at.z,
          [
            { y: c.floor, radius: 0.3 },
            { y: c.floor + 0.34, radius: 0.3 },
          ],
          10,
          colour(cloth),
          {},
        );
        cone(mesh, at.x, c.floor + 0.34, at.z, 0.34, 0.46, 10, colour(cloth));
      }
      break;
    }
    case 'ruin': {
      const at = local(c, 0, 0);
      box(mesh, at.x, c.floor, at.z, c.width * 0.7, 0.3, c.depth * 0.7, colour(PALETTE.rubbleDark), {
        yaw: c.yaw,
        footOcclusion: 0.4,
      });
      break;
    }
    default:
      break;
  }
}

function addFence(mesh: MeshBuilder, c: FeatureContext, timber: Rgb): void {
  const halfW = c.plotWidth / 2 - 0.08;
  const halfD = c.plotDepth / 2 - 0.08;
  const posts = Math.max(2, Math.round(c.plotWidth / 0.42));
  const rails = Math.max(2, Math.round(c.plotDepth / 0.42));
  const put = (ox: number, oz: number): void => {
    const at = local(c, ox, oz);
    box(mesh, at.x, c.floor - 0.04, at.z, 0.06, 0.36, 0.06, timber, { yaw: c.yaw, footOcclusion: 0.4 });
  };
  for (let i = 0; i <= posts; i++) {
    const ox = -halfW + (halfW * 2 * i) / posts;
    put(ox, -halfD);
    put(ox, halfD);
  }
  for (let i = 1; i < rails; i++) {
    const oz = -halfD + (halfD * 2 * i) / rails;
    put(-halfW, oz);
    put(halfW, oz);
  }
  // Two rails running between them.
  for (const y of [c.floor + 0.12, c.floor + 0.26]) {
    for (const sz of [-1, 1]) {
      const at = local(c, 0, sz * halfD);
      box(mesh, at.x, y, at.z, halfW * 2, 0.035, 0.03, tone(timber, 0.06), { yaw: c.yaw, footOcclusion: 0.6 });
    }
    for (const sx of [-1, 1]) {
      const at = local(c, sx * halfW, 0);
      box(mesh, at.x, y, at.z, 0.03, 0.035, halfD * 2, tone(timber, 0.06), { yaw: c.yaw, footOcclusion: 0.6 });
    }
  }
}

/** A laid hawthorn hedge, the boundary of every English close. */
function addHedge(mesh: MeshBuilder, c: FeatureContext): void {
  const leaf = colour(PALETTE.canopyPale);
  const halfW = c.plotWidth / 2 - 0.06;
  const halfD = c.plotDepth / 2 - 0.06;
  const along = (from: { x: number; z: number }, to: { x: number; z: number }): void => {
    const steps = Math.max(2, Math.round(Math.hypot(to.x - from.x, to.z - from.z) / 0.3));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = lerp(from.x, to.x, t);
      const z = lerp(from.z, to.z, t);
      const r = 0.19 + ((i * 37) % 7) / 7 * 0.05;
      spheroid(mesh, x, c.floor + 0.1, z, r, r * 0.95, 7, 4, tone(leaf, ((i % 3) - 1) * 0.05), { squash: 0.35 });
    }
  };
  const corners = [
    local(c, -halfW, -halfD),
    local(c, halfW, -halfD),
    local(c, halfW, halfD),
    local(c, -halfW, halfD),
  ];
  for (let i = 0; i < 4; i++) along(corners[i], corners[(i + 1) % 4]);
}

/** Ridge and furrow: the strip fields of an open-field parish. */
function addField(mesh: MeshBuilder, c: FeatureContext): void {
  const earth = colour(PALETTE.ploughed);
  const crop = colour(PALETTE.corn);
  const span = Math.max(0.6, c.plotWidth - 0.2);
  const depth = Math.max(0.6, c.plotDepth - 0.2);
  const strips = Math.max(3, Math.round(span / 0.22));
  for (let i = 0; i < strips; i++) {
    const ox = -span / 2 + (span * (i + 0.5)) / strips;
    const at = local(c, ox, 0);
    const ridge = i % 2 === 0;
    box(
      mesh,
      at.x,
      c.floor - 0.06,
      at.z,
      span / strips - 0.02,
      ridge ? 0.13 : 0.07,
      depth,
      ridge ? crop : earth,
      { yaw: c.yaw, footOcclusion: 0.6, skipBottom: true },
    );
  }
}

function addWaggon(mesh: MeshBuilder, c: FeatureContext): void {
  const at = local(c, c.plotWidth * 0.28, c.plotDepth * 0.26);
  const timber = colour(PALETTE.board);
  const yaw = c.yaw + 0.4;
  box(mesh, at.x, c.floor + 0.17, at.z, 0.62, 0.16, 0.3, timber, { yaw });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const wheelX = at.x + (sx * 0.22 * Math.cos(yaw) + sz * 0.17 * Math.sin(yaw));
      const wheelZ = at.z + (sz * 0.17 * Math.cos(yaw) - sx * 0.22 * Math.sin(yaw));
      lathe(
        mesh,
        wheelX,
        wheelZ,
        [
          { y: c.floor + 0.02, radius: 0.14 },
          { y: c.floor + 0.06, radius: 0.16 },
          { y: c.floor + 0.1, radius: 0.14 },
        ],
        10,
        colour(PALETTE.oakDark),
        {},
      );
    }
  }
}

function addWaterwheel(mesh: MeshBuilder, c: FeatureContext): void {
  const at = local(c, -c.width / 2 - 0.22, 0);
  const radius = Math.min(0.55, (c.wallTop - c.floor) * 0.62);
  const timber = colour(PALETTE.oakDark);
  const centreY = c.floor + radius * 0.9;
  // Two rims and the paddles between them.
  for (const offset of [-0.11, 0.11]) {
    const side = local(c, -c.width / 2 - 0.22, offset);
    lathe(
      mesh,
      side.x,
      side.z,
      [
        { y: centreY - radius, radius: 0.04 },
        { y: centreY, radius: 0.05 },
      ],
      8,
      timber,
      {},
    );
  }
  const paddles = 12;
  for (let i = 0; i < paddles; i++) {
    const angle = (i / paddles) * Math.PI * 2;
    const px = at.x + Math.cos(angle) * radius * Math.cos(c.yaw);
    const pz = at.z - Math.cos(angle) * radius * Math.sin(c.yaw);
    const py = centreY + Math.sin(angle) * radius;
    box(mesh, px, py - 0.04, pz, 0.07, 0.08, 0.3, tone(timber, ((i % 3) - 1) * 0.06), { yaw: c.yaw });
  }
  // The axle and the leat it turns in.
  box(mesh, at.x, centreY - 0.03, at.z, 0.06, 0.06, 0.42, tone(timber, 0.08), { yaw: c.yaw });
  box(mesh, at.x, c.floor - 0.06, at.z, 0.5, 0.1, 0.46, colour(PALETTE.water), { yaw: c.yaw, footOcclusion: 0.4 });
}

function addPier(mesh: MeshBuilder, c: FeatureContext): void {
  const timber = colour(PALETTE.board);
  const reach = Math.max(1.2, c.plotDepth);
  const deckY = c.floor + 0.06;
  const at = local(c, 0, c.plotDepth / 2 + reach / 2);
  box(mesh, at.x, deckY, at.z, Math.max(0.8, c.plotWidth * 0.7), 0.07, reach, timber, {
    yaw: c.yaw,
    footOcclusion: 0.55,
  });
  const posts = Math.max(2, Math.round(reach / 0.5));
  for (let i = 0; i <= posts; i++) {
    for (const sx of [-1, 1]) {
      const post = local(
        c,
        (sx * Math.max(0.8, c.plotWidth * 0.7)) / 2 - sx * 0.07,
        c.plotDepth / 2 + (reach * i) / posts,
      );
      box(mesh, post.x, deckY - 1.4, post.z, 0.08, 1.45, 0.08, colour(PALETTE.oakDark), {
        yaw: c.yaw,
        skipBottom: true,
        footOcclusion: 0.3,
      });
    }
  }
  // A bollard to tie up to.
  const bollard = local(c, 0, c.plotDepth / 2 + reach - 0.2);
  lathe(
    mesh,
    bollard.x,
    bollard.z,
    [
      { y: deckY + 0.07, radius: 0.07 },
      { y: deckY + 0.26, radius: 0.06 },
      { y: deckY + 0.3, radius: 0.08 },
    ],
    8,
    colour(PALETTE.oakDark),
    { capTop: true },
  );
}

/** A crenellated parapet around a round tower. */
function addCrenellations(
  mesh: MeshBuilder,
  cx: number,
  y: number,
  cz: number,
  radius: number,
  sides: number,
  stone: Rgb,
): void {
  for (let s = 0; s < sides; s += 2) {
    const angle = (s / sides) * Math.PI * 2;
    box(
      mesh,
      cx + Math.cos(angle) * radius,
      y,
      cz + Math.sin(angle) * radius,
      0.14,
      0.16,
      0.14,
      stone,
      { yaw: -angle, footOcclusion: 0.75 },
    );
  }
}

/** A crenellated parapet around a square plan. */
function addSquareCrenellations(
  mesh: MeshBuilder,
  cx: number,
  y: number,
  cz: number,
  size: number,
  yaw: number,
  stone: Rgb,
): void {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const half = size / 2;
  const count = Math.max(2, Math.round(size / 0.24));
  for (let i = 0; i <= count; i++) {
    if (i % 2 === 1) continue;
    const along = -half + (size * i) / count;
    for (const sz of [-1, 1]) {
      box(mesh, cx + along * cos + sz * half * sin, y, cz + sz * half * cos - along * sin, 0.15, 0.17, 0.12, stone, {
        yaw,
        footOcclusion: 0.75,
      });
    }
    for (const sx of [-1, 1]) {
      box(mesh, cx + sx * half * cos + along * sin, y, cz + along * cos - sx * half * sin, 0.12, 0.17, 0.15, stone, {
        yaw,
        footOcclusion: 0.75,
      });
    }
  }
}

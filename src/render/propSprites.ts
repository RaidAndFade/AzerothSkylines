/**
 * Procedural artwork for everything that is not a building: the hardwoods
 * of Elwynn, cobbled streets, the Stormwind curtain wall, and the people
 * and carts that move along it.
 */
import { HALF_HEIGHT, HALF_WIDTH, TILE_HEIGHT, TILE_WIDTH } from './iso';
import { PALETTE, mix, withAlpha } from './palette';
import {
  OUTLINE,
  Point,
  Skin,
  castShadow,
  coneRoof,
  cylinder,
  groundShadow,
  isoBox,
  lerpPoint,
  strokeSilhouette,
} from './shapes';
import { light } from './light';
import { paintFace } from './materials';
import { AgentKind } from '../sim/types';
import { Rng } from '../core/rng';

export interface Sprite {
  canvas: HTMLCanvasElement;
  originX: number;
  originY: number;
}

function makeCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width);
  canvas.height = Math.ceil(height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is unavailable');
  ctx.lineJoin = 'round';
  return { canvas, ctx };
}

// --- Trees ------------------------------------------------------------------

/**
 * Elwynn's stands: oak, pine, birch, a turning maple, and the scrub and
 * saplings that fill the gaps between them.
 */
export const TREE_VARIANTS = 6;
const treeCache: Sprite[] = [];

export function getTreeSprite(variant: number): Sprite {
  const index = ((variant % TREE_VARIANTS) + TREE_VARIANTS) % TREE_VARIANTS;
  const cached = treeCache[index];
  if (cached) return cached;
  const sprite = drawTree(index);
  treeCache[index] = sprite;
  return sprite;
}

interface Foliage {
  deep: string;
  mid: string;
  lit: string;
  rim: string;
}

const FOLIAGE: Foliage[] = [
  { deep: '#1E4526', mid: '#2F6B36', lit: '#4E9247', rim: '#8FC45E' },
  { deep: '#1A3D2A', mid: '#28603C', lit: '#3F8452', rim: '#79B872' },
  { deep: '#26522A', mid: '#3C7A38', lit: '#5C9C48', rim: '#A3CC66' },
  { deep: '#5C4A18', mid: '#8A7226', lit: '#B99A3A', rim: '#E0C463' },
];

/**
 * A canopy built from overlapping lobes: a dark mass, lighter clumps on the
 * sunward side, and a thin rim where the light catches the outer leaves.
 */
function canopy(
  ctx: CanvasRenderingContext2D,
  lobes: [number, number, number][],
  palette: Foliage,
): void {
  // The whole mass in shadow first, so gaps between lobes stay dark.
  ctx.beginPath();
  for (const [x, y, r] of lobes) {
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
  ctx.fillStyle = palette.deep;
  ctx.fill();
  ctx.strokeStyle = 'rgba(18, 30, 18, 0.5)';
  ctx.lineWidth = 1.4;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Mid tone pulled up and to the left, toward the sun.
  ctx.beginPath();
  for (const [x, y, r] of lobes) {
    ctx.moveTo(x - r * 0.16 + r * 0.86, y - r * 0.14);
    ctx.arc(x - r * 0.16, y - r * 0.14, r * 0.86, 0, Math.PI * 2);
  }
  ctx.fillStyle = palette.mid;
  ctx.fill();

  // Lit clumps, then a bright edge on the top-left of each.
  ctx.beginPath();
  for (const [x, y, r] of lobes) {
    ctx.moveTo(x - r * 0.3 + r * 0.58, y - r * 0.3);
    ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.58, 0, Math.PI * 2);
  }
  ctx.fillStyle = palette.lit;
  ctx.fill();

  for (const [x, y, r] of lobes) {
    ctx.beginPath();
    ctx.arc(x - r * 0.34, y - r * 0.36, r * 0.44, Math.PI * 0.9, Math.PI * 1.75);
    ctx.strokeStyle = withAlpha(palette.rim, 0.7);
    ctx.lineWidth = Math.max(1.2, r * 0.18);
    ctx.lineCap = 'round';
    ctx.stroke();
  }
}

/** A tapering trunk with a couple of limbs, drawn as a filled shape. */
function trunk(
  ctx: CanvasRenderingContext2D,
  height: number,
  width: number,
  bark: string,
  barkDark: string,
  limbs = true,
): void {
  ctx.beginPath();
  ctx.moveTo(-width, 0);
  ctx.bezierCurveTo(-width * 0.8, -height * 0.5, -width * 0.55, -height * 0.7, -width * 0.4, -height);
  ctx.lineTo(width * 0.4, -height);
  ctx.bezierCurveTo(width * 0.55, -height * 0.7, width * 0.8, -height * 0.5, width, 0);
  ctx.closePath();
  ctx.fillStyle = bark;
  ctx.fill();
  ctx.strokeStyle = 'rgba(30, 20, 12, 0.45)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Shadow down the right-hand side of the bole.
  ctx.beginPath();
  ctx.moveTo(width * 0.1, 0);
  ctx.lineTo(width, 0);
  ctx.bezierCurveTo(width * 0.8, -height * 0.5, width * 0.55, -height * 0.7, width * 0.4, -height);
  ctx.lineTo(width * 0.05, -height);
  ctx.closePath();
  ctx.fillStyle = barkDark;
  ctx.fill();

  if (limbs) {
    ctx.strokeStyle = bark;
    ctx.lineCap = 'round';
    ctx.lineWidth = width * 0.8;
    ctx.beginPath();
    ctx.moveTo(-width * 0.2, -height * 0.72);
    ctx.lineTo(-width * 2.6, -height * 1.08);
    ctx.moveTo(width * 0.2, -height * 0.82);
    ctx.lineTo(width * 2.4, -height * 1.1);
    ctx.stroke();
  }
}

function drawTree(variant: number): Sprite {
  const width = 62;
  const height = 92;
  const { canvas, ctx } = makeCanvas(width, height);
  const originX = width / 2;
  const originY = height - 7;
  ctx.translate(originX, originY);

  // Trees stand on the ground, so they cast along the sun like everything else.
  ctx.save();
  ctx.scale(1, 0.42);
  ctx.beginPath();
  ctx.ellipse(13, 8, 19, 15, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(34, 40, 60, 0.2)';
  ctx.filter = 'blur(2px)';
  ctx.fill();
  ctx.restore();
  groundShadow(ctx, { x: 0, y: 0 }, 15, 6, 0.28);

  switch (variant) {
    case 1: {
      // Scots pine: a bare bole with tiered skirts of needles.
      trunk(ctx, 40, 3.2, '#6B4A2C', '#432C19', false);
      const palette = FOLIAGE[1];
      for (let i = 0; i < 5; i++) {
        const y = -26 - i * 11;
        const spread = 22 - i * 3.6;
        ctx.beginPath();
        ctx.moveTo(-spread, y);
        ctx.quadraticCurveTo(-spread * 0.4, y - 7, 0, y - 17);
        ctx.quadraticCurveTo(spread * 0.4, y - 7, spread, y);
        ctx.quadraticCurveTo(0, y + 5, -spread, y);
        ctx.closePath();
        ctx.fillStyle = i % 2 === 0 ? palette.mid : palette.deep;
        ctx.fill();
        ctx.strokeStyle = 'rgba(18, 30, 18, 0.45)';
        ctx.lineWidth = 1.1;
        ctx.stroke();
        // Light on the left edge of each skirt.
        ctx.beginPath();
        ctx.moveTo(-spread, y);
        ctx.quadraticCurveTo(-spread * 0.4, y - 7, 0, y - 17);
        ctx.strokeStyle = withAlpha(palette.lit, 0.75);
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      break;
    }
    case 2: {
      // Birch: pale bole, light open crown.
      trunk(ctx, 44, 3, '#D8D2C4', '#A8A294');
      ctx.strokeStyle = 'rgba(60, 56, 48, 0.6)';
      ctx.lineWidth = 1.2;
      for (const y of [-8, -17, -27, -36]) {
        ctx.beginPath();
        ctx.moveTo(-2.6, y);
        ctx.lineTo(0.4, y - 1);
        ctx.stroke();
      }
      canopy(ctx, [
        [-10, -54, 12],
        [9, -52, 11],
        [0, -64, 13],
        [-13, -44, 9],
        [12, -42, 9],
      ], FOLIAGE[2]);
      break;
    }
    case 3: {
      // A maple on the turn.
      trunk(ctx, 34, 4.4, '#6B4A2C', '#432C19');
      canopy(ctx, [
        [-11, -44, 14],
        [11, -42, 13],
        [0, -56, 15],
        [-14, -33, 10],
        [13, -32, 10],
        [0, -34, 13],
      ], FOLIAGE[3]);
      break;
    }
    case 4: {
      // Hazel scrub: low, dense, many stems.
      ctx.strokeStyle = '#5A4028';
      ctx.lineCap = 'round';
      ctx.lineWidth = 2.2;
      for (const lean of [-6, -2, 2, 6]) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(lean, -14);
        ctx.stroke();
      }
      canopy(ctx, [
        [-8, -20, 10],
        [8, -19, 9],
        [0, -26, 11],
      ], FOLIAGE[0]);
      break;
    }
    case 5: {
      // A sapling, barely more than a switch.
      trunk(ctx, 20, 1.8, '#6B4A2C', '#432C19', false);
      canopy(ctx, [
        [-4, -24, 7],
        [4, -23, 6],
        [0, -29, 7],
      ], FOLIAGE[2]);
      break;
    }
    default: {
      // The Elwynn oak: heavy bole, broad crown.
      trunk(ctx, 32, 5, '#6B4A2C', '#432C19');
      canopy(ctx, [
        [-13, -44, 15],
        [12, -42, 14],
        [0, -57, 16],
        [-16, -32, 11],
        [15, -31, 11],
        [0, -33, 14],
      ], FOLIAGE[0]);
      break;
    }
  }

  return { canvas, originX, originY };
}

// --- Ground props -----------------------------------------------------------

/** Stones, flowers, tufts, fallen wood, reeds and boulders. */
export const PROP_VARIANTS = 6;
const propCache: Sprite[] = [];

export function getPropSprite(variant: number): Sprite {
  const index = ((variant % PROP_VARIANTS) + PROP_VARIANTS) % PROP_VARIANTS;
  const cached = propCache[index];
  if (cached) return cached;
  const sprite = drawProp(index);
  propCache[index] = sprite;
  return sprite;
}

function drawProp(variant: number): Sprite {
  const width = 34;
  const height = 30;
  const { canvas, ctx } = makeCanvas(width, height);
  const originX = width / 2;
  const originY = height - 4;
  ctx.translate(originX, originY);
  const rng = new Rng(0x9f2 + variant * 977);

  switch (variant) {
    case 1: {
      // A clump of peacebloom and wild marigold.
      const blooms = ['#EDE7F2', '#F2D65C', '#D9799B', '#9FD4E8'];
      for (let i = 0; i < 9; i++) {
        const x = (rng.next() - 0.5) * 16;
        const y = -rng.next() * 5;
        ctx.strokeStyle = '#4A7A34';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (rng.next() - 0.5) * 2, y - 4 - rng.next() * 3);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x + (rng.next() - 0.5) * 2, y - 6 - rng.next() * 3, 1.6, 0, Math.PI * 2);
        ctx.fillStyle = blooms[i % blooms.length];
        ctx.fill();
      }
      break;
    }
    case 2: {
      // A tuft of long grass.
      for (let i = 0; i < 11; i++) {
        const x = (rng.next() - 0.5) * 13;
        const lean = (rng.next() - 0.5) * 7;
        const tall = 5 + rng.next() * 7;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.quadraticCurveTo(x + lean * 0.4, -tall * 0.7, x + lean, -tall);
        ctx.strokeStyle = rng.next() < 0.4 ? '#86BC52' : '#5E9337';
        ctx.lineWidth = 1.3;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
      break;
    }
    case 3: {
      // A fallen limb, gone soft with moss.
      groundShadow(ctx, { x: 0, y: 0 }, 11, 4, 0.24);
      ctx.beginPath();
      ctx.moveTo(-11, -1);
      ctx.lineTo(9, -4);
      ctx.lineTo(10, -7.5);
      ctx.lineTo(-11, -4.5);
      ctx.closePath();
      ctx.fillStyle = light('#6B4A2C', 'left');
      ctx.fill();
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(10, -5.8, 1.6, 2.1, 0, 0, Math.PI * 2);
      ctx.fillStyle = light('#8A6339', 'top');
      ctx.fill();
      ctx.strokeStyle = withAlpha('#3F7A3F', 0.6);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-8, -5.5);
      ctx.lineTo(2, -6.6);
      ctx.stroke();
      break;
    }
    case 4: {
      // Reeds, for the wet ground at the water's edge.
      for (let i = 0; i < 9; i++) {
        const x = (rng.next() - 0.5) * 14;
        const lean = (rng.next() - 0.5) * 6;
        const tall = 9 + rng.next() * 9;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.quadraticCurveTo(x + lean * 0.3, -tall * 0.6, x + lean, -tall);
        ctx.strokeStyle = rng.next() < 0.3 ? '#A8B06A' : '#5F7F42';
        ctx.lineWidth = 1.2;
        ctx.lineCap = 'round';
        ctx.stroke();
        if (rng.next() < 0.4) {
          ctx.beginPath();
          ctx.ellipse(x + lean, -tall - 1.5, 1.1, 2.6, 0, 0, Math.PI * 2);
          ctx.fillStyle = '#7A5C2E';
          ctx.fill();
        }
      }
      break;
    }
    case 5: {
      // A boulder with a mossy cap.
      groundShadow(ctx, { x: 1, y: 0 }, 13, 5, 0.3);
      drawStone(ctx, 0, 0, 11, 8, rng);
      ctx.beginPath();
      ctx.ellipse(-2.5, -8.5, 6, 2.4, -0.12, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha('#4F8A42', 0.55);
      ctx.fill();
      break;
    }
    default: {
      // A scatter of field stones.
      groundShadow(ctx, { x: 1, y: 0 }, 10, 4, 0.24);
      drawStone(ctx, -3, 0, 6, 4.5, rng);
      drawStone(ctx, 5, -1, 4.5, 3.4, rng);
      drawStone(ctx, 0, 1.5, 3.4, 2.6, rng);
      break;
    }
  }

  return { canvas, originX, originY };
}

/** One rounded stone, lit from the upper left. */
function drawStone(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  height: number,
  rng: Rng,
): void {
  const tone = 0.3 + rng.next() * 0.5;
  const base = mix('#6E6960', '#A49C90', tone);
  ctx.beginPath();
  ctx.moveTo(x - radius, y);
  ctx.bezierCurveTo(x - radius * 1.05, y - height * 0.8, x - radius * 0.5, y - height, x, y - height);
  ctx.bezierCurveTo(x + radius * 0.6, y - height, x + radius * 1.05, y - height * 0.7, x + radius, y);
  ctx.bezierCurveTo(x + radius * 0.6, y + height * 0.34, x - radius * 0.6, y + height * 0.34, x - radius, y);
  ctx.closePath();
  ctx.fillStyle = light(base, 'left');
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.stroke();

  // The shaded flank and a highlight on the crown.
  ctx.beginPath();
  ctx.moveTo(x + radius * 0.1, y - height * 0.95);
  ctx.bezierCurveTo(x + radius * 0.7, y - height * 0.9, x + radius * 1.05, y - height * 0.7, x + radius, y);
  ctx.bezierCurveTo(x + radius * 0.7, y + height * 0.3, x + radius * 0.2, y + height * 0.3, x + radius * 0.1, y);
  ctx.closePath();
  ctx.fillStyle = light(base, 'right');
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(x - radius * 0.28, y - height * 0.66, radius * 0.4, height * 0.24, -0.2, 0, Math.PI * 2);
  ctx.fillStyle = withAlpha(light(base, 'bright'), 0.7);
  ctx.fill();
}

// --- The curtain wall -------------------------------------------------------

export type WallKind = 'wall' | 'tower' | 'gate';

const wallCache = new Map<string, Sprite>();

export function getWallSprite(kind: WallKind, mask: number, orientation: number): Sprite {
  const key = `${kind}|${mask}|${orientation}`;
  const cached = wallCache.get(key);
  if (cached) return cached;
  const sprite = drawWall(kind, mask, orientation);
  wallCache.set(key, sprite);
  return sprite;
}

const WALL_HEIGHT = 40;
const TOWER_HEIGHT = 54;

function drawWall(kind: WallKind, mask: number, orientation: number): Sprite {
  const pad = 16;
  const total = kind === 'tower' ? TOWER_HEIGHT + 62 : kind === 'gate' ? WALL_HEIGHT + 40 : WALL_HEIGHT + 22;
  const { canvas, ctx } = makeCanvas(TILE_WIDTH + pad * 2, TILE_HEIGHT + total + pad * 2);
  const originX = TILE_WIDTH / 2 + pad;
  const originY = total + pad + TILE_HEIGHT / 2;
  ctx.translate(originX, originY);

  const corners: Point[] = [
    { x: 0, y: -HALF_HEIGHT },
    { x: HALF_WIDTH, y: 0 },
    { x: 0, y: HALF_HEIGHT },
    { x: -HALF_WIDTH, y: 0 },
  ];

  groundShadow(ctx, { x: 0, y: 2 }, 26, 13, 0.26);

  if (kind === 'tower') {
    drawWallTower(ctx, corners);
  } else if (kind === 'gate') {
    drawGatehouse(ctx, corners, orientation);
  } else {
    drawWallRun(ctx, corners, mask);
  }

  return { canvas, originX, originY };
}

/**
 * A point inside a tile, in sprite-local pixels. `u` runs along tile +x,
 * `v` along tile +y, both from 0 at the north corner to 1 at the far edge.
 */
function tilePoint(u: number, v: number): Point {
  return { x: (u - v) * HALF_WIDTH, y: (u + v - 1) * HALF_HEIGHT };
}

const STONE_SKIN: Skin = { material: 'whitestone', color: PALETTE.stoneLight };
const PARAPET_SKIN: Skin = { material: 'whitestone', color: PALETTE.stoneLight };
const SLATE_SKIN: Skin = { material: 'slate', color: PALETTE.roofBlue };

/**
 * A length of curtain wall: a crenellated rampart of dressed stone running
 * along the direction the wall travels, so successive tiles read as one
 * continuous defence rather than a row of separate slabs.
 */
function drawWallRun(ctx: CanvasRenderingContext2D, corners: Point[], mask: number): void {
  void corners;
  const runsNorthSouth = (mask & 0b0101) !== 0;
  const thin = 0.3;
  const fat = 0.7;
  // Overlap the tile edges very slightly so no seam shows between segments.
  const over = -0.03;
  const end = 1.03;

  const footprint: Point[] = runsNorthSouth
    ? [tilePoint(thin, over), tilePoint(fat, over), tilePoint(fat, end), tilePoint(thin, end)]
    : [tilePoint(over, thin), tilePoint(end, thin), tilePoint(end, fat), tilePoint(over, fat)];

  castShadow(ctx, footprint, WALL_HEIGHT, 0.16);

  // A battered plinth, then the rampart itself: the taper reads as weight.
  const plinth = isoBox(ctx, expandFootprint(footprint, 2.5), 7, {
    material: 'granite',
    color: PALETTE.stoneMid,
  }, false);
  const top = isoBox(ctx, plinth, WALL_HEIGHT - 7, { ...STONE_SKIN, seed: mask });

  // A string course marking the wall walk.
  const band = runsNorthSouth ? [top[1], top[2]] : [top[3], top[2]];
  ctx.strokeStyle = withAlpha(PALETTE.stoneMid, 0.8);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(band[0].x, band[0].y + 5);
  ctx.lineTo(band[1].x, band[1].y + 5);
  ctx.stroke();
  ctx.strokeStyle = withAlpha('#FFF6E0', 0.28);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(band[0].x, band[0].y + 3.4);
  ctx.lineTo(band[1].x, band[1].y + 3.4);
  ctx.stroke();

  drawArrowSlit(ctx, runsNorthSouth ? lerpPoint(top[1], top[2], 0.5) : lerpPoint(top[3], top[2], 0.5));
  drawMerlons(ctx, top, runsNorthSouth, 3);
}

/** A cross-shaped loophole, cut deep enough to read as an opening. */
function drawArrowSlit(ctx: CanvasRenderingContext2D, base: Point): void {
  ctx.save();
  // A splayed reveal in the stone, with the dark of the loophole inside it.
  ctx.fillStyle = withAlpha('#FFF6E0', 0.22);
  ctx.fillRect(base.x - 2.2, base.y + WALL_HEIGHT * 0.34 - 1, 4.4, 12);
  ctx.fillStyle = 'rgba(24, 22, 18, 0.85)';
  ctx.fillRect(base.x - 0.9, base.y + WALL_HEIGHT * 0.34, 1.8, 10);
  ctx.restore();
}

/**
 * Crenellations standing on a wall's walkway. Each merlon is a little
 * isometric block of the same dressed stone, cut from the top face so they
 * sit on the parapet rather than floating beside it.
 */
function drawMerlons(
  ctx: CanvasRenderingContext2D,
  top: Point[],
  runsNorthSouth: boolean,
  count: number,
  height = 7,
): void {
  const [north, east, south, west] = top;
  const edgeA: [Point, Point] = runsNorthSouth ? [north, west] : [north, east];
  const edgeB: [Point, Point] = runsNorthSouth ? [east, south] : [west, south];
  // Merlons take a little under half of each bay, leaving a proper embrasure.
  const half = 0.26 / count;

  for (let i = 0; i < count; i++) {
    const centre = (i + 0.5) / count;
    const from = Math.max(0, centre - half);
    const to = Math.min(1, centre + half);
    const block: Point[] = runsNorthSouth
      ? [
          lerpPoint(edgeA[0], edgeA[1], from),
          lerpPoint(edgeB[0], edgeB[1], from),
          lerpPoint(edgeB[0], edgeB[1], to),
          lerpPoint(edgeA[0], edgeA[1], to),
        ]
      : [
          lerpPoint(edgeA[0], edgeA[1], from),
          lerpPoint(edgeA[0], edgeA[1], to),
          lerpPoint(edgeB[0], edgeB[1], to),
          lerpPoint(edgeB[0], edgeB[1], from),
        ];
    isoBox(ctx, block, height, { ...PARAPET_SKIN, seed: i * 7 });
  }
}

/** Push a footprint outward, for plinths and batters. */
function expandFootprint(points: Point[], amount: number): Point[] {
  let cx = 0;
  let cy = 0;
  for (const point of points) {
    cx += point.x / points.length;
    cy += point.y / points.length;
  }
  return points.map((point) => {
    const dx = point.x - cx;
    const dy = point.y - cy;
    const length = Math.hypot(dx, dy) || 1;
    return { x: point.x + (dx / length) * amount, y: point.y + (dy / length) * amount };
  });
}

/** A round tower with a blue slate cap, as on Stormwind's outer wall. */
function drawWallTower(ctx: CanvasRenderingContext2D, corners: Point[]): void {
  void corners;
  const radiusX = 21;
  const radiusY = 10;
  const height = TOWER_HEIGHT;

  castShadow(
    ctx,
    [
      { x: -radiusX, y: -radiusY },
      { x: radiusX, y: -radiusY },
      { x: radiusX, y: radiusY },
      { x: -radiusX, y: radiusY },
    ],
    height,
    0.18,
  );

  // Battered base, drum, then the parapet it carries.
  cylinder(ctx, { x: 0, y: 2 }, radiusX + 2.5, radiusY + 1.2, 9, {
    material: 'granite',
    color: PALETTE.stoneMid,
  });
  cylinder(ctx, { x: 0, y: -6 }, radiusX, radiusY, height - 12, { ...STONE_SKIN, seed: 3 });

  // Corbels under the parapet, the way a real machicolation is carried.
  const capY = -height - 4;
  for (let i = 0; i < 9; i++) {
    const angle = Math.PI + (i / 8) * Math.PI;
    const x = Math.cos(angle) * (radiusX + 1);
    const y = capY + 8 + Math.sin(angle) * (radiusY + 0.6);
    ctx.beginPath();
    ctx.moveTo(x - 2.4, y);
    ctx.lineTo(x + 2.4, y);
    ctx.lineTo(x + 1.4, y + 4.5);
    ctx.lineTo(x - 1.4, y + 4.5);
    ctx.closePath();
    ctx.fillStyle = light(PALETTE.stoneMid, 'right');
    ctx.fill();
  }

  cylinder(ctx, { x: 0, y: capY + 9 }, radiusX + 3, radiusY + 1.6, 9, { ...PARAPET_SKIN, seed: 11 });

  // Crenellations round the rim.
  for (let i = 0; i < 8; i++) {
    const angle = Math.PI + ((i + 0.5) / 8) * Math.PI;
    const x = Math.cos(angle) * (radiusX + 1.5);
    const y = capY + Math.sin(angle) * (radiusY + 1) - 0.5;
    const facing = Math.cos(angle + Math.PI * 0.25);
    paintFace(
      ctx,
      [
        { x: x - 3.4, y: y - 7 },
        { x: x + 3.4, y: y - 7 },
        { x: x + 3.4, y },
        { x: x - 3.4, y },
      ],
      'whitestone',
      PALETTE.stoneLight,
      { surface: facing > 0.3 ? 'bright' : facing > -0.3 ? 'left' : 'right', seed: i },
    );
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 0.9;
    ctx.strokeRect(x - 3.4, y - 7, 6.8, 7);
  }

  // The slate cap and the lion's pennant above it.
  const roofBase = capY - 5;
  coneRoof(ctx, { x: 0, y: roofBase }, radiusX * 0.84, radiusY * 0.6, 28, { ...SLATE_SKIN, seed: 5 });

  ctx.strokeStyle = PALETTE.stoneDark;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(0, roofBase - 28);
  ctx.lineTo(0, roofBase - 40);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, roofBase - 40);
  ctx.lineTo(11, roofBase - 36);
  ctx.lineTo(0, roofBase - 32);
  ctx.closePath();
  ctx.fillStyle = light(PALETTE.gold, 'left');
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 0.9;
  ctx.stroke();

  // A lit arrow slit facing the viewer.
  drawArrowSlit(ctx, { x: 0, y: -height * 0.72 });
}

/**
 * A gatehouse: two crenellated blocks either side of the street, joined
 * over the road by an arch, so the cobbles run straight through it.
 */
function drawGatehouse(ctx: CanvasRenderingContext2D, corners: Point[], orientation: number): void {
  void corners;
  const passageRunsNorthSouth = orientation === 0;
  const height = WALL_HEIGHT + 6;
  const outer = -0.03;
  const inner = 0.3;

  const blocks: Point[][] = passageRunsNorthSouth
    ? [
        [tilePoint(outer, outer), tilePoint(inner, outer), tilePoint(inner, 1.03), tilePoint(outer, 1.03)],
        [tilePoint(1 - inner, outer), tilePoint(1.03, outer), tilePoint(1.03, 1.03), tilePoint(1 - inner, 1.03)],
      ]
    : [
        [tilePoint(outer, outer), tilePoint(1.03, outer), tilePoint(1.03, inner), tilePoint(outer, inner)],
        [tilePoint(outer, 1 - inner), tilePoint(1.03, 1 - inner), tilePoint(1.03, 1.03), tilePoint(outer, 1.03)],
      ];

  const farBlock = blocks[0];
  const nearBlock = blocks[1];
  castShadow(ctx, [...farBlock, ...nearBlock], height, 0.16);

  const farTop = isoBox(ctx, farBlock, height, { ...STONE_SKIN, seed: 17 });
  drawMerlons(ctx, farTop, passageRunsNorthSouth, 2, 8);

  drawGateArch(ctx, passageRunsNorthSouth, height);

  const nearTop = isoBox(ctx, nearBlock, height, { ...STONE_SKIN, seed: 23 });
  drawMerlons(ctx, nearTop, passageRunsNorthSouth, 2, 8);

  // The lion banner hung between the two blocks.
  const bannerAnchor = passageRunsNorthSouth ? tilePoint(0.5, 0.92) : tilePoint(0.92, 0.5);
  ctx.fillStyle = light(PALETTE.alliance, 'left');
  ctx.fillRect(bannerAnchor.x - 5, bannerAnchor.y - height - 2, 10, 15);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.strokeRect(bannerAnchor.x - 5, bannerAnchor.y - height - 2, 10, 15);
  ctx.fillStyle = light(PALETTE.gold, 'top');
  ctx.fillRect(bannerAnchor.x - 5, bannerAnchor.y - height - 2, 10, 2.5);
}

/** The arched span carrying the wall walk over the roadway. */
function drawGateArch(ctx: CanvasRenderingContext2D, passageRunsNorthSouth: boolean, height: number): void {
  const span: Point[] = passageRunsNorthSouth
    ? [tilePoint(0.3, -0.03), tilePoint(0.7, -0.03), tilePoint(0.7, 1.03), tilePoint(0.3, 1.03)]
    : [tilePoint(-0.03, 0.3), tilePoint(1.03, 0.3), tilePoint(1.03, 0.7), tilePoint(-0.03, 0.7)];

  const lift = height * 0.55;
  const raised = span.map((point) => ({ x: point.x, y: point.y - lift }));
  const top = isoBox(ctx, raised, height - lift, { material: 'whitestone', color: PALETTE.stone, seed: 31 });
  drawMerlons(ctx, top, passageRunsNorthSouth, 2, 8);

  // The dark of the passage, with voussoirs round its head.
  const mouth = passageRunsNorthSouth ? lerpPoint(span[1], span[2], 0.5) : lerpPoint(span[3], span[2], 0.5);
  ctx.beginPath();
  ctx.moveTo(mouth.x - 11, mouth.y);
  ctx.lineTo(mouth.x - 11, mouth.y - lift * 0.55);
  ctx.arc(mouth.x, mouth.y - lift * 0.55, 11, Math.PI, 0);
  ctx.lineTo(mouth.x + 11, mouth.y);
  ctx.closePath();
  ctx.fillStyle = 'rgba(24, 20, 15, 0.9)';
  ctx.fill();

  ctx.strokeStyle = withAlpha(PALETTE.stoneMid, 0.9);
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.arc(mouth.x, mouth.y - lift * 0.55, 12.4, Math.PI, 0);
  ctx.stroke();
  ctx.strokeStyle = withAlpha('#FFF6E0', 0.3);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(mouth.x, mouth.y - lift * 0.55, 13.6, Math.PI * 1.05, Math.PI * 1.7);
  ctx.stroke();

  // The portcullis, raised.
  ctx.strokeStyle = withAlpha(PALETTE.timberDark, 0.8);
  ctx.lineWidth = 1.4;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(mouth.x + i * 4.5, mouth.y - lift * 0.2);
    ctx.lineTo(mouth.x + i * 4.5, mouth.y - lift * 0.78);
    ctx.stroke();
  }
  for (const level of [0.4, 0.62]) {
    ctx.beginPath();
    ctx.moveTo(mouth.x - 9, mouth.y - lift * level);
    ctx.lineTo(mouth.x + 9, mouth.y - lift * level);
    ctx.stroke();
  }
  void strokeSilhouette;
}

// --- People and carts -------------------------------------------------------

/** Directions an agent sprite is drawn for: NE, SE, SW, NW. */
export const AGENT_DIRECTIONS = 4;
export const AGENT_FRAMES = 2;
export const AGENT_VARIANTS = 3;

const agentCache = new Map<string, Sprite>();

export function getAgentSprite(kind: AgentKind, variant: number, direction: number, frame: number): Sprite {
  const key = `${kind}|${variant % AGENT_VARIANTS}|${direction % AGENT_DIRECTIONS}|${frame % AGENT_FRAMES}`;
  const cached = agentCache.get(key);
  if (cached) return cached;
  const sprite = drawAgent(kind, variant % AGENT_VARIANTS, direction % AGENT_DIRECTIONS, frame % AGENT_FRAMES);
  agentCache.set(key, sprite);
  return sprite;
}

const PEASANT_COLORS = [
  { tunic: '#8C6239', trim: '#63431F' },
  { tunic: '#6E7A4A', trim: '#4A5330' },
  { tunic: '#8A5A55', trim: '#5E3A36' },
];
const TRAVELER_COLORS = [
  { tunic: '#5A4A8C', trim: '#3A2F60' },
  { tunic: '#2F7A6B', trim: '#1E5248' },
  { tunic: '#A8783A', trim: '#785222' },
];

function drawAgent(kind: AgentKind, variant: number, direction: number, frame: number): Sprite {
  if (kind === AgentKind.Cart) return drawCart(variant, direction);

  const width = 20;
  const height = 30;
  const { canvas, ctx } = makeCanvas(width, height);
  const originX = width / 2;
  const originY = height - 3;
  ctx.translate(originX, originY);

  groundShadow(ctx, { x: 0, y: 0 }, 6, 3, 0.34);

  // Facing away (NE, NW) hides the face; facing toward shows it.
  const facingAway = direction === 0 || direction === 3;
  const mirror = direction === 2 || direction === 3;
  if (mirror) ctx.scale(-1, 1);

  const scheme =
    kind === AgentKind.Guard
      ? { tunic: PALETTE.alliance, trim: PALETTE.gold }
      : kind === AgentKind.Traveler
        ? TRAVELER_COLORS[variant]
        : PEASANT_COLORS[variant];

  const swing = frame === 0 ? 1 : -1;

  // Legs.
  ctx.strokeStyle = '#4A3A28';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(-1, -8);
  ctx.lineTo(-1 + swing * 2.2, 0);
  ctx.moveTo(1.5, -8);
  ctx.lineTo(1.5 - swing * 2.2, 0);
  ctx.stroke();

  // Body.
  ctx.beginPath();
  ctx.moveTo(-3.6, -8);
  ctx.lineTo(-3, -18);
  ctx.lineTo(3, -18);
  ctx.lineTo(3.6, -8);
  ctx.closePath();
  ctx.fillStyle = scheme.tunic;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = scheme.trim;
  ctx.fillRect(-3.4, -12, 7, 1.8);

  // Arms.
  ctx.strokeStyle = scheme.tunic;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-3, -17);
  ctx.lineTo(-4.5 - swing, -10);
  ctx.moveTo(3, -17);
  ctx.lineTo(4.5 + swing, -10);
  ctx.stroke();

  // Head.
  ctx.beginPath();
  ctx.arc(0, -21.5, 3.6, 0, Math.PI * 2);
  ctx.fillStyle = '#E0B48C';
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.stroke();

  if (facingAway) {
    ctx.beginPath();
    ctx.arc(0, -22.5, 3.4, Math.PI * 0.9, Math.PI * 2.1);
    ctx.fillStyle = '#5A4128';
    ctx.fill();
  } else {
    ctx.fillStyle = '#3A2A1A';
    ctx.fillRect(-1.8, -22.4, 1.2, 1.2);
    ctx.fillRect(0.8, -22.4, 1.2, 1.2);
  }

  if (kind === AgentKind.Guard) {
    // Helm and spear.
    ctx.beginPath();
    ctx.arc(0, -22.8, 3.9, Math.PI, Math.PI * 2);
    ctx.fillStyle = '#B9BEC4';
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    ctx.strokeStyle = PALETTE.timber;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(5.5, -26);
    ctx.lineTo(5.5, -2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(5.5, -30);
    ctx.lineTo(7, -25);
    ctx.lineTo(4, -25);
    ctx.closePath();
    ctx.fillStyle = '#C8CDD3';
    ctx.fill();
  } else if (kind === AgentKind.Traveler) {
    // A pack and a walking staff.
    ctx.beginPath();
    ctx.ellipse(-4.5, -15, 3, 4, 0.3, 0, Math.PI * 2);
    ctx.fillStyle = PALETTE.timber;
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  return { canvas, originX, originY };
}

/** A waggon drawn by a shaggy Elwynn pony, seen from the side. */
function drawCart(variant: number, direction: number): Sprite {
  const width = 58;
  const height = 40;
  const { canvas, ctx } = makeCanvas(width, height);
  const originX = width / 2;
  const originY = height - 5;
  ctx.translate(originX, originY);

  groundShadow(ctx, { x: 0, y: 0 }, 20, 7, 0.3);

  // Directions 2 and 3 face left, so the whole rig is mirrored.
  const mirror = direction === 2 || direction === 3;
  if (mirror) ctx.scale(-1, 1);
  // Travelling away from the viewer tips the rig the other way in isometric.
  const rise = direction === 0 || direction === 3 ? -3 : 3;

  const outline = (path: () => void, fill: string) => {
    ctx.beginPath();
    path();
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1;
    ctx.stroke();
  };

  // --- the pony, in front ---------------------------------------------------
  const ponyX = 15;
  const ponyY = -11 - rise;
  const coat = variant % 3 === 0 ? '#7A5A3C' : variant % 3 === 1 ? '#4E3B2A' : '#9A8264';

  ctx.strokeStyle = '#33261A';
  ctx.lineWidth = 2;
  for (const dx of [-4, 4]) {
    ctx.beginPath();
    ctx.moveTo(ponyX + dx, ponyY + 3);
    ctx.lineTo(ponyX + dx - 1, ponyY + 11);
    ctx.stroke();
  }
  outline(() => ctx.ellipse(ponyX, ponyY, 8.5, 5, -0.08, 0, Math.PI * 2), coat);
  // Neck and head.
  outline(() => {
    ctx.moveTo(ponyX + 5, ponyY - 3);
    ctx.lineTo(ponyX + 12, ponyY - 9);
    ctx.lineTo(ponyX + 15, ponyY - 6);
    ctx.lineTo(ponyX + 8, ponyY + 1);
  }, coat);
  outline(() => ctx.ellipse(ponyX + 13.5, ponyY - 8, 3.4, 2.6, 0.5, 0, Math.PI * 2), coat);
  ctx.fillStyle = '#2A1E14';
  ctx.beginPath();
  ctx.ellipse(ponyX + 4, ponyY - 4, 3.5, 2.2, -0.5, 0, Math.PI * 2);
  ctx.fill();

  // --- the shafts -----------------------------------------------------------
  ctx.strokeStyle = PALETTE.timber;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(-1, -9);
  ctx.lineTo(ponyX - 6, ponyY + 1);
  ctx.stroke();

  // --- the waggon bed -------------------------------------------------------
  const bedTop = -15;
  const bedBottom = -5;
  outline(() => {
    ctx.moveTo(-18, bedTop + 3);
    ctx.lineTo(0, bedTop - rise * 0.6);
    ctx.lineTo(0, bedBottom - rise * 0.6);
    ctx.lineTo(-18, bedBottom + 3);
  }, PALETTE.timberLight);

  // Plank lines along the side panel.
  ctx.strokeStyle = withAlpha(PALETTE.timberDark, 0.7);
  ctx.lineWidth = 1;
  for (const t of [0.35, 0.7]) {
    ctx.beginPath();
    ctx.moveTo(-18, bedTop + 3 + (bedBottom - bedTop) * t + 3 * (1 - t));
    ctx.lineTo(0, bedTop - rise * 0.6 + (bedBottom - bedTop) * t);
    ctx.stroke();
  }

  // --- the load -------------------------------------------------------------
  const cargo = [PALETTE.thatch, PALETTE.timber, PALETTE.rock, PALETTE.roofRed];
  outline(() => {
    ctx.moveTo(-15, bedTop + 2);
    ctx.lineTo(-3, bedTop - rise * 0.6 - 1);
    ctx.lineTo(-3, bedTop - rise * 0.6 - 7);
    ctx.lineTo(-15, bedTop - 4);
  }, cargo[variant % cargo.length]);

  // --- wheels ---------------------------------------------------------------
  for (const [wx, wy] of [[-13, -3.5], [-3, -5.5 - rise * 0.5]] as [number, number][]) {
    outline(() => ctx.arc(wx, wy, 5.2, 0, Math.PI * 2), PALETTE.timberDark);
    ctx.strokeStyle = PALETTE.timberLight;
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI;
      ctx.beginPath();
      ctx.moveTo(wx - Math.cos(angle) * 4.4, wy - Math.sin(angle) * 4.4);
      ctx.lineTo(wx + Math.cos(angle) * 4.4, wy + Math.sin(angle) * 4.4);
      ctx.stroke();
    }
    outline(() => ctx.arc(wx, wy, 1.5, 0, Math.PI * 2), PALETTE.timberLight);
  }

  return { canvas, originX, originY };
}

/** Drop every cached sprite, e.g. when the device pixel ratio changes. */
export function clearPropCaches(): void {
  treeCache.length = 0;
  wallCache.clear();
  agentCache.clear();
}

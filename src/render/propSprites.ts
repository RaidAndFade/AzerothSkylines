/**
 * Procedural artwork for everything that is not a building: the hardwoods
 * of Elwynn, cobbled streets, the Stormwind curtain wall, and the people
 * and carts that move along it.
 */
import { HALF_HEIGHT, HALF_WIDTH, TILE_HEIGHT, TILE_WIDTH } from './iso';
import { PALETTE, mix, shade, withAlpha } from './palette';
import { OUTLINE, Point, boxColors, fillFace, groundShadow, isoBox, lerpPoint, polygon } from './shapes';
import { AgentKind, RoadType } from '../sim/types';
import { hash2 } from '../core/rng';

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

/** Elwynn's four common stands: oak, pine, birch and a turning maple. */
export const TREE_VARIANTS = 4;
const treeCache: Sprite[] = [];

export function getTreeSprite(variant: number): Sprite {
  const index = ((variant % TREE_VARIANTS) + TREE_VARIANTS) % TREE_VARIANTS;
  const cached = treeCache[index];
  if (cached) return cached;
  const sprite = drawTree(index);
  treeCache[index] = sprite;
  return sprite;
}

function drawTree(variant: number): Sprite {
  const width = 52;
  const height = 76;
  const { canvas, ctx } = makeCanvas(width, height);
  const originX = width / 2;
  const originY = height - 6;
  ctx.translate(originX, originY);

  groundShadow(ctx, { x: 0, y: 0 }, 15, 7, 0.3);

  const trunk = variant === 2 ? '#D8D2C4' : PALETTE.timber;
  const trunkDark = variant === 2 ? '#A8A294' : PALETTE.timberDark;

  // Trunk, slightly tapered.
  ctx.beginPath();
  ctx.moveTo(-3.5, 0);
  ctx.lineTo(-2, -26);
  ctx.lineTo(2, -26);
  ctx.lineTo(3.5, 0);
  ctx.closePath();
  ctx.fillStyle = trunk;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(1, -24);
  ctx.lineTo(2.6, 0);
  ctx.lineTo(3.5, 0);
  ctx.lineTo(2, -26);
  ctx.closePath();
  ctx.fillStyle = trunkDark;
  ctx.fill();

  const leaf =
    variant === 3
      ? { main: PALETTE.canopyAutumn, light: '#B99A3A', dark: '#5C4D18' }
      : { main: PALETTE.canopy, light: PALETTE.canopyLight, dark: PALETTE.canopyDark };

  if (variant === 1) {
    // A conifer: stacked skirts.
    for (let i = 0; i < 4; i++) {
      const y = -26 - i * 11;
      const spread = 20 - i * 4;
      ctx.beginPath();
      ctx.moveTo(-spread, y);
      ctx.quadraticCurveTo(0, y - 6, spread, y);
      ctx.lineTo(0, y - 20);
      ctx.closePath();
      ctx.fillStyle = i % 2 === 0 ? leaf.main : leaf.light;
      ctx.fill();
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
    }
  } else {
    // A broadleaf crown: overlapping lobes, lit from the upper left.
    const lobes: [number, number, number][] = [
      [-9, -34, 13],
      [9, -32, 12],
      [0, -46, 15],
      [-12, -46, 10],
      [11, -45, 10],
      [0, -30, 14],
    ];
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1.2;
    for (const [x, y, r] of lobes) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = leaf.main;
      ctx.fill();
      ctx.stroke();
    }
    // Highlight on the sunward side, shadow beneath.
    for (const [x, y, r] of lobes) {
      ctx.beginPath();
      ctx.arc(x - r * 0.25, y - r * 0.3, r * 0.62, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(leaf.light, 0.55);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(4, -28, 12, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha(leaf.dark, 0.4);
    ctx.fill();
  }

  return { canvas, originX, originY };
}

// --- Roads ------------------------------------------------------------------

const roadCache = new Map<number, Sprite>();

/**
 * A road tile, auto-tiled from its connection mask. The mask has bits in
 * N, E, S, W order; edges without a neighbour get a kerb.
 */
export function getRoadSprite(type: RoadType, mask: number): Sprite {
  const key = type * 16 + mask;
  const cached = roadCache.get(key);
  if (cached) return cached;
  const sprite = drawRoad(type, mask);
  roadCache.set(key, sprite);
  return sprite;
}

function drawRoad(type: RoadType, mask: number): Sprite {
  const pad = 3;
  const { canvas, ctx } = makeCanvas(TILE_WIDTH + pad * 2, TILE_HEIGHT + pad * 2);
  const originX = TILE_WIDTH / 2 + pad;
  const originY = TILE_HEIGHT / 2 + pad;
  ctx.translate(originX, originY);

  const diamond: Point[] = [
    { x: 0, y: -HALF_HEIGHT },
    { x: HALF_WIDTH, y: 0 },
    { x: 0, y: HALF_HEIGHT },
    { x: -HALF_WIDTH, y: 0 },
  ];

  const surface =
    type === RoadType.Avenue ? PALETTE.flagstone : type === RoadType.Cobble ? PALETTE.cobble : PALETTE.path;
  const surfaceLight =
    type === RoadType.Avenue ? PALETTE.flagstoneLight : type === RoadType.Cobble ? PALETTE.cobbleLight : mix(PALETTE.path, '#FFFFFF', 0.18);
  const surfaceDark =
    type === RoadType.Avenue ? PALETTE.flagstoneDark : type === RoadType.Cobble ? PALETTE.cobbleDark : PALETTE.pathDark;

  fillFace(ctx, diamond, surface, false);

  ctx.save();
  polygon(ctx, diamond);
  ctx.clip();

  if (type === RoadType.Path) {
    // A packed dirt track: scattered grit, no masonry.
    for (let i = 0; i < 26; i++) {
      const u = hash2(i, mask, 3);
      const v = hash2(mask, i, 5);
      const a = lerpPoint(diamond[3], diamond[0], u);
      const b = lerpPoint(diamond[2], diamond[1], u);
      const point = lerpPoint(a, b, v);
      ctx.fillStyle = i % 3 === 0 ? surfaceLight : surfaceDark;
      ctx.fillRect(point.x, point.y, 2, 1.5);
    }
  } else if (type === RoadType.Avenue) {
    // Large flagstones, laid to the diagonal of the street.
    ctx.strokeStyle = withAlpha(surfaceDark, 0.7);
    ctx.lineWidth = 1.2;
    for (let i = 1; i < 4; i++) {
      const a = lerpPoint(diamond[3], diamond[2], i / 4);
      const b = lerpPoint(diamond[0], diamond[1], i / 4);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      const c = lerpPoint(diamond[3], diamond[0], i / 4);
      const d = lerpPoint(diamond[2], diamond[1], i / 4);
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.stroke();
    }
  } else {
    // Cobbles: small rounded stones in staggered courses.
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 7; col++) {
        const u = (row + 0.5) / 7;
        const v = (col + 0.5 + (row % 2) * 0.3) / 7;
        const a = lerpPoint(diamond[3], diamond[0], u);
        const b = lerpPoint(diamond[2], diamond[1], u);
        const point = lerpPoint(a, b, v % 1);
        const tone = hash2(row, col, mask);
        ctx.beginPath();
        ctx.ellipse(point.x, point.y, 3.2, 1.8, 0, 0, Math.PI * 2);
        ctx.fillStyle = tone > 0.66 ? surfaceLight : tone > 0.33 ? surface : surfaceDark;
        ctx.fill();
      }
    }
  }
  ctx.restore();

  // Kerbs along every edge with no road beyond it.
  const edges: [number, Point, Point][] = [
    [1, diamond[3], diamond[0]],
    [2, diamond[0], diamond[1]],
    [4, diamond[1], diamond[2]],
    [8, diamond[2], diamond[3]],
  ];
  ctx.lineWidth = 1.6;
  for (const [bit, from, to] of edges) {
    if (mask & bit) continue;
    ctx.strokeStyle =
      type === RoadType.Path
        ? withAlpha(PALETTE.pathDark, 0.55)
        : withAlpha(type === RoadType.Avenue ? PALETTE.flagstoneDark : PALETTE.cobbleDark, 0.6);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }

  return { canvas, originX, originY };
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

const WALL_HEIGHT = 34;
const TOWER_HEIGHT = 54;

function drawWall(kind: WallKind, mask: number, orientation: number): Sprite {
  const pad = 12;
  const total = kind === 'tower' ? TOWER_HEIGHT + 40 : kind === 'gate' ? WALL_HEIGHT + 40 : WALL_HEIGHT + 22;
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

/**
 * A length of curtain wall: a narrow crenellated block running along the
 * direction the wall travels, so successive tiles read as one continuous
 * rampart rather than a row of separate slabs.
 */
function drawWallRun(ctx: CanvasRenderingContext2D, corners: Point[], mask: number): void {
  void corners;
  const runsNorthSouth = (mask & 0b0101) !== 0;
  const thin = 0.26;
  const fat = 0.74;
  // Overlap the tile edges very slightly so no seam shows between segments.
  const over = -0.03;
  const end = 1.03;

  // Footprint corners in [north, east, south, west] order.
  const footprint: Point[] = runsNorthSouth
    ? [tilePoint(thin, over), tilePoint(fat, over), tilePoint(fat, end), tilePoint(thin, end)]
    : [tilePoint(over, thin), tilePoint(end, thin), tilePoint(end, fat), tilePoint(over, fat)];

  const colors = boxColors(PALETTE.stoneLight);
  const top = isoBox(ctx, footprint, WALL_HEIGHT, colors);

  // Coursed stone on the face the viewer sees.
  drawMasonry(ctx, [top[1], top[2], footprint[2], footprint[1]], WALL_HEIGHT);
  drawMasonry(ctx, [top[3], top[2], footprint[2], footprint[3]], WALL_HEIGHT);

  // An arrow slit facing out of the city.
  const slitBase = runsNorthSouth ? lerpPoint(top[1], top[2], 0.5) : lerpPoint(top[3], top[2], 0.5);
  ctx.fillStyle = 'rgba(32, 26, 18, 0.72)';
  ctx.fillRect(slitBase.x - 1.2, slitBase.y + WALL_HEIGHT * 0.32, 2.4, 9);

  drawMerlons(ctx, top, runsNorthSouth, 3);
}

/**
 * Crenellations standing on a wall's walkway. Each merlon is a little
 * isometric block cut from the top face, so they sit on the parapet
 * instead of floating beside it.
 */
function drawMerlons(
  ctx: CanvasRenderingContext2D,
  top: Point[],
  runsNorthSouth: boolean,
  count: number,
  height = 9,
): void {
  const [north, east, south, west] = top;
  // The two edges the merlons march along, and the half-width of each block.
  const edgeA: [Point, Point] = runsNorthSouth ? [north, west] : [north, east];
  const edgeB: [Point, Point] = runsNorthSouth ? [east, south] : [west, south];
  const half = 0.5 / (count * 2);
  const colors = boxColors(PALETTE.stoneLight);

  for (let i = 0; i < count; i++) {
    const centre = (i + 0.5) / count;
    const from = Math.max(0, centre - half * 2);
    const to = Math.min(1, centre + half * 2);
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
    isoBox(ctx, block, height, colors);
  }
}

/** A round tower with a blue conical cap, as on Stormwind's outer wall. */
function drawWallTower(ctx: CanvasRenderingContext2D, corners: Point[]): void {
  void corners;
  const radiusX = 21;
  const radiusY = 10;
  const height = TOWER_HEIGHT;

  // Body.
  ctx.beginPath();
  ctx.moveTo(-radiusX, -height);
  ctx.lineTo(-radiusX, 0);
  ctx.ellipse(0, 0, radiusX, radiusY, 0, Math.PI, 0, false);
  ctx.lineTo(radiusX, -height);
  ctx.closePath();
  ctx.fillStyle = shade(PALETTE.stoneLight, -0.16);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-radiusX, -height);
  ctx.lineTo(-radiusX, 0);
  ctx.lineTo(-radiusX * 0.25, radiusY * 0.92);
  ctx.lineTo(-radiusX * 0.25, -height + radiusY * 0.92);
  ctx.closePath();
  ctx.fillStyle = PALETTE.stoneLight;
  ctx.fill();

  // Courses of stone.
  ctx.strokeStyle = withAlpha(PALETTE.stoneMid, 0.6);
  ctx.lineWidth = 1;
  for (let i = 1; i < 6; i++) {
    const y = -height + (height / 6) * i;
    ctx.beginPath();
    ctx.ellipse(0, y, radiusX, radiusY, 0, 0.15, Math.PI - 0.15);
    ctx.stroke();
  }

  // Crenellated parapet, then the roof.
  ctx.beginPath();
  ctx.ellipse(0, -height, radiusX + 3, radiusY + 1.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.stone;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2;
    const x = Math.cos(angle) * (radiusX + 1);
    const y = -height + Math.sin(angle) * (radiusY + 1);
    if (Math.sin(angle) < -0.75) continue;
    ctx.beginPath();
    ctx.rect(x - 3.5, y - 8, 7, 8);
    ctx.fillStyle = PALETTE.stoneLight;
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
  }

  const capBase = -height - 6;
  ctx.beginPath();
  ctx.moveTo(-radiusX * 0.82, capBase);
  ctx.lineTo(0, capBase - 26);
  ctx.lineTo(radiusX * 0.82, capBase);
  ctx.closePath();
  ctx.fillStyle = PALETTE.roofBlue;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-radiusX * 0.82, capBase);
  ctx.lineTo(0, capBase - 26);
  ctx.lineTo(-radiusX * 0.18, capBase);
  ctx.closePath();
  ctx.fillStyle = PALETTE.roofBlueLight;
  ctx.fill();

  // The lion's pennant.
  ctx.strokeStyle = PALETTE.stoneDark;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(0, capBase - 26);
  ctx.lineTo(0, capBase - 38);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, capBase - 38);
  ctx.lineTo(11, capBase - 34);
  ctx.lineTo(0, capBase - 30);
  ctx.closePath();
  ctx.fillStyle = PALETTE.gold;
  ctx.fill();
}

/**
 * A gatehouse: two crenellated blocks either side of the street, joined
 * over the road by an arch, so the cobbles run straight through it.
 */
function drawGatehouse(ctx: CanvasRenderingContext2D, corners: Point[], orientation: number): void {
  void corners;
  // Orientation 0 means the road runs north-south, so the blocks flank it
  // to east and west; orientation 1 is the other way about.
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

  // The far block, then the arch over the road, then the near block, so the
  // painter's order matches what a viewer would actually see.
  const colors = boxColors(PALETTE.stoneLight);
  const farBlock = blocks[0];
  const nearBlock = blocks[1];

  const farTop = isoBox(ctx, farBlock, height, colors);
  drawMerlons(ctx, farTop, passageRunsNorthSouth, 2, 8);

  drawGateArch(ctx, passageRunsNorthSouth, height);

  const nearTop = isoBox(ctx, nearBlock, height, colors);
  drawMasonry(ctx, [nearTop[1], nearTop[2], nearBlock[2], nearBlock[1]], height);
  drawMasonry(ctx, [nearTop[3], nearTop[2], nearBlock[2], nearBlock[3]], height);
  drawMerlons(ctx, nearTop, passageRunsNorthSouth, 2, 8);

  // The lion banner hung between the two blocks.
  const bannerAnchor = passageRunsNorthSouth ? tilePoint(0.5, 0.92) : tilePoint(0.92, 0.5);
  ctx.fillStyle = PALETTE.alliance;
  ctx.fillRect(bannerAnchor.x - 5, bannerAnchor.y - height - 2, 10, 15);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.strokeRect(bannerAnchor.x - 5, bannerAnchor.y - height - 2, 10, 15);
  ctx.fillStyle = PALETTE.gold;
  ctx.fillRect(bannerAnchor.x - 5, bannerAnchor.y - height - 2, 10, 2.5);
}

/** The arched span carrying the wall walk over the roadway. */
function drawGateArch(ctx: CanvasRenderingContext2D, passageRunsNorthSouth: boolean, height: number): void {
  const span: Point[] = passageRunsNorthSouth
    ? [tilePoint(0.3, -0.03), tilePoint(0.7, -0.03), tilePoint(0.7, 1.03), tilePoint(0.3, 1.03)]
    : [tilePoint(-0.03, 0.3), tilePoint(1.03, 0.3), tilePoint(1.03, 0.7), tilePoint(-0.03, 0.7)];

  // The span sits on top, leaving an opening beneath it for the road.
  const lift = height * 0.55;
  const raised = span.map((point) => ({ x: point.x, y: point.y - lift }));
  const colors = boxColors(PALETTE.stone);
  const top = isoBox(ctx, raised, height - lift, colors);
  drawMerlons(ctx, top, passageRunsNorthSouth, 2, 8);

  // The dark of the passage, and the portcullis across it.
  const mouth = passageRunsNorthSouth ? lerpPoint(span[1], span[2], 0.5) : lerpPoint(span[3], span[2], 0.5);
  ctx.beginPath();
  ctx.moveTo(mouth.x - 11, mouth.y);
  ctx.lineTo(mouth.x - 11, mouth.y - lift * 0.55);
  ctx.arc(mouth.x, mouth.y - lift * 0.55, 11, Math.PI, 0);
  ctx.lineTo(mouth.x + 11, mouth.y);
  ctx.closePath();
  ctx.fillStyle = 'rgba(28, 22, 15, 0.85)';
  ctx.fill();

  ctx.strokeStyle = withAlpha(PALETTE.timberDark, 0.75);
  ctx.lineWidth = 1.3;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(mouth.x + i * 4.5, mouth.y);
    ctx.lineTo(mouth.x + i * 4.5, mouth.y - lift * 0.75);
    ctx.stroke();
  }
}

/** Faint coursing lines, which is what sells stone at this scale. */
function drawMasonry(ctx: CanvasRenderingContext2D, face: Point[], height: number): void {
  ctx.save();
  polygon(ctx, face);
  ctx.clip();
  ctx.strokeStyle = withAlpha(PALETTE.stoneMid, 0.55);
  ctx.lineWidth = 1;
  const courses = 5;
  for (let i = 1; i < courses; i++) {
    const a = lerpPoint(face[0], face[3], i / courses);
    const b = lerpPoint(face[1], face[2], i / courses);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  void height;
  ctx.restore();
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
  roadCache.clear();
  wallCache.clear();
  agentCache.clear();
}

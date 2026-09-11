/**
 * The scene renderer.
 *
 * Ground is painted first as batched diamonds, then everything that stands
 * on it is gathered into one list, sorted by depth and drawn nearest last,
 * so a cottage correctly hides the hedge behind it and the wall hides the
 * cottage.
 */
import { ELEVATION_STEP, HALF_HEIGHT, HALF_WIDTH, depthOf } from './iso';
import { PALETTE, mix, withAlpha } from './palette';
import { Camera } from './camera';
import { DETAIL_ZOOM, TileRange, ViewRect, drawTerrain, strokeTile, strokeTileRect } from './terrainLayer';
import { getBuildingSprite } from './buildingSprites';
import { Sprite, getAgentSprite, getRoadSprite, getTreeSprite, getWallSprite } from './propSprites';
import { AgentKind, Building, RoadType, Service, Terrain, Zone, isWater } from '../sim/types';
import { CityState, PARCEL_SIZE, tileIndex } from '../sim/city';
import { treesOnTile } from '../sim/terrain';
import { roadConnectionMask } from '../sim/roads';
import { getDef } from '../data/buildings';

export type Overlay =
  | 'none'
  | 'water'
  | 'sewage'
  | 'safety'
  | 'faith'
  | 'leisure'
  | 'commerce'
  | 'landValue'
  | 'pollution'
  | 'land';

export interface BuildPreview {
  /** Tiles to highlight, with whether each is a legal placement. */
  tiles: { x: number; y: number; ok: boolean }[];
  /** Optional footprint rectangle to outline. */
  rect?: { x: number; y: number; width: number; height: number; ok: boolean };
}

export interface RenderOptions {
  /** Seconds since the game started, for animation. */
  time: number;
  overlay: Overlay;
  showZones: boolean;
  hoverTile: { x: number; y: number } | null;
  preview: BuildPreview | null;
  selectedBuilding: number | null;
  /** Parcel the player is considering buying. */
  highlightParcel: { px: number; py: number } | null;
}

const SKY_TOP = '#7FB3D9';
const SKY_BOTTOM = '#CFE4EE';

/**
 * One sprite to paint, with the depth it sorts at.
 *
 * Depth is an explicit function of world position, height and footprint
 * rather than something the loop nesting happens to produce, so buildings,
 * trees and people all sort against each other rather than only within
 * their own kind.
 */
interface DrawItem {
  depth: number;
  /** Screen position the sprite is anchored at. */
  x: number;
  y: number;
  sprite: Sprite;
  /** Trees are drawn at a per-tree scale; everything else at 1. */
  scale: number;
  /** Set for buildings, so the selection outline and warning draw with it. */
  building: Building | null;
}

function byDepth(a: DrawItem, b: DrawItem): number {
  return a.depth - b.depth;
}

/**
 * Depth a building sorts at.
 *
 * A building is emitted once, from its anchor — the footprint's north-west
 * corner, and so its *smallest* x + y. Sorting it there puts it behind
 * anything standing on the tiles it covers, which is backwards, so it sorts
 * on its far corner instead. Where it draws is unchanged.
 */
export function buildingDepth(
  building: { x: number; y: number; width: number; height: number },
  elevation: number,
): number {
  return depthOf(building.x + building.width - 1, building.y + building.height - 1, elevation);
}

/**
 * Depth a tree sorts at, including the sub-tile offset that decides where it
 * is actually standing.
 *
 * The offset is given in screen pixels; inverting the projection turns it
 * back into a tile position. Only the north-south part moves a tree in
 * depth — nudging one east or west slides it along its own diagonal.
 */
export function treeDepth(
  x: number,
  y: number,
  tree: { ox: number; oy: number },
  elevation: number,
): number {
  return depthOf(x + (tree.oy + tree.ox) / 2, y + (tree.oy - tree.ox) / 2, elevation);
}

/**
 * Height under a point given in fractional tile coordinates, interpolated so
 * that someone walking between two elevation steps rises smoothly instead of
 * popping a full step at the tile boundary.
 */
export function sampleElevation(city: CityState, x: number, y: number): number {
  const width = city.width;
  const height = city.height;
  const elevation = city.map.elevation;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const lx = x0 < 0 ? 0 : x0 > width - 1 ? width - 1 : x0;
  const hx = x0 + 1 < 0 ? 0 : x0 + 1 > width - 1 ? width - 1 : x0 + 1;
  const ly = y0 < 0 ? 0 : y0 > height - 1 ? height - 1 : y0;
  const hy = y0 + 1 < 0 ? 0 : y0 + 1 > height - 1 ? height - 1 : y0 + 1;
  const topLeft = elevation[ly * width + lx];
  const topRight = elevation[ly * width + hx];
  const bottomLeft = elevation[hy * width + lx];
  const bottomRight = elevation[hy * width + hx];
  const top = topLeft + (topRight - topLeft) * fx;
  const bottom = bottomLeft + (bottomRight - bottomLeft) * fx;
  return top + (bottom - top) * fy;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly camera = new Camera();
  private ctx: CanvasRenderingContext2D;
  private pixelRatio = 1;
  /** Rebuilt only on resize; creating it per frame was pure waste. */
  private sky: CanvasGradient | null = null;
  /** Frame time in milliseconds, smoothed, for the debug readout. */
  frameTime = 0;
  /** This frame's sprites, rebuilt each frame and sorted by depth. */
  private drawItems: DrawItem[] = [];
  /** Backing store for the above, kept between frames and never shrunk. */
  private itemPool: DrawItem[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas is unavailable');
    this.ctx = ctx;
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.pixelRatio = pixelRatio;
    this.canvas.width = Math.round(width * pixelRatio);
    this.canvas.height = Math.round(height * pixelRatio);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.camera.resize(width, height);
    this.sky = null;
  }

  render(city: CityState, options: RenderOptions): void {
    const started = performance.now();
    const ctx = this.ctx;

    ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    this.drawSky();

    ctx.save();
    this.camera.applyTransform(ctx);

    // Computed once and passed down: culling ran per tile, and each call
    // allocated a fresh rectangle.
    const view = this.camera.visibleWorldRect();
    const range = this.camera.visibleTileRect(city.width, city.height);
    drawTerrain(ctx, city, view, range, {
      time: options.time,
      showZones: options.showZones,
      zoom: this.camera.zoom,
    });

    if (options.overlay !== 'none') this.drawOverlay(city, range, options.overlay);

    this.drawObjects(city, view, range, options);
    this.drawParcelGrid(city, range, options);
    this.drawPreview(city, options);

    ctx.restore();

    const elapsed = performance.now() - started;
    this.frameTime = this.frameTime * 0.9 + elapsed * 0.1;
  }

  private drawSky(): void {
    const ctx = this.ctx;
    if (!this.sky) {
      const gradient = ctx.createLinearGradient(0, 0, 0, this.camera.viewHeight);
      gradient.addColorStop(0, SKY_TOP);
      gradient.addColorStop(1, SKY_BOTTOM);
      this.sky = gradient;
    }
    ctx.fillStyle = this.sky;
    ctx.fillRect(0, 0, this.camera.viewWidth, this.camera.viewHeight);
  }

  /**
   * Draw everything standing on the ground, nearest last.
   *
   * Collected into one list with an explicit depth per sprite, then sorted,
   * so that height, multi-tile footprints and sub-tile positions all take
   * part in the ordering — none of which a walk over x + y diagonals can
   * express. The list and its items are reused between frames.
   */
  private drawObjects(
    city: CityState,
    view: ViewRect,
    range: TileRange,
    options: RenderOptions,
  ): void {
    const ctx = this.ctx;
    const zoom = this.camera.zoom;
    // Foliage and people are not worth drawing when zoomed far out.
    const drawDetail = zoom >= DETAIL_ZOOM;
    const width = city.width;
    const elevation = city.map.elevation;
    const items = this.drawItems;
    items.length = 0;

    for (let y = range.y0; y <= range.y1; y++) {
      for (let x = range.x0; x <= range.x1; x++) {
        const index = y * width + x;
        const step = elevation[index];
        const cx = (x - y) * HALF_WIDTH;
        const cy = (x + y) * HALF_HEIGHT - step * ELEVATION_STEP;

        // Inline culling, with headroom for tall sprites above the tile.
        if (cx + 90 < view.left || cx - 90 > view.right) continue;
        if (cy + 90 < view.top || cy - 200 > view.bottom) continue;

        const tileDepth = depthOf(x, y, step);

        // Streets.
        const road = city.roads[index] as RoadType;
        if (road !== RoadType.None) {
          this.push(tileDepth, cx, cy, getRoadSprite(road, roadConnectionMask(city, x, y)), 1, null);
        }

        // The curtain wall.
        const wallIndex = city.wallAt[index];
        if (wallIndex >= 0) {
          const segment = city.walls[wallIndex];
          this.push(
            tileDepth,
            cx,
            cy,
            getWallSprite(segment.kind, segment.connections, segment.orientation),
            1,
            null,
          );
        }

        // Buildings are emitted once, from their anchor tile, but sort on
        // their far corner — see `buildingDepth`.
        const buildingId = city.buildingAt[index];
        if (buildingId >= 0) {
          const building = city.buildings.get(buildingId);
          if (building && building.x === x && building.y === y) {
            const sprite = getBuildingSprite(building.defId, building.variant, building.facing, building.abandoned);
            this.push(buildingDepth(building, step), cx, cy, sprite, 1, building);
          }
        } else if (drawDetail && road === RoadType.None && wallIndex < 0) {
          // Woodland, but only where nothing has been built. A tree nudged
          // toward a corner of its tile sorts from where it actually stands
          // — see `treeDepth`.
          for (const tree of treesOnTile(city.map, x, y)) {
            this.push(
              treeDepth(x, y, tree, step),
              cx + tree.ox * HALF_WIDTH,
              cy + tree.oy * HALF_HEIGHT,
              getTreeSprite(tree.variant),
              tree.scale,
              null,
            );
          }
        }
      }
    }

    // People and carts, at their own continuous position and their own
    // height, so two villagers on one tile keep a stable order and neither
    // pops a full step crossing a slope.
    if (drawDetail) {
      for (const agent of city.agents) {
        if (agent.x < range.x0 || agent.x > range.x1 || agent.y < range.y0 || agent.y > range.y1) continue;
        const height = sampleElevation(city, agent.x, agent.y);
        const worldX = (agent.x - agent.y) * HALF_WIDTH;
        const worldY = (agent.x + agent.y) * HALF_HEIGHT - height * ELEVATION_STEP;
        if (worldX + 90 < view.left || worldX - 90 > view.right) continue;
        if (worldY + 90 < view.top || worldY - 200 > view.bottom) continue;
        const direction = directionOf(agent.heading);
        const frame = Math.floor(options.time * 5 + agent.id) % 2;
        const sprite = getAgentSprite(agent.kind, agent.variant, direction, frame);
        this.push(depthOf(agent.x, agent.y, height), worldX, worldY, sprite, 1, null);
      }
    }

    items.sort(byDepth);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const sprite = item.sprite;
      if (item.scale === 1) {
        ctx.drawImage(sprite.canvas, item.x - sprite.originX, item.y - sprite.originY);
      } else {
        ctx.save();
        ctx.translate(item.x, item.y);
        ctx.scale(item.scale, item.scale);
        ctx.drawImage(sprite.canvas, -sprite.originX, -sprite.originY);
        ctx.restore();
      }

      const building = item.building;
      if (building) {
        if (options.selectedBuilding === building.id) {
          this.outlineBuilding(city, building.x, building.y, building.width, building.height);
        }
        if (!building.connected && !building.abandoned && drawDetail) {
          this.drawWarningIcon(item.x, item.y - sprite.originY * 0.55, options.time);
        }
      }
    }
  }

  /**
   * Add a sprite to this frame's draw list, reusing the item object from the
   * previous frame so a busy frame allocates nothing per sprite.
   */
  private push(
    depth: number,
    x: number,
    y: number,
    sprite: Sprite,
    scale: number,
    building: Building | null,
  ): void {
    const items = this.drawItems;
    const pool = this.itemPool;
    const index = items.length;
    let item = pool[index];
    if (!item) {
      item = { depth, x, y, sprite, scale, building };
      pool[index] = item;
    } else {
      item.depth = depth;
      item.x = x;
      item.y = y;
      item.sprite = sprite;
      item.scale = scale;
      item.building = building;
    }
    items.push(item);
  }

  private outlineBuilding(city: CityState, x: number, y: number, width: number, height: number): void {
    strokeTileRect(this.ctx, city, x, y, width, height, PALETTE.gold, 2.5);
  }

  /** A pulsing marker over a building that has lost its road. */
  private drawWarningIcon(x: number, y: number, time: number): void {
    const ctx = this.ctx;
    const bob = Math.sin(time * 3) * 3;
    ctx.save();
    ctx.translate(x, y + bob);
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(9, 5);
    ctx.lineTo(-9, 5);
    ctx.closePath();
    ctx.fillStyle = PALETTE.gold;
    ctx.fill();
    ctx.strokeStyle = 'rgba(40, 28, 10, 0.7)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.fillStyle = '#3A2A10';
    ctx.fillRect(-1.2, -6, 2.4, 6);
    ctx.fillRect(-1.2, 1.5, 2.4, 2.4);
    ctx.restore();
  }

  // --- Overlays -------------------------------------------------------------

  private drawOverlay(city: CityState, range: TileRange, overlay: Overlay): void {
    if (overlay === 'land') return;
    const field = overlayField(city, overlay);
    if (!field) return;
    const ctx = this.ctx;
    const { low, high } = OVERLAY_COLORS[overlay];

    // Bucket into a handful of shades so this stays one fill per shade.
    const buckets = new Map<number, Path2D>();
    for (let y = range.y0; y <= range.y1; y++) {
      for (let x = range.x0; x <= range.x1; x++) {
        const index = tileIndex(city, x, y);
        if (isWater(city.map.terrain[index] as Terrain)) continue;
        const value = Math.max(0, Math.min(1, field[index]));
        if (value <= 0.02) continue;
        const bucket = Math.min(5, Math.floor(value * 6));
        let path = buckets.get(bucket);
        if (!path) {
          path = new Path2D();
          buckets.set(bucket, path);
        }
        const cx = (x - y) * HALF_WIDTH;
        const cy = (x + y) * HALF_HEIGHT - city.map.elevation[index] * ELEVATION_STEP;
        path.moveTo(cx, cy - HALF_HEIGHT);
        path.lineTo(cx + HALF_WIDTH, cy);
        path.lineTo(cx, cy + HALF_HEIGHT);
        path.lineTo(cx - HALF_WIDTH, cy);
        path.closePath();
      }
    }
    for (const [bucket, path] of buckets) {
      const t = bucket / 5;
      ctx.fillStyle = withAlpha(mix(low, high, t), 0.28 + t * 0.34);
      ctx.fill(path);
    }
  }

  /** Parcel boundaries, and the lot the player is being quoted for. */
  private drawParcelGrid(city: CityState, range: TileRange, options: RenderOptions): void {
    if (options.overlay !== 'land' && !options.highlightParcel) return;
    const ctx = this.ctx;

    if (options.overlay === 'land') {
      const px0 = Math.floor(range.x0 / PARCEL_SIZE);
      const py0 = Math.floor(range.y0 / PARCEL_SIZE);
      const px1 = Math.floor(range.x1 / PARCEL_SIZE);
      const py1 = Math.floor(range.y1 / PARCEL_SIZE);
      for (let py = py0; py <= py1; py++) {
        for (let px = px0; px <= px1; px++) {
          const parcel = city.parcels[py * city.parcelsWide + px];
          if (!parcel || parcel.owned) continue;
          const color = parcel.settleable ? PALETTE.gold : PALETTE.crimson;
          strokeTileRect(
            ctx,
            city,
            px * PARCEL_SIZE,
            py * PARCEL_SIZE,
            PARCEL_SIZE,
            PARCEL_SIZE,
            withAlpha(color, 0.65),
            2,
            withAlpha(color, parcel.settleable ? 0.1 : 0.05),
          );
        }
      }
    }

    if (options.highlightParcel) {
      const { px, py } = options.highlightParcel;
      strokeTileRect(
        ctx,
        city,
        px * PARCEL_SIZE,
        py * PARCEL_SIZE,
        PARCEL_SIZE,
        PARCEL_SIZE,
        PALETTE.gold,
        3,
        withAlpha(PALETTE.gold, 0.22),
      );
    }
  }

  private drawPreview(city: CityState, options: RenderOptions): void {
    const ctx = this.ctx;
    if (options.preview) {
      for (const tile of options.preview.tiles) {
        strokeTile(
          ctx,
          city,
          tile.x,
          tile.y,
          withAlpha(tile.ok ? PALETTE.emerald : PALETTE.crimson, 0.95),
          2,
          withAlpha(tile.ok ? PALETTE.emerald : PALETTE.crimson, 0.3),
        );
      }
      if (options.preview.rect) {
        const rect = options.preview.rect;
        strokeTileRect(
          ctx,
          city,
          rect.x,
          rect.y,
          rect.width,
          rect.height,
          rect.ok ? PALETTE.emerald : PALETTE.crimson,
          3,
        );
      }
    } else if (options.hoverTile) {
      strokeTile(ctx, city, options.hoverTile.x, options.hoverTile.y, withAlpha(PALETTE.parchment, 0.8), 2);
    }
  }

  /**
   * Which tile a screen point is over. Because height shifts a tile upward
   * on screen, the search walks from the highest possible ground down, and
   * takes the first tile whose diamond actually contains the point.
   */
  pickTile(city: CityState, screenX: number, screenY: number): { x: number; y: number } | null {
    const world = this.camera.screenToWorld(screenX, screenY);
    let best: { x: number; y: number } | null = null;

    // Tiles higher up the screen may be tall ground in front of the camera;
    // check from the far side forward and keep the nearest match.
    for (let elevation = 0; elevation <= 7; elevation++) {
      const adjustedY = world.y + elevation * ELEVATION_STEP;
      const tx = Math.floor(adjustedY / (HALF_HEIGHT * 2) + world.x / (HALF_WIDTH * 2) + 0.5);
      const ty = Math.floor(adjustedY / (HALF_HEIGHT * 2) - world.x / (HALF_WIDTH * 2) + 0.5);
      if (tx < 0 || ty < 0 || tx >= city.width || ty >= city.height) continue;
      if (city.map.elevation[tileIndex(city, tx, ty)] !== elevation) continue;
      best = { x: tx, y: ty };
    }

    if (best) return best;
    // Fall back to the flat projection, so clicks never simply do nothing.
    const tx = Math.floor(world.y / (HALF_HEIGHT * 2) + world.x / (HALF_WIDTH * 2) + 0.5);
    const ty = Math.floor(world.y / (HALF_HEIGHT * 2) - world.x / (HALF_WIDTH * 2) + 0.5);
    if (tx < 0 || ty < 0 || tx >= city.width || ty >= city.height) return null;
    return { x: tx, y: ty };
  }
}

const OVERLAY_COLORS: Record<Overlay, { low: string; high: string }> = {
  none: { low: PALETTE.grass, high: PALETTE.grass },
  land: { low: PALETTE.gold, high: PALETTE.gold },
  water: { low: PALETTE.waterShallow, high: PALETTE.water },
  sewage: { low: '#8C9E5C', high: '#5C6B2C' },
  safety: { low: '#7FB3D9', high: PALETTE.alliance },
  faith: { low: '#F3E7CC', high: PALETTE.gold },
  leisure: { low: '#A5D267', high: PALETTE.emerald },
  commerce: { low: '#F0C44A', high: '#C4762C' },
  landValue: { low: '#C8E0A0', high: '#2F7A4A' },
  pollution: { low: '#C4A88C', high: '#6E3A2C' },
};

function overlayField(city: CityState, overlay: Overlay): Float32Array | null {
  switch (overlay) {
    case 'water':
      return city.coverage[Service.Water];
    case 'sewage':
      return city.coverage[Service.Sewage];
    case 'safety':
      return city.coverage[Service.Safety];
    case 'faith':
      return city.coverage[Service.Faith];
    case 'leisure':
      return city.coverage[Service.Leisure];
    case 'commerce':
      return city.coverage[Service.Commerce];
    case 'landValue':
      return city.landValue;
    case 'pollution':
      return city.pollution;
    default:
      return null;
  }
}

/** Map a tile-space heading onto one of the four drawn facings. */
export function directionOf(heading: number): number {
  const dx = Math.cos(heading);
  const dy = Math.sin(heading);
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 1 : 3;
  return dy > 0 ? 2 : 0;
}

export { getDef, Zone, AgentKind };

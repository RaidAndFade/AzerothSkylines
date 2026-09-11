/**
 * The scene renderer.
 *
 * Ground is painted first as batched diamonds, then everything that stands
 * on it is drawn front to back along isometric diagonals, so a cottage
 * correctly hides the hedge behind it and the wall hides the cottage.
 */
import { ELEVATION_STEP, HALF_HEIGHT, HALF_WIDTH } from './iso';
import { PALETTE, mix, withAlpha } from './palette';
import { Camera } from './camera';
import { DETAIL_ZOOM, TileRange, ViewRect, drawTerrain, strokeTile, strokeTileRect } from './terrainLayer';
import { getBuildingSprite } from './buildingSprites';
import { getAgentSprite, getRoadSprite, getTreeSprite, getWallSprite } from './propSprites';
import { AgentKind, RoadType, Service, Terrain, Zone, isWater } from '../sim/types';
import { CityState, PARCEL_SIZE, standingTreesOnTile, tileIndex } from '../sim/city';
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

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly camera = new Camera();
  private ctx: CanvasRenderingContext2D;
  private pixelRatio = 1;
  /** Rebuilt only on resize; creating it per frame was pure waste. */
  private sky: CanvasGradient | null = null;
  /** Frame time in milliseconds, smoothed, for the debug readout. */
  frameTime = 0;

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
   * Draw everything standing on the ground, in isometric depth order:
   * along successive diagonals, nearest last.
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
    const agentsByTile = drawDetail ? this.bucketAgents(city, range) : null;
    const width = city.width;
    const elevation = city.map.elevation;

    for (let sum = range.x0 + range.y0; sum <= range.x1 + range.y1; sum++) {
      const startX = Math.max(range.x0, sum - range.y1);
      const endX = Math.min(range.x1, sum - range.y0);
      for (let x = startX; x <= endX; x++) {
        const y = sum - x;
        const index = y * width + x;
        const step = elevation[index];
        const cx = (x - y) * HALF_WIDTH;
        const cy = (x + y) * HALF_HEIGHT - step * ELEVATION_STEP;

        // Inline culling, with headroom for tall sprites above the tile.
        if (cx + 90 < view.left || cx - 90 > view.right) continue;
        if (cy + 90 < view.top || cy - 200 > view.bottom) continue;

        // Streets.
        const road = city.roads[index] as RoadType;
        if (road !== RoadType.None) {
          const sprite = getRoadSprite(road, roadConnectionMask(city, x, y));
          ctx.drawImage(sprite.canvas, cx - sprite.originX, cy - sprite.originY);
        }

        // The curtain wall.
        const wallIndex = city.wallAt[index];
        if (wallIndex >= 0) {
          const segment = city.walls[wallIndex];
          const sprite = getWallSprite(segment.kind, segment.connections, segment.orientation);
          ctx.drawImage(sprite.canvas, cx - sprite.originX, cy - sprite.originY);
        }

        // Buildings draw from their anchor tile only.
        const buildingId = city.buildingAt[index];
        if (buildingId >= 0) {
          const building = city.buildings.get(buildingId);
          if (building && building.x === x && building.y === y) {
            const sprite = getBuildingSprite(building.defId, building.variant, building.facing, building.abandoned);
            ctx.drawImage(sprite.canvas, cx - sprite.originX, cy - sprite.originY);
            if (options.selectedBuilding === building.id) {
              this.outlineBuilding(city, building.x, building.y, building.width, building.height);
            }
            if (!building.connected && !building.abandoned && drawDetail) {
              this.drawWarningIcon(cx, cy - sprite.originY * 0.55, options.time);
            }
          }
        } else if (drawDetail && road === RoadType.None && wallIndex < 0) {
          // Woodland, but only where nothing has been built and the city has
          // not already cleared the ground to take it.
          for (const tree of standingTreesOnTile(city, x, y)) {
            const sprite = getTreeSprite(tree.variant);
            ctx.save();
            ctx.translate(cx + tree.ox * HALF_WIDTH, cy + tree.oy * HALF_HEIGHT);
            ctx.scale(tree.scale, tree.scale);
            ctx.drawImage(sprite.canvas, -sprite.originX, -sprite.originY);
            ctx.restore();
          }
        }

        // People and carts standing on this tile.
        if (agentsByTile) {
          const agents = agentsByTile.get(index);
          if (agents) {
            for (const agent of agents) {
              const worldX = (agent.x - agent.y) * HALF_WIDTH;
              const worldY = (agent.x + agent.y) * HALF_HEIGHT - step * ELEVATION_STEP;
              const direction = directionOf(agent.heading);
              const frame = Math.floor(options.time * 5 + agent.id) % 2;
              const sprite = getAgentSprite(agent.kind, agent.variant, direction, frame);
              ctx.drawImage(sprite.canvas, worldX - sprite.originX, worldY - sprite.originY);
            }
          }
        }
      }
    }
  }

  private bucketAgents(
    city: CityState,
    range: { x0: number; y0: number; x1: number; y1: number },
  ): Map<number, typeof city.agents> {
    const buckets = new Map<number, typeof city.agents>();
    for (const agent of city.agents) {
      const tx = Math.round(agent.x);
      const ty = Math.round(agent.y);
      if (tx < range.x0 || tx > range.x1 || ty < range.y0 || ty > range.y1) continue;
      const index = tileIndex(city, tx, ty);
      const list = buckets.get(index);
      if (list) list.push(agent);
      else buckets.set(index, [agent]);
    }
    return buckets;
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

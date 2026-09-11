/** Pan and zoom over the isometric world. */
import { clamp } from '../core/math';
import { HALF_HEIGHT, HALF_WIDTH, ELEVATION_STEP, tileToWorld, worldToTile } from './iso';

export const MIN_ZOOM = 0.28;
export const MAX_ZOOM = 2.4;

export class Camera {
  /** World-space point at the centre of the viewport. */
  x = 0;
  y = 0;
  zoom = 1;
  /** Viewport size in CSS pixels. */
  viewWidth = 1;
  viewHeight = 1;

  private boundsMinX = -Infinity;
  private boundsMaxX = Infinity;
  private boundsMinY = -Infinity;
  private boundsMaxY = Infinity;

  resize(width: number, height: number): void {
    this.viewWidth = Math.max(1, width);
    this.viewHeight = Math.max(1, height);
    this.clampToBounds();
  }

  /** Keep the camera roughly over the map, with a margin so edges are reachable. */
  setWorldBounds(mapWidth: number, mapHeight: number): void {
    const corners = [
      tileToWorld(0, 0),
      tileToWorld(mapWidth, 0),
      tileToWorld(0, mapHeight),
      tileToWorld(mapWidth, mapHeight),
    ];
    const margin = 8 * HALF_WIDTH;
    this.boundsMinX = Math.min(...corners.map((c) => c.x)) - margin;
    this.boundsMaxX = Math.max(...corners.map((c) => c.x)) + margin;
    this.boundsMinY = Math.min(...corners.map((c) => c.y)) - margin;
    this.boundsMaxY = Math.max(...corners.map((c) => c.y)) + margin;
  }

  centreOnTile(tileX: number, tileY: number, elevation = 0): void {
    const world = tileToWorld(tileX, tileY, elevation);
    this.x = world.x;
    this.y = world.y;
    this.clampToBounds();
  }

  panByScreen(dx: number, dy: number): void {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this.clampToBounds();
  }

  /** Zoom, keeping the world point under the given screen position fixed. */
  zoomAt(screenX: number, screenY: number, factor: number): void {
    const before = this.screenToWorld(screenX, screenY);
    this.zoom = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const after = this.screenToWorld(screenX, screenY);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clampToBounds();
  }

  private clampToBounds(): void {
    this.x = clamp(this.x, this.boundsMinX, this.boundsMaxX);
    this.y = clamp(this.y, this.boundsMinY, this.boundsMaxY);
  }

  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    return {
      x: (worldX - this.x) * this.zoom + this.viewWidth / 2,
      y: (worldY - this.y) * this.zoom + this.viewHeight / 2,
    };
  }

  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: (screenX - this.viewWidth / 2) / this.zoom + this.x,
      y: (screenY - this.viewHeight / 2) / this.zoom + this.y,
    };
  }

  /** Apply the camera transform to a context; callers must save/restore. */
  applyTransform(ctx: CanvasRenderingContext2D): void {
    ctx.translate(this.viewWidth / 2, this.viewHeight / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
  }

  /** World-space rectangle currently on screen. */
  visibleWorldRect(): { left: number; top: number; right: number; bottom: number } {
    const halfW = this.viewWidth / (2 * this.zoom);
    const halfH = this.viewHeight / (2 * this.zoom);
    return {
      left: this.x - halfW,
      right: this.x + halfW,
      top: this.y - halfH,
      bottom: this.y + halfH,
    };
  }

  /**
   * Tile-space bounding box of everything that could be on screen, with a
   * margin that covers tall buildings and high ground.
   */
  visibleTileRect(
    mapWidth: number,
    mapHeight: number,
    maxElevation = 7,
  ): { x0: number; y0: number; x1: number; y1: number } {
    const rect = this.visibleWorldRect();
    const margin = Math.ceil((maxElevation * ELEVATION_STEP + 140) / HALF_HEIGHT);
    const corners = [
      worldToTile(rect.left, rect.top),
      worldToTile(rect.right, rect.top),
      worldToTile(rect.left, rect.bottom),
      worldToTile(rect.right, rect.bottom),
    ];
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    return {
      x0: Math.max(0, Math.floor(Math.min(...xs)) - margin),
      y0: Math.max(0, Math.floor(Math.min(...ys)) - margin),
      x1: Math.min(mapWidth - 1, Math.ceil(Math.max(...xs)) + margin),
      y1: Math.min(mapHeight - 1, Math.ceil(Math.max(...ys)) + margin),
    };
  }

  /** Whether a world-space box intersects the view, for culling. */
  isVisible(left: number, top: number, right: number, bottom: number): boolean {
    const rect = this.visibleWorldRect();
    return !(right < rect.left || left > rect.right || bottom < rect.top || top > rect.bottom);
  }
}

export { HALF_WIDTH, HALF_HEIGHT };

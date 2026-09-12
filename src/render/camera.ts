/**
 * The camera.
 *
 * It orbits a point on the ground: drag to slide that point about, pinch or
 * scroll to come closer, and turn or tilt to look at the valley from
 * somewhere else. Because the ground is a real surface now, the camera
 * rides its height, so crossing a hill does not send the town off screen.
 */
import { clamp, lerp } from '../core/math';
import { Mat4, Vec3, lookAt, mat4, multiply, perspective, transformPoint } from './mat4';
import { WorldMap, WATER_HEIGHT, surfaceHeight } from '../sim/terrain';

/** Closest and furthest the eye may sit from its target, in tiles. */
export const MIN_DISTANCE = 9;
export const MAX_DISTANCE = 150;

/**
 * The distance the rest of the game calls "zoom 1": close enough to read a
 * street, far enough to see the district it is in.
 */
export const REFERENCE_DISTANCE = 34;

export const MIN_ZOOM = REFERENCE_DISTANCE / MAX_DISTANCE;
export const MAX_ZOOM = REFERENCE_DISTANCE / MIN_DISTANCE;

/** Never level with the ground, and never straight down onto it. */
const MIN_PITCH = 0.17;
const MAX_PITCH = 1.4;
export const FIELD_OF_VIEW = 0.86;

export interface Ray {
  origin: Vec3;
  direction: Vec3;
}

/** The camera's own axes: where it is looking, and which way is right and up. */
interface Basis {
  forward: Vec3;
  right: Vec3;
  up: Vec3;
}

export class Camera {
  /** The point on the ground the camera is looking at, in world units. */
  x = 0;
  z = 0;
  /** Height of that point, so the view rides the relief. */
  groundHeight = WATER_HEIGHT;
  /** Distance from the eye to the target. */
  distance = REFERENCE_DISTANCE;
  /** Rotation about the vertical axis, in radians. */
  yaw = Math.PI * 0.22;
  /** Angle above the ground, in radians. */
  pitch = 0.62;

  viewWidth = 1;
  viewHeight = 1;

  private map: WorldMap | null = null;
  private boundsMinX = -Infinity;
  private boundsMaxX = Infinity;
  private boundsMinZ = -Infinity;
  private boundsMaxZ = Infinity;

  readonly view: Mat4 = mat4();
  readonly projection: Mat4 = mat4();
  readonly viewProjection: Mat4 = mat4();
  readonly eye: Vec3 = { x: 0, y: 0, z: 0 };

  constructor() {
    this.update();
  }

  /** How close the camera is: larger is nearer, as the interface reads it. */
  get zoom(): number {
    return REFERENCE_DISTANCE / this.distance;
  }

  set zoom(value: number) {
    this.distance = clamp(REFERENCE_DISTANCE / Math.max(value, 1e-4), MIN_DISTANCE, MAX_DISTANCE);
  }

  resize(width: number, height: number): void {
    this.viewWidth = Math.max(1, width);
    this.viewHeight = Math.max(1, height);
  }

  /** Keep the target over the valley, with a margin so the edges are reachable. */
  setWorldBounds(mapWidth: number, mapHeight: number, map: WorldMap | null = null): void {
    const margin = 6;
    this.boundsMinX = -margin;
    this.boundsMaxX = mapWidth + margin;
    this.boundsMinZ = -margin;
    this.boundsMaxZ = mapHeight + margin;
    if (map) this.map = map;
    this.clampToBounds();
    this.groundHeight = this.sampleGround();
  }

  centreOnTile(tileX: number, tileY: number): void {
    this.x = tileX + 0.5;
    this.z = tileY + 0.5;
    this.clampToBounds();
    this.groundHeight = this.sampleGround();
  }

  /** The camera's axes, from its yaw and pitch. */
  basis(): Basis {
    const cosPitch = Math.cos(this.pitch);
    const forward: Vec3 = {
      x: Math.sin(this.yaw) * cosPitch,
      y: -Math.sin(this.pitch),
      z: Math.cos(this.yaw) * cosPitch,
    };
    // forward x up, which has no vertical component and so writes out short.
    const right: Vec3 = { x: -Math.cos(this.yaw), y: 0, z: Math.sin(this.yaw) };
    const up: Vec3 = {
      x: Math.sin(this.yaw) * Math.sin(this.pitch),
      y: cosPitch,
      z: Math.cos(this.yaw) * Math.sin(this.pitch),
    };
    return { forward, right, up };
  }

  /**
   * Slide the target across the ground so the country follows the finger.
   * The step is scaled by how far away the eye is, so a drag covers about
   * the same amount of ground whatever the zoom.
   */
  panByScreen(dx: number, dy: number): void {
    const scale = (this.distance * 2 * Math.tan(FIELD_OF_VIEW / 2)) / this.viewHeight;
    // Dragging up or down runs along the ground rather than along the view,
    // so a shallow angle covers more country per pixel — as it should.
    const vertical = scale / Math.max(Math.sin(this.pitch), 0.28);
    this.x += Math.cos(this.yaw) * dx * scale + Math.sin(this.yaw) * dy * vertical;
    this.z += -Math.sin(this.yaw) * dx * scale + Math.cos(this.yaw) * dy * vertical;
    this.clampToBounds();
    this.groundHeight = this.sampleGround();
  }

  /** Turn about the target, and tilt between a low view and a high one. */
  orbitByScreen(dx: number, dy: number): void {
    this.yaw -= dx * 0.006;
    this.pitch = clamp(this.pitch + dy * 0.005, MIN_PITCH, MAX_PITCH);
  }

  /**
   * Zoom, keeping the ground under the given screen position as close to
   * fixed as a perspective view allows.
   */
  zoomAt(screenX: number, screenY: number, factor: number): void {
    const before = this.groundPoint(screenX, screenY);
    this.distance = clamp(this.distance / factor, MIN_DISTANCE, MAX_DISTANCE);
    // Coming in close, tilt down toward the street; pulling back, look across
    // the valley. It is the shot you would take at each range.
    const closeness = 1 - (this.distance - MIN_DISTANCE) / (MAX_DISTANCE - MIN_DISTANCE);
    this.pitch = clamp(lerp(this.pitch, lerp(1.0, 0.46, closeness), 0.16), MIN_PITCH, MAX_PITCH);
    this.update();
    const after = this.groundPoint(screenX, screenY);
    if (before && after) {
      this.x += before.x - after.x;
      this.z += before.z - after.z;
      this.clampToBounds();
    }
    this.groundHeight = this.sampleGround();
    this.update();
  }

  private clampToBounds(): void {
    this.x = clamp(this.x, this.boundsMinX, this.boundsMaxX);
    this.z = clamp(this.z, this.boundsMinZ, this.boundsMaxZ);
  }

  private sampleGround(): number {
    if (!this.map) return this.groundHeight;
    return Math.max(WATER_HEIGHT, surfaceHeight(this.map, this.x, this.z));
  }

  /** Recompute the matrices. Called once a frame, before anything is drawn. */
  update(): void {
    const target: Vec3 = { x: this.x, y: this.groundHeight, z: this.z };
    const horizontal = Math.cos(this.pitch) * this.distance;
    this.eye.x = target.x - Math.sin(this.yaw) * horizontal;
    this.eye.y = target.y + Math.sin(this.pitch) * this.distance;
    this.eye.z = target.z - Math.cos(this.yaw) * horizontal;

    const aspect = this.viewWidth / this.viewHeight;
    perspective(this.projection, FIELD_OF_VIEW, aspect, 0.6, 900);
    lookAt(this.view, this.eye, target, { x: 0, y: 1, z: 0 });
    multiply(this.viewProjection, this.projection, this.view);
  }

  /** Where a world point lands on screen, in CSS pixels. */
  worldToScreen(
    worldX: number,
    worldY: number,
    worldZ: number,
  ): { x: number; y: number; behind: boolean } {
    const p = transformPoint(this.viewProjection, worldX, worldY, worldZ);
    const w = p.w === 0 ? 1e-6 : p.w;
    return {
      x: ((p.x / w) * 0.5 + 0.5) * this.viewWidth,
      y: (0.5 - (p.y / w) * 0.5) * this.viewHeight,
      behind: w <= 0,
    };
  }

  /** The ray from the eye through a point on the screen. */
  screenRay(screenX: number, screenY: number): Ray {
    const ndcX = (screenX / this.viewWidth) * 2 - 1;
    const ndcY = 1 - (screenY / this.viewHeight) * 2;
    const tanY = Math.tan(FIELD_OF_VIEW / 2);
    const tanX = tanY * (this.viewWidth / this.viewHeight);
    const { forward, right, up } = this.basis();

    const dx = forward.x + right.x * ndcX * tanX + up.x * ndcY * tanY;
    const dy = forward.y + right.y * ndcX * tanX + up.y * ndcY * tanY;
    const dz = forward.z + right.z * ndcX * tanX + up.z * ndcY * tanY;
    const length = Math.hypot(dx, dy, dz) || 1;
    return {
      origin: { x: this.eye.x, y: this.eye.y, z: this.eye.z },
      direction: { x: dx / length, y: dy / length, z: dz / length },
    };
  }

  /**
   * Where a screen point meets the ground.
   *
   * The ray is walked forward until it passes under the surface and the
   * crossing is then bisected. There is no closed form to reach for: the
   * ground is a spline, not a plane.
   */
  groundPoint(screenX: number, screenY: number): Vec3 | null {
    const ray = this.screenRay(screenX, screenY);
    const map = this.map;
    if (!map) {
      if (ray.direction.y >= -1e-5) return null;
      const t = (this.groundHeight - ray.origin.y) / ray.direction.y;
      return {
        x: ray.origin.x + ray.direction.x * t,
        y: this.groundHeight,
        z: ray.origin.z + ray.direction.z * t,
      };
    }
    return marchToGround(map, ray, this.distance * 6 + 240);
  }
}

/** Follow a ray until it meets the ground, or give up at `far`. */
export function marchToGround(map: WorldMap, ray: Ray, far: number): Vec3 | null {
  const step = Math.max(0.3, far * 0.004);
  let t = 0;
  let previous = ray.origin.y - surfaceHeight(map, ray.origin.x, ray.origin.z);
  while (t < far) {
    const next = Math.min(t + step, far);
    const x = ray.origin.x + ray.direction.x * next;
    const y = ray.origin.y + ray.direction.y * next;
    const z = ray.origin.z + ray.direction.z * next;
    const above = y - surfaceHeight(map, x, z);
    if (above <= 0 && previous > 0) {
      let low = t;
      let high = next;
      for (let i = 0; i < 22; i++) {
        const mid = (low + high) * 0.5;
        const mx = ray.origin.x + ray.direction.x * mid;
        const my = ray.origin.y + ray.direction.y * mid;
        const mz = ray.origin.z + ray.direction.z * mid;
        if (my - surfaceHeight(map, mx, mz) > 0) low = mid;
        else high = mid;
      }
      const hit = (low + high) * 0.5;
      return {
        x: ray.origin.x + ray.direction.x * hit,
        y: ray.origin.y + ray.direction.y * hit,
        z: ray.origin.z + ray.direction.z * hit,
      };
    }
    previous = above;
    t = next;
  }
  return null;
}

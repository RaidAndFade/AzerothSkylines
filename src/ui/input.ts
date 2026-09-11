/**
 * Pointer, touch and keyboard input.
 *
 * Designed for a phone first: one finger pans while inspecting and draws
 * while a build tool is held, two fingers always pinch-zoom and pan, and
 * every gesture cancels cleanly if a finger is lifted mid-way.
 */
import { Camera } from '../render/camera';

export interface TilePoint {
  x: number;
  y: number;
}

export interface InputHandlers {
  /** A quick press with no meaningful movement. */
  onTap(screenX: number, screenY: number): void;
  /** A drag began in drawing mode. */
  onDragStart(screenX: number, screenY: number): void;
  onDragMove(screenX: number, screenY: number): void;
  onDragEnd(): void;
  /** The drag was interrupted, e.g. by a second finger arriving. */
  onDragCancel(): void;
  /** The pointer moved without a button held (desktop hover). */
  onHover(screenX: number, screenY: number): void;
  onHoverEnd(): void;
  /** True while a build tool wants one-finger drags for drawing. */
  isDrawing(): boolean;
}

/** Movement beyond this many CSS pixels is a drag, not a tap. */
const TAP_SLOP = 10;
/** A press longer than this is never treated as a tap. */
const TAP_TIMEOUT_MS = 500;

interface ActivePointer {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  startTime: number;
  moved: boolean;
}

export class InputController {
  private readonly element: HTMLElement;
  private readonly camera: Camera;
  private readonly handlers: InputHandlers;
  private readonly pointers = new Map<number, ActivePointer>();

  /** Distance between two fingers when the pinch began. */
  private pinchDistance = 0;
  private pinchCentre = { x: 0, y: 0 };
  private dragging = false;
  private panning = false;

  constructor(element: HTMLElement, camera: Camera, handlers: InputHandlers) {
    this.element = element;
    this.camera = camera;
    this.handlers = handlers;

    element.addEventListener('pointerdown', this.onPointerDown, { passive: false });
    element.addEventListener('pointermove', this.onPointerMove, { passive: false });
    element.addEventListener('pointerup', this.onPointerUp, { passive: false });
    element.addEventListener('pointercancel', this.onPointerUp, { passive: false });
    element.addEventListener('pointerleave', this.onPointerLeave);
    element.addEventListener('wheel', this.onWheel, { passive: false });
    element.addEventListener('contextmenu', (event) => event.preventDefault());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  dispose(): void {
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.element.removeEventListener('pointermove', this.onPointerMove);
    this.element.removeEventListener('pointerup', this.onPointerUp);
    this.element.removeEventListener('pointercancel', this.onPointerUp);
    this.element.removeEventListener('pointerleave', this.onPointerLeave);
    this.element.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  /** Keys currently held, for the camera scroll in `update`. */
  private readonly keys = new Set<string>();

  /** Called each frame to apply keyboard panning. */
  update(dt: number): void {
    if (this.keys.size === 0) return;
    const speed = 620 * dt;
    let dx = 0;
    let dy = 0;
    if (this.keys.has('arrowleft') || this.keys.has('a')) dx += speed;
    if (this.keys.has('arrowright') || this.keys.has('d')) dx -= speed;
    if (this.keys.has('arrowup') || this.keys.has('w')) dy += speed;
    if (this.keys.has('arrowdown') || this.keys.has('s')) dy -= speed;
    if (dx !== 0 || dy !== 0) this.camera.panByScreen(dx, dy);
  }

  /** Keyboard shortcuts the host wires up (speed, tools, escape). */
  onShortcut: ((key: string) => void) | null = null;

  private localPoint(event: PointerEvent): { x: number; y: number } {
    const rect = this.element.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private onPointerDown = (event: PointerEvent): void => {
    event.preventDefault();
    this.element.setPointerCapture?.(event.pointerId);
    const point = this.localPoint(event);
    this.pointers.set(event.pointerId, {
      id: event.pointerId,
      x: point.x,
      y: point.y,
      startX: point.x,
      startY: point.y,
      startTime: performance.now(),
      moved: false,
    });

    if (this.pointers.size === 2) {
      // A second finger always takes over as a pinch, so abandon any draw.
      if (this.dragging) {
        this.dragging = false;
        this.handlers.onDragCancel();
      }
      this.panning = false;
      this.beginPinch();
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) {
      // No button held: this is a hover on a desktop pointer.
      if (event.pointerType === 'mouse') {
        const point = this.localPoint(event);
        this.handlers.onHover(point.x, point.y);
      }
      return;
    }

    event.preventDefault();
    const point = this.localPoint(event);
    const previousX = pointer.x;
    const previousY = pointer.y;
    pointer.x = point.x;
    pointer.y = point.y;
    if (Math.hypot(point.x - pointer.startX, point.y - pointer.startY) > TAP_SLOP) pointer.moved = true;

    if (this.pointers.size >= 2) {
      this.updatePinch();
      return;
    }

    if (!pointer.moved) return;

    if (this.handlers.isDrawing()) {
      if (!this.dragging) {
        this.dragging = true;
        this.handlers.onDragStart(pointer.startX, pointer.startY);
      }
      this.handlers.onDragMove(point.x, point.y);
    } else {
      this.panning = true;
      this.camera.panByScreen(point.x - previousX, point.y - previousY);
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) return;
    this.pointers.delete(event.pointerId);
    this.element.releasePointerCapture?.(event.pointerId);

    if (this.pointers.size === 1) {
      // Coming out of a pinch: re-seat the remaining finger so the map does
      // not jump as it takes over panning.
      const remaining = [...this.pointers.values()][0];
      remaining.startX = remaining.x;
      remaining.startY = remaining.y;
      remaining.moved = false;
      this.pinchDistance = 0;
      return;
    }

    if (this.pointers.size === 0) {
      if (this.dragging) {
        this.dragging = false;
        this.handlers.onDragEnd();
      } else if (!pointer.moved && !this.panning && performance.now() - pointer.startTime < TAP_TIMEOUT_MS) {
        this.handlers.onTap(pointer.x, pointer.y);
      }
      this.panning = false;
      this.pinchDistance = 0;
    }
  };

  private onPointerLeave = (): void => {
    this.handlers.onHoverEnd();
  };

  private beginPinch(): void {
    const [a, b] = [...this.pointers.values()];
    this.pinchDistance = Math.hypot(b.x - a.x, b.y - a.y);
    this.pinchCentre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  private updatePinch(): void {
    const points = [...this.pointers.values()];
    if (points.length < 2) return;
    const [a, b] = points;
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

    if (this.pinchDistance > 0 && distance > 0) {
      this.camera.zoomAt(centre.x, centre.y, distance / this.pinchDistance);
    }
    // Two-finger drag pans as well as zooms.
    this.camera.panByScreen(centre.x - this.pinchCentre.x, centre.y - this.pinchCentre.y);

    this.pinchDistance = distance;
    this.pinchCentre = centre;
  }

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const rect = this.element.getBoundingClientRect();
    const factor = Math.exp(-event.deltaY * 0.0016);
    this.camera.zoomAt(event.clientX - rect.left, event.clientY - rect.top, factor);
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    const key = event.key.toLowerCase();
    this.keys.add(key);
    if (this.onShortcut) this.onShortcut(key);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.key.toLowerCase());
  };
}

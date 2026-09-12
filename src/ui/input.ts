/**
 * Pointer, touch and keyboard input.
 *
 * Designed for a phone first: one finger pans while inspecting and draws
 * while a build tool is held, two fingers always pinch-zoom and pan, and
 * every gesture cancels cleanly if a finger is lifted mid-way.
 *
 * A mouse and a trackpad get the rest of what a city builder expects on a
 * desktop: the right or middle button always pans whatever tool is held, a
 * right click with no movement cancels, a plain two-finger scroll pans while
 * a wheel notch or a pinch zooms, and the zoom eases toward its target
 * rather than jumping a notch at a time.
 */
import { Camera, MAX_ZOOM, MIN_ZOOM } from '../render/camera';
import { clamp } from '../core/math';

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
  /** A right click, or Escape: back out of whatever is held or open. */
  onCancel(): void;
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
/** How far a wheel notch zooms, before smoothing. */
const ZOOM_PER_NOTCH = 0.12;
/** Notches a single wheel event may be worth, so momentum cannot bottom out the zoom. */
const MAX_NOTCHES_PER_EVENT = 4;
/** How quickly the camera closes on its zoom target, per second. */
const ZOOM_SMOOTHING = 18;
/** Zoom per second while a zoom key is held. */
const KEY_ZOOM_RATE = 1.1;
/** How close to the edge of the view starts an edge scroll, in CSS pixels. */
const EDGE_MARGIN = 28;
/** Edge scroll speed, in CSS pixels per second. */
const EDGE_SPEED = 700;
/** Keyboard pan speed, in CSS pixels per second. */
const KEY_PAN_SPEED = 620;

/** Buttons that pan the map no matter which tool is held. */
const MIDDLE_BUTTON = 1;
const RIGHT_BUTTON = 2;

interface ActivePointer {
  id: number;
  /** `PointerEvent.button` as the press began. */
  button: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  startTime: number;
  moved: boolean;
}

/** The parts of a wheel event that decide what it means. */
export interface WheelIntent {
  ctrlKey: boolean;
  deltaMode: number;
  deltaX: number;
  deltaY: number;
}

/**
 * Whether a wheel event means "zoom" rather than "pan".
 *
 * There is no way to ask the browser what kind of device sent a wheel event,
 * so this reads the shape of the deltas. A trackpad pinch arrives as
 * ctrl+wheel; a classic mouse wheel reports lines or pages rather than
 * pixels, or a large round pixel step on one axis only. Anything else is a
 * two-finger scroll, which every other map on the desktop treats as a pan.
 */
export function wheelZooms(event: WheelIntent): boolean {
  if (event.ctrlKey) return true;
  if (event.deltaMode !== 0) return true;
  if (event.deltaX !== 0) return false;
  return Number.isInteger(event.deltaY) && Math.abs(event.deltaY) >= 50;
}

/** Wheel deltas as a signed number of notches, clamped so momentum cannot run away. */
export function wheelNotches(event: WheelIntent): number {
  const raw = event.deltaMode === 0 ? event.deltaY / 100 : event.deltaY;
  return clamp(raw, -MAX_NOTCHES_PER_EVENT, MAX_NOTCHES_PER_EVENT);
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

  /** Scroll the map when the mouse rests against the edge of the view. */
  edgeScroll = false;

  /** Where the mouse is, for edge scrolling. Negative while it is elsewhere. */
  private mouseX = -1;
  private mouseY = -1;

  /** Zoom the camera is easing toward; zero when it has arrived. */
  private zoomTarget = 0;
  private zoomAnchorX = 0;
  private zoomAnchorY = 0;

  /** Last cursor written to the element, so the style is only touched on a change. */
  private cursor = '';

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
    element.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  dispose(): void {
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.element.removeEventListener('pointermove', this.onPointerMove);
    this.element.removeEventListener('pointerup', this.onPointerUp);
    this.element.removeEventListener('pointercancel', this.onPointerUp);
    this.element.removeEventListener('pointerleave', this.onPointerLeave);
    this.element.removeEventListener('wheel', this.onWheel);
    this.element.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  /** Keys currently held, for the camera scroll in `update`. */
  private readonly keys = new Set<string>();

  /** Called each frame to apply held keys, edge scrolling and zoom easing. */
  update(dt: number): void {
    this.applyKeyPan(dt);
    this.applyKeyZoom(dt);
    this.applyEdgeScroll(dt);
    this.applyZoom(dt);
    this.updateCursor();
  }

  /** Keyboard shortcuts the host wires up (speed, tools, escape). */
  onShortcut: ((key: string) => void) | null = null;

  private applyKeyPan(dt: number): void {
    if (this.keys.size === 0) return;
    const speed = KEY_PAN_SPEED * dt;
    let dx = 0;
    let dy = 0;
    if (this.keys.has('arrowleft') || this.keys.has('a')) dx += speed;
    if (this.keys.has('arrowright') || this.keys.has('d')) dx -= speed;
    if (this.keys.has('arrowup') || this.keys.has('w')) dy += speed;
    if (this.keys.has('arrowdown') || this.keys.has('s')) dy -= speed;
    if (dx !== 0 || dy !== 0) this.camera.panByScreen(dx, dy);
  }

  private applyKeyZoom(dt: number): void {
    if (this.keys.size === 0) return;
    const inward = this.keys.has('e') || this.keys.has(']') ? 1 : 0;
    const outward = this.keys.has('q') || this.keys.has('[') ? 1 : 0;
    if (inward === outward) return;
    // Keys zoom on the middle of the view, which is where the eye already is.
    this.camera.zoomAt(
      this.camera.viewWidth / 2,
      this.camera.viewHeight / 2,
      Math.exp((inward - outward) * KEY_ZOOM_RATE * dt),
    );
    this.zoomTarget = 0;
  }

  private applyEdgeScroll(dt: number): void {
    if (!this.edgeScroll || this.mouseX < 0 || this.pointers.size > 0) return;
    const width = this.camera.viewWidth;
    const height = this.camera.viewHeight;
    let dx = 0;
    let dy = 0;
    if (this.mouseX < EDGE_MARGIN) dx = 1;
    else if (this.mouseX > width - EDGE_MARGIN) dx = -1;
    if (this.mouseY < EDGE_MARGIN) dy = 1;
    else if (this.mouseY > height - EDGE_MARGIN) dy = -1;
    if (dx !== 0 || dy !== 0) this.camera.panByScreen(dx * EDGE_SPEED * dt, dy * EDGE_SPEED * dt);
  }

  /**
   * Ease the camera toward the zoom a wheel or pinch asked for. A notch is a
   * tenth of the range, which lands hard if it is applied in one frame.
   */
  private applyZoom(dt: number): void {
    if (this.zoomTarget <= 0) return;
    const current = this.camera.zoom;
    if (dt <= 0) return;
    if (Math.abs(this.zoomTarget - current) < 0.0005) {
      this.camera.zoomAt(this.zoomAnchorX, this.zoomAnchorY, this.zoomTarget / current);
      this.zoomTarget = 0;
      return;
    }
    const t = 1 - Math.exp(-ZOOM_SMOOTHING * dt);
    const next = current + (this.zoomTarget - current) * t;
    this.camera.zoomAt(this.zoomAnchorX, this.zoomAnchorY, next / current);
  }

  private updateCursor(): void {
    const next = this.panning ? 'grabbing' : this.handlers.isDrawing() ? 'crosshair' : 'grab';
    if (next === this.cursor) return;
    this.cursor = next;
    this.element.style.cursor = next;
  }

  private localPoint(event: PointerEvent): { x: number; y: number } {
    const rect = this.element.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /** A pointer that only ever pans, whatever tool is held. */
  private static pansOnly(pointer: ActivePointer): boolean {
    return pointer.button === MIDDLE_BUTTON || pointer.button === RIGHT_BUTTON;
  }

  private onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  private onPointerDown = (event: PointerEvent): void => {
    event.preventDefault();
    this.element.setPointerCapture?.(event.pointerId);
    const point = this.localPoint(event);
    this.pointers.set(event.pointerId, {
      id: event.pointerId,
      button: event.button,
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
    if (event.pointerType === 'mouse') {
      const point = this.localPoint(event);
      this.mouseX = point.x;
      this.mouseY = point.y;
    }

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

    if (this.handlers.isDrawing() && !InputController.pansOnly(pointer)) {
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
      } else if (pointer.button === RIGHT_BUTTON) {
        // A right click that went nowhere backs out; a right drag panned.
        if (!pointer.moved && !this.panning) this.handlers.onCancel();
      } else if (
        pointer.button !== MIDDLE_BUTTON &&
        !pointer.moved &&
        !this.panning &&
        performance.now() - pointer.startTime < TAP_TIMEOUT_MS
      ) {
        this.handlers.onTap(pointer.x, pointer.y);
      }
      this.panning = false;
      this.pinchDistance = 0;
    }
  };

  private onPointerLeave = (): void => {
    this.mouseX = -1;
    this.mouseY = -1;
    this.handlers.onHoverEnd();
  };

  private beginPinch(): void {
    const [a, b] = [...this.pointers.values()];
    this.pinchDistance = Math.hypot(b.x - a.x, b.y - a.y);
    this.pinchCentre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // A pinch takes the camera over from any wheel zoom still easing in.
    this.zoomTarget = 0;
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
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (!wheelZooms(event)) {
      // A trackpad scroll moves the map under the fingers, as a page would.
      this.camera.panByScreen(-event.deltaX, -event.deltaY);
      return;
    }

    // Stack notches onto whatever the camera is already easing toward, so a
    // quick spin of the wheel covers as much ground as a slow one.
    const base = this.zoomTarget > 0 ? this.zoomTarget : this.camera.zoom;
    this.zoomTarget = clamp(base * Math.exp(-wheelNotches(event) * ZOOM_PER_NOTCH), MIN_ZOOM, MAX_ZOOM);
    this.zoomAnchorX = x;
    this.zoomAnchorY = y;
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    const key = event.key.toLowerCase();

    // Tab cycles panels, but only when nothing in the HUD has focus: a
    // keyboard user tabbing through the toolbar still gets their focus ring.
    if (key === 'tab') {
      const active = typeof document === 'undefined' ? null : document.activeElement;
      if (active && active !== document.body && active !== this.element) return;
      event.preventDefault();
    }

    this.keys.add(key);
    // Auto-repeat pans and zooms through the held-key set; a shortcut should
    // only fire once per press, or holding Tab would race through the panels.
    if (!event.repeat && this.onShortcut) this.onShortcut(key);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.key.toLowerCase());
  };

  /** Losing the window loses the keyup, so a held key would pan forever. */
  private onBlur = (): void => {
    this.keys.clear();
  };
}

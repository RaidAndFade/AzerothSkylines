/**
 * Azeroth Skylines — entry point.
 *
 * Wires the simulation, the renderer and the interface together, and runs
 * the frame loop.
 */
import './ui/styles.css';

import {
  CityState,
  PARCEL_SIZE,
  buildingAtTile,
  buildingCenter,
  createCity,
  parcelForTile,
  tileIndex,
} from './sim/city';
import { Simulation } from './sim/simulation';
import { createTrafficQueue } from './sim/agents';
import { buyParcel } from './sim/build';
import { RoadType, Zone } from './sim/types';
import { SAVE_KEY, hasSave, loadFromStorage, saveToStorage } from './sim/save';
import { Renderer, Overlay, BuildPreview } from './render/renderer';
import { Hud } from './ui/hud';
import { InputController } from './ui/input';
import { ToolState, applyTool, defaultTool, quoteTool, tilesForDrag, toolDraws, toolHint } from './ui/tools';
import { createTitleScreen, randomValleyName } from './ui/title';
import { el } from './ui/dom';

/** How often the city is written to local storage, in game days. */
const AUTOSAVE_INTERVAL_DAYS = 90;

class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: Renderer;
  private readonly hud: Hud;
  private readonly input: InputController;

  private city: CityState;
  private simulation: Simulation;
  private tool: ToolState = defaultTool();
  private overlay: Overlay = 'none';
  private speed = 1;

  private hoverTile: { x: number; y: number } | null = null;
  private dragStart: { x: number; y: number } | null = null;
  private preview: BuildPreview | null = null;
  private selectedBuildingId: number | null = null;
  private highlightParcel: { px: number; py: number } | null = null;

  private lastFrame = 0;
  private elapsed = 0;
  private lastAutosaveDay = 0;

  constructor(root: HTMLElement, city: CityState) {
    this.city = city;
    this.simulation = new Simulation(city, createTrafficQueue());

    this.canvas = el('canvas', { id: 'view' }) as HTMLCanvasElement;
    root.appendChild(this.canvas);

    this.renderer = new Renderer(this.canvas);
    this.renderer.camera.setWorldBounds(city.width, city.height, city.map);
    this.frameDistrict(city);

    this.hud = new Hud(root, this.tool, {
      onToolChange: (next) => this.setTool(next),
      onSpeedChange: (speed) => this.setSpeed(speed),
      onOverlayChange: (overlay) => {
        this.overlay = overlay;
      },
      onTaxChange: (zone, rate) => this.setTax(zone, rate),
      onBuyParcel: (px, py) => this.buyLand(px, py),
      onNewCity: () => this.newCity(),
      onSave: () => this.save(true),
      onLoad: () => this.load(),
      onToggleZones: () => {
        /* the HUD holds the flag; nothing else to do */
      },
      onFocusBuilding: (building) => {
        const centre = buildingCenter(building);
        this.renderer.camera.centreOnTile(centre.x, centre.y);
      },
    });
    this.hud.attachCity(city);
    this.hud.setSpeed(this.speed);
    this.hud.setTool(this.tool);

    this.input = new InputController(this.canvas, this.renderer.camera, {
      onTap: (x, y) => this.handleTap(x, y),
      onDragStart: (x, y) => this.handleDragStart(x, y),
      onDragMove: (x, y) => this.handleDragMove(x, y),
      onDragEnd: () => this.handleDragEnd(),
      onDragCancel: () => this.cancelDrag(),
      onHover: (x, y) => this.handleHover(x, y),
      onHoverEnd: () => {
        this.hoverTile = null;
      },
      isDrawing: () => toolDraws(this.tool),
    });
    this.input.onShortcut = (key) => this.handleShortcut(key);

    window.addEventListener('resize', this.handleResize);
    window.addEventListener('orientationchange', this.handleResize);
    document.addEventListener('visibilitychange', this.handleVisibility);
    this.handleResize();

    // A new city opens on the guide; a loaded one carries straight on.
    if (city.clock.totalDays <= 1 && city.buildings.size === 0) {
      this.hud.togglePanel('guide', true);
    } else {
      this.hud.showHint('Lay a street off the king’s road, then zone beside it.');
    }
    installDebugHandle(this);
    requestAnimationFrame(this.frame);
  }

  /** Open looking across the founding district, from the south-east. */
  private frameDistrict(city: CityState): void {
    const span = PARCEL_SIZE * city.map.districtParcels;
    const centreX = city.map.foundingDistrict.x * PARCEL_SIZE + span / 2;
    const centreY = city.map.foundingDistrict.y * PARCEL_SIZE + span / 2;
    const camera = this.renderer.camera;
    camera.distance = span * 2.1;
    camera.pitch = 0.62;
    camera.yaw = Math.PI * 0.22;
    camera.centreOnTile(centreX, centreY);
    camera.update();
  }

  /** Live city state, for the console handle and automated tests. */
  get state(): CityState {
    return this.city;
  }

  get view(): Renderer {
    return this.renderer;
  }

  /** Where a tile currently sits on screen, in CSS pixels. */
  screenForTile(tileX: number, tileY: number): { x: number; y: number } {
    const point = this.renderer.screenForTile(this.city, tileX, tileY);
    return { x: point.x, y: point.y };
  }

  // --- frame loop -----------------------------------------------------------

  private frame = (now: number): void => {
    const dt = this.lastFrame === 0 ? 0 : Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.elapsed += dt;

    this.input.update(dt);
    this.simulation.update(dt);
    this.hud.update(this.city);

    if (this.city.clock.totalDays - this.lastAutosaveDay >= AUTOSAVE_INTERVAL_DAYS) {
      this.lastAutosaveDay = this.city.clock.totalDays;
      this.save(false);
    }

    this.renderer.render(this.city, {
      time: this.elapsed,
      overlay: this.overlay,
      showZones: this.hud.zonesVisible,
      hoverTile: this.hoverTile,
      preview: this.preview,
      selectedBuilding: this.selectedBuildingId,
      highlightParcel: this.highlightParcel,
    });

    requestAnimationFrame(this.frame);
  };

  private handleResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    // Cap the backing store on very dense displays: the scene is shaded per
    // pixel, and beyond two device pixels per CSS one nobody can tell.
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.resize(width, height, ratio);
  };

  private handleVisibility = (): void => {
    // Coming back from a background tab should not fast-forward a year.
    if (!document.hidden) this.lastFrame = 0;
  };

  // --- input ----------------------------------------------------------------

  private setTool(next: Partial<ToolState> & { kind: ToolState['kind'] }): void {
    this.tool = { ...this.tool, ...next };
    this.preview = null;
    this.dragStart = null;
    if (this.tool.kind !== 'land') this.highlightParcel = null;
    if (this.tool.kind !== 'inspect') this.selectedBuildingId = null;
  }

  private setSpeed(speed: number): void {
    this.speed = speed;
    this.simulation.speed = speed === 0 ? 0 : speed === 1 ? 1 : speed === 2 ? 3 : 8;
    this.hud.setSpeed(speed);
  }

  private setTax(zone: Zone, rate: number): void {
    if (zone === Zone.Residential) this.city.budget.taxRateResidential = rate;
    else if (zone === Zone.Commercial) this.city.budget.taxRateCommercial = rate;
    else if (zone === Zone.Industrial) this.city.budget.taxRateIndustrial = rate;
  }

  private handleHover(screenX: number, screenY: number): void {
    const tile = this.renderer.pickTile(this.city, screenX, screenY);
    this.hoverTile = tile;
    if (!tile) {
      this.preview = null;
      return;
    }
    if (this.tool.kind === 'build' || this.tool.kind === 'land') {
      this.preview = quoteTool(this.city, this.tool, [tile]).preview;
    } else if (!this.dragStart) {
      this.preview = null;
    }
  }

  private handleTap(screenX: number, screenY: number): void {
    const tile = this.renderer.pickTile(this.city, screenX, screenY);
    if (!tile) return;

    switch (this.tool.kind) {
      case 'inspect': {
        const building = buildingAtTile(this.city, tile.x, tile.y);
        this.selectedBuildingId = building ? building.id : null;
        this.hud.selectBuilding(building);
        if (!building) this.hud.showToast(this.describeTile(tile.x, tile.y), 'info');
        break;
      }
      case 'land': {
        const parcel = parcelForTile(this.city, tile.x, tile.y);
        if (!parcel) break;
        this.highlightParcel = { px: parcel.px, py: parcel.py };
        this.hud.selectParcel(parcel.px, parcel.py);
        break;
      }
      default: {
        const result = applyTool(this.city, this.tool, [tile]);
        if (result.message) this.hud.showToast(result.message, result.tone);
        break;
      }
    }
  }

  private handleDragStart(screenX: number, screenY: number): void {
    this.dragStart = this.renderer.pickTile(this.city, screenX, screenY);
  }

  private handleDragMove(screenX: number, screenY: number): void {
    if (!this.dragStart) return;
    const end = this.renderer.pickTile(this.city, screenX, screenY);
    if (!end) return;
    this.hoverTile = end;
    const tiles = tilesForDrag(this.tool, this.dragStart, end);
    this.preview = quoteTool(this.city, this.tool, tiles).preview;
  }

  private handleDragEnd(): void {
    if (!this.dragStart || !this.hoverTile) {
      this.cancelDrag();
      return;
    }
    const tiles = tilesForDrag(this.tool, this.dragStart, this.hoverTile);
    const result = applyTool(this.city, this.tool, tiles);
    if (result.message) this.hud.showToast(result.message, result.tone);
    this.cancelDrag();
  }

  private cancelDrag(): void {
    this.dragStart = null;
    this.preview = null;
  }

  private handleShortcut(key: string): void {
    switch (key) {
      case 'escape':
        this.setTool({ kind: 'inspect' });
        this.hud.setTool(this.tool);
        this.hud.closePanel();
        break;
      case '1':
      case '2':
      case '3':
      case '4':
        this.setSpeed(Number(key) - 1);
        break;
      case 'r':
        this.setTool({ kind: 'road', roadType: RoadType.Cobble });
        this.hud.setTool(this.tool);
        this.hud.showHint(toolHint(this.tool));
        break;
      case 'z':
        this.setTool({ kind: 'zone', zone: Zone.Residential });
        this.hud.setTool(this.tool);
        this.hud.showHint(toolHint(this.tool));
        break;
      case 'x':
        this.setTool({ kind: 'demolish' });
        this.hud.setTool(this.tool);
        this.hud.showHint(toolHint(this.tool));
        break;
      case 'q':
        this.renderer.camera.orbitByScreen(-110, 0);
        break;
      case 'e':
        this.renderer.camera.orbitByScreen(110, 0);
        break;
      default:
        break;
    }
  }

  // --- actions --------------------------------------------------------------

  private buyLand(px: number, py: number): void {
    const result = buyParcel(this.city, px, py);
    if (!result.ok) {
      this.hud.showToast(result.reason ?? 'The lot cannot be bought', 'bad');
      return;
    }
    this.hud.showToast(`Lot annexed for ${Math.round(result.total)}g — the walls now enclose it`, 'good');
    this.highlightParcel = null;
    // The quote outline belongs to a lot that is now simply part of the city.
    this.preview = null;
    this.hud.closePanel();
  }

  private describeTile(x: number, y: number): string {
    const index = tileIndex(this.city, x, y);
    const owned = parcelForTile(this.city, x, y)?.owned ?? false;
    const zone = this.city.zones[index] as Zone;
    const road = this.city.roads[index] as RoadType;
    if (road !== RoadType.None) return 'A street.';
    if (this.city.wallAt[index] >= 0) return 'The city wall.';
    if (zone !== Zone.None) return 'Zoned, and waiting for someone to build on it.';
    if (!owned) return 'Land beyond the walls. Buy the lot to build here.';
    return 'Open ground within your holdings.';
  }

  private save(announce: boolean): void {
    const ok = saveToStorage(this.city, window.localStorage, SAVE_KEY);
    if (announce) this.hud.showToast(ok ? 'City saved to this device' : 'Could not save — storage is full', ok ? 'good' : 'bad');
  }

  private load(): void {
    const loaded = loadFromStorage(window.localStorage, SAVE_KEY);
    if (!loaded) {
      this.hud.showToast('No saved city on this device', 'bad');
      return;
    }
    this.replaceCity(loaded);
    this.hud.showToast('City loaded', 'good');
    this.hud.closePanel();
  }

  private newCity(): void {
    this.replaceCity(createCity({ seed: randomValleyName() }));
    this.hud.showToast('A new valley awaits', 'good');
    this.hud.togglePanel('guide', true);
  }

  private replaceCity(city: CityState): void {
    this.city = city;
    this.simulation = new Simulation(city, createTrafficQueue());
    this.simulation.speed = this.speed === 0 ? 0 : this.speed === 1 ? 1 : this.speed === 2 ? 3 : 8;
    this.hud.attachCity(city);
    this.selectedBuildingId = null;
    this.highlightParcel = null;
    this.preview = null;
    this.lastAutosaveDay = city.clock.totalDays;
    this.renderer.camera.setWorldBounds(city.width, city.height, city.map);
    this.frameDistrict(city);
  }
}

/**
 * Expose a small read-mostly handle on `window` for debugging from the
 * browser console and for automated interface tests. Nothing in the game
 * depends on it.
 */
function installDebugHandle(game: Game): void {
  const handle = {
    get city(): CityState {
      return game.state;
    },
    get camera() {
      return game.view.camera;
    },
    screenForTile: (x: number, y: number) => game.screenForTile(x, y),
    /** What the renderer is holding and drawing, for frame-pacing checks. */
    renderStats: () => game.view.stats(),
    version: '1.0.0',
  };
  (window as unknown as Record<string, unknown>).azerothSkylines = handle;
}

// --- bootstrap --------------------------------------------------------------

function boot(): void {
  const root = document.getElementById('app');
  if (!root) throw new Error('Missing #app');

  const start = (city: CityState, title: HTMLElement): void => {
    title.classList.add('hidden');
    window.setTimeout(() => title.remove(), 600);
    // Give the browser a frame to paint the fade before the first heavy tick.
    requestAnimationFrame(() => {
      new Game(root, city);
    });
  };

  const title = createTitleScreen({
    hasSave: hasSave(window.localStorage, SAVE_KEY),
    onStart: (seed) => start(createCity({ seed }), title),
    onContinue: () => {
      const loaded = loadFromStorage(window.localStorage, SAVE_KEY);
      start(loaded ?? createCity({ seed: randomValleyName() }), title);
    },
  });
  root.appendChild(title);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

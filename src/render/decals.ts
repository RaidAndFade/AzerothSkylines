/**
 * Everything the interface paints on the ground.
 *
 * Zoning, the service overlays, the lot grid, the outline round a selected
 * building and whatever the player is currently pointing at all end up in
 * one small map-space texture, which the ground shader samples in tile
 * coordinates. That is why they drape exactly over the relief: they are not
 * geometry laid on top of the hill, they are part of the hill's colour.
 */
import { RoadType, Service, Terrain, Zone, isWater } from '../sim/types';
import { CityState, PARCEL_SIZE, tileIndex } from '../sim/city';
import { PALETTE, hexToRgb } from './palette';
import { clamp01 } from '../core/math';

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

export interface DecalState {
  overlay: Overlay;
  showZones: boolean;
  hoverTile: { x: number; y: number } | null;
  preview: BuildPreview | null;
  selectedFootprint: { x: number; y: number; width: number; height: number } | null;
  highlightParcel: { px: number; py: number } | null;
}

/** Pixels per tile. Two is enough for a half-tile border to read. */
export const DECAL_SCALE = 2;

const OVERLAY_RAMP: Record<Overlay, { low: string; high: string }> = {
  none: { low: PALETTE.grass, high: PALETTE.grass },
  land: { low: PALETTE.gold, high: PALETTE.gold },
  water: { low: PALETTE.waterShallow, high: PALETTE.water },
  sewage: { low: '#8A8A52', high: '#55582A' },
  safety: { low: PALETTE.woadLight, high: PALETTE.woad },
  faith: { low: PALETTE.parchment, high: PALETTE.gold },
  leisure: { low: PALETTE.meadowLight, high: PALETTE.verdigris },
  commerce: { low: PALETTE.corn, high: '#A8641E' },
  landValue: { low: '#B6C68A', high: '#2E6B46' },
  pollution: { low: '#B49A7E', high: '#5E3326' },
};

const ZONE_COLOURS: Record<Zone, string | null> = {
  [Zone.None]: null,
  [Zone.Residential]: PALETTE.zoneResidential,
  [Zone.Commercial]: PALETTE.zoneCommercial,
  [Zone.Industrial]: PALETTE.zoneIndustrial,
};

/**
 * The decal buffer for a city, rebuilt only when something it shows has
 * changed — which for the hover tile is every time the pointer moves, and
 * for zoning is whenever a district is painted.
 */
export class DecalMap {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
  /** Raised whenever the contents change, so the renderer knows to upload. */
  revision = 0;
  private signature = '';

  constructor(city: CityState) {
    this.width = city.width * DECAL_SCALE;
    this.height = city.height * DECAL_SCALE;
    this.pixels = new Uint8Array(this.width * this.height * 4);
  }

  /** Repaint if anything has changed. Returns true when it did. */
  update(city: CityState, state: DecalState, zoneRevision: number): boolean {
    const signature = describe(state, zoneRevision);
    if (signature === this.signature) return false;
    this.signature = signature;
    this.paint(city, state);
    this.revision++;
    return true;
  }

  private paint(city: CityState, state: DecalState): void {
    this.pixels.fill(0);

    if (state.showZones) this.paintZones(city);
    if (state.overlay !== 'none' && state.overlay !== 'land') this.paintOverlay(city, state.overlay);
    if (state.overlay === 'land') this.paintParcelGrid(city);
    if (state.highlightParcel) {
      const { px, py } = state.highlightParcel;
      this.paintRect(
        px * PARCEL_SIZE,
        py * PARCEL_SIZE,
        PARCEL_SIZE,
        PARCEL_SIZE,
        PALETTE.gold,
        0.2,
        0.78,
      );
    }
    if (state.selectedFootprint) {
      const f = state.selectedFootprint;
      this.paintRect(f.x, f.y, f.width, f.height, PALETTE.gold, 0, 0.92);
    }
    if (state.preview) {
      for (const tile of state.preview.tiles) {
        this.paintTile(tile.x, tile.y, tile.ok ? PALETTE.verdigris : PALETTE.madder, 0.6);
      }
      if (state.preview.rect) {
        const rect = state.preview.rect;
        this.paintRect(
          rect.x,
          rect.y,
          rect.width,
          rect.height,
          rect.ok ? PALETTE.verdigris : PALETTE.madder,
          0.2,
          0.9,
        );
      }
    } else if (state.hoverTile) {
      this.paintRect(state.hoverTile.x, state.hoverTile.y, 1, 1, PALETTE.parchment, 0, 0.7);
    }
  }

  private paintZones(city: CityState): void {
    for (let y = 0; y < city.height; y++) {
      for (let x = 0; x < city.width; x++) {
        const index = tileIndex(city, x, y);
        const zone = city.zones[index] as Zone;
        const hex = ZONE_COLOURS[zone];
        if (!hex) continue;
        // A street is a street, whatever it was zoned; leave it alone.
        if (city.roads[index] !== RoadType.None) continue;
        // Where a building already stands the paint has done its job. Kept
        // light either way: a wash over the turf, not a sheet of colour —
        // painted any heavier, an empty commercial plot reads as a pond.
        const alpha = city.buildingAt[index] >= 0 ? 0.09 : 0.2;
        this.paintTile(x, y, hex, alpha);
      }
    }
  }

  private paintOverlay(city: CityState, overlay: Overlay): void {
    const field = overlayField(city, overlay);
    if (!field) return;
    const ramp = OVERLAY_RAMP[overlay];
    const low = hexToRgb(ramp.low);
    const high = hexToRgb(ramp.high);
    for (let y = 0; y < city.height; y++) {
      for (let x = 0; x < city.width; x++) {
        const index = tileIndex(city, x, y);
        if (isWater(city.map.terrain[index] as Terrain)) continue;
        const value = clamp01(field[index]);
        if (value <= 0.02) continue;
        const r = low.r + (high.r - low.r) * value;
        const g = low.g + (high.g - low.g) * value;
        const b = low.b + (high.b - low.b) * value;
        this.paintTileRgb(x, y, r, g, b, 0.28 + value * 0.38);
      }
    }
  }

  private paintParcelGrid(city: CityState): void {
    for (const parcel of city.parcels) {
      if (parcel.owned) continue;
      const hex = parcel.settleable ? PALETTE.gold : PALETTE.madder;
      this.paintRect(
        parcel.px * PARCEL_SIZE,
        parcel.py * PARCEL_SIZE,
        PARCEL_SIZE,
        PARCEL_SIZE,
        hex,
        parcel.settleable ? 0.1 : 0.06,
        0.62,
      );
    }
  }

  /** A filled interior and a one-pixel border, in tile space. */
  private paintRect(
    x: number,
    y: number,
    width: number,
    height: number,
    hex: string,
    fillAlpha: number,
    borderAlpha: number,
  ): void {
    const { r, g, b } = hexToRgb(hex);
    const x0 = x * DECAL_SCALE;
    const y0 = y * DECAL_SCALE;
    const x1 = (x + width) * DECAL_SCALE;
    const y1 = (y + height) * DECAL_SCALE;
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const edge = px === x0 || px === x1 - 1 || py === y0 || py === y1 - 1;
        const alpha = edge ? borderAlpha : fillAlpha;
        if (alpha <= 0) continue;
        this.blend(px, py, r, g, b, alpha);
      }
    }
  }

  private paintTile(x: number, y: number, hex: string, alpha: number): void {
    const { r, g, b } = hexToRgb(hex);
    this.paintTileRgb(x, y, r, g, b, alpha);
  }

  private paintTileRgb(x: number, y: number, r: number, g: number, b: number, alpha: number): void {
    const x0 = x * DECAL_SCALE;
    const y0 = y * DECAL_SCALE;
    for (let py = y0; py < y0 + DECAL_SCALE; py++) {
      for (let px = x0; px < x0 + DECAL_SCALE; px++) this.blend(px, py, r, g, b, alpha);
    }
  }

  private blend(px: number, py: number, r: number, g: number, b: number, alpha: number): void {
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return;
    const at = (py * this.width + px) * 4;
    const pixels = this.pixels;
    const existing = pixels[at + 3] / 255;
    const out = alpha + existing * (1 - alpha);
    if (out <= 0) return;
    // Straight alpha compositing, so a preview reads over zoning paint.
    pixels[at] = (r * alpha + pixels[at] * existing * (1 - alpha)) / out;
    pixels[at + 1] = (g * alpha + pixels[at + 1] * existing * (1 - alpha)) / out;
    pixels[at + 2] = (b * alpha + pixels[at + 2] * existing * (1 - alpha)) / out;
    pixels[at + 3] = Math.round(out * 255);
  }
}

/**
 * A short description of everything the decal map draws, so a frame that
 * changes nothing costs nothing. Only the ends of a preview are included:
 * a drag's interior follows from them.
 */
function describe(state: DecalState, zoneRevision: number): string {
  const parts: (string | number)[] = [
    state.overlay,
    state.showZones ? 'z' : '-',
    zoneRevision,
  ];
  parts.push(state.hoverTile ? `${state.hoverTile.x},${state.hoverTile.y}` : '-');
  const preview = state.preview;
  if (preview) {
    const tiles = preview.tiles;
    const first = tiles[0];
    const last = tiles[tiles.length - 1];
    parts.push(tiles.length);
    parts.push(first ? `${first.x},${first.y},${first.ok ? 1 : 0}` : '-');
    parts.push(last ? `${last.x},${last.y},${last.ok ? 1 : 0}` : '-');
    const rect = preview.rect;
    parts.push(rect ? `${rect.x},${rect.y},${rect.width},${rect.height},${rect.ok ? 1 : 0}` : '-');
  } else {
    parts.push('-');
  }
  const footprint = state.selectedFootprint;
  parts.push(footprint ? `${footprint.x},${footprint.y},${footprint.width},${footprint.height}` : '-');
  parts.push(state.highlightParcel ? `${state.highlightParcel.px},${state.highlightParcel.py}` : '-');
  return parts.join('|');
}

export function overlayField(city: CityState, overlay: Overlay): Float32Array | null {
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

/**
 * Tools: what a tap or a drag actually does.
 *
 * Roads are laid as an L from where the drag started, zoning and demolition
 * fill a rectangle, and everything else places on a tap. Each tool can
 * quote a preview before it commits, so the player sees the price and the
 * legality of every tile before lifting a finger.
 */
import { RoadType, Zone } from '../sim/types';
import { CityState, PARCEL_SIZE, ROAD_NAMES, inCity, parcelForTile } from '../sim/city';
import { evaluateRoadPlacement, placeRoad } from '../sim/roads';
import { canZone, setZone } from '../sim/zoning';
import { demolish, evaluatePlacement, placeBuilding, quoteParcel } from '../sim/build';
import { getDef } from '../data/buildings';
import type { BuildPreview } from '../render/renderer';

export type ToolKind = 'inspect' | 'road' | 'zone' | 'build' | 'demolish' | 'land';

export interface ToolState {
  kind: ToolKind;
  roadType: RoadType;
  zone: Zone;
  buildDefId: string | null;
}

export function defaultTool(): ToolState {
  return { kind: 'inspect', roadType: RoadType.Cobble, zone: Zone.Residential, buildDefId: null };
}

/** Tools that draw with a one-finger drag rather than panning the map. */
export function toolDraws(tool: ToolState): boolean {
  return tool.kind === 'road' || tool.kind === 'zone' || tool.kind === 'demolish';
}

export interface TilePoint {
  x: number;
  y: number;
}

/**
 * The tiles a drag covers. Roads follow an L so streets come out straight;
 * zoning and demolition fill the rectangle between the two corners.
 */
export function tilesForDrag(tool: ToolState, start: TilePoint, end: TilePoint): TilePoint[] {
  if (tool.kind === 'road') return elbowPath(start, end);
  if (tool.kind === 'zone' || tool.kind === 'demolish') return rectangle(start, end);
  return [end];
}

/** An L-shaped run: along the longer axis first, then the shorter. */
export function elbowPath(start: TilePoint, end: TilePoint): TilePoint[] {
  const tiles: TilePoint[] = [];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);

  if (Math.abs(dx) >= Math.abs(dy)) {
    for (let x = start.x; x !== end.x + stepX && stepX !== 0; x += stepX) tiles.push({ x, y: start.y });
    if (stepX === 0) tiles.push({ x: start.x, y: start.y });
    for (let y = start.y + stepY; y !== end.y + stepY && stepY !== 0; y += stepY) tiles.push({ x: end.x, y });
  } else {
    for (let y = start.y; y !== end.y + stepY && stepY !== 0; y += stepY) tiles.push({ x: start.x, y });
    if (stepY === 0) tiles.push({ x: start.x, y: start.y });
    for (let x = start.x + stepX; x !== end.x + stepX && stepX !== 0; x += stepX) tiles.push({ x, y: end.y });
  }
  if (tiles.length === 0) tiles.push({ x: start.x, y: start.y });
  return tiles;
}

export function rectangle(start: TilePoint, end: TilePoint): TilePoint[] {
  const tiles: TilePoint[] = [];
  const x0 = Math.min(start.x, end.x);
  const x1 = Math.max(start.x, end.x);
  const y0 = Math.min(start.y, end.y);
  const y1 = Math.max(start.y, end.y);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) tiles.push({ x, y });
  }
  return tiles;
}

export interface ToolQuote {
  preview: BuildPreview;
  cost: number;
  /** How many tiles would actually change. */
  count: number;
  /** Why nothing can be done here, when nothing can. */
  reason?: string;
}

/** Work out what a tool would do, without doing it. */
export function quoteTool(city: CityState, tool: ToolState, tiles: TilePoint[]): ToolQuote {
  const preview: BuildPreview = { tiles: [] };
  let cost = 0;
  let count = 0;
  let reason: string | undefined;

  switch (tool.kind) {
    case 'road': {
      for (const tile of tiles) {
        const check = evaluateRoadPlacement(city, tile.x, tile.y, tool.roadType);
        preview.tiles.push({ x: tile.x, y: tile.y, ok: check.ok });
        if (check.ok) {
          cost += check.cost;
          count++;
        } else if (!reason) {
          reason = check.reason;
        }
      }
      break;
    }
    case 'zone': {
      for (const tile of tiles) {
        const check = canZone(city, tile.x, tile.y, tool.zone);
        preview.tiles.push({ x: tile.x, y: tile.y, ok: check.ok });
        if (check.ok) {
          cost += tool.zone === Zone.None ? 0 : 3;
          count++;
        } else if (!reason) {
          reason = check.reason;
        }
      }
      break;
    }
    case 'demolish': {
      for (const tile of tiles) {
        const clear = canClear(city, tile.x, tile.y);
        preview.tiles.push({ x: tile.x, y: tile.y, ok: clear });
        if (clear) count++;
      }
      break;
    }
    case 'build': {
      if (!tool.buildDefId) break;
      const def = getDef(tool.buildDefId);
      const anchor = tiles[tiles.length - 1];
      const check = evaluatePlacement(city, tool.buildDefId, anchor.x, anchor.y);
      cost = check.cost;
      count = check.ok ? 1 : 0;
      reason = check.reason;
      preview.rect = { x: anchor.x, y: anchor.y, width: def.width, height: def.height, ok: check.ok };
      for (let y = anchor.y; y < anchor.y + def.height; y++) {
        for (let x = anchor.x; x < anchor.x + def.width; x++) {
          preview.tiles.push({ x, y, ok: check.ok });
        }
      }
      break;
    }
    case 'land': {
      const anchor = tiles[tiles.length - 1];
      const parcel = parcelForTile(city, anchor.x, anchor.y);
      if (!parcel) break;
      const quote = quoteParcel(city, parcel.px, parcel.py);
      cost = quote.total;
      count = quote.ok ? 1 : 0;
      reason = quote.reason;
      preview.rect = {
        x: parcel.px * PARCEL_SIZE,
        y: parcel.py * PARCEL_SIZE,
        width: PARCEL_SIZE,
        height: PARCEL_SIZE,
        ok: quote.ok,
      };
      break;
    }
    default:
      break;
  }

  return { preview, cost, count, reason };
}

function canClear(city: CityState, x: number, y: number): boolean {
  if (!inCity(city, x, y)) return false;
  const index = y * city.width + x;
  if (city.wallAt[index] >= 0) return false;
  return city.buildingAt[index] >= 0 || city.roads[index] !== RoadType.None || city.zones[index] !== Zone.None;
}

export interface ToolResult {
  applied: number;
  spent: number;
  message?: string;
  tone: 'good' | 'bad' | 'info';
}

/** Commit a tool over a set of tiles. */
export function applyTool(city: CityState, tool: ToolState, tiles: TilePoint[]): ToolResult {
  const before = city.budget.gold;
  let applied = 0;

  switch (tool.kind) {
    case 'road': {
      for (const tile of tiles) {
        if (placeRoad(city, tile.x, tile.y, tool.roadType)) applied++;
      }
      if (applied === 0) {
        const check = evaluateRoadPlacement(city, tiles[0].x, tiles[0].y, tool.roadType);
        return { applied: 0, spent: 0, message: check.reason ?? 'Nothing to pave', tone: 'bad' };
      }
      return {
        applied,
        spent: before - city.budget.gold,
        message: `${applied} tiles of ${ROAD_NAMES[tool.roadType].toLowerCase()} laid`,
        tone: 'good',
      };
    }
    case 'zone': {
      for (const tile of tiles) {
        if (canZone(city, tile.x, tile.y, tool.zone).ok) {
          setZone(city, tile.x, tile.y, tool.zone);
          applied++;
        }
      }
      if (applied === 0) return { applied: 0, spent: 0, message: 'Nothing to zone here', tone: 'bad' };
      return { applied, spent: before - city.budget.gold, message: `${applied} plots zoned`, tone: 'good' };
    }
    case 'demolish': {
      for (const tile of tiles) {
        if (demolish(city, tile.x, tile.y).ok) applied++;
      }
      if (applied === 0) return { applied: 0, spent: 0, message: 'Nothing to clear', tone: 'bad' };
      return { applied, spent: before - city.budget.gold, message: `${applied} tiles cleared`, tone: 'info' };
    }
    case 'build': {
      if (!tool.buildDefId) return { applied: 0, spent: 0, tone: 'info' };
      const anchor = tiles[tiles.length - 1];
      const check = evaluatePlacement(city, tool.buildDefId, anchor.x, anchor.y);
      if (!check.ok) return { applied: 0, spent: 0, message: check.reason, tone: 'bad' };
      placeBuilding(city, tool.buildDefId, anchor.x, anchor.y);
      return {
        applied: 1,
        spent: before - city.budget.gold,
        message: `${getDef(tool.buildDefId).name} built`,
        tone: 'good',
      };
    }
    default:
      return { applied: 0, spent: 0, tone: 'info' };
  }
}

/** A one-line instruction shown while a tool is held. */
export function toolHint(tool: ToolState): string {
  switch (tool.kind) {
    case 'road':
      return 'Drag to lay a street. Two fingers, or the right button, move the map.';
    case 'zone':
      return 'Drag to paint a district beside a road.';
    case 'demolish':
      return 'Drag over anything to clear it. Walls cannot be razed.';
    case 'build':
      return 'Tap a plot beside a road to build.';
    case 'land':
      return 'Tap a lot outside the walls to buy it and extend them.';
    default:
      return 'Tap anything to inspect it. Drag to look around.';
  }
}

/** What a cancel — Escape, or a right click — should back out of. */
export type CancelAction = 'drop-tool' | 'close-panel' | 'none';

/**
 * A cancel puts the tool down before it closes anything, so backing out of
 * the catalogue leaves the catalogue open to choose again from.
 */
export function resolveCancel(tool: ToolState, panelOpen: boolean): CancelAction {
  if (tool.kind !== 'inspect') return 'drop-tool';
  return panelOpen ? 'close-panel' : 'none';
}

/** Tools that can show what a single tile under the cursor would cost. */
export function toolPreviewsHover(tool: ToolState): boolean {
  return tool.kind !== 'inspect';
}

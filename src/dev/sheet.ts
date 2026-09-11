/**
 * Development contact sheet.
 *
 * Renders every building, wall piece, road tile, tree and agent sprite on
 * one page so the artwork can be reviewed side by side. Not part of the
 * game bundle — built separately with `npm run sheet`.
 */
import { ALL_BUILDING_DEFS } from '../data/buildings';
import { getBuildingSprite } from '../render/buildingSprites';
import { getAgentSprite, getRoadSprite, getTreeSprite, getWallSprite } from '../render/propSprites';
import { AgentKind, RoadType } from '../sim/types';

function section(title: string): HTMLElement {
  const heading = document.createElement('h2');
  heading.textContent = title;
  heading.style.cssText = 'font:700 15px sans-serif;color:#E8BE55;margin:22px 0 8px;width:100%';
  return heading;
}

/** Sprites are cached and share one canvas element, so copy before showing. */
function copyOf(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  canvas.getContext('2d')?.drawImage(source, 0, 0);
  return canvas;
}

function cell(sprite: { canvas: HTMLCanvasElement }, label: string): HTMLElement {
  const box = document.createElement('div');
  box.style.cssText =
    'display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:4px;' +
    'padding:8px;background:#6EA33E;border:1px solid #3a2a10;border-radius:6px;min-width:120px';
  const holder = document.createElement('div');
  holder.style.cssText = 'display:flex;align-items:flex-end;justify-content:center;height:190px';
  const canvas = copyOf(sprite.canvas);
  // Scale tall sprites down to fit rather than letting them overflow the cell.
  canvas.style.maxHeight = '190px';
  canvas.style.width = 'auto';
  holder.appendChild(canvas);
  const caption = document.createElement('span');
  caption.textContent = label;
  caption.style.cssText = 'font:600 10px sans-serif;color:#1b1206;text-align:center';
  box.append(holder, caption);
  return box;
}

function row(): HTMLElement {
  const node = document.createElement('div');
  node.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;width:100%';
  return node;
}

function main(): void {
  const root = document.body;
  root.style.cssText = 'margin:0;padding:16px;background:#241809;display:flex;flex-wrap:wrap;gap:8px';

  root.appendChild(section('Buildings'));
  let current = row();
  root.appendChild(current);
  for (const def of ALL_BUILDING_DEFS) {
    current.appendChild(cell(getBuildingSprite(def.id, 0, 2, false), `${def.name}\n${def.width}x${def.height}`));
  }

  root.appendChild(section('Variants (Crofter’s Hut, Townhouse, Shop)'));
  current = row();
  root.appendChild(current);
  for (const id of ['house1', 'house3', 'shop2', 'farm1', 'timber2', 'mine2']) {
    for (let variant = 0; variant < 4; variant++) {
      current.appendChild(cell(getBuildingSprite(id, variant, 2, false), `${id} v${variant}`));
    }
  }

  root.appendChild(section('Facings (each building is drawn four ways)'));
  current = row();
  root.appendChild(current);
  for (const id of ['house1', 'house2', 'shop1', 'farm1']) {
    for (let facing = 0; facing < 4; facing++) {
      current.appendChild(cell(getBuildingSprite(id, 0, facing, false), `${id} f${facing}`));
    }
  }

  root.appendChild(section('Derelict'));
  current = row();
  root.appendChild(current);
  for (const id of ['house1', 'house3', 'shop2', 'craft1']) {
    current.appendChild(cell(getBuildingSprite(id, 0, 2, true), `${id} ruined`));
  }

  root.appendChild(section('Curtain Wall'));
  current = row();
  root.appendChild(current);
  for (const mask of [0b0101, 0b1010]) {
    current.appendChild(cell(getWallSprite('wall', mask, 0), `wall ${mask.toString(2)}`));
  }
  current.appendChild(cell(getWallSprite('tower', 0b1111, 0), 'tower'));
  current.appendChild(cell(getWallSprite('gate', 0b0101, 0), 'gate N-S'));
  current.appendChild(cell(getWallSprite('gate', 0b1010, 1), 'gate E-W'));

  root.appendChild(section('Roads'));
  current = row();
  root.appendChild(current);
  for (const type of [RoadType.Path, RoadType.Cobble, RoadType.Avenue]) {
    for (const mask of [0b0101, 0b1010, 0b1111, 0b0011, 0b0001]) {
      current.appendChild(cell(getRoadSprite(type, mask), `${RoadType[type]} ${mask.toString(2).padStart(4, '0')}`));
    }
  }

  root.appendChild(section('Trees'));
  current = row();
  root.appendChild(current);
  for (let variant = 0; variant < 4; variant++) {
    current.appendChild(cell(getTreeSprite(variant), `tree ${variant}`));
  }

  root.appendChild(section('People and Carts'));
  current = row();
  root.appendChild(current);
  for (const kind of [AgentKind.Peasant, AgentKind.Guard, AgentKind.Traveler, AgentKind.Cart]) {
    for (let direction = 0; direction < 4; direction++) {
      current.appendChild(cell(getAgentSprite(kind, 0, direction, 0), `${kind} d${direction}`));
    }
  }
}

main();

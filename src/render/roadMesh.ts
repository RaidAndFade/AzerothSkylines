/**
 * Ways: footpaths, cobbled streets and flagstone avenues.
 *
 * A road is not a tile of texture. Each road tile contributes a patch at its
 * centre and an arm out toward every neighbour it joins, so a junction is
 * genuinely a junction and a dead end genuinely stops. The surface is lifted
 * a few centimetres and follows the relief, so a street runs over a rise
 * instead of cutting through it.
 *
 * Where a road crosses water it becomes a timber bridge on piles, because a
 * cobbled street does not float.
 */
import { RoadType } from '../sim/types';
import { WATER_HEIGHT, WorldMap } from '../sim/terrain';
import { CityState, roadAt, tileIndex } from '../sim/city';
import { MeshBuilder, Rgb, box, colour, lathe, point, tone } from './meshBuilder';
import { PALETTE } from './palette';
import { surfaceHeight } from './world';
import { DIRECTIONS } from '../core/grid';
import { hash2 } from '../core/rng';

/** How far the made surface sits above the turf. */
const LIFT = 0.045;

interface RoadLook {
  width: number;
  surface: string;
  kerb: string | null;
}

const LOOKS: Record<number, RoadLook> = {
  [RoadType.Path]: { width: 0.5, surface: PALETTE.path, kerb: null },
  [RoadType.Cobble]: { width: 0.86, surface: PALETTE.cobble, kerb: PALETTE.cobbleDark },
  [RoadType.Avenue]: { width: 1.0, surface: PALETTE.flagstone, kerb: PALETTE.flagstoneDark },
};

export function addRoad(mesh: MeshBuilder, city: CityState, x: number, y: number): void {
  const map = city.map;
  const kind = city.roads[tileIndex(city, x, y)] as RoadType;
  if (kind === RoadType.None) return;
  const look = LOOKS[kind] ?? LOOKS[RoadType.Path];
  const cx = x + 0.5;
  const cz = y + 0.5;
  const half = look.width / 2;

  const submerged = surfaceHeight(map, cx, cz) < WATER_HEIGHT - 0.05;
  if (submerged) {
    addBridge(mesh, city, x, y, look);
    return;
  }

  const surface = colour(look.surface);
  // The centre patch.
  patch(mesh, map, cx - half, cz - half, look.width, look.width, surface, kind);
  // An arm out to every way that joins, which is what makes a junction read.
  for (let d = 0; d < 4; d++) {
    const direction = DIRECTIONS[d];
    if (roadAt(city, x + direction.x, y + direction.y) === RoadType.None) continue;
    if (direction.x !== 0) {
      const x0 = direction.x > 0 ? cx + half : cx - 0.5;
      patch(mesh, map, x0, cz - half, 0.5 - half, look.width, surface, kind);
    } else {
      const z0 = direction.y > 0 ? cz + half : cz - 0.5;
      patch(mesh, map, cx - half, z0, look.width, 0.5 - half, surface, kind);
    }
  }

  if (look.kerb) addKerbs(mesh, city, x, y, look, colour(look.kerb));
}

/**
 * One rectangle of made surface, subdivided so it follows the ground, with
 * a little per-stone colour variation.
 */
function patch(
  mesh: MeshBuilder,
  map: WorldMap,
  x0: number,
  z0: number,
  width: number,
  depth: number,
  surface: Rgb,
  kind: RoadType,
): void {
  if (width <= 0.001 || depth <= 0.001) return;
  const columns = Math.max(1, Math.round(width / 0.22));
  const rows = Math.max(1, Math.round(depth / 0.22));
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const ax = x0 + (width * column) / columns;
      const bx = x0 + (width * (column + 1)) / columns;
      const az = z0 + (depth * row) / rows;
      const bz = z0 + (depth * (row + 1)) / rows;
      // A cobbled street is made of stones, and no two are the same grey.
      const roll = hash2(Math.round(ax * 16), Math.round(az * 16), 0x51ed3f);
      // Enough spread between one stone and the next to read as a made
      // surface from above, where a flat grey would read as a grey stripe.
      const stone = tone(surface, (roll - 0.5) * (kind === RoadType.Path ? 0.22 : 0.3));
      mesh.quad(
        point(ax, surfaceHeight(map, ax, az) + LIFT, az),
        point(ax, surfaceHeight(map, ax, bz) + LIFT, bz),
        point(bx, surfaceHeight(map, bx, bz) + LIFT, bz),
        point(bx, surfaceHeight(map, bx, az) + LIFT, az),
        stone,
        0.94,
      );
    }
  }
}

/** A raised kerb along the sides of a street that has no road beside it. */
function addKerbs(
  mesh: MeshBuilder,
  city: CityState,
  x: number,
  y: number,
  look: RoadLook,
  kerb: Rgb,
): void {
  const map = city.map;
  const cx = x + 0.5;
  const cz = y + 0.5;
  const half = look.width / 2;
  for (let d = 0; d < 4; d++) {
    const direction = DIRECTIONS[d];
    if (roadAt(city, x + direction.x, y + direction.y) !== RoadType.None) continue;
    const px = cx + direction.x * half;
    const pz = cz + direction.y * half;
    box(
      mesh,
      px,
      surfaceHeight(map, px, pz) + LIFT - 0.04,
      pz,
      direction.x !== 0 ? 0.07 : look.width,
      0.08,
      direction.x !== 0 ? look.width : 0.07,
      kerb,
      { footOcclusion: 0.55, skipBottom: true },
    );
  }
}

/** A timber bridge where a way crosses the water. */
function addBridge(mesh: MeshBuilder, city: CityState, x: number, y: number, look: RoadLook): void {
  const cx = x + 0.5;
  const cz = y + 0.5;
  const deckY = WATER_HEIGHT + 0.34;
  const timber = colour(PALETTE.board);
  const planks = 5;
  const width = Math.max(look.width, 0.7);
  for (let i = 0; i < planks; i++) {
    const z0 = cz - 0.5 + i / planks;
    box(
      mesh,
      cx,
      deckY,
      z0 + 0.5 / planks,
      width,
      0.07,
      1 / planks - 0.015,
      tone(timber, ((i % 3) - 1) * 0.07),
      { footOcclusion: 0.8 },
    );
  }
  // Piles down into the riverbed, and a handrail along each side.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const px = cx + (sx * width) / 2;
      const pz = cz + sz * 0.4;
      lathe(
        mesh,
        px,
        pz,
        [
          { y: surfaceHeight(city.map, px, pz) - 0.1, radius: 0.055 },
          { y: deckY, radius: 0.05 },
        ],
        6,
        colour(PALETTE.oakDark),
        { occlusionFoot: 0.3 },
      );
    }
    const railX = cx + (sx * width) / 2;
    box(mesh, railX, deckY + 0.36, cz, 0.05, 0.06, 1, colour(PALETTE.oak), { footOcclusion: 0.9 });
    for (const sz of [-1, 0, 1]) {
      box(mesh, railX, deckY + 0.07, cz + sz * 0.35, 0.05, 0.32, 0.05, colour(PALETTE.oakDark), {
        footOcclusion: 0.7,
      });
    }
  }
}

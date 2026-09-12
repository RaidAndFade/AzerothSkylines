/**
 * The town wall.
 *
 * A curtain of coursed rubble with an ashlar plinth and a crenellated
 * parapet, carried along whichever faces of a tile the wall connects
 * through, with round towers at the corners and a gatehouse with a pointed
 * arch wherever a street runs out of the town.
 *
 * The wall follows the ground rather than stepping over it: each span is
 * built between the heights at its own two ends, so a wall running up a
 * slope leans up it.
 */
import { WallSegment } from '../sim/types';
import { WorldMap } from '../sim/terrain';
import { MeshBuilder, Rgb, box, colour, cone, lathe, spheroid, tone } from './meshBuilder';
import { PALETTE } from './palette';
import { surfaceHeight } from './world';
import { DIRECTIONS } from '../core/grid';

/** Height of the wall-walk above the ground, in world units. */
const WALL_HEIGHT = 1.5;
const WALL_THICKNESS = 0.46;
const PARAPET = 0.3;

export function addWall(mesh: MeshBuilder, map: WorldMap, segment: WallSegment): void {
  const cx = segment.x + 0.5;
  const cz = segment.y + 0.5;
  const ground = surfaceHeight(map, cx, cz);
  const stone = colour(PALETTE.rubble);
  const ashlar = colour(PALETTE.limestone);

  if (segment.kind === 'tower') {
    addTower(mesh, cx, ground, cz, stone, ashlar);
    return;
  }
  if (segment.kind === 'gate') {
    addGatehouse(mesh, map, segment, cx, ground, cz, stone, ashlar);
    return;
  }

  // A plain span: half a curtain out along every side it connects through,
  // plus a block at the tile's own centre so the joins are solid.
  addCurtainBlock(mesh, cx, ground, cz, WALL_THICKNESS, WALL_THICKNESS, stone, ashlar, 0);
  for (let d = 0; d < 4; d++) {
    if ((segment.connections & (1 << d)) === 0) continue;
    const direction = DIRECTIONS[d];
    const toX = cx + direction.x * 0.5;
    const toZ = cz + direction.y * 0.5;
    addCurtainSpan(mesh, map, cx, cz, toX, toZ, stone, ashlar);
  }
  // If the wall ends here, cap the open end so it is not a hollow slab.
  if (segment.connections === 0) {
    addCrenellatedCap(mesh, cx, ground + WALL_HEIGHT, cz, WALL_THICKNESS + 0.1, ashlar);
  }
}

/** One run of curtain between two points on the ground. */
function addCurtainSpan(
  mesh: MeshBuilder,
  map: WorldMap,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  stone: Rgb,
  ashlar: Rgb,
): void {
  const steps = 2;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const ax = fromX + (toX - fromX) * t0;
    const az = fromZ + (toZ - fromZ) * t0;
    const bx = fromX + (toX - fromX) * t1;
    const bz = fromZ + (toZ - fromZ) * t1;
    const midX = (ax + bx) / 2;
    const midZ = (az + bz) / 2;
    const ground = Math.min(surfaceHeight(map, ax, az), surfaceHeight(map, bx, bz));
    const length = Math.hypot(bx - ax, bz - az);
    const yaw = Math.atan2(bx - ax, bz - az);
    addCurtainBlock(mesh, midX, ground, midZ, WALL_THICKNESS, length + 0.02, stone, ashlar, yaw);
  }
}

/**
 * A block of curtain: a battered plinth, the wall above it, a string course
 * and a crenellated parapet.
 */
function addCurtainBlock(
  mesh: MeshBuilder,
  cx: number,
  ground: number,
  cz: number,
  thickness: number,
  length: number,
  stone: Rgb,
  ashlar: Rgb,
  yaw: number,
): void {
  box(mesh, cx, ground - 0.5, cz, thickness + 0.18, 0.72, length, tone(stone, -0.08), {
    yaw,
    taper: 0.14,
    skipBottom: true,
    footOcclusion: 0.3,
  });
  box(mesh, cx, ground + 0.2, cz, thickness, WALL_HEIGHT - 0.2, length, stone, {
    yaw,
    taper: 0.05,
    skipBottom: true,
    skipTop: true,
    footOcclusion: 0.45,
  });
  // String course, then the wall-walk, then the merlons along the outer edge.
  box(mesh, cx, ground + WALL_HEIGHT - 0.1, cz, thickness + 0.1, 0.09, length, tone(ashlar, -0.05), {
    yaw,
    footOcclusion: 0.7,
  });
  const merlons = Math.max(1, Math.round(length / 0.34));
  for (let i = 0; i < merlons; i++) {
    if (i % 2 === 1) continue;
    const along = -length / 2 + (length * (i + 0.5)) / merlons;
    box(
      mesh,
      cx + along * Math.sin(yaw),
      ground + WALL_HEIGHT,
      cz + along * Math.cos(yaw),
      thickness + 0.06,
      PARAPET,
      length / merlons - 0.04,
      ashlar,
      { yaw, footOcclusion: 0.8 },
    );
  }
}

function addCrenellatedCap(
  mesh: MeshBuilder,
  cx: number,
  y: number,
  cz: number,
  size: number,
  ashlar: Rgb,
): void {
  box(mesh, cx, y, cz, size, PARAPET, size, ashlar, { footOcclusion: 0.8 });
}

/** A round drum tower, taller than the curtain, with a conical cap. */
function addTower(mesh: MeshBuilder, cx: number, ground: number, cz: number, stone: Rgb, ashlar: Rgb): void {
  const top = ground + WALL_HEIGHT + 0.7;
  lathe(
    mesh,
    cx,
    cz,
    [
      { y: ground - 0.6, radius: 0.52 },
      { y: ground + 0.1, radius: 0.44 },
      { y: top, radius: 0.4 },
      { y: top + 0.09, radius: 0.46 },
    ],
    16,
    stone,
    { tintByHeight: 0.1, occlusionFoot: 0.3 },
  );
  // Parapet: alternate merlons around the drum.
  for (let s = 0; s < 16; s += 2) {
    const angle = (s / 16) * Math.PI * 2;
    box(
      mesh,
      cx + Math.cos(angle) * 0.43,
      top + 0.09,
      cz + Math.sin(angle) * 0.43,
      0.18,
      PARAPET,
      0.14,
      ashlar,
      { yaw: -angle, footOcclusion: 0.8 },
    );
  }
  cone(mesh, cx, top + 0.2, cz, 0.38, 0.8, 16, colour(PALETTE.lead));
  // An arrow loop on each face, so the drum is not blank.
  for (let s = 0; s < 4; s++) {
    const angle = (s / 4) * Math.PI * 2 + 0.4;
    box(
      mesh,
      cx + Math.cos(angle) * 0.43,
      ground + 0.7,
      cz + Math.sin(angle) * 0.43,
      0.07,
      0.34,
      0.06,
      colour('#241F18'),
      { yaw: -angle, footOcclusion: 0.4 },
    );
  }
}

/** A gatehouse: two drums, a pointed arch between them, and a roadway under it. */
function addGatehouse(
  mesh: MeshBuilder,
  map: WorldMap,
  segment: WallSegment,
  cx: number,
  ground: number,
  cz: number,
  stone: Rgb,
  ashlar: Rgb,
): void {
  // Orientation 0 is a north-south passage, so the drums stand east and west.
  const acrossX = segment.orientation === 0 ? 1 : 0;
  const acrossZ = segment.orientation === 0 ? 0 : 1;
  const top = ground + WALL_HEIGHT + 0.95;

  for (const side of [-1, 1]) {
    const dx = cx + acrossX * side * 0.52;
    const dz = cz + acrossZ * side * 0.52;
    const footing = surfaceHeight(map, dx, dz);
    lathe(
      mesh,
      dx,
      dz,
      [
        { y: footing - 0.6, radius: 0.36 },
        { y: footing + 0.12, radius: 0.3 },
        { y: top, radius: 0.27 },
        { y: top + 0.08, radius: 0.32 },
      ],
      14,
      stone,
      { tintByHeight: 0.09, occlusionFoot: 0.3 },
    );
    for (let s = 0; s < 14; s += 2) {
      const angle = (s / 14) * Math.PI * 2;
      box(
        mesh,
        dx + Math.cos(angle) * 0.29,
        top + 0.08,
        dz + Math.sin(angle) * 0.29,
        0.14,
        PARAPET,
        0.12,
        ashlar,
        { yaw: -angle, footOcclusion: 0.8 },
      );
    }
    cone(mesh, dx, top + 0.18, dz, 0.26, 0.55, 14, colour(PALETTE.lead));
  }

  // The arch over the road: a band of voussoirs turning a point.
  const yaw = segment.orientation === 0 ? Math.PI / 2 : 0;
  const springing = ground + 0.62;
  const crown = ground + 1.18;
  const voussoirs = 9;
  for (let i = 0; i <= voussoirs; i++) {
    const t = i / voussoirs;
    // Two straight-ish limbs meeting at a point, as a Gothic arch does.
    const side = t < 0.5 ? -1 : 1;
    const local = t < 0.5 ? t * 2 : (1 - t) * 2;
    const ox = side * (1 - local) * 0.42;
    const y = springing + Math.sin(local * Math.PI * 0.5) * (crown - springing);
    box(
      mesh,
      cx + ox * Math.cos(yaw),
      y,
      cz - ox * Math.sin(yaw),
      0.14,
      0.14,
      WALL_THICKNESS + 0.08,
      tone(ashlar, ((i % 3) - 1) * 0.05),
      { yaw, footOcclusion: 0.6 },
    );
  }
  // The wall above the arch, carrying the walk across.
  box(mesh, cx, crown + 0.05, cz, 1.0, WALL_HEIGHT + 0.9 - (crown + 0.05 - ground), WALL_THICKNESS, stone, {
    yaw,
    skipBottom: true,
    footOcclusion: 0.45,
  });
  box(mesh, cx, top + 0.08, cz, 1.04, PARAPET, WALL_THICKNESS + 0.08, ashlar, { yaw, footOcclusion: 0.8 });
  // A lamp in the gate passage, so the way in reads at dusk.
  spheroid(mesh, cx, crown - 0.08, cz, 0.06, 0.07, 6, 3, colour('#C89A46'));
}

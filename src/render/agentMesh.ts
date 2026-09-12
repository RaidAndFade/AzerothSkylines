/**
 * The people, and what they push.
 *
 * Villagers, carters, the watch and travellers on the road. Each is a few
 * dozen triangles: a cloaked body turned on a lathe, a head, and arms that
 * swing. The swing is the whole point — a figure that slides about without
 * moving reads as a counter on a board, not a person walking home.
 */
import { AgentKind } from '../sim/types';
import { MeshBuilder, Rgb, blend, box, colour, lathe, spheroid, tone } from './meshBuilder';
import { PALETTE } from './palette';

/** Russet, hodden grey, madder, woad: what a dye-works could manage cheaply. */
const CLOTH = ['#7A5A3A', '#6B6355', '#8E4A3A', '#46566E', '#5E6046', '#8A7A52'];
const SKIN = ['#C49A76', '#A87E58', '#8A6242', '#D2AE8C'];

export interface AgentLook {
  kind: AgentKind;
  variant: number;
  /** Position in world units, on the ground. */
  x: number;
  y: number;
  z: number;
  /** Where they are facing, in radians. */
  heading: number;
  /** Walk cycle phase, in radians. */
  phase: number;
  /** True when a cart is carrying something. */
  laden: boolean;
}

export function addAgent(mesh: MeshBuilder, look: AgentLook): void {
  switch (look.kind) {
    case AgentKind.Cart:
      addCart(mesh, look);
      return;
    case AgentKind.Guard:
      addPerson(mesh, look, {
        cloth: colour('#4A5464'),
        over: colour('#8A8478'),
        hat: colour('#7E8288'),
        spear: true,
        height: 0.34,
      });
      return;
    case AgentKind.Traveler:
      addPerson(mesh, look, {
        cloth: colour(CLOTH[(look.variant + 3) % CLOTH.length]),
        over: colour(PALETTE.stubble),
        hat: colour(PALETTE.oak),
        staff: true,
        height: 0.33,
      });
      return;
    default:
      addPerson(mesh, look, {
        cloth: colour(CLOTH[look.variant % CLOTH.length]),
        over: null,
        hat: null,
        height: 0.31,
      });
  }
}

interface PersonLook {
  cloth: Rgb;
  /** A surcoat, apron or mantle over the tunic. */
  over: Rgb | null;
  hat: Rgb | null;
  height: number;
  spear?: boolean;
  staff?: boolean;
}

function addPerson(mesh: MeshBuilder, look: AgentLook, person: PersonLook): void {
  const { x, y, z, heading, phase } = look;
  const height = person.height;
  const skin = colour(SKIN[look.variant % SKIN.length]);
  const sway = Math.sin(phase) * 0.035;
  const bob = Math.abs(Math.cos(phase)) * 0.012;

  // The body: a lathe, wider at the hem than the shoulder, like a tunic.
  lathe(
    mesh,
    x,
    z,
    [
      { y: y + bob, radius: height * 0.3 },
      { y: y + height * 0.42 + bob, radius: height * 0.27 },
      { y: y + height * 0.72 + bob, radius: height * 0.22 },
    ],
    8,
    person.cloth,
    { tintByHeight: 0.2, occlusionFoot: 0.4 },
  );
  if (person.over) {
    lathe(
      mesh,
      x,
      z,
      [
        { y: y + height * 0.3 + bob, radius: height * 0.29 },
        { y: y + height * 0.74 + bob, radius: height * 0.23 },
      ],
      8,
      person.over,
      { tintByHeight: 0.16, occlusionFoot: 0.5 },
    );
  }
  // Head and hood.
  spheroid(mesh, x, y + height * 0.86 + bob, z, height * 0.15, height * 0.17, 7, 4, skin, { tint: 0.18 });
  if (person.hat) {
    spheroid(mesh, x, y + height * 0.93 + bob, z, height * 0.17, height * 0.1, 7, 3, person.hat, { squash: 0.3 });
  }
  // Arms, swinging opposite each other.
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  for (const side of [-1, 1]) {
    const ox = -sin * side * height * 0.26;
    const oz = cos * side * height * 0.26;
    const swing = sway * side;
    lathe(
      mesh,
      x + ox + cos * swing,
      z + oz + sin * swing,
      [
        { y: y + height * 0.36 + bob, radius: height * 0.055 },
        { y: y + height * 0.7 + bob, radius: height * 0.07 },
      ],
      5,
      blend(person.cloth, skin, 0.2),
      { occlusionFoot: 0.6 },
    );
  }
  // Legs, striding.
  for (const side of [-1, 1]) {
    const ox = -sin * side * height * 0.1;
    const oz = cos * side * height * 0.1;
    const stride = Math.sin(phase + (side > 0 ? 0 : Math.PI)) * height * 0.12;
    lathe(
      mesh,
      x + ox + cos * stride,
      z + oz + sin * stride,
      [
        { y: y, radius: height * 0.05 },
        { y: y + height * 0.34, radius: height * 0.07 },
      ],
      5,
      tone(person.cloth, -0.22),
      { occlusionFoot: 0.3 },
    );
  }
  if (person.spear || person.staff) {
    const ox = -sin * height * 0.3;
    const oz = cos * height * 0.3;
    const shaft = person.spear ? height * 2.5 : height * 2.1;
    lathe(
      mesh,
      x + ox,
      z + oz,
      [
        { y: y, radius: 0.014 },
        { y: y + shaft, radius: 0.011 },
      ],
      4,
      colour(PALETTE.oak),
      { occlusionFoot: 0.6 },
    );
    if (person.spear) {
      lathe(
        mesh,
        x + ox,
        z + oz,
        [
          { y: y + shaft, radius: 0.024 },
          { y: y + shaft + 0.12, radius: 0.002 },
        ],
        4,
        colour('#9A9EA2'),
        {},
      );
    }
  }
}

/** A two-wheeled cart, which is how almost everything moved. */
function addCart(mesh: MeshBuilder, look: AgentLook): void {
  const { x, y, z, heading, phase } = look;
  const timber = colour(PALETTE.board);
  const iron = colour(PALETTE.oakDark);
  const yaw = -heading;

  box(mesh, x, y + 0.17, z, 0.46, 0.1, 0.3, timber, { yaw, footOcclusion: 0.6 });
  // Sides, so it can hold something.
  for (const side of [-1, 1]) {
    const ox = Math.cos(yaw) * 0 + Math.sin(yaw) * side * 0.15;
    const oz = Math.cos(yaw) * side * 0.15;
    box(mesh, x + ox, y + 0.26, z + oz, 0.46, 0.11, 0.035, tone(timber, 0.05), { yaw, footOcclusion: 0.75 });
  }
  if (look.laden) {
    spheroid(mesh, x, y + 0.32, z, 0.17, 0.08, 7, 3, colour(PALETTE.corn), { squash: 0.4 });
  }
  // Wheels, turning as the cart moves.
  for (const side of [-1, 1]) {
    const ox = Math.sin(yaw) * side * 0.19;
    const oz = Math.cos(yaw) * side * 0.19;
    lathe(
      mesh,
      x + ox,
      z + oz,
      [
        { y: y + 0.02, radius: 0.15 },
        { y: y + 0.08, radius: 0.17 },
        { y: y + 0.14, radius: 0.15 },
      ],
      9,
      iron,
      { occlusionFoot: 0.4 },
    );
    // Spokes: a crude wheel, but the turn is visible.
    for (let s = 0; s < 4; s++) {
      const angle = phase * 0.9 + (s / 4) * Math.PI;
      box(
        mesh,
        x + ox + Math.cos(angle) * 0.07 * Math.cos(yaw),
        y + 0.08 + Math.sin(angle) * 0.07,
        z + oz - Math.cos(angle) * 0.07 * Math.sin(yaw),
        0.02,
        0.02,
        0.05,
        tone(iron, 0.12),
        { yaw },
      );
    }
  }
  // Shafts, reaching forward to where the ox would be.
  for (const side of [-1, 1]) {
    const ox = Math.sin(yaw) * side * 0.12 + Math.cos(yaw) * 0.34;
    const oz = Math.cos(yaw) * side * 0.12 - Math.sin(yaw) * 0.34;
    box(mesh, x + ox, y + 0.2, z + oz, 0.3, 0.04, 0.04, timber, { yaw, footOcclusion: 0.7 });
  }
}

/**
 * Trees and the things that grow between them.
 *
 * Six species stand in for an English valley: oak, ash, birch, hawthorn,
 * willow and Scots pine. Each is built once as a template and then stamped
 * into the world with its own turn, scale and tint, so a wood is thousands
 * of trees and one mesh's worth of work.
 *
 * Crowns are smooth-shaded spheroids rather than cones or billboards. That
 * is the whole reason they read as foliage at any angle, and it is why
 * nothing in the woodland looks like a cube.
 */
import { MeshBuilder, colour, lathe, spheroid, tone } from './meshBuilder';
import { PALETTE } from './palette';

export const TREE_VARIANTS = 6;
export const PROP_VARIANTS = 6;

interface Species {
  name: string;
  /** Height of the tree at scale 1, in world units. */
  height: number;
  trunk: string;
  crown: string;
  build(mesh: MeshBuilder, species: Species, detail: boolean): void;
}

/** A tapered bole, with a slight flare at the root. */
function bole(mesh: MeshBuilder, height: number, radius: number, trunk: string, sides: number): void {
  lathe(
    mesh,
    0,
    0,
    [
      { y: 0, radius: radius * 1.5 },
      { y: height * 0.1, radius: radius * 1.05 },
      { y: height * 0.6, radius: radius * 0.78 },
      { y: height, radius: radius * 0.5 },
    ],
    sides,
    colour(trunk),
    { tintByHeight: 0.14, occlusionFoot: 0.35 },
  );
}

const SPECIES: Species[] = [
  {
    // Oak: short bole, wide and lumpy crown. The tree of the English wood.
    name: 'oak',
    height: 1.9,
    trunk: PALETTE.oakDark,
    crown: PALETTE.canopy,
    build(mesh, species, detail) {
      bole(mesh, species.height * 0.42, 0.07, species.trunk, detail ? 7 : 5);
      const c = colour(species.crown);
      const rings = detail ? 5 : 3;
      const sides = detail ? 9 : 6;
      spheroid(mesh, 0, species.height * 0.68, 0, 0.62, 0.46, sides, rings, c, { squash: 0.25, tint: 0.3 });
      if (detail) {
        spheroid(mesh, 0.3, species.height * 0.52, 0.16, 0.34, 0.28, 7, 3, tone(c, -0.06), { squash: 0.3 });
        spheroid(mesh, -0.26, species.height * 0.56, -0.2, 0.3, 0.26, 7, 3, tone(c, 0.05), { squash: 0.3 });
      }
    },
  },
  {
    // Ash: taller, lighter, an airier crown.
    name: 'ash',
    height: 2.3,
    trunk: PALETTE.oak,
    crown: PALETTE.canopyLight,
    build(mesh, species, detail) {
      bole(mesh, species.height * 0.6, 0.055, species.trunk, detail ? 7 : 5);
      const c = colour(species.crown);
      spheroid(mesh, 0, species.height * 0.8, 0, 0.46, 0.5, detail ? 9 : 6, detail ? 5 : 3, c, {
        squash: 0.15,
        tint: 0.32,
      });
      if (detail) spheroid(mesh, 0.18, species.height * 0.62, -0.14, 0.28, 0.26, 7, 3, tone(c, -0.05));
    },
  },
  {
    // Birch: slender, silver-barked, a narrow crown.
    name: 'birch',
    height: 2.0,
    trunk: '#C4C0B2',
    crown: PALETTE.canopyPale,
    build(mesh, species, detail) {
      bole(mesh, species.height * 0.66, 0.038, species.trunk, detail ? 6 : 4);
      const c = colour(species.crown);
      spheroid(mesh, 0, species.height * 0.82, 0, 0.3, 0.44, detail ? 8 : 6, detail ? 4 : 3, c, { tint: 0.34 });
    },
  },
  {
    // Hawthorn: low, dense, and what every hedge is laid from.
    name: 'hawthorn',
    height: 1.1,
    trunk: PALETTE.oakDark,
    crown: PALETTE.canopyPale,
    build(mesh, species, detail) {
      bole(mesh, species.height * 0.3, 0.05, species.trunk, 5);
      const c = colour(species.crown);
      spheroid(mesh, 0, species.height * 0.6, 0, 0.44, 0.38, detail ? 8 : 6, detail ? 4 : 3, c, {
        squash: 0.35,
        tint: 0.26,
      });
    },
  },
  {
    // Willow: by the water, weeping, yellow-green.
    name: 'willow',
    height: 1.8,
    trunk: '#6E6048',
    crown: '#7D8A4A',
    build(mesh, species, detail) {
      bole(mesh, species.height * 0.38, 0.075, species.trunk, detail ? 7 : 5);
      const c = colour(species.crown);
      spheroid(mesh, 0, species.height * 0.66, 0, 0.56, 0.36, detail ? 9 : 6, detail ? 4 : 3, c, {
        squash: 0.1,
        tint: 0.3,
      });
      if (detail) {
        // Trailing branches, which is the whole point of a willow.
        for (let i = 0; i < 5; i++) {
          const angle = (i / 5) * Math.PI * 2;
          spheroid(
            mesh,
            Math.cos(angle) * 0.42,
            species.height * 0.44,
            Math.sin(angle) * 0.42,
            0.14,
            0.26,
            6,
            3,
            tone(c, -0.08),
          );
        }
      }
    },
  },
  {
    // Scots pine: a long bare bole and a flat dark head.
    name: 'pine',
    height: 2.6,
    trunk: '#6B4A33',
    crown: PALETTE.canopyPine,
    build(mesh, species, detail) {
      bole(mesh, species.height * 0.72, 0.055, species.trunk, detail ? 7 : 5);
      const c = colour(species.crown);
      spheroid(mesh, 0, species.height * 0.86, 0, 0.44, 0.3, detail ? 9 : 6, detail ? 4 : 3, c, {
        squash: 0.4,
        tint: 0.26,
      });
      if (detail) spheroid(mesh, 0, species.height * 0.7, 0, 0.32, 0.2, 7, 3, tone(c, -0.08), { squash: 0.45 });
    },
  },
];

const nearTemplates: (MeshBuilder | null)[] = new Array(TREE_VARIANTS).fill(null);
const farTemplates: (MeshBuilder | null)[] = new Array(TREE_VARIANTS).fill(null);

/**
 * The template mesh for a species, at full detail or at the reduced one
 * used for distant woodland. Built on first use and kept.
 */
export function treeTemplate(variant: number, detail: boolean): MeshBuilder {
  const index = ((variant % TREE_VARIANTS) + TREE_VARIANTS) % TREE_VARIANTS;
  const cache = detail ? nearTemplates : farTemplates;
  let mesh = cache[index];
  if (!mesh) {
    mesh = new MeshBuilder(detail ? 320 : 96, detail ? 640 : 192);
    const species = SPECIES[index];
    species.build(mesh, species, detail);
    cache[index] = mesh;
  }
  return mesh;
}

/** How tall a species stands at scale 1, for culling and shadow bounds. */
export function treeHeight(variant: number): number {
  return SPECIES[((variant % TREE_VARIANTS) + TREE_VARIANTS) % TREE_VARIANTS].height;
}

const propTemplates: (MeshBuilder | null)[] = new Array(PROP_VARIANTS).fill(null);

/**
 * Ground clutter: a fieldstone, a clump of thistle, a tuft of grass, fallen
 * wood, reeds, a chalk outcrop. Small, but it is what stops open ground
 * reading as a painted plane.
 */
export function propTemplate(variant: number): MeshBuilder {
  const index = ((variant % PROP_VARIANTS) + PROP_VARIANTS) % PROP_VARIANTS;
  let mesh = propTemplates[index];
  if (mesh) return mesh;
  mesh = new MeshBuilder(80, 160);
  switch (index) {
    case 0: {
      // A fieldstone, half buried.
      const stone = colour(PALETTE.chalkDark);
      spheroid(mesh, 0, 0.04, 0, 0.16, 0.1, 7, 3, stone, { squash: 0.4, tint: 0.12 });
      spheroid(mesh, 0.12, 0.02, 0.08, 0.08, 0.05, 6, 3, tone(stone, -0.06), { squash: 0.4 });
      break;
    }
    case 1: {
      // Thistle and ragwort.
      const stem = colour(PALETTE.grassDark);
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2;
        lathe(
          mesh,
          Math.cos(angle) * 0.05,
          Math.sin(angle) * 0.05,
          [
            { y: 0, radius: 0.018 },
            { y: 0.2, radius: 0.008 },
          ],
          4,
          stem,
          {},
        );
        spheroid(mesh, Math.cos(angle) * 0.05, 0.22, Math.sin(angle) * 0.05, 0.035, 0.04, 5, 2, colour('#7A6A8E'));
      }
      break;
    }
    case 2: {
      // A tuft of coarse grass.
      const blade = colour(PALETTE.grassLight);
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        lathe(
          mesh,
          Math.cos(angle) * 0.06,
          Math.sin(angle) * 0.06,
          [
            { y: 0, radius: 0.03 },
            { y: 0.14, radius: 0.004 },
          ],
          4,
          tone(blade, ((i % 3) - 1) * 0.08),
          {},
        );
      }
      break;
    }
    case 3: {
      // Fallen wood.
      const wood = colour(PALETTE.oakDark);
      lathe(
        mesh,
        0,
        0,
        [
          { y: 0.05, radius: 0.05 },
          { y: 0.055, radius: 0.045 },
        ],
        6,
        wood,
        { capTop: true, capBottom: true },
      );
      spheroid(mesh, 0.14, 0.04, 0.04, 0.1, 0.04, 6, 3, tone(wood, 0.06), { squash: 0.4 });
      break;
    }
    case 4: {
      // Reeds and flag iris at a water's edge.
      const reed = colour('#6E7A44');
      for (let i = 0; i < 7; i++) {
        const angle = (i / 7) * Math.PI * 2;
        const r = 0.04 + (i % 3) * 0.03;
        lathe(
          mesh,
          Math.cos(angle) * r,
          Math.sin(angle) * r,
          [
            { y: 0, radius: 0.022 },
            { y: 0.3 + (i % 3) * 0.07, radius: 0.004 },
          ],
          4,
          tone(reed, ((i % 3) - 1) * 0.07),
          {},
        );
      }
      break;
    }
    default: {
      // A chalk outcrop breaking the turf.
      const chalk = colour(PALETTE.chalk);
      spheroid(mesh, 0, 0.02, 0, 0.2, 0.07, 8, 3, chalk, { squash: 0.5, tint: 0.1 });
      spheroid(mesh, -0.1, 0.04, -0.08, 0.1, 0.06, 6, 3, tone(chalk, 0.05), { squash: 0.4 });
      break;
    }
  }
  propTemplates[index] = mesh;
  return mesh;
}

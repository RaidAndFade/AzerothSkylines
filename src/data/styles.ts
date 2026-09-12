/**
 * How each building in the catalogue is built.
 *
 * This is a table rather than forty bespoke model functions, which is what
 * keeps the town looking like one town. Heights are in world units, and one
 * world unit is one tile, so a cottage wall of 0.8 stands a little under a
 * tile high and a minster tower clears six.
 *
 * The vocabulary is English, around 1300: cruck and box frames infilled
 * with wattle and daub, limewashed if the owner can afford the lime; walls
 * of knapped flint or coursed rubble where there is stone to hand; ashlar
 * only on what the parish or the crown pays for. Roofs climb from wheat
 * straw through oak shingle and stone slate to clay tile and, at the very
 * top, lead. Upper floors oversail the street on a jetty, because ground
 * rent was charged on the footprint and nothing else.
 */
import { RoofSet } from '../render/palette';

/** What a wall is built of. */
export type WallMaterial =
  | 'daub'
  | 'limewash'
  | 'frame'
  | 'board'
  | 'flint'
  | 'rubble'
  | 'limestone'
  | 'none';

/** Extra structure or dressing a style carries. */
export type Feature =
  | 'chimney'
  | 'smokehood'
  | 'kiln'
  | 'banner'
  | 'sign'
  | 'porch'
  | 'fence'
  | 'hedge'
  | 'field'
  | 'crates'
  | 'waterwheel'
  | 'headframe'
  | 'spire'
  | 'tower'
  | 'crenellations'
  | 'awning'
  | 'stall'
  | 'well'
  | 'garden'
  | 'cross'
  | 'trough'
  | 'pier'
  | 'waggon'
  | 'arcade'
  | 'buttress'
  | 'rose'
  | 'brazier'
  | 'water'
  | 'lists'
  | 'pavilions'
  | 'dovecote'
  | 'ruin';

export interface BuildingStyle {
  wall: WallMaterial;
  roof: RoofSet;
  /**
   * `halfHip` is the hipped-and-gabled roof of an English barn; `gable` has
   * vertical ends; `hip` slopes on all four sides; `cone` is a round cap.
   */
  roofShape: 'gable' | 'hip' | 'halfHip' | 'cone' | 'flat' | 'none';
  /** Height of the wall plate above the floor, in world units. */
  wallHeight: number;
  /** Rise from the wall plate to the ridge. */
  roofHeight: number;
  /** An oversailing upper floor. */
  jetty?: boolean;
  /** How far the building is set back inside its plot, per side. */
  inset?: number;
  features: Feature[];
  /** Whether the windows are shuttered openings, mullions or church lights. */
  windows?: 'shutter' | 'mullion' | 'lancet' | 'none';
}

export const BUILDING_STYLES: Record<string, BuildingStyle> = {
  // --- Dwellings ----------------------------------------------------------
  // A one-bay cruck cottage, then a box-framed one, then a jettied burgage
  // house on the street, then a stone hall with a tiled roof.
  house1: { wall: 'daub', roof: 'thatch', roofShape: 'halfHip', wallHeight: 0.74, roofHeight: 0.84, inset: 0.22, features: ['smokehood', 'fence', 'garden'], windows: 'shutter' },
  house2: { wall: 'frame', roof: 'thatch', roofShape: 'gable', wallHeight: 1.0, roofHeight: 0.86, inset: 0.18, features: ['chimney', 'porch', 'fence'], windows: 'shutter' },
  house3: { wall: 'frame', roof: 'shingle', roofShape: 'gable', wallHeight: 1.6, roofHeight: 0.92, jetty: true, inset: 0.07, features: ['chimney', 'sign'], windows: 'mullion' },
  house4: { wall: 'limestone', roof: 'tile', roofShape: 'halfHip', wallHeight: 2.25, roofHeight: 1.1, inset: 0.12, features: ['chimney', 'porch', 'dovecote'], windows: 'mullion' },

  // --- Trade --------------------------------------------------------------
  shop1: { wall: 'board', roof: 'thatch', roofShape: 'gable', wallHeight: 0.5, roofHeight: 0.5, inset: 0.16, features: ['stall', 'awning', 'crates'] },
  shop2: { wall: 'frame', roof: 'shingle', roofShape: 'gable', wallHeight: 1.55, roofHeight: 0.84, jetty: true, inset: 0.1, features: ['sign', 'awning', 'stall'], windows: 'shutter' },
  shop3: { wall: 'frame', roof: 'tile', roofShape: 'gable', wallHeight: 1.7, roofHeight: 1.0, jetty: true, inset: 0.07, features: ['sign', 'banner', 'awning'], windows: 'mullion' },
  shop4: { wall: 'limestone', roof: 'tile', roofShape: 'hip', wallHeight: 2.5, roofHeight: 1.25, inset: 0.1, features: ['arcade', 'banner', 'sign'], windows: 'mullion' },

  // --- Farming ------------------------------------------------------------
  farm1: { wall: 'board', roof: 'thatch', roofShape: 'halfHip', wallHeight: 0.86, roofHeight: 1.0, inset: 0.2, features: ['field', 'fence', 'trough'] },
  farm2: { wall: 'board', roof: 'thatch', roofShape: 'halfHip', wallHeight: 1.1, roofHeight: 1.2, inset: 0.16, features: ['field', 'fence', 'crates', 'dovecote'] },
  farm3: { wall: 'frame', roof: 'thatch', roofShape: 'halfHip', wallHeight: 1.3, roofHeight: 1.3, inset: 0.14, features: ['field', 'hedge', 'crates', 'waggon'] },

  // --- Timber -------------------------------------------------------------
  timber1: { wall: 'board', roof: 'shingle', roofShape: 'gable', wallHeight: 0.78, roofHeight: 0.66, inset: 0.2, features: ['crates', 'fence'] },
  timber2: { wall: 'board', roof: 'shingle', roofShape: 'gable', wallHeight: 1.05, roofHeight: 0.8, inset: 0.16, features: ['waterwheel', 'crates'] },
  timber3: { wall: 'frame', roof: 'shingle', roofShape: 'halfHip', wallHeight: 1.4, roofHeight: 0.98, inset: 0.14, features: ['waterwheel', 'crates', 'chimney'] },

  // --- Mining -------------------------------------------------------------
  mine1: { wall: 'board', roof: 'thatch', roofShape: 'gable', wallHeight: 0.56, roofHeight: 0.4, inset: 0.2, features: ['headframe', 'crates'] },
  mine2: { wall: 'board', roof: 'shingle', roofShape: 'gable', wallHeight: 0.88, roofHeight: 0.62, inset: 0.18, features: ['headframe', 'crates', 'waggon'] },
  mine3: { wall: 'rubble', roof: 'stoneSlate', roofShape: 'gable', wallHeight: 1.2, roofHeight: 0.8, inset: 0.14, features: ['headframe', 'crates', 'kiln'] },

  // --- Crafting -----------------------------------------------------------
  craft1: { wall: 'rubble', roof: 'stoneSlate', roofShape: 'gable', wallHeight: 0.96, roofHeight: 0.7, inset: 0.18, features: ['smokehood', 'crates'], windows: 'shutter' },
  craft2: { wall: 'frame', roof: 'stoneSlate', roofShape: 'gable', wallHeight: 1.3, roofHeight: 0.86, inset: 0.14, features: ['chimney', 'crates', 'sign'], windows: 'shutter' },
  craft3: { wall: 'flint', roof: 'stoneSlate', roofShape: 'halfHip', wallHeight: 1.65, roofHeight: 1.0, inset: 0.12, features: ['kiln', 'chimney', 'crates'], windows: 'shutter' },

  // --- Water and drainage -------------------------------------------------
  well: { wall: 'rubble', roof: 'shingle', roofShape: 'none', wallHeight: 0, roofHeight: 0, features: ['well'] },
  cistern: { wall: 'limestone', roof: 'stoneSlate', roofShape: 'hip', wallHeight: 0.95, roofHeight: 0.5, inset: 0.18, features: ['arcade', 'water', 'trough'] },
  reservoir: { wall: 'limestone', roof: 'limestone', roofShape: 'flat', wallHeight: 0.7, roofHeight: 0.18, inset: 0.1, features: ['arcade', 'water', 'trough'] },
  cesspit: { wall: 'board', roof: 'thatch', roofShape: 'none', wallHeight: 0.3, roofHeight: 0, features: ['well', 'fence'] },
  canal: { wall: 'rubble', roof: 'limestone', roofShape: 'flat', wallHeight: 0.45, roofHeight: 0.1, inset: 0.04, features: ['arcade', 'water'] },
  sewerworks: { wall: 'flint', roof: 'stoneSlate', roofShape: 'hip', wallHeight: 1.1, roofHeight: 0.8, inset: 0.14, features: ['arcade', 'chimney', 'water'] },

  // --- The watch ----------------------------------------------------------
  guardpost: { wall: 'rubble', roof: 'stoneSlate', roofShape: 'cone', wallHeight: 1.9, roofHeight: 0.95, inset: 0.2, features: ['crenellations', 'brazier', 'tower'] },
  barracks: { wall: 'rubble', roof: 'stoneSlate', roofShape: 'halfHip', wallHeight: 1.6, roofHeight: 0.95, inset: 0.14, features: ['banner', 'crenellations'], windows: 'shutter' },
  garrison: { wall: 'limestone', roof: 'lead', roofShape: 'hip', wallHeight: 2.5, roofHeight: 1.3, inset: 0.12, features: ['banner', 'tower', 'crenellations', 'buttress'], windows: 'mullion' },

  // --- The church ---------------------------------------------------------
  shrine: { wall: 'limestone', roof: 'stoneSlate', roofShape: 'none', wallHeight: 0, roofHeight: 0, features: ['cross'] },
  chapel: { wall: 'limestone', roof: 'stoneSlate', roofShape: 'gable', wallHeight: 1.8, roofHeight: 1.0, inset: 0.16, features: ['spire', 'buttress', 'cross'], windows: 'lancet' },
  cathedral: { wall: 'limestone', roof: 'lead', roofShape: 'gable', wallHeight: 3.1, roofHeight: 1.6, inset: 0.1, features: ['spire', 'buttress', 'rose', 'banner'], windows: 'lancet' },

  // --- Merriment ----------------------------------------------------------
  garden: { wall: 'none', roof: 'thatch', roofShape: 'none', wallHeight: 0, roofHeight: 0, features: ['garden', 'hedge'] },
  fountain: { wall: 'limestone', roof: 'limestone', roofShape: 'none', wallHeight: 0, roofHeight: 0, features: ['cross', 'trough', 'garden'] },
  inn: { wall: 'frame', roof: 'thatch', roofShape: 'gable', wallHeight: 1.7, roofHeight: 1.0, jetty: true, inset: 0.09, features: ['sign', 'chimney', 'porch'], windows: 'mullion' },
  tourney: { wall: 'none', roof: 'thatch', roofShape: 'none', wallHeight: 0, roofHeight: 0, features: ['lists', 'pavilions', 'fence'] },
  keep: { wall: 'limestone', roof: 'lead', roofShape: 'hip', wallHeight: 3.4, roofHeight: 1.3, inset: 0.1, features: ['tower', 'banner', 'crenellations', 'buttress'], windows: 'lancet' },

  // --- Trade with the world ----------------------------------------------
  market: { wall: 'board', roof: 'shingle', roofShape: 'hip', wallHeight: 0.66, roofHeight: 0.66, inset: 0.12, features: ['stall', 'awning', 'crates', 'arcade'] },
  caravanserai: { wall: 'frame', roof: 'thatch', roofShape: 'halfHip', wallHeight: 1.25, roofHeight: 1.0, inset: 0.12, features: ['waggon', 'crates', 'banner', 'trough'] },
  docks: { wall: 'board', roof: 'shingle', roofShape: 'gable', wallHeight: 1.3, roofHeight: 0.85, inset: 0.14, features: ['pier', 'crates', 'waggon'] },
};

export const DEFAULT_STYLE: BuildingStyle = {
  wall: 'daub',
  roof: 'thatch',
  roofShape: 'gable',
  wallHeight: 0.9,
  roofHeight: 0.8,
  inset: 0.18,
  features: [],
  windows: 'shutter',
};

export function styleFor(defId: string): BuildingStyle {
  return BUILDING_STYLES[defId] ?? DEFAULT_STYLE;
}

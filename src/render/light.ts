/**
 * The lighting model.
 *
 * One sun, low in the west, warm; everything it misses is filled by cool
 * sky light. Tinting toward gold in the light and toward blue in shadow —
 * rather than simply lightening and darkening one hue — is what stops the
 * artwork reading as flat coloured card.
 */
import { clamp01 } from '../core/math';
import { hexToRgb, rgbToHex } from './palette';

/** Warm direct sunlight. */
const SUN_TINT = { r: 255, g: 232, b: 176 };
/** Cool light bounced from the sky into the shadows. */
const SKY_TINT = { r: 150, g: 176, b: 214 };
/** Warm light bounced back up off the ground. */
const BOUNCE_TINT = { r: 214, g: 190, b: 150 };
/**
 * How far the light is allowed to colour a material. At full strength white
 * stone comes out yellow in the sun and blue in shadow, which reads as two
 * different materials rather than one stone in two lights.
 */
const TINT_STRENGTH = 0.5;
/**
 * Pigment is pushed a little past life. Multiplying by a light tint pulls
 * colour toward grey, and a hand-painted look wants the opposite.
 */
const SATURATION = 1.18;

export interface Surface {
  /** How much direct sun the surface catches, 0..1. */
  sun: number;
  /** How much sky fills it, 0..1. Shadowed faces get more. */
  sky: number;
  /** Overall exposure; below 1 darkens, above 1 brightens. */
  exposure: number;
}

/**
 * The five orientations everything in the game is built from. The sun comes
 * from the upper left, so the south-west face is lit and the south-east
 * face falls away into sky-blue shadow.
 */
export const SURFACES = {
  /** A horizontal face: roofs, walkways, the ground. */
  top: { sun: 0.92, sky: 0.34, exposure: 1.06 },
  /** The south-west wall, turned toward the sun. */
  left: { sun: 0.68, sky: 0.3, exposure: 0.93 },
  /** The south-east wall, turned away from it. */
  right: { sun: 0.22, sky: 0.56, exposure: 0.78 },
  /** A face in full shadow — under an eave, inside an arch. */
  shadow: { sun: 0, sky: 0.7, exposure: 0.55 },
  /** A roof slope angled steeply into the sun. */
  bright: { sun: 1, sky: 0.26, exposure: 1.16 },
} as const satisfies Record<string, Surface>;

export type SurfaceName = keyof typeof SURFACES;

const cache = new Map<string, string>();

/**
 * Light a base colour for a given surface. Results are cached because the
 * palette is small and this is called from drawing code.
 */
export function light(base: string, surface: SurfaceName | Surface, extra = 0): string {
  const spec = typeof surface === 'string' ? SURFACES[surface] : surface;
  const key = `${base}|${spec.sun}|${spec.sky}|${spec.exposure}|${extra}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const { r, g, b } = hexToRgb(base);
  const exposure = spec.exposure + extra;

  // Direct sun and sky fill are both multiplicative tints, mixed by weight,
  // then scaled by exposure. Keeping them multiplicative preserves the hue
  // of the material instead of washing it toward the light colour.
  const [tintR, tintG, tintB] = tintFor(spec);

  const result = rgbToHex(...saturate(r * tintR * exposure, g * tintG * exposure, b * tintB * exposure));
  cache.set(key, result);
  return result;
}

/** Ground bounce, for the undersides of eaves and the feet of walls. */
export function bounced(base: string, amount = 0.5): string {
  const { r, g, b } = hexToRgb(base);
  return rgbToHex(
    clamp255(r * (1 - amount) + BOUNCE_TINT.r * amount * 0.45),
    clamp255(g * (1 - amount) + BOUNCE_TINT.g * amount * 0.45),
    clamp255(b * (1 - amount) + BOUNCE_TINT.b * amount * 0.45),
  );
}

/** The colour of the light falling on a surface, pulled back toward white. */
function tintFor(spec: Surface): [number, number, number] {
  const total = spec.sun + spec.sky || 1;
  const raw = [
    (SUN_TINT.r * spec.sun + SKY_TINT.r * spec.sky) / total / 255,
    (SUN_TINT.g * spec.sun + SKY_TINT.g * spec.sky) / total / 255,
    (SUN_TINT.b * spec.sun + SKY_TINT.b * spec.sky) / total / 255,
  ];
  return [
    1 + (raw[0] - 1) * TINT_STRENGTH,
    1 + (raw[1] - 1) * TINT_STRENGTH,
    1 + (raw[2] - 1) * TINT_STRENGTH,
  ];
}

function clamp255(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

/** Light applied to a raw colour triple, for per-pixel work. */
export function lightRgb(
  r: number,
  g: number,
  b: number,
  surface: SurfaceName | Surface,
  extra = 0,
): [number, number, number] {
  const spec = typeof surface === 'string' ? SURFACES[surface] : surface;
  const exposure = spec.exposure + extra;
  const [tintR, tintG, tintB] = tintFor(spec);
  return saturate(r * tintR * exposure, g * tintG * exposure, b * tintB * exposure);
}

/** Push colour away from grey, then clamp. */
function saturate(r: number, g: number, b: number): [number, number, number] {
  const luma = r * 0.3 + g * 0.59 + b * 0.11;
  return [
    clamp255(luma + (r - luma) * SATURATION),
    clamp255(luma + (g - luma) * SATURATION),
    clamp255(luma + (b - luma) * SATURATION),
  ];
}

/** Direction the sun casts shadows, in screen pixels per unit of height. */
export const SHADOW_OFFSET = { x: 0.42, y: 0.2 };
export const SHADOW_COLOR = 'rgba(38, 44, 68, 0.22)';

export { clamp01 };

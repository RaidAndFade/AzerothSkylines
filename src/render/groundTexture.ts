/**
 * The painted ground.
 *
 * Filling one flat diamond per tile puts the grid on screen: neighbouring
 * tiles sit in visibly different blocks of colour with hard seams between
 * them. Instead the whole valley is baked once into a map-space colour
 * field, which the renderer samples with a single affine transform per
 * region of level ground. Because the field is interpolated, the colour
 * runs continuously across tile boundaries and the grid disappears.
 *
 * The field only has to carry broad colour; fine grain is added at screen
 * resolution as a world-anchored pattern, so it stays crisp at every zoom
 * without needing a huge bitmap.
 */
import { Terrain } from '../sim/types';
import { CityState } from '../sim/city';
import { MAX_ELEVATION } from '../sim/terrain';
import { PALETTE, hexToRgb } from './palette';
import { lightRgb } from './light';
import { Rng } from '../core/rng';
import { clamp01, lerp } from '../core/math';

/** Pixels per tile in the baked colour field. The field is smooth, so this
 *  can stay small: sharpness comes from the detail pattern drawn over it. */
export const FIELD_SCALE = 8;
/** Edge of the repeating grain tile, in pixels. */
const GRAIN_SIZE = 192;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Two ends of a colour range for each terrain class. */
const TERRAIN_RANGE: Record<number, [Rgb, Rgb]> = {
  [Terrain.DeepWater]: [hexToRgb('#123E63'), hexToRgb('#1D5C87')],
  [Terrain.ShallowWater]: [hexToRgb('#2E7FA8'), hexToRgb('#57B4CE')],
  [Terrain.Sand]: [hexToRgb('#C9B07C'), hexToRgb('#E3D2A5')],
  [Terrain.Grass]: [hexToRgb('#5E9337'), hexToRgb('#86BC52')],
  [Terrain.Meadow]: [hexToRgb('#7BB047'), hexToRgb('#A6D169')],
  [Terrain.Forest]: [hexToRgb('#3B6B2C'), hexToRgb('#54893A')],
  [Terrain.Rock]: [hexToRgb('#6E6960'), hexToRgb('#A49C90')],
  [Terrain.Snow]: [hexToRgb('#C9D2D8'), hexToRgb('#F2F4F2')],
};

export interface GroundField {
  /** The baked colour field, FIELD_SCALE pixels per tile. */
  canvas: HTMLCanvasElement;
  scale: number;
  /** Repeating grain, drawn over the ground at screen resolution. */
  grain: HTMLCanvasElement;
}

/**
 * Bake the colour field for a valley. Called once when a city is created,
 * and again only if the terrain itself changes.
 */
export function buildGroundField(city: CityState): GroundField {
  const { width, height } = city;

  // 1. One pixel per tile, which is all the resolution the colour needs.
  const small = document.createElement('canvas');
  small.width = width;
  small.height = height;
  const smallCtx = small.getContext('2d');
  if (!smallCtx) throw new Error('2D canvas is unavailable');
  const image = smallCtx.createImageData(width, height);
  const data = image.data;

  const heights = city.map.heightField;
  const moisture = city.map.moisture;
  const terrain = city.map.terrain;
  const elevation = city.map.elevation;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const kind = terrain[index] as Terrain;
      const range = TERRAIN_RANGE[kind] ?? TERRAIN_RANGE[Terrain.Grass];

      // Where the tile sits within its class's colour range. Moisture and
      // height do the work a noise function would, and they are already
      // continuous across the map.
      const wetness = moisture[index];
      const lift = elevation[index] / MAX_ELEVATION;
      let t = clamp01(0.34 + wetness * 0.46 - lift * 0.22);
      if (kind === Terrain.DeepWater || kind === Terrain.ShallowWater) {
        // Deeper water reads darker; the shallows catch the sky.
        t = clamp01(1 - (0.36 - heights[index]) * 8);
      }

      let r = lerp(range[0].r, range[1].r, t);
      let g = lerp(range[0].g, range[1].g, t);
      let b = lerp(range[0].b, range[1].b, t);

      // Slope shading off the continuous height field: hillsides facing the
      // sun catch it, the far sides fall into shadow. This is what gives
      // the valley its form once the tile grid is gone.
      const west = heights[index - (x > 0 ? 1 : 0)];
      const east = heights[index + (x < width - 1 ? 1 : 0)];
      const north = heights[index - (y > 0 ? width : 0)];
      const south = heights[index + (y < height - 1 ? width : 0)];
      const slope = (west - east) * 0.5 + (north - south) * 0.5;
      const facing = clamp01(0.5 + slope * 7);

      const [lr, lg, lb] = lightRgb(r, g, b, 'top', (facing - 0.5) * 0.34);
      r = lr;
      g = lg;
      b = lb;

      const offset = index * 4;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = 255;
    }
  }
  smallCtx.putImageData(image, 0, 0);

  // 2. Upscale with smoothing. The interpolation is the whole point: it
  //    turns per-tile colours into a continuous field.
  const canvas = document.createElement('canvas');
  canvas.width = width * FIELD_SCALE;
  canvas.height = height * FIELD_SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, width, height, 0, 0, canvas.width, canvas.height);

  return { canvas, scale: FIELD_SCALE, grain: buildGrain(city.map.seed) };
}

/**
 * A seamless scatter of soft marks, drawn over the ground to break up the
 * smoothness with something that looks brushed rather than computed.
 *
 * The tile is transparent apart from the marks themselves, so it can be laid
 * down with ordinary alpha compositing. A blend mode would read better on
 * paper, but full-screen `overlay` costs more per frame than the extra
 * subtlety is worth.
 */
function buildGrain(seed: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = GRAIN_SIZE;
  canvas.height = GRAIN_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is unavailable');
  const rng = new Rng(seed ^ 0x6d5a1f);

  // Broad tonal patches first, then finer speckle over them. Every mark is
  // drawn nine times so the tile repeats without a visible edge.
  const marks: { radius: number; count: number; strength: number }[] = [
    { radius: 34, count: 26, strength: 0.16 },
    { radius: 14, count: 70, strength: 0.13 },
    { radius: 5, count: 190, strength: 0.11 },
    { radius: 2, count: 320, strength: 0.1 },
  ];

  for (const mark of marks) {
    for (let i = 0; i < mark.count; i++) {
      const x = rng.next() * GRAIN_SIZE;
      const y = rng.next() * GRAIN_SIZE;
      const tone = rng.next() < 0.5 ? 0 : 255;
      const alpha = mark.strength * (0.4 + rng.next() * 0.6);
      for (let wrapY = -1; wrapY <= 1; wrapY++) {
        for (let wrapX = -1; wrapX <= 1; wrapX++) {
          const cx = x + wrapX * GRAIN_SIZE;
          const cy = y + wrapY * GRAIN_SIZE;
          if (cx < -mark.radius || cx > GRAIN_SIZE + mark.radius) continue;
          if (cy < -mark.radius || cy > GRAIN_SIZE + mark.radius) continue;
          const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, mark.radius);
          gradient.addColorStop(0, `rgba(${tone}, ${tone}, ${tone}, ${alpha})`);
          gradient.addColorStop(1, `rgba(${tone}, ${tone}, ${tone}, 0)`);
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(cx, cy, mark.radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
  return canvas;
}

/** Cliff colours, warm rock and earth rather than a darkened grass. */
export const CLIFF_BASE: Record<number, string> = {
  [Terrain.Sand]: '#B49A6A',
  [Terrain.Grass]: '#8A7048',
  [Terrain.Meadow]: '#8A7048',
  [Terrain.Forest]: '#6E5836',
  [Terrain.Rock]: '#736C61',
  [Terrain.Snow]: '#9AA0A4',
  [Terrain.DeepWater]: '#123E63',
  [Terrain.ShallowWater]: '#2E7FA8',
};

export { PALETTE };

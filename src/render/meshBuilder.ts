/**
 * The geometry kit.
 *
 * Everything in the valley — ground, roofs, tree crowns, cart wheels — is
 * assembled here from a handful of primitives into one interleaved vertex
 * buffer per batch. The primitives are deliberately round-shouldered: rings
 * and lathes rather than boxes, smooth normals rather than faceted ones,
 * because a town built out of cubes reads as a diagram rather than a place.
 */
import { VERTEX_FLOATS } from './glx';
import { hexToRgb } from './palette';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Vec {
  x: number;
  y: number;
  z: number;
}

/** Parse and cache '#rrggbb' as linear-ish floats, since colours repeat a lot. */
const colourCache = new Map<string, Rgb>();

export function colour(hex: string): Rgb {
  let value = colourCache.get(hex);
  if (!value) {
    const { r, g, b } = hexToRgb(hex);
    // sRGB to linear, so lighting adds up the way it does outdoors.
    const toLinear = (c: number): number => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    value = { r: toLinear(r), g: toLinear(g), b: toLinear(b) };
    colourCache.set(hex, value);
  }
  return value;
}

/** Shift a colour toward white or black, in linear space. */
export function tone(base: Rgb, amount: number): Rgb {
  if (amount >= 0) {
    return {
      r: base.r + (1 - base.r) * amount,
      g: base.g + (1 - base.g) * amount,
      b: base.b + (1 - base.b) * amount,
    };
  }
  const factor = 1 + amount;
  return { r: base.r * factor, g: base.g * factor, b: base.b * factor };
}

export function blend(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

/**
 * A growable vertex and index store.
 *
 * Vertices carry a position, a normal, a colour and an occlusion factor —
 * how much of the sky the point can see — which is what keeps eaves,
 * doorways and the undersides of things from glowing.
 */
export class MeshBuilder {
  private vertices: Float32Array;
  private indices: Uint32Array;
  private vertexCount = 0;
  private indexCount = 0;

  minX = Infinity;
  minY = Infinity;
  minZ = Infinity;
  maxX = -Infinity;
  maxY = -Infinity;
  maxZ = -Infinity;

  constructor(vertexCapacity = 512, indexCapacity = 1024) {
    this.vertices = new Float32Array(vertexCapacity * VERTEX_FLOATS);
    this.indices = new Uint32Array(indexCapacity);
  }

  get isEmpty(): boolean {
    return this.indexCount === 0;
  }

  reset(): void {
    this.vertexCount = 0;
    this.indexCount = 0;
    this.minX = this.minY = this.minZ = Infinity;
    this.maxX = this.maxY = this.maxZ = -Infinity;
  }

  vertex(
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    c: Rgb,
    occlusion = 1,
  ): number {
    if ((this.vertexCount + 1) * VERTEX_FLOATS > this.vertices.length) {
      const grown = new Float32Array(this.vertices.length * 2);
      grown.set(this.vertices);
      this.vertices = grown;
    }
    let at = this.vertexCount * VERTEX_FLOATS;
    const v = this.vertices;
    v[at++] = x;
    v[at++] = y;
    v[at++] = z;
    v[at++] = nx;
    v[at++] = ny;
    v[at++] = nz;
    v[at++] = c.r;
    v[at++] = c.g;
    v[at++] = c.b;
    v[at++] = occlusion;

    if (x < this.minX) this.minX = x;
    if (y < this.minY) this.minY = y;
    if (z < this.minZ) this.minZ = z;
    if (x > this.maxX) this.maxX = x;
    if (y > this.maxY) this.maxY = y;
    if (z > this.maxZ) this.maxZ = z;
    return this.vertexCount++;
  }

  /**
   * A triangle, its vertices given **clockwise as seen from the front** —
   * the side that faces out of a wall, or up off the ground. That is the
   * convention every primitive in this file and every caller uses; the
   * reversal to the anticlockwise order the GPU wants happens here, once.
   */
  triangle(a: number, b: number, c: number): void {
    if (this.indexCount + 3 > this.indices.length) {
      const grown = new Uint32Array(this.indices.length * 2);
      grown.set(this.indices);
      this.indices = grown;
    }
    this.indices[this.indexCount++] = a;
    this.indices[this.indexCount++] = c;
    this.indices[this.indexCount++] = b;
  }

  quadIndices(a: number, b: number, c: number, d: number): void {
    this.triangle(a, b, c);
    this.triangle(a, c, d);
  }

  /** A flat quad, wound anticlockwise seen from the side the normal faces. */
  quad(p0: Vec, p1: Vec, p2: Vec, p3: Vec, c: Rgb, occlusion: number | number[] = 1): void {
    const nx = faceNormal(p0, p1, p2);
    const occ = Array.isArray(occlusion) ? occlusion : [occlusion, occlusion, occlusion, occlusion];
    const a = this.vertex(p0.x, p0.y, p0.z, nx.x, nx.y, nx.z, c, occ[0]);
    const b = this.vertex(p1.x, p1.y, p1.z, nx.x, nx.y, nx.z, c, occ[1]);
    const d = this.vertex(p2.x, p2.y, p2.z, nx.x, nx.y, nx.z, c, occ[2]);
    const e = this.vertex(p3.x, p3.y, p3.z, nx.x, nx.y, nx.z, c, occ[3]);
    this.quadIndices(a, b, d, e);
  }

  /** A flat triangle. */
  tri(p0: Vec, p1: Vec, p2: Vec, c: Rgb, occlusion = 1): void {
    const n = faceNormal(p0, p1, p2);
    const a = this.vertex(p0.x, p0.y, p0.z, n.x, n.y, n.z, c, occlusion);
    const b = this.vertex(p1.x, p1.y, p1.z, n.x, n.y, n.z, c, occlusion);
    const d = this.vertex(p2.x, p2.y, p2.z, n.x, n.y, n.z, c, occlusion);
    this.triangle(a, b, d);
  }

  /** A convex fan, for polygon caps. */
  fan(points: Vec[], c: Rgb, normal: Vec, occlusion = 1): void {
    if (points.length < 3) return;
    const first = this.vertex(
      points[0].x, points[0].y, points[0].z, normal.x, normal.y, normal.z, c, occlusion,
    );
    let previous = this.vertex(
      points[1].x, points[1].y, points[1].z, normal.x, normal.y, normal.z, c, occlusion,
    );
    for (let i = 2; i < points.length; i++) {
      const next = this.vertex(
        points[i].x, points[i].y, points[i].z, normal.x, normal.y, normal.z, c, occlusion,
      );
      this.triangle(first, previous, next);
      previous = next;
    }
  }

  /** Copy another builder's geometry in, offset by a position. */
  append(other: MeshBuilder, dx = 0, dy = 0, dz = 0): void {
    const base = this.vertexCount;
    const source = other.vertices;
    for (let i = 0; i < other.vertexCount; i++) {
      const at = i * VERTEX_FLOATS;
      this.vertex(
        source[at] + dx,
        source[at + 1] + dy,
        source[at + 2] + dz,
        source[at + 3],
        source[at + 4],
        source[at + 5],
        { r: source[at + 6], g: source[at + 7], b: source[at + 8] },
        source[at + 9],
      );
    }
    for (let i = 0; i + 2 < other.indexCount; i += 3) {
      this.triangle(
        other.indices[i] + base,
        other.indices[i + 1] + base,
        other.indices[i + 2] + base,
      );
    }
  }

  /**
   * Copy another builder in, rotated about the vertical axis and scaled.
   * This is how one oak becomes a wood.
   */
  appendTransformed(
    other: MeshBuilder,
    dx: number,
    dy: number,
    dz: number,
    yaw: number,
    scale: number,
    tint: number = 0,
  ): void {
    const base = this.vertexCount;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const source = other.vertices;
    for (let i = 0; i < other.vertexCount; i++) {
      const at = i * VERTEX_FLOATS;
      const px = source[at] * scale;
      const py = source[at + 1] * scale;
      const pz = source[at + 2] * scale;
      const nx = source[at + 3];
      const ny = source[at + 4];
      const nz = source[at + 5];
      let c: Rgb = { r: source[at + 6], g: source[at + 7], b: source[at + 8] };
      if (tint !== 0) c = tone(c, tint);
      this.vertex(
        dx + px * cos + pz * sin,
        dy + py,
        dz + pz * cos - px * sin,
        nx * cos + nz * sin,
        ny,
        nz * cos - nx * sin,
        c,
        source[at + 9],
      );
    }
    for (let i = 0; i + 2 < other.indexCount; i += 3) {
      this.triangle(
        other.indices[i] + base,
        other.indices[i + 1] + base,
        other.indices[i + 2] + base,
      );
    }
  }

  vertexData(): Float32Array {
    return this.vertices.subarray(0, this.vertexCount * VERTEX_FLOATS);
  }

  indexData(): Uint32Array {
    return this.indices.subarray(0, this.indexCount);
  }
}

/**
 * The outward normal of a face whose vertices run clockwise seen from the
 * front — so the cross product is taken the other way round from the usual
 * anticlockwise convention.
 */
export function faceNormal(p0: Vec, p1: Vec, p2: Vec): Vec {
  const ax = p2.x - p0.x;
  const ay = p2.y - p0.y;
  const az = p2.z - p0.z;
  const bx = p1.x - p0.x;
  const by = p1.y - p0.y;
  const bz = p1.z - p0.z;
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const length = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / length, y: ny / length, z: nz / length };
}

const point = (x: number, y: number, z: number): Vec => ({ x, y, z });
export { point };

// --- primitives -------------------------------------------------------------

export interface BoxOptions {
  /** Shrink the top face relative to the bottom, for a battered wall. */
  taper?: number;
  /** Darken the colour of the top and bottom caps. */
  capTint?: number;
  /** Leave the bottom face off, when it is buried anyway. */
  skipBottom?: boolean;
  skipTop?: boolean;
  /** Occlusion at the foot, where light does not reach. */
  footOcclusion?: number;
  yaw?: number;
}

/**
 * A rectangular block standing on the ground, optionally battered and
 * turned. Corners are shaded down a little so the form reads even when a
 * wall faces away from the sun.
 */
export function box(
  mesh: MeshBuilder,
  cx: number,
  baseY: number,
  cz: number,
  width: number,
  height: number,
  depth: number,
  c: Rgb,
  options: BoxOptions = {},
): void {
  const taper = options.taper ?? 0;
  const yaw = options.yaw ?? 0;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const foot = options.footOcclusion ?? 0.62;
  const topY = baseY + height;

  const at = (ox: number, oz: number, y: number): Vec =>
    point(cx + ox * cos + oz * sin, y, cz + oz * cos - ox * sin);

  const hw = width / 2;
  const hd = depth / 2;
  const tw = hw * (1 - taper);
  const td = hd * (1 - taper);

  const b0 = at(-hw, -hd, baseY);
  const b1 = at(hw, -hd, baseY);
  const b2 = at(hw, hd, baseY);
  const b3 = at(-hw, hd, baseY);
  const t0 = at(-tw, -td, topY);
  const t1 = at(tw, -td, topY);
  const t2 = at(tw, td, topY);
  const t3 = at(-tw, td, topY);

  const side = [foot, foot, 1, 1];
  mesh.quad(b0, b1, t1, t0, c, side);
  mesh.quad(b1, b2, t2, t1, c, side);
  mesh.quad(b2, b3, t3, t2, c, side);
  mesh.quad(b3, b0, t0, t3, c, side);
  if (!options.skipTop) mesh.quad(t0, t1, t2, t3, tone(c, options.capTint ?? 0.04), 1);
  if (!options.skipBottom) mesh.quad(b3, b2, b1, b0, tone(c, -0.4), foot);
}

/**
 * A lathe: a ring of `sides` points swept up through a list of radii, with
 * normals averaged around the ring so it reads as a turned surface rather
 * than a prism. Trunks, towers, barrels, well-heads and tree crowns are all
 * this shape with different profiles.
 */
export function lathe(
  mesh: MeshBuilder,
  cx: number,
  cz: number,
  profile: { y: number; radius: number }[],
  sides: number,
  c: Rgb,
  options: { capTop?: boolean; capBottom?: boolean; tintByHeight?: number; occlusionFoot?: number } = {},
): void {
  if (profile.length < 2) return;
  const rings: number[][] = [];
  const foot = options.occlusionFoot ?? 0.7;
  const lowest = profile[0].y;
  const highest = profile[profile.length - 1].y;
  const span = Math.max(1e-4, highest - lowest);

  for (let p = 0; p < profile.length; p++) {
    const ring: number[] = [];
    const { y, radius } = profile[p];
    // Slope of the profile, so the normal leans with the surface.
    const before = profile[Math.max(0, p - 1)];
    const after = profile[Math.min(profile.length - 1, p + 1)];
    const dr = after.radius - before.radius;
    const dy = after.y - before.y;
    const nLength = Math.hypot(dy, -dr) || 1;
    const ny = -dr / nLength;
    const nRadial = dy / nLength;
    const lift = (y - lowest) / span;
    const shade = options.tintByHeight ? tone(c, options.tintByHeight * (lift - 0.5)) : c;
    const occlusion = foot + (1 - foot) * Math.min(1, lift * 1.6);

    for (let s = 0; s < sides; s++) {
      const angle = (s / sides) * Math.PI * 2;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      ring.push(
        mesh.vertex(
          cx + dx * radius,
          y,
          cz + dz * radius,
          dx * nRadial,
          ny,
          dz * nRadial,
          shade,
          occlusion,
        ),
      );
    }
    rings.push(ring);
  }

  for (let p = 0; p + 1 < rings.length; p++) {
    const lower = rings[p];
    const upper = rings[p + 1];
    for (let s = 0; s < sides; s++) {
      const next = (s + 1) % sides;
      mesh.quadIndices(lower[s], lower[next], upper[next], upper[s]);
    }
  }

  if (options.capTop) {
    const top = profile[profile.length - 1];
    const points: Vec[] = [];
    for (let s = 0; s < sides; s++) {
      const angle = (s / sides) * Math.PI * 2;
      points.push(point(cx + Math.cos(angle) * top.radius, top.y, cz + Math.sin(angle) * top.radius));
    }
    mesh.fan(points, tone(c, 0.05), point(0, 1, 0), 1);
  }
  if (options.capBottom) {
    const bottom = profile[0];
    const points: Vec[] = [];
    for (let s = sides - 1; s >= 0; s--) {
      const angle = (s / sides) * Math.PI * 2;
      points.push(point(cx + Math.cos(angle) * bottom.radius, bottom.y, cz + Math.sin(angle) * bottom.radius));
    }
    mesh.fan(points, tone(c, -0.35), point(0, -1, 0), foot);
  }
}

/** A smooth-shaded spheroid, the shape every tree crown is built from. */
export function spheroid(
  mesh: MeshBuilder,
  cx: number,
  cy: number,
  cz: number,
  radiusX: number,
  radiusY: number,
  sides: number,
  rings: number,
  c: Rgb,
  options: { squash?: number; tint?: number } = {},
): void {
  const profile: { y: number; radius: number }[] = [];
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const angle = -Math.PI / 2 + t * Math.PI;
    profile.push({ y: cy + Math.sin(angle) * radiusY, radius: Math.cos(angle) * radiusX });
  }
  // Flatten the poles slightly so the crown sits rather than balloons.
  const squash = options.squash ?? 0;
  if (squash > 0) {
    profile[0].y += radiusY * squash;
    profile[profile.length - 1].y -= radiusY * squash * 0.5;
  }
  lathe(mesh, cx, cz, profile, sides, c, { tintByHeight: options.tint ?? 0.16, occlusionFoot: 0.5 });
}

/**
 * A ridged roof over a rectangular plan.
 *
 * `hip` runs from 0 for a gable — vertical ends, the ridge the full length
 * of the building — to 1 for a full hip, where the ridge shrinks to a point
 * and all four sides slope. Both have overhanging eaves, because a roof
 * that stops flush with the wall is the surest way to make a house look
 * like a box with a lid.
 */
export function ridgedRoof(
  mesh: MeshBuilder,
  cx: number,
  eaveY: number,
  cz: number,
  width: number,
  depth: number,
  height: number,
  hip: number,
  c: Rgb,
  options: { yaw?: number; overhang?: number; ridgeColour?: Rgb; gableColour?: Rgb } = {},
): void {
  const yaw = options.yaw ?? 0;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const overhang = options.overhang ?? 0.11;
  const hw = width / 2 + overhang;
  const hd = depth / 2 + overhang;
  const ridgeY = eaveY + height;
  // The ridge runs along the long axis, as a roof drains best across the
  // short one.
  const alongX = width >= depth;
  const ridgeHalf = (alongX ? hw : hd) * (1 - hip) * 0.92;

  const at = (ox: number, oz: number, y: number): Vec =>
    point(cx + ox * cos + oz * sin, y, cz + oz * cos - ox * sin);

  const e0 = at(-hw, -hd, eaveY);
  const e1 = at(hw, -hd, eaveY);
  const e2 = at(hw, hd, eaveY);
  const e3 = at(-hw, hd, eaveY);

  const gable = options.gableColour ?? tone(c, -0.16);
  const eaveOcclusion = 0.72;

  if (alongX) {
    const r0 = at(-ridgeHalf, 0, ridgeY);
    const r1 = at(ridgeHalf, 0, ridgeY);
    mesh.quad(e0, e1, r1, r0, c, [eaveOcclusion, eaveOcclusion, 1, 1]);
    mesh.quad(e2, e3, r0, r1, tone(c, -0.06), [eaveOcclusion, eaveOcclusion, 1, 1]);
    if (hip > 0.001) {
      mesh.tri(e1, e2, r1, tone(c, -0.03), 0.85);
      mesh.tri(e3, e0, r0, tone(c, -0.03), 0.85);
    } else {
      // Vertical gable ends, in the wall's own material.
      mesh.tri(e1, e2, r1, gable, 0.8);
      mesh.tri(e3, e0, r0, gable, 0.8);
    }
    if (options.ridgeColour) {
      capRidge(mesh, r0, r1, options.ridgeColour, overhang);
    }
  } else {
    const r0 = at(0, -ridgeHalf, ridgeY);
    const r1 = at(0, ridgeHalf, ridgeY);
    mesh.quad(e1, e2, r1, r0, c, [eaveOcclusion, eaveOcclusion, 1, 1]);
    mesh.quad(e3, e0, r0, r1, tone(c, -0.06), [eaveOcclusion, eaveOcclusion, 1, 1]);
    if (hip > 0.001) {
      mesh.tri(e2, e3, r1, tone(c, -0.03), 0.85);
      mesh.tri(e0, e1, r0, tone(c, -0.03), 0.85);
    } else {
      mesh.tri(e2, e3, r1, gable, 0.8);
      mesh.tri(e0, e1, r0, gable, 0.8);
    }
    if (options.ridgeColour) {
      capRidge(mesh, r0, r1, options.ridgeColour, overhang);
    }
  }
}

/** A rounded cap along the ridge line: clay ridge tiles, or a straw bolster. */
function capRidge(mesh: MeshBuilder, a: Vec, b: Vec, c: Rgb, size: number): void {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-4) return;
  const ux = -dz / length;
  const uz = dx / length;
  const r = Math.max(0.05, size * 0.9);
  const steps = 5;
  const rings: Vec[][] = [];
  for (const end of [a, b]) {
    const ring: Vec[] = [];
    for (let s = 0; s <= steps; s++) {
      const angle = (s / steps) * Math.PI;
      ring.push(point(end.x + ux * Math.cos(angle) * r, end.y + Math.sin(angle) * r * 0.85, end.z + uz * Math.cos(angle) * r));
    }
    rings.push(ring);
  }
  for (let s = 0; s < steps; s++) {
    mesh.quad(rings[0][s], rings[0][s + 1], rings[1][s + 1], rings[1][s], c, 0.95);
  }
}

/** A cone: spires, oast caps, the tops of round towers. */
export function cone(
  mesh: MeshBuilder,
  cx: number,
  baseY: number,
  cz: number,
  radius: number,
  height: number,
  sides: number,
  c: Rgb,
): void {
  lathe(
    mesh,
    cx,
    cz,
    [
      { y: baseY, radius },
      { y: baseY + height * 0.55, radius: radius * 0.45 },
      { y: baseY + height, radius: 0.008 },
    ],
    sides,
    c,
    { tintByHeight: 0.18, occlusionFoot: 0.8 },
  );
}

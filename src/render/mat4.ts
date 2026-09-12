/**
 * The small amount of linear algebra the renderer needs.
 *
 * Matrices are column-major `Float32Array`s of sixteen elements, which is
 * the layout `uniformMatrix4fv` wants, so nothing is transposed on the way
 * to the GPU.
 */

export type Mat4 = Float32Array;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function mat4(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function identity(out: Mat4): Mat4 {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  return out;
}

/** Right-handed perspective projection with a depth range of [-1, 1]. */
export function perspective(out: Mat4, fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

/** Right-handed orthographic projection, used for the shadow pass. */
export function ortho(
  out: Mat4,
  left: number,
  right: number,
  bottom: number,
  top: number,
  near: number,
  far: number,
): Mat4 {
  out.fill(0);
  out[0] = 2 / (right - left);
  out[5] = 2 / (top - bottom);
  out[10] = -2 / (far - near);
  out[12] = -(right + left) / (right - left);
  out[13] = -(top + bottom) / (top - bottom);
  out[14] = -(far + near) / (far - near);
  out[15] = 1;
  return out;
}

export function lookAt(out: Mat4, eye: Vec3, centre: Vec3, up: Vec3): Mat4 {
  let zx = eye.x - centre.x;
  let zy = eye.y - centre.y;
  let zz = eye.z - centre.z;
  let length = Math.hypot(zx, zy, zz) || 1;
  zx /= length;
  zy /= length;
  zz /= length;

  let xx = up.y * zz - up.z * zy;
  let xy = up.z * zx - up.x * zz;
  let xz = up.x * zy - up.y * zx;
  length = Math.hypot(xx, xy, xz);
  if (length < 1e-6) {
    // Looking straight down: any horizontal axis will do.
    xx = 1;
    xy = 0;
    xz = 0;
  } else {
    xx /= length;
    xy /= length;
    xz /= length;
  }

  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  out[0] = xx;
  out[1] = yx;
  out[2] = zx;
  out[3] = 0;
  out[4] = xy;
  out[5] = yy;
  out[6] = zy;
  out[7] = 0;
  out[8] = xz;
  out[9] = yz;
  out[10] = zz;
  out[11] = 0;
  out[12] = -(xx * eye.x + xy * eye.y + xz * eye.z);
  out[13] = -(yx * eye.x + yy * eye.y + yz * eye.z);
  out[14] = -(zx * eye.x + zy * eye.y + zz * eye.z);
  out[15] = 1;
  return out;
}

export function multiply(out: Mat4, a: Mat4, b: Mat4): Mat4 {
  for (let column = 0; column < 4; column++) {
    const b0 = b[column * 4];
    const b1 = b[column * 4 + 1];
    const b2 = b[column * 4 + 2];
    const b3 = b[column * 4 + 3];
    out[column * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[column * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[column * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[column * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

/** Project a point, returning normalised device coordinates and its w. */
export function transformPoint(
  m: Mat4,
  x: number,
  y: number,
  z: number,
): { x: number; y: number; z: number; w: number } {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return {
    x: m[0] * x + m[4] * y + m[8] * z + m[12],
    y: m[1] * x + m[5] * y + m[9] * z + m[13],
    z: m[2] * x + m[6] * y + m[10] * z + m[14],
    w,
  };
}

export function normalise(v: Vec3): Vec3 {
  const length = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

/**
 * The six frustum planes of a view-projection matrix, each as
 * `[a, b, c, d]` with the normal pointing inward, for culling.
 */
export function frustumPlanes(m: Mat4, out: Float32Array): Float32Array {
  const rows: [number, number, number, number][] = [
    [m[0], m[4], m[8], m[12]],
    [m[1], m[5], m[9], m[13]],
    [m[2], m[6], m[10], m[14]],
    [m[3], m[7], m[11], m[15]],
  ];
  const put = (index: number, sign: number, row: number): void => {
    const a = rows[3][0] + sign * rows[row][0];
    const b = rows[3][1] + sign * rows[row][1];
    const c = rows[3][2] + sign * rows[row][2];
    const d = rows[3][3] + sign * rows[row][3];
    const length = Math.hypot(a, b, c) || 1;
    out[index * 4] = a / length;
    out[index * 4 + 1] = b / length;
    out[index * 4 + 2] = c / length;
    out[index * 4 + 3] = d / length;
  };
  put(0, 1, 0);
  put(1, -1, 0);
  put(2, 1, 1);
  put(3, -1, 1);
  put(4, 1, 2);
  put(5, -1, 2);
  return out;
}

/** Whether an axis-aligned box is at least partly inside the frustum. */
export function boxInFrustum(
  planes: Float32Array,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): boolean {
  for (let i = 0; i < 6; i++) {
    const a = planes[i * 4];
    const b = planes[i * 4 + 1];
    const c = planes[i * 4 + 2];
    const d = planes[i * 4 + 3];
    // The box is outside only if its most positive corner is behind.
    const px = a >= 0 ? maxX : minX;
    const py = b >= 0 ? maxY : minY;
    const pz = c >= 0 ? maxZ : minZ;
    if (a * px + b * py + c * pz + d < 0) return false;
  }
  return true;
}

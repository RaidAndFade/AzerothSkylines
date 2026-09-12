/**
 * A thin layer over WebGL2: programs, buffers and the one texture format
 * the renderer uses. Nothing here knows about the city.
 */

export interface Program {
  program: WebGLProgram;
  uniform(name: string): WebGLUniformLocation | null;
}

export function createProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string): Program {
  const vs = compile(gl, gl.VERTEX_SHADER, vertex);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram();
  if (!program) throw new Error('Could not create a shader program');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    throw new Error(`Could not link the shader program: ${log ?? 'unknown error'}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  const cache = new Map<string, WebGLUniformLocation | null>();
  return {
    program,
    uniform(name: string): WebGLUniformLocation | null {
      let location = cache.get(name);
      if (location === undefined) {
        location = gl.getUniformLocation(program, name);
        cache.set(name, location);
      }
      return location;
    },
  };
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Could not create a shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Could not compile a shader: ${log ?? 'unknown error'}`);
  }
  return shader;
}

/**
 * A drawable batch: interleaved position, normal and colour, with an index
 * buffer. The vertex layout is shared by every program in the renderer, so
 * one vertex array object can be bound and drawn by any of them.
 *
 * Layout, per vertex: position xyz, normal xyz, colour rgb, occlusion.
 */
export const VERTEX_FLOATS = 10;
export const VERTEX_BYTES = VERTEX_FLOATS * 4;

export class Batch {
  readonly vao: WebGLVertexArrayObject;
  private readonly gl: WebGL2RenderingContext;
  private readonly vertexBuffer: WebGLBuffer;
  private readonly indexBuffer: WebGLBuffer;
  private capacityVertices = 0;
  private capacityIndices = 0;
  indexCount = 0;
  /** World-space bounds, for frustum culling. */
  minX = 0;
  minY = 0;
  minZ = 0;
  maxX = 0;
  maxY = 0;
  maxZ = 0;

  private readonly usage: number;

  constructor(gl: WebGL2RenderingContext, dynamic = false) {
    this.gl = gl;
    const vao = gl.createVertexArray();
    const vertexBuffer = gl.createBuffer();
    const indexBuffer = gl.createBuffer();
    if (!vao || !vertexBuffer || !indexBuffer) throw new Error('Could not allocate a draw batch');
    this.vao = vao;
    this.vertexBuffer = vertexBuffer;
    this.indexBuffer = indexBuffer;
    this.usage = dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW;

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, VERTEX_BYTES, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, VERTEX_BYTES, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, VERTEX_BYTES, 24);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bindVertexArray(null);
  }

  /** Upload vertex and index data, growing the buffers only when needed. */
  upload(vertices: Float32Array, indices: Uint32Array): void {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    if (vertices.length > this.capacityVertices) {
      this.capacityVertices = Math.ceil(vertices.length * 1.4);
      gl.bufferData(gl.ARRAY_BUFFER, this.capacityVertices * 4, this.usage);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    if (indices.length > this.capacityIndices) {
      this.capacityIndices = Math.ceil(indices.length * 1.4);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.capacityIndices * 4, this.usage);
    }
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, indices);
    gl.bindVertexArray(null);
    this.indexCount = indices.length;
  }

  draw(): void {
    if (this.indexCount === 0) return;
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.vertexBuffer);
    gl.deleteBuffer(this.indexBuffer);
    this.indexCount = 0;
  }
}

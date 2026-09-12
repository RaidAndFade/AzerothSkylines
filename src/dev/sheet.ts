/**
 * Development catalogue.
 *
 * Renders every building, wall piece, tree and villager as a small
 * three-dimensional portrait on one page, so the modelling can be reviewed
 * side by side. Not part of the game bundle — built separately with
 * `npm run sheet`.
 *
 * One WebGL context does all of it, each portrait copied off as an image,
 * because a browser will not give you four hundred contexts.
 */
import { ALL_BUILDING_DEFS } from '../data/buildings';
import { AgentKind, WallSegment } from '../sim/types';
import { Batch, createProgram } from '../render/glx';
import {
  OBJECT_FRAGMENT,
  OBJECT_VERTEX,
  SHADOW_FRAGMENT,
  SHADOW_VERTEX,
} from '../render/shaders';
import { MeshBuilder, colour } from '../render/meshBuilder';
import { Mat4, lookAt, mat4, multiply, ortho, perspective, normalise } from '../render/mat4';
import { addBuilding } from '../render/buildingMesh';
import { addWall } from '../render/wallMesh';
import { addAgent } from '../render/agentMesh';
import { propTemplate, treeTemplate } from '../render/natureMesh';
import { PALETTE } from '../render/palette';
import { WorldMap } from '../sim/terrain';

const SIZE = 260;
const SUN = normalise({ x: -0.58, y: 0.57, z: 0.58 });

/** A flat green table for things to stand on, so nothing floats. */
function addGround(mesh: MeshBuilder, radius: number): void {
  const sides = 28;
  const turf = colour(PALETTE.grass);
  const centre = mesh.vertex(0, 0, 0, 0, 1, 0, turf, 1);
  const ring: number[] = [];
  for (let s = 0; s < sides; s++) {
    const angle = (s / sides) * Math.PI * 2;
    ring.push(
      mesh.vertex(Math.cos(angle) * radius, 0, Math.sin(angle) * radius, 0, 1, 0, turf, 0.86),
    );
  }
  for (let s = 0; s < sides; s++) mesh.triangle(centre, ring[s], ring[(s + 1) % sides]);
}

/** A portrait studio: one context, one shadow map, one batch, reused. */
class Studio {
  readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly objectProgram;
  private readonly shadowProgram;
  private readonly batch: Batch;
  private readonly shadowTexture: WebGLTexture;
  private readonly shadowBuffer: WebGLFramebuffer;
  private readonly shadowSize = 1024;
  private readonly viewProjection: Mat4 = mat4();
  private readonly shadowMatrix: Mat4 = mat4();
  private readonly view: Mat4 = mat4();
  private readonly projection: Mat4 = mat4();

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = SIZE * 2;
    this.canvas.height = SIZE * 2;
    const gl = this.canvas.getContext('webgl2', { alpha: false, antialias: true });
    if (!gl) throw new Error('WebGL 2 is unavailable');
    this.gl = gl;
    this.objectProgram = createProgram(gl, OBJECT_VERTEX, OBJECT_FRAGMENT);
    this.shadowProgram = createProgram(gl, SHADOW_VERTEX, SHADOW_FRAGMENT);
    this.batch = new Batch(gl, true);

    const texture = gl.createTexture();
    const buffer = gl.createFramebuffer();
    if (!texture || !buffer) throw new Error('Could not allocate the shadow map');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, this.shadowSize, this.shadowSize);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, buffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, texture, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.shadowTexture = texture;
    this.shadowBuffer = buffer;

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.frontFace(gl.CCW);
  }

  /** Render a mesh centred on the origin and return it as an image. */
  portrait(mesh: MeshBuilder): string {
    const gl = this.gl;
    this.batch.upload(mesh.vertexData(), mesh.indexData());

    const centreX = (mesh.minX + mesh.maxX) / 2;
    const centreZ = (mesh.minZ + mesh.maxZ) / 2;
    const centreY = (mesh.minY + mesh.maxY) / 2;
    const extent = Math.max(
      mesh.maxX - mesh.minX,
      mesh.maxZ - mesh.minZ,
      (mesh.maxY - mesh.minY) * 1.15,
      0.8,
    );
    const distance = extent * 2.0;
    const yaw = Math.PI * 0.24;
    const pitch = 0.52;
    const target = { x: centreX, y: centreY, z: centreZ };
    const eye = {
      x: target.x - Math.sin(yaw) * Math.cos(pitch) * distance,
      y: target.y + Math.sin(pitch) * distance,
      z: target.z - Math.cos(yaw) * Math.cos(pitch) * distance,
    };
    perspective(this.projection, 0.75, 1, 0.1, distance * 6);
    lookAt(this.view, eye, target, { x: 0, y: 1, z: 0 });
    multiply(this.viewProjection, this.projection, this.view);

    const radius = extent * 0.9;
    const back = radius * 3;
    lookAt(
      this.view,
      { x: target.x + SUN.x * back, y: target.y + SUN.y * back, z: target.z + SUN.z * back },
      target,
      { x: 0, y: 1, z: 0 },
    );
    ortho(this.projection, -radius, radius, -radius, radius, 0.1, back * 2.5);
    multiply(this.shadowMatrix, this.projection, this.view);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowBuffer);
    gl.viewport(0, 0, this.shadowSize, this.shadowSize);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.shadowProgram.program);
    gl.uniformMatrix4fv(this.shadowProgram.uniform('uViewProjection'), false, this.shadowMatrix);
    gl.cullFace(gl.FRONT);
    this.batch.draw();
    gl.cullFace(gl.BACK);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.72, 0.75, 0.75, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTexture);
    const program = this.objectProgram;
    gl.useProgram(program.program);
    gl.uniformMatrix4fv(program.uniform('uViewProjection'), false, this.viewProjection);
    gl.uniformMatrix4fv(program.uniform('uShadowMatrix'), false, this.shadowMatrix);
    gl.uniform3f(program.uniform('uSunDirection'), SUN.x, SUN.y, SUN.z);
    gl.uniform3f(program.uniform('uSunColor'), 1.28, 1.16, 0.96);
    gl.uniform3f(program.uniform('uSkyColor'), 0.34, 0.4, 0.48);
    gl.uniform3f(program.uniform('uGroundColor'), 0.2, 0.19, 0.14);
    gl.uniform3f(program.uniform('uFogColor'), 0.72, 0.75, 0.75);
    gl.uniform1f(program.uniform('uFogDensity'), 0.0006);
    gl.uniform3f(program.uniform('uCameraPosition'), eye.x, eye.y, eye.z);
    gl.uniform1i(program.uniform('uShadowMap'), 0);
    gl.uniform1f(program.uniform('uShadowTexel'), 1 / this.shadowSize);
    gl.uniform4f(program.uniform('uTint'), 0, 0, 0, 0);
    this.batch.draw();
    gl.bindVertexArray(null);
    return this.canvas.toDataURL('image/png');
  }
}

function section(title: string): HTMLElement {
  const heading = document.createElement('h2');
  heading.textContent = title;
  heading.style.cssText = `font:700 15px sans-serif;color:${PALETTE.gold};margin:22px 0 8px;width:100%`;
  return heading;
}

function row(): HTMLElement {
  const node = document.createElement('div');
  node.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;width:100%';
  return node;
}

function cell(source: string, label: string): HTMLElement {
  const box = document.createElement('div');
  box.style.cssText =
    'display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px;' +
    `background:${PALETTE.parchmentDark};border:1px solid ${PALETTE.ink};border-radius:6px`;
  const image = document.createElement('img');
  image.src = source;
  image.width = SIZE;
  image.height = SIZE;
  image.style.cssText = 'border-radius:4px;display:block';
  const caption = document.createElement('span');
  caption.textContent = label;
  caption.style.cssText = `font:600 10px sans-serif;color:${PALETTE.ink};text-align:center`;
  box.append(image, caption);
  return box;
}

function main(): void {
  const studio = new Studio();
  const root = document.body;
  root.style.cssText = `margin:0;padding:16px;background:${PALETTE.ink};display:flex;flex-wrap:wrap;gap:8px`;
  const mesh = new MeshBuilder(8192, 16384);

  const buildingPortrait = (
    defId: string,
    width: number,
    height: number,
    variant: number,
    facing: number,
    abandoned: boolean,
  ): string => {
    mesh.reset();
    addGround(mesh, Math.max(width, height) * 0.95 + 0.4);
    addBuilding(
      mesh,
      null,
      { x: -width / 2, y: -height / 2, width, height, defId, variant, facing, abandoned },
      { floor: 0, base: 0 },
    );
    return studio.portrait(mesh);
  };

  root.appendChild(section('Buildings'));
  let current = row();
  root.appendChild(current);
  for (const def of ALL_BUILDING_DEFS) {
    current.appendChild(
      cell(
        buildingPortrait(def.id, def.width, def.height, 0, 2, false),
        `${def.name}\n${def.width}x${def.height}`,
      ),
    );
  }

  root.appendChild(section('Variants'));
  current = row();
  root.appendChild(current);
  for (const id of ['house1', 'house3', 'shop2', 'farm1', 'timber2', 'craft1']) {
    for (let variant = 0; variant < 3; variant++) {
      current.appendChild(cell(buildingPortrait(id, 2, 2, variant, 2, false), `${id} v${variant}`));
    }
  }

  root.appendChild(section('Facings'));
  current = row();
  root.appendChild(current);
  for (const id of ['house2', 'shop2', 'inn']) {
    for (let facing = 0; facing < 4; facing++) {
      current.appendChild(cell(buildingPortrait(id, 2, 2, 0, facing, false), `${id} f${facing}`));
    }
  }

  root.appendChild(section('Derelict'));
  current = row();
  root.appendChild(current);
  for (const id of ['house1', 'house3', 'shop2', 'craft1']) {
    current.appendChild(cell(buildingPortrait(id, 2, 2, 0, 2, true), `${id} abandoned`));
  }

  root.appendChild(section('Town wall'));
  current = row();
  root.appendChild(current);
  const wallMap = flatMap();
  const wallPortrait = (segment: WallSegment, label: string): HTMLElement => {
    mesh.reset();
    addGround(mesh, 1.6);
    addWall(mesh, wallMap, segment);
    return cell(studio.portrait(mesh), label);
  };
  current.appendChild(
    wallPortrait({ x: -1, y: -1, connections: 0b0101, kind: 'wall', orientation: 0 }, 'curtain, north-south'),
  );
  current.appendChild(
    wallPortrait({ x: -1, y: -1, connections: 0b1010, kind: 'wall', orientation: 0 }, 'curtain, east-west'),
  );
  current.appendChild(
    wallPortrait({ x: -1, y: -1, connections: 0b0011, kind: 'tower', orientation: 0 }, 'corner tower'),
  );
  current.appendChild(
    wallPortrait({ x: -1, y: -1, connections: 0b0101, kind: 'gate', orientation: 0 }, 'gatehouse'),
  );

  root.appendChild(section('Woodland'));
  current = row();
  root.appendChild(current);
  const names = ['oak', 'ash', 'birch', 'hawthorn', 'willow', 'pine'];
  for (let variant = 0; variant < 6; variant++) {
    mesh.reset();
    addGround(mesh, 1.3);
    mesh.appendTransformed(treeTemplate(variant, true), 0, 0, 0, 0, 1, 0);
    current.appendChild(cell(studio.portrait(mesh), names[variant]));
  }

  root.appendChild(section('Ground'));
  current = row();
  root.appendChild(current);
  for (let variant = 0; variant < 6; variant++) {
    mesh.reset();
    addGround(mesh, 0.45);
    mesh.appendTransformed(propTemplate(variant), 0, 0, 0, 0, 1, 0);
    current.appendChild(cell(studio.portrait(mesh), `ground ${variant}`));
  }

  root.appendChild(section('People and carts'));
  current = row();
  root.appendChild(current);
  for (const kind of [AgentKind.Peasant, AgentKind.Guard, AgentKind.Traveler, AgentKind.Cart]) {
    for (let variant = 0; variant < 2; variant++) {
      mesh.reset();
      addGround(mesh, 0.6);
      addAgent(mesh, {
        kind,
        variant,
        x: 0,
        y: 0,
        z: 0,
        heading: 0.6,
        phase: 0.9,
        laden: variant === 1,
      });
      current.appendChild(cell(studio.portrait(mesh), `${kind} ${variant}`));
    }
  }
}

/** A tiny level map, for the pieces that read the ground height. */
function flatMap(): WorldMap {
  const width = 4;
  const height = 4;
  return {
    width,
    height,
    seed: 1,
    // Level with the portrait's own ground plane.
    heightField: new Float32Array(width * height),
    elevation: new Int8Array(width * height),
    terrain: new Uint8Array(width * height).fill(3),
    moisture: new Float32Array(width * height),
    treeDensity: new Float32Array(width * height),
    fertility: new Float32Array(width * height),
    oreRichness: new Float32Array(width * height),
    foundingSite: { x: 0, y: 0 },
    foundingDistrict: { x: 0, y: 0 },
    districtParcels: 1,
    roadEntry: { x: 0, y: 0 },
    kingsRoad: [],
  };
}

main();

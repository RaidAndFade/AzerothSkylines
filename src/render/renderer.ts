/**
 * The scene renderer.
 *
 * The valley is drawn as a real three-dimensional place: one continuous
 * ground surface with the town standing on it, lit by a low sun through a
 * single shadow map, hazed with distance, and turned round whichever way
 * the player wants to look at it.
 *
 * Work is divided into chunks of sixteen tiles. Ground and water are built
 * once; roads, buildings, walls and woodland are rebuilt only for the
 * chunks the simulation has touched. Building is budgeted per frame, so a
 * chunk coming into view never costs a visible hitch.
 */
import { AgentKind, Building, RoadType, Zone } from '../sim/types';
import {
  TERRAIN_HEIGHT,
  WATER_HEIGHT,
  WorldMap,
  surfaceHeight,
} from '../sim/terrain';
import { CityState, buildingCenter, standingTreesOnTile, tileIndex } from '../sim/city';
import { propsOnTile } from '../sim/terrain';
import { getDef } from '../data/buildings';
import { Batch, Program, createProgram } from './glx';
import {
  GROUND_FRAGMENT,
  OBJECT_FRAGMENT,
  OBJECT_VERTEX,
  SHADOW_FRAGMENT,
  SHADOW_VERTEX,
  SKY_FRAGMENT,
  SKY_VERTEX,
  WATER_FRAGMENT,
} from './shaders';
import { Camera, MAX_DISTANCE, MIN_DISTANCE, marchToGround } from './camera';
import { Mat4, boxInFrustum, frustumPlanes, lookAt, mat4, multiply, ortho, normalise } from './mat4';
import { MeshBuilder, colour } from './meshBuilder';
import {
  CHUNK_TILES,
  FAR_SUBDIVISIONS,
  GroundPalette,
  NEAR_SUBDIVISIONS,
  WORLD_MARGIN,
  buildTerrainChunk,
  buildWaterChunk,
} from './terrainMesh';
import { addRoad } from './roadMesh';
import { addBuilding, placementOf } from './buildingMesh';
import { addWall } from './wallMesh';
import { addAgent } from './agentMesh';
import { propTemplate, treeHeight, treeTemplate } from './natureMesh';
import { DecalMap, DecalState, Overlay, BuildPreview } from './decals';
import { PALETTE } from './palette';
import { hash2 } from '../core/rng';
import { clamp } from '../core/math';

export type { Overlay, BuildPreview };

export interface RenderOptions {
  /** Seconds since the game started, for animation. */
  time: number;
  overlay: Overlay;
  showZones: boolean;
  hoverTile: { x: number; y: number } | null;
  preview: BuildPreview | null;
  selectedBuilding: number | null;
  /** Parcel the player is considering buying. */
  highlightParcel: { px: number; py: number } | null;
}

/** Direction toward the sun: low, and out of the south-west. */
const SUN = normalise({ x: -0.58, y: 0.57, z: 0.58 });
const SUN_COLOUR = [1.28, 1.16, 0.96];
const SKY_LIGHT = [0.34, 0.4, 0.48];
const BOUNCE_LIGHT = [0.2, 0.19, 0.14];
const ZENITH = [0.36, 0.49, 0.66];
const HORIZON = [0.74, 0.77, 0.76];
const FOG_COLOUR = [0.72, 0.75, 0.75];

/** How far from the camera full-detail woodland is built. */
const NEAR_WOOD = 34;
/** How much ground the shadow map covers, relative to the camera's range. */
const SHADOW_COVERAGE = 1.15;
const MIN_SHADOW_RADIUS = 14;
const MAX_SHADOW_RADIUS = 90;
/**
 * How much chunk building may happen in one frame, so nothing hitches.
 * Measured in cost rather than in chunks, because the two kinds are not
 * remotely alike: a chunk of the valley is a thousand vertices with ambient
 * occlusion sampled at each, and a chunk of the country out toward the
 * horizon is under three hundred with none. So a frame lays down either a
 * few of the former or a great many of the latter, and the horizon closes
 * up in the first moments rather than creeping outward.
 */
const BUILD_BUDGET = 48;
const FINE_COST = 16;
const COARSE_COST = 1;

interface Chunk {
  cx: number;
  cz: number;
  /** Whether the chunk holds any of the playable map. */
  inMap: boolean;
  /** Distant country, built at reduced resolution. */
  coarse: boolean;
  ground: Batch | null;
  water: Batch | null;
  structures: Batch | null;
  nature: Batch | null;
  /** Whether the woodland in this chunk is built at full detail. */
  natureDetail: boolean;
  builtGround: boolean;
  contentDirty: boolean;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  minY: number;
  maxY: number;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly camera = new Camera();
  /** Frame time in milliseconds, smoothed, for the debug readout. */
  frameTime = 0;
  private drawnChunks = 0;

  private readonly gl: WebGL2RenderingContext;
  private readonly groundProgram: Program;
  private readonly objectProgram: Program;
  private readonly waterProgram: Program;
  private readonly shadowProgram: Program;
  private readonly skyProgram: Program;

  private chunks: Chunk[] = [];
  private chunksWide = 0;
  private chunkMinX = 0;
  private chunkMinZ = 0;
  private groundPalette: GroundPalette | null = null;
  private mapSeed = Number.NaN;

  private readonly scratch = new MeshBuilder(4096, 8192);
  private readonly agentMesh = new MeshBuilder(2048, 4096);
  private agentBatch: Batch | null = null;
  private decals: DecalMap | null = null;
  private decalTexture: WebGLTexture | null = null;
  private decalRevision = -1;
  private zoneRevision = 0;

  private shadowTexture: WebGLTexture | null = null;
  private shadowBuffer: WebGLFramebuffer | null = null;
  private shadowSize = 2048;
  private shadowRadius = 40;
  private readonly shadowMatrix: Mat4 = mat4();
  private readonly lightView: Mat4 = mat4();
  private readonly lightProjection: Mat4 = mat4();
  private readonly planes = new Float32Array(24);

  private skyVao: WebGLVertexArrayObject | null = null;
  private readonly inverseViewProjection: Mat4 = mat4();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: true,
      depth: true,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('This browser cannot show the valley: WebGL 2 is unavailable.');
    this.gl = gl;

    this.groundProgram = createProgram(gl, OBJECT_VERTEX, GROUND_FRAGMENT);
    this.objectProgram = createProgram(gl, OBJECT_VERTEX, OBJECT_FRAGMENT);
    this.waterProgram = createProgram(gl, OBJECT_VERTEX, WATER_FRAGMENT);
    this.shadowProgram = createProgram(gl, SHADOW_VERTEX, SHADOW_FRAGMENT);
    this.skyProgram = createProgram(gl, SKY_VERTEX, SKY_FRAGMENT);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    this.createShadowMap();
    this.createSkyQuad();
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.canvas.width = Math.max(1, Math.round(width * pixelRatio));
    this.canvas.height = Math.max(1, Math.round(height * pixelRatio));
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.camera.resize(width, height);
  }

  // --- set-up ---------------------------------------------------------------

  private createShadowMap(): void {
    const gl = this.gl;
    // Fall back to a smaller map on hardware that will not give us a large one.
    const limit = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    this.shadowSize = Math.min(this.shadowSize, limit);
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
  }

  private createSkyQuad(): void {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    if (!vao || !buffer) throw new Error('Could not allocate the sky');
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.bindVertexArray(null);
    this.skyVao = vao;
  }

  /** Throw away every batch, for a new valley. */
  private resetScene(city: CityState): void {
    for (const chunk of this.chunks) {
      chunk.ground?.dispose();
      chunk.water?.dispose();
      chunk.structures?.dispose();
      chunk.nature?.dispose();
    }
    this.chunks = [];

    this.chunkMinX = Math.floor(-WORLD_MARGIN / CHUNK_TILES);
    this.chunkMinZ = Math.floor(-WORLD_MARGIN / CHUNK_TILES);
    const maxX = Math.ceil((city.width + WORLD_MARGIN) / CHUNK_TILES);
    const maxZ = Math.ceil((city.height + WORLD_MARGIN) / CHUNK_TILES);
    this.chunksWide = maxX - this.chunkMinX;
    const chunksHigh = maxZ - this.chunkMinZ;

    for (let z = 0; z < chunksHigh; z++) {
      for (let x = 0; x < this.chunksWide; x++) {
        const cx = this.chunkMinX + x;
        const cz = this.chunkMinZ + z;
        const minX = cx * CHUNK_TILES;
        const minZ = cz * CHUNK_TILES;
        const inMap =
          minX < city.width && minZ < city.height && minX + CHUNK_TILES > 0 && minZ + CHUNK_TILES > 0;
        // A ring of full-resolution chunks just outside the valley, so the
        // change in resolution never happens where anyone is looking closely.
        const near =
          minX < city.width + CHUNK_TILES * 2 &&
          minZ < city.height + CHUNK_TILES * 2 &&
          minX + CHUNK_TILES > -CHUNK_TILES * 2 &&
          minZ + CHUNK_TILES > -CHUNK_TILES * 2;
        this.chunks.push({
          cx,
          cz,
          inMap,
          coarse: !near,
          ground: null,
          water: null,
          structures: null,
          nature: null,
          natureDetail: false,
          builtGround: false,
          contentDirty: true,
          minX,
          minZ,
          maxX: minX + CHUNK_TILES,
          maxZ: minZ + CHUNK_TILES,
          minY: 0,
          maxY: TERRAIN_HEIGHT + 12,
        });
      }
    }

    this.groundPalette = new GroundPalette(city.map);
    this.decals = new DecalMap(city);
    this.decalRevision = -1;
    this.zoneRevision++;
    this.mapSeed = city.map.seed;
    this.camera.setWorldBounds(city.width, city.height, city.map);
  }

  private chunkAt(cx: number, cz: number): Chunk | null {
    const x = cx - this.chunkMinX;
    const z = cz - this.chunkMinZ;
    if (x < 0 || z < 0 || x >= this.chunksWide) return null;
    const index = z * this.chunksWide + x;
    return this.chunks[index] ?? null;
  }

  // --- the frame ------------------------------------------------------------

  render(city: CityState, options: RenderOptions): void {
    const started = performance.now();
    const gl = this.gl;

    if (this.mapSeed !== city.map.seed || this.chunks.length === 0) this.resetScene(city);
    this.consumeDirtyTiles(city);
    this.camera.update();

    frustumPlanes(this.camera.viewProjection, this.planes);
    const visible = this.collectVisible(city);
    this.drawnChunks = visible.length;
    this.buildAgents(city, options.time);
    this.updateDecals(city, options);
    this.fitShadowMap();

    // 1. Depth from the sun's point of view.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowBuffer);
    gl.viewport(0, 0, this.shadowSize, this.shadowSize);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.shadowProgram.program);
    gl.uniformMatrix4fv(this.shadowProgram.uniform('uViewProjection'), false, this.shadowMatrix);
    // Front faces cast, which keeps the acne on surfaces that are in shadow anyway.
    gl.cullFace(gl.FRONT);
    for (const chunk of visible) {
      if (!this.nearShadowCaster(chunk)) continue;
      chunk.ground?.draw();
      chunk.structures?.draw();
      chunk.nature?.draw();
    }
    this.agentBatch?.draw();
    gl.cullFace(gl.BACK);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // 2. The valley itself.
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(FOG_COLOUR[0], FOG_COLOUR[1], FOG_COLOUR[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    this.drawSky();

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.decalTexture);

    gl.useProgram(this.groundProgram.program);
    this.setSceneUniforms(this.groundProgram);
    gl.uniform1i(this.groundProgram.uniform('uDecal'), 1);
    gl.uniform2f(this.groundProgram.uniform('uMapSize'), city.width, city.height);
    for (const chunk of visible) chunk.ground?.draw();

    gl.useProgram(this.objectProgram.program);
    this.setSceneUniforms(this.objectProgram);
    for (const chunk of visible) {
      chunk.structures?.draw();
      chunk.nature?.draw();
    }
    this.agentBatch?.draw();

    // 3. Water last, because it is see-through.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(this.waterProgram.program);
    this.setSceneUniforms(this.waterProgram);
    gl.uniform1f(this.waterProgram.uniform('uTime'), options.time);
    for (const chunk of visible) chunk.water?.draw();
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);

    this.frameTime = this.frameTime * 0.9 + (performance.now() - started) * 0.1;
  }

  private setSceneUniforms(program: Program): void {
    const gl = this.gl;
    gl.uniformMatrix4fv(program.uniform('uViewProjection'), false, this.camera.viewProjection);
    gl.uniformMatrix4fv(program.uniform('uShadowMatrix'), false, this.shadowMatrix);
    gl.uniform3f(program.uniform('uSunDirection'), SUN.x, SUN.y, SUN.z);
    gl.uniform3fv(program.uniform('uSunColor'), SUN_COLOUR);
    gl.uniform3fv(program.uniform('uSkyColor'), SKY_LIGHT);
    gl.uniform3fv(program.uniform('uGroundColor'), BOUNCE_LIGHT);
    gl.uniform3fv(program.uniform('uFogColor'), FOG_COLOUR);
    // Haze thickens as the view pulls back, so the far country softens away
    // before the eye can find where it stops — but only enough to close the
    // horizon, not enough to whiten the middle distance. This is haze over a
    // valley, not weather.
    const pullback = (this.camera.distance - MIN_DISTANCE) / (MAX_DISTANCE - MIN_DISTANCE);
    gl.uniform1f(program.uniform('uFogDensity'), 0.002 + 0.0032 * pullback ** 1.4);
    gl.uniform3f(
      program.uniform('uCameraPosition'),
      this.camera.eye.x,
      this.camera.eye.y,
      this.camera.eye.z,
    );
    gl.uniform1i(program.uniform('uShadowMap'), 0);
    gl.uniform1f(program.uniform('uShadowTexel'), 1 / this.shadowSize);
    gl.uniform4f(program.uniform('uTint'), 0, 0, 0, 0);
  }

  private drawSky(): void {
    const gl = this.gl;
    invert(this.camera.viewProjection, this.inverseViewProjection);
    gl.useProgram(this.skyProgram.program);
    gl.uniformMatrix4fv(
      this.skyProgram.uniform('uInverseViewProjection'),
      false,
      this.inverseViewProjection,
    );
    gl.uniform3fv(this.skyProgram.uniform('uZenith'), ZENITH);
    gl.uniform3fv(this.skyProgram.uniform('uHorizon'), HORIZON);
    gl.uniform3f(this.skyProgram.uniform('uSunDirection'), SUN.x, SUN.y, SUN.z);
    gl.uniform3fv(this.skyProgram.uniform('uSunColor'), SUN_COLOUR);
    gl.depthMask(false);
    gl.bindVertexArray(this.skyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);
  }

  /**
   * Fit the sun's view to the ground around the camera's target. The box
   * follows the zoom, so a close view spends the whole map on one street
   * rather than on country nobody can see.
   */
  private fitShadowMap(): void {
    const radius = clamp(this.camera.distance * SHADOW_COVERAGE, MIN_SHADOW_RADIUS, MAX_SHADOW_RADIUS);
    this.shadowRadius = radius;
    const centre = {
      x: this.camera.x,
      y: this.camera.groundHeight,
      z: this.camera.z,
    };
    const back = radius * 2.4;
    lookAt(
      this.lightView,
      { x: centre.x + SUN.x * back, y: centre.y + SUN.y * back, z: centre.z + SUN.z * back },
      centre,
      { x: 0, y: 1, z: 0 },
    );
    ortho(this.lightProjection, -radius, radius, -radius, radius, 1, back * 2 + TERRAIN_HEIGHT * 2);
    multiply(this.shadowMatrix, this.lightProjection, this.lightView);
  }

  /** Whether a chunk is close enough to the camera to be worth shadowing. */
  private nearShadowCaster(chunk: Chunk): boolean {
    const dx = (chunk.minX + chunk.maxX) / 2 - this.camera.x;
    const dz = (chunk.minZ + chunk.maxZ) / 2 - this.camera.z;
    return Math.hypot(dx, dz) < this.shadowRadius + CHUNK_TILES;
  }

  // --- chunk maintenance ----------------------------------------------------

  /** Mark the chunks the simulation has touched since the last frame. */
  private consumeDirtyTiles(city: CityState): void {
    if (city.dirtyTiles.size === 0) return;
    let zonesTouched = false;
    for (const index of city.dirtyTiles) {
      const x = index % city.width;
      const y = (index / city.width) | 0;
      const cx = Math.floor(x / CHUNK_TILES);
      const cz = Math.floor(y / CHUNK_TILES);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const chunk = this.chunkAt(cx + dx, cz + dz);
          if (chunk) chunk.contentDirty = true;
        }
      }
      zonesTouched = true;
    }
    city.dirtyTiles.clear();
    if (zonesTouched) this.zoneRevision++;
  }

  /**
   * The chunks on screen, building what is missing within this frame's
   * budget. Ground comes first: a chunk with no ground is a hole in the
   * world, where a chunk with no trees yet is only a bare field.
   */
  private collectVisible(city: CityState): Chunk[] {
    const visible: Chunk[] = [];
    let budget = BUILD_BUDGET;
    const order = this.chunks
      .filter((chunk) =>
        boxInFrustum(
          this.planes,
          chunk.minX,
          chunk.minY,
          chunk.minZ,
          chunk.maxX,
          chunk.maxY,
          chunk.maxZ,
        ),
      )
      .sort((a, b) => this.chunkDistance(a) - this.chunkDistance(b));

    for (const chunk of order) {
      const cost = chunk.coarse ? COARSE_COST : FINE_COST;
      if (!chunk.builtGround) {
        // Ground is never skipped in favour of something cheaper behind it:
        // a chunk with no ground is a hole in the world.
        if (budget <= 0) continue;
        this.buildGround(city.map, chunk);
        budget -= cost;
      }
      const detail = this.chunkDistance(chunk) < NEAR_WOOD;
      if (chunk.inMap && (chunk.contentDirty || chunk.natureDetail !== detail)) {
        if (budget > 0) {
          this.buildContent(city, chunk, detail);
          budget -= FINE_COST;
        }
      }
      visible.push(chunk);
    }
    return visible;
  }

  private chunkDistance(chunk: Chunk): number {
    const dx = (chunk.minX + chunk.maxX) / 2 - this.camera.x;
    const dz = (chunk.minZ + chunk.maxZ) / 2 - this.camera.z;
    return Math.hypot(dx, dz);
  }

  private buildGround(map: WorldMap, chunk: Chunk): void {
    const gl = this.gl;
    const mesh = this.scratch;
    const subdivisions = chunk.coarse ? FAR_SUBDIVISIONS : NEAR_SUBDIVISIONS;
    buildTerrainChunk(map, this.groundPalette!, chunk.cx, chunk.cz, mesh, subdivisions);
    chunk.ground = chunk.ground ?? new Batch(gl);
    chunk.ground.upload(mesh.vertexData(), mesh.indexData());
    chunk.minY = mesh.minY - 1;
    chunk.maxY = mesh.maxY + 14;

    buildWaterChunk(map, chunk.cx, chunk.cz, mesh, chunk.coarse ? 2 : 0.5);
    if (!mesh.isEmpty) {
      chunk.water = chunk.water ?? new Batch(gl);
      chunk.water.upload(mesh.vertexData(), mesh.indexData());
      chunk.maxY = Math.max(chunk.maxY, WATER_HEIGHT + 1);
    } else if (chunk.water) {
      chunk.water.dispose();
      chunk.water = null;
    }
    chunk.builtGround = true;
  }

  /** Rebuild the roads, buildings, walls and woodland of one chunk. */
  private buildContent(city: CityState, chunk: Chunk, detail: boolean): void {
    const gl = this.gl;
    const map = city.map;
    const mesh = this.scratch;
    mesh.reset();

    const x0 = Math.max(0, chunk.minX);
    const z0 = Math.max(0, chunk.minZ);
    const x1 = Math.min(city.width, chunk.maxX);
    const z1 = Math.min(city.height, chunk.maxZ);

    for (let y = z0; y < z1; y++) {
      for (let x = x0; x < x1; x++) {
        const index = tileIndex(city, x, y);
        if (city.roads[index] !== RoadType.None) addRoad(mesh, city, x, y);
        const wallIndex = city.wallAt[index];
        if (wallIndex >= 0) addWall(mesh, map, city.walls[wallIndex]);
        const buildingId = city.buildingAt[index];
        if (buildingId >= 0) {
          const building = city.buildings.get(buildingId);
          // A building is emitted once, from its anchor tile, even where its
          // footprint runs into the next chunk.
          if (building && building.x === x && building.y === y) {
            addBuilding(mesh, map, placementOf(building));
          }
        }
      }
    }
    chunk.structures = chunk.structures ?? new Batch(gl);
    chunk.structures.upload(mesh.vertexData(), mesh.indexData());

    // Woodland and ground clutter, on whatever the town has not taken.
    mesh.reset();
    for (let y = z0; y < z1; y++) {
      for (let x = x0; x < x1; x++) {
        const index = tileIndex(city, x, y);
        if (city.buildingAt[index] >= 0 || city.roads[index] !== RoadType.None) continue;
        if (city.wallAt[index] >= 0) continue;
        for (const tree of standingTreesOnTile(city, x, y)) {
          const wx = x + 0.5 + tree.ox;
          const wz = y + 0.5 + tree.oy;
          const yaw = hash2(x * 31 + tree.variant, y * 17, map.seed) * Math.PI * 2;
          mesh.appendTransformed(
            treeTemplate(tree.variant, detail),
            wx,
            surfaceHeight(map, wx, wz) - 0.05,
            wz,
            yaw,
            tree.scale,
            (hash2(x, y + tree.variant, map.seed ^ 0x77) - 0.5) * 0.14,
          );
        }
        if (!detail) continue;
        if (city.zones[index] !== Zone.None) continue;
        for (const prop of propsOnTile(map, x, y)) {
          const wx = x + 0.5 + prop.ox;
          const wz = y + 0.5 + prop.oy;
          mesh.appendTransformed(
            propTemplate(prop.variant),
            wx,
            surfaceHeight(map, wx, wz) - 0.02,
            wz,
            hash2(x + prop.variant, y, map.seed ^ 0x2b) * Math.PI * 2,
            prop.scale,
          );
        }
      }
    }
    chunk.nature = chunk.nature ?? new Batch(gl);
    chunk.nature.upload(mesh.vertexData(), mesh.indexData());

    chunk.natureDetail = detail;
    chunk.contentDirty = false;
    chunk.maxY = Math.max(chunk.maxY, chunk.minY + 6 + treeHeight(0) * 2);
  }

  // --- people ---------------------------------------------------------------

  private buildAgents(city: CityState, time: number): void {
    const mesh = this.agentMesh;
    mesh.reset();
    // Anyone far enough away to be a speck is not worth the triangles.
    const range = Math.min(72, this.camera.distance * 1.9 + 22);
    for (const agent of city.agents) {
      const wx = agent.x + 0.5;
      const wz = agent.y + 0.5;
      if (Math.hypot(wx - this.camera.x, wz - this.camera.z) > range) continue;
      addAgent(mesh, {
        kind: agent.kind,
        variant: agent.variant,
        x: wx,
        y: surfaceHeight(city.map, wx, wz),
        z: wz,
        // Tile space runs +x east and +y south, and so does the world.
        heading: Math.atan2(Math.sin(agent.heading), Math.cos(agent.heading)),
        phase: time * (agent.kind === AgentKind.Cart ? 4 : 7) + agent.id,
        laden: agent.cargo !== null,
      });
    }
    if (mesh.isEmpty) {
      this.agentBatch?.upload(new Float32Array(0), new Uint32Array(0));
      return;
    }
    this.agentBatch = this.agentBatch ?? new Batch(this.gl, true);
    this.agentBatch.upload(mesh.vertexData(), mesh.indexData());
  }

  // --- decals ---------------------------------------------------------------

  private updateDecals(city: CityState, options: RenderOptions): void {
    const gl = this.gl;
    const decals = this.decals;
    if (!decals) return;

    let selected: Building | null = null;
    if (options.selectedBuilding !== null) {
      selected = city.buildings.get(options.selectedBuilding) ?? null;
    }
    const state: DecalState = {
      overlay: options.overlay,
      showZones: options.showZones,
      hoverTile: options.hoverTile,
      preview: options.preview,
      selectedFootprint: selected
        ? { x: selected.x, y: selected.y, width: selected.width, height: selected.height }
        : null,
      highlightParcel: options.highlightParcel,
    };
    decals.update(city, state, this.zoneRevision);

    if (!this.decalTexture) {
      const texture = gl.createTexture();
      if (!texture) throw new Error('Could not allocate the overlay map');
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, decals.width, decals.height);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.decalTexture = texture;
      this.decalRevision = -1;
    }
    if (this.decalRevision !== decals.revision) {
      gl.bindTexture(gl.TEXTURE_2D, this.decalTexture);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        decals.width,
        decals.height,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        decals.pixels,
      );
      this.decalRevision = decals.revision;
    }
  }

  // --- picking --------------------------------------------------------------

  /**
   * Which tile a screen point is over, by following the ray to the ground.
   * Where the ray misses the ground entirely — the player is pointing at the
   * sky — the waterline is used, so a click near the horizon still lands
   * somewhere sensible rather than nowhere.
   */
  pickTile(city: CityState, screenX: number, screenY: number): { x: number; y: number } | null {
    const ray = this.camera.screenRay(screenX, screenY);
    let hit = marchToGround(city.map, ray, this.camera.distance * 6 + 400);
    if (!hit && ray.direction.y < -1e-4) {
      const t = (WATER_HEIGHT - ray.origin.y) / ray.direction.y;
      hit = {
        x: ray.origin.x + ray.direction.x * t,
        y: WATER_HEIGHT,
        z: ray.origin.z + ray.direction.z * t,
      };
    }
    if (!hit) return null;
    const x = Math.floor(hit.x);
    const y = Math.floor(hit.z);
    if (x < 0 || y < 0 || x >= city.width || y >= city.height) return null;
    return { x, y };
  }

  /** Where a tile currently sits on screen, in CSS pixels. */
  screenForTile(city: CityState, tileX: number, tileY: number): { x: number; y: number } {
    const wx = tileX + 0.5;
    const wz = tileY + 0.5;
    return this.camera.worldToScreen(wx, surfaceHeight(city.map, wx, wz), wz);
  }

  /**
   * What the renderer is holding and drawing, for the console handle and the
   * frame-pacing tool.
   */
  stats(): { chunks: number; built: number; drawn: number; frameMs: number } {
    let built = 0;
    for (const chunk of this.chunks) if (chunk.builtGround) built++;
    return {
      chunks: this.chunks.length,
      built,
      drawn: this.drawnChunks,
      frameMs: Math.round(this.frameTime * 100) / 100,
    };
  }

  /** Point the camera at a building, for the "show me" links in the ledger. */
  focusOn(building: Building): void {
    const centre = buildingCenter(building);
    this.camera.centreOnTile(centre.x, centre.y);
  }
}

/** A general 4x4 inverse, needed only for turning the sky back into rays. */
function invert(m: Mat4, out: Mat4): Mat4 {
  const a = m;
  const b00 = a[0] * a[5] - a[1] * a[4];
  const b01 = a[0] * a[6] - a[2] * a[4];
  const b02 = a[0] * a[7] - a[3] * a[4];
  const b03 = a[1] * a[6] - a[2] * a[5];
  const b04 = a[1] * a[7] - a[3] * a[5];
  const b05 = a[2] * a[7] - a[3] * a[6];
  const b06 = a[8] * a[13] - a[9] * a[12];
  const b07 = a[8] * a[14] - a[10] * a[12];
  const b08 = a[8] * a[15] - a[11] * a[12];
  const b09 = a[9] * a[14] - a[10] * a[13];
  const b10 = a[9] * a[15] - a[11] * a[13];
  const b11 = a[10] * a[15] - a[11] * a[14];

  let determinant = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!determinant) return out;
  determinant = 1 / determinant;

  out[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * determinant;
  out[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * determinant;
  out[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * determinant;
  out[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * determinant;
  out[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * determinant;
  out[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * determinant;
  out[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * determinant;
  out[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * determinant;
  out[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * determinant;
  out[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * determinant;
  out[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * determinant;
  out[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * determinant;
  out[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * determinant;
  out[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * determinant;
  out[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * determinant;
  out[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * determinant;
  return out;
}

export { getDef, Zone, AgentKind, PALETTE, colour, Camera };

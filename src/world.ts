import { makeNoise3D } from 'open-simplex-noise';
import { Vertex } from './game';
import { vec3, vec3_add, vec3_sub, vec3_dot, assert, mod } from './utils';
import { BlockDef, BlockManager, Face, getNormal } from './block';
import { HighlightSpanKind } from 'typescript';

// We assign each step a cost.
// we stop doing work after the cost exceeds 1
const CHUNK_GEN_COST = 1;
const CHUNK_MESH_COST = 1;
const CHUNK_MKGRAPHICS_COST = 1;

const CHUNK_X_SIZE = 16;
const CHUNK_Y_SIZE = 16;
const CHUNK_Z_SIZE = 16;


// how many chunks to render
const RENDER_RADIUS_X = 3;
const RENDER_RADIUS_Y = 3;
const RENDER_RADIUS_Z = 3;

type Graphics = {
  vao: WebGLVertexArrayObject;
  buffer: WebGLBuffer;
  vertexCount: number;
}

type ChunkGraphics = {
}


type Chunk = {
  blocks?: Uint16Array,
  mesh?: { stale: boolean, solid: Vertex[], transparent: Vertex[] }
  graphics?: { stale: boolean, solid: Graphics, transparent: Graphics }
}


// these are used to render the shadow map
const shadowmap_vs = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_position;

// premultiplied mvp matrix
uniform mat4 u_mvpMat;

void main() {
   gl_Position = u_mvpMat * vec4(a_position, 1.0);
}
`;

const shadowmap_fs = `#version 300 es
out vec4 v_outColor;
void main() {
  v_outColor = vec4(0.0, 0.0, 0.0, 1.0);
}
`;

export type Highlight = {
  coords: vec3,
  face: Face
}

class World {
  readonly emptyChunk = new Uint16Array(CHUNK_X_SIZE * CHUNK_Y_SIZE * CHUNK_Z_SIZE);

  private worldChunkCenterLoc: vec3;

  // noise function
  private readonly seed: number;
  private readonly noiseFn: (x: number, y: number, z: number) => number;

  // list of active <id, highlight> pairs
  private highlights: Map<string, Graphics>;

  // list of active lights
  private lights: Light[];

  // hashmap storing chunks
  private chunk_map: Map<string, Chunk>;

  private gl: WebGL2RenderingContext;
  private blockManager: BlockManager

  private glPositionLoc: number;
  private glTuvLoc: number;

  getWorldChunkLoc = (cameraLoc: vec3) => [
    Math.floor(cameraLoc[0] / CHUNK_X_SIZE),
    Math.floor(cameraLoc[1] / CHUNK_Y_SIZE),
    Math.floor(cameraLoc[2] / CHUNK_Z_SIZE),
  ] as vec3;

  constructor(seed: number, cameraLoc: vec3, gl: WebGL2RenderingContext, positionLoc: number, tuvLoc: number, blockManager: BlockManager) {
    this.gl = gl;
    this.blockManager = blockManager;
    this.glPositionLoc = positionLoc;
    this.glTuvLoc = tuvLoc;
    this.seed = seed;
    this.noiseFn = makeNoise3D(seed);
    this.worldChunkCenterLoc = this.getWorldChunkLoc(cameraLoc);
    this.chunk_map = new Map();
    this.lights = [];
    this.highlights = new Map();
    this.updateCameraLoc();
  }

  createGraphics = (vertexes: Vertex[]) => {
    const data = new Float32Array(vertexes.length * 6);
    for (let i = 0; i < vertexes.length; i++) {
      const { position: [px, py, pz], tuv: [t, u, v] } = vertexes[i];
      data[i * 6 + 0] = px;
      data[i * 6 + 1] = py;
      data[i * 6 + 2] = pz;
      data[i * 6 + 3] = t;
      data[i * 6 + 4] = u;
      data[i * 6 + 5] = v;
    }

    const vao = this.gl.createVertexArray()!;
    this.gl.bindVertexArray(vao);

    const buffer = this.gl.createBuffer()!;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, data, this.gl.DYNAMIC_DRAW);

    // setup our attributes to tell WebGL how to pull
    // the data from the buffer above to the position attribute
    this.gl.enableVertexAttribArray(this.glPositionLoc);
    this.gl.vertexAttribPointer(
      this.glPositionLoc,
      3,              // size (num components)
      this.gl.FLOAT,  // type of data in buffer
      false,          // normalize
      6 * 4,          // stride (0 = auto)
      0 * 4,          // offset
    );
    this.gl.enableVertexAttribArray(this.glTuvLoc);
    this.gl.vertexAttribPointer(
      this.glTuvLoc,
      3,              // size (num components)
      this.gl.FLOAT,  // type of data in buffer
      false,          // normalize
      6 * 4,          // stride (0 = auto)
      3 * 4,          // offset
    );

    return {
      vao,
      buffer,
      vertexCount: vertexes.length,
    }
  }

  deleteGraphics = (graphics: Graphics) => {
    this.gl.deleteBuffer(graphics.buffer);
    this.gl.deleteVertexArray(graphics.vao);
  }


  // if the camera new chunk coords misalign with our current chunk coords then
  private updateCameraLoc = () => {
    const shouldBeLoaded = (worldChunkCoords: vec3) => {
      const disp = vec3_sub(worldChunkCoords, this.worldChunkCenterLoc);
      return (disp[0] >= -RENDER_RADIUS_X && disp[0] <= RENDER_RADIUS_X) &&
        (disp[1] >= -RENDER_RADIUS_Y && disp[1] <= RENDER_RADIUS_Y) &&
        (disp[2] >= -RENDER_RADIUS_Z && disp[2] <= RENDER_RADIUS_Z);
    }

    // delete any generated chunks
    for (const [coord, chunk] of this.chunk_map) {
      if (!shouldBeLoaded(JSON.parse(coord))) {
        if (chunk.graphics !== undefined) {
          this.deleteGraphics(chunk.graphics.solid);
          this.deleteGraphics(chunk.graphics.transparent);
          chunk.graphics = undefined;
        }
        this.chunk_map.delete(coord);
      }
    }

    // initialize all of our neighboring chunks to be on the load list
    for (let x = -RENDER_RADIUS_X; x <= RENDER_RADIUS_X; x++) {
      for (let y = -RENDER_RADIUS_Y; y <= RENDER_RADIUS_Y; y++) {
        for (let z = -RENDER_RADIUS_Z; z <= RENDER_RADIUS_Z; z++) {
          const chunkCoord = JSON.stringify(vec3_add(this.worldChunkCenterLoc, [x, y, z]));
          if (this.chunk_map.get(chunkCoord) === undefined) {
            this.chunk_map.set(chunkCoord, {});
          }
        }
      }
    }
  }

  addHighlight = (id: string, ray: Highlight) => {
    const highlight = this.highlights.get(id);
    const vertexes = createMeshHighlight(ray.coords, ray.face, this.blockManager);
    if (highlight === undefined) {
      this.highlights.set(id, this.createGraphics(vertexes));
    } else {
      this.deleteGraphics(highlight);
      this.highlights.set(id, this.createGraphics(vertexes));
    }
  }

  removeHighlight = (id: string) => {
    const highlight = this.highlights.get(id);
    if (highlight !== undefined) {
      this.deleteGraphics(highlight);
      this.highlights.delete(id);
    }
  }

  markNeighboringChunksStale = (chunkLoc: vec3) => {
    const offsets: vec3[] = [
      [-1, 0, 0],
      [+1, 0, 0],
      [0, -1, 0],
      [0, +1, 0],
      [0, 0, -1],
      [0, 0, +1],
    ];

    for (const offset of offsets) {
      const chunk = this.chunk_map.get(JSON.stringify(vec3_add(chunkLoc, offset)));
      if (chunk !== undefined && chunk.mesh !== undefined) {
        chunk.mesh.stale = true;
      }
    }
  }

  getChunkBlocksIfExists = (coord: vec3) => {
    const blocks = this.chunk_map.get(JSON.stringify(coord))?.blocks;
    if (blocks) {
      return blocks;
    } else {
      return this.emptyChunk;
    }
  }

  update = (cameraLoc: vec3) => {
    let current_cost = 0;

    for (const [coord, chunk] of this.chunk_map) {
      if (chunk.blocks === undefined) {
        const parsedCoord = JSON.parse(coord) as vec3;
        chunk.blocks = genChunkData(parsedCoord, this.noiseFn);
        // mark neighboring blocks as stale so they can get rid of excess faces
        this.markNeighboringChunksStale(parsedCoord);
        current_cost += CHUNK_GEN_COST;
      }

      if (current_cost > 1) { break; }

      const parsedCoord = JSON.parse(coord);
      const offset: vec3 = [parsedCoord[0] * CHUNK_X_SIZE, parsedCoord[1] * CHUNK_Y_SIZE, parsedCoord[2] * CHUNK_Z_SIZE];

      if (chunk.mesh === undefined || chunk.mesh.stale) {
        const { solid, transparent } = createMesh(
          // offset to store at
          offset,
          // block manager
          this.blockManager,
          // core
          chunk.blocks,
          // left
          this.getChunkBlocksIfExists(vec3_add(parsedCoord, [-1, 0, 0])),
          // right
          this.getChunkBlocksIfExists(vec3_add(parsedCoord, [+1, 0, 0])),
          // up
          this.getChunkBlocksIfExists(vec3_add(parsedCoord, [0, -1, 0])),
          // down
          this.getChunkBlocksIfExists(vec3_add(parsedCoord, [0, +1, 0])),
          // back
          this.getChunkBlocksIfExists(vec3_add(parsedCoord, [0, 0, -1])),
          // front
          this.getChunkBlocksIfExists(vec3_add(parsedCoord, [0, 0, +1])),
        );

        chunk.mesh = {
          solid,
          transparent,
          stale: false
        }
        if (chunk.graphics !== undefined) {
          chunk.graphics.stale = true;
        }

        current_cost += CHUNK_MESH_COST;
      }

      if (current_cost > 1) { break; }

      if (chunk.graphics === undefined || chunk.graphics.stale) {
        if (chunk.graphics !== undefined) {
          this.deleteGraphics(chunk.graphics.solid);
          this.deleteGraphics(chunk.graphics.transparent);
        }
        chunk.graphics = {
          solid: this.createGraphics(chunk.mesh.solid),
          transparent: this.createGraphics(chunk.mesh.transparent),
          stale: false
        }
        current_cost += CHUNK_MKGRAPHICS_COST;
      }

      if (current_cost > 1) { break; }
    }

    const cameraChunkLoc = this.getWorldChunkLoc(cameraLoc);
    if (
      cameraChunkLoc[0] !== this.worldChunkCenterLoc[0] ||
      cameraChunkLoc[1] !== this.worldChunkCenterLoc[1] ||
      cameraChunkLoc[2] !== this.worldChunkCenterLoc[2]
    ) {
      this.worldChunkCenterLoc = cameraChunkLoc;
      this.updateCameraLoc();
    }
  }

  render = () => {
    // enable depth tests
    this.gl.enable(this.gl.DEPTH_TEST);

    // remove reversed faces
    this.gl.enable(this.gl.CULL_FACE)

    // enable blending
    this.gl.blendFunc(this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA)
    this.gl.enable(this.gl.BLEND)

    // draw solid
    this.gl.depthMask(true);
    for (const chunk of this.chunk_map.values()) {
      if (chunk.graphics !== undefined) {
        this.gl.bindVertexArray(chunk.graphics.solid.vao);
        this.gl.drawArrays(this.gl.TRIANGLES, 0, chunk.graphics.solid.vertexCount);
      }
    }
    // draw highlights
    for (const highlight of this.highlights.values()) {
      this.gl.bindVertexArray(highlight.vao);
      this.gl.drawArrays(this.gl.TRIANGLES, 0, highlight.vertexCount);
    }
    // draw translucent
    this.gl.depthMask(false);
    for (const chunk of this.chunk_map.values()) {
      if (chunk.graphics !== undefined) {
        this.gl.bindVertexArray(chunk.graphics.transparent.vao);
        this.gl.drawArrays(this.gl.TRIANGLES, 0, chunk.graphics.transparent.vertexCount);
      }
    }
  }
  getBlock = (coords: vec3) => {
    const chunk = this.chunk_map.get(JSON.stringify(this.getWorldChunkLoc(coords)));
    if (chunk && chunk.blocks) {
      return chunk.blocks[chunkDataIndex(
        mod(coords[0], CHUNK_X_SIZE),
        mod(coords[1], CHUNK_Y_SIZE),
        mod(coords[2], CHUNK_Z_SIZE),
      )];
    } else {
      return null;
    }
  }

  setBlock = (coords: vec3, val: number) => {
    const chunkCoord = this.getWorldChunkLoc(coords);
    const chunk = this.chunk_map.get(JSON.stringify(chunkCoord));
    if (chunk && chunk.blocks) {

      const x = mod(coords[0], CHUNK_X_SIZE);
      const y = mod(coords[1], CHUNK_Y_SIZE);
      const z = mod(coords[2], CHUNK_Z_SIZE);

      chunk.blocks[chunkDataIndex(x, y, z)] = val;

      // means we need to recompute the mesh of this
      if (chunk.mesh !== undefined) {
        chunk.mesh.stale = true;
      }
      // TODO: could be optimized, only mark when x y and z are bordering another chunk
      this.markNeighboringChunksStale(chunkCoord);
      return true;
    } else {
      return false;
    }
  }

  private intbound = (s: number, ds: number) => {
    // Some kind of edge case, see:
    // http://gamedev.stackexchange.com/questions/47362/cast-ray-to-select-block-in-voxel-game#comment160436_49423
    const sIsInteger = Math.round(s) == s;
    if (ds < 0 && sIsInteger)
      return 0;

    let ceils: number;
    if (s == 0.0) {
      ceils = 1.0;
    } else {
      ceils = Math.ceil(s);
    }

    return (ds > 0 ? ceils - s : s - Math.floor(s)) / Math.abs(ds);
  }

  castRay = (origin: vec3, direction: vec3, max_dist: number): Highlight | null => {
    // From "A Fast Voxel Traversal Algorithm for Ray Tracing"
    // by John Amanatides and Andrew Woo, 1987
    // <http://www.cse.yorku.ca/~amana/research/grid.pdf>
    // <http://citeseer.ist.psu.edu/viewdoc/summary?doi=10.1.1.42.3443>
    // Extensions to the described algorithm:
    //   • Imposed a distance limit.
    //   • The face passed through to reach the current cube is provided to
    //     the callback.

    // The foundation of this algorithm is a parameterized representation of
    // the provided ray,
    //                    origin + t * direction,
    // except that t is not actually stored; rather, at any given point in the
    // traversal, we keep track of the *greater* t values which we would have
    // if we took a step sufficient to cross a cube boundary along that axis
    // (i.e. change the integer part of the coordinate) in the variables
    // tMaxX, tMaxY, and tMaxZ.

    // Cube containing origin point.
    let x = Math.floor(origin[0]);
    let y = Math.floor(origin[1]);
    let z = Math.floor(origin[2]);
    // Break out direction vector.
    const [dx, dy, dz] = direction;
    // Direction to increment x,y,z when stepping.
    const stepX = Math.sign(dx);
    const stepY = Math.sign(dy);
    const stepZ = Math.sign(dz);
    // See description above. The initial values depend on the fractional
    // part of the origin.
    let tMaxX = this.intbound(origin[0], dx);
    let tMaxY = this.intbound(origin[1], dy);
    let tMaxZ = this.intbound(origin[2], dz);
    // The change in t when taking a step (always positive).
    const tDeltaX = stepX / dx;
    const tDeltaY = stepY / dy;
    const tDeltaZ = stepZ / dz;

    // Avoids an infinite loop.
    // reject if the direction is zero
    assert(vec3_dot(direction, direction) !== 0, "direction vector is 0");

    // Rescale from units of 1 cube-edge to units of 'direction' so we can
    // compare with 't'.
    const radius = max_dist / Math.sqrt(dx * dx + dy * dy + dz * dz);

    let face = Face.UP;

    while (true) {
      // get block here
      const blockIndex = this.getBlock([x, y, z]);
      if (blockIndex === null) {
        break;
      }

      if (this.blockManager.defs[blockIndex].pointable) {
        return {
          coords: [x, y, z],
          face
        };
      }

      // tMaxX stores the t-value at which we cross a cube boundary along the
      // X axis, and similarly for Y and Z. Therefore, choosing the least tMax
      // chooses the closest cube boundary. Only the first case of the four
      // has been commented in detail.
      if (tMaxX < tMaxY) {
        if (tMaxX < tMaxZ) {
          if (tMaxX > radius)
            break;
          // Update which cube we are now in.
          x += stepX;
          // Adjust tMaxX to the next X-oriented boundary crossing.
          tMaxX += tDeltaX;
          // Record the normal vector of the cube face we entered.
          face = stepX == 1 ? Face.LEFT : Face.RIGHT;
        } else {
          if (tMaxZ > radius)
            break;
          z += stepZ;
          tMaxZ += tDeltaZ;
          face = stepZ == 1 ? Face.BACK : Face.FRONT;
        }
      } else {
        if (tMaxY < tMaxZ) {
          if (tMaxY > radius)
            break;
          y += stepY;
          tMaxY += tDeltaY;
          face = stepY == 1 ? Face.UP : Face.DOWN;
        } else {
          // Identical to the second case, repeated for simplicity in
          // the conditionals.
          if (tMaxZ > radius)
            break;
          z += stepZ;
          tMaxZ += tDeltaZ;
          face = stepZ == 1 ? Face.BACK : Face.FRONT;
        }
      }
    }
    return null;
  }

}

// get chunk data index
function chunkDataIndex(x: number, y: number, z: number) {
  return Math.floor(x) * CHUNK_Y_SIZE * CHUNK_Z_SIZE + Math.floor(y) * CHUNK_Z_SIZE + Math.floor(z);
}


// generate chunk data
function genChunkData(worldChunkCoords: vec3, noise: (x: number, y: number, z: number) => number) {
  // generate chunk, we need to give it the block coordinate to generate at
  const chunkOffset = [
    worldChunkCoords[0] * CHUNK_X_SIZE,
    worldChunkCoords[1] * CHUNK_Y_SIZE,
    worldChunkCoords[2] * CHUNK_Z_SIZE
  ];

  const blocks = new Uint16Array(CHUNK_X_SIZE * CHUNK_Y_SIZE * CHUNK_Z_SIZE);

  const scale1 = 20.0;
  for (let x = 0; x < CHUNK_X_SIZE; x++) {
    for (let y = 0; y < CHUNK_Y_SIZE; y++) {
      for (let z = 0; z < CHUNK_Z_SIZE; z++) {
        // this is the offset within the blocks array to store the value
        const off_xyz = chunkDataIndex(x, y, z);

        // calculate world coordinates in blocks
        const wx = x + chunkOffset[0];
        const wy = y + chunkOffset[1];
        const wz = z + chunkOffset[2];
        const valHere = noise(wx / scale1, wy / scale1, wz / scale1);
        const valAbove = noise(wx / scale1, (wy - 1) / scale1, wz / scale1);

        if (valHere > 0) {
          if (valAbove > 0) {
            blocks[off_xyz] = 3; // stone
          } else {
            blocks[off_xyz] = 1; // grass
          }
        } else {
          blocks[off_xyz] = 0; // air
        }
      }
    }
  }
  blocks[0] = 4;
  blocks[1] = 0;
  blocks[2] = 4;
  blocks[3] = 5;

  return blocks;
}

type Light = {
  pos: vec3
  dir: vec3
}

type ChunkMesh = {
  solid: Vertex[],
  transparent: Vertex[]
  lights: Light[];
}

function shouldRender(thisblock: BlockDef, otherblock: BlockDef) {
  // dont render air
  if (thisblock.textures === undefined) {
    return false;
  }
  // dont render if both blocks are solid
  if (!thisblock.transparent && !otherblock.transparent) {
    return false;
  }
  // dont render if both blocks are the same type
  if (thisblock == otherblock) {
    return false;
  }
  return true;
}

function createMesh(
  offset: vec3,
  bm: BlockManager,
  blocks: Uint16Array,
  leftBlocks: Uint16Array,
  rightBlocks: Uint16Array,
  upBlocks: Uint16Array,
  downBlocks: Uint16Array,
  backBlocks: Uint16Array,
  frontBlocks: Uint16Array,
): ChunkMesh {


  const lights: Light[] = [];
  const solid: Vertex[] = [];
  const transparent: Vertex[] = [];

  for (let x = 0; x < CHUNK_X_SIZE; x++) {
    for (let y = 0; y < CHUNK_Y_SIZE; y++) {
      for (let z = 0; z < CHUNK_Z_SIZE; z++) {
        const bi = blocks[chunkDataIndex(x, y, z)];
        // block definition of this block
        const thisblock = bm.defs[bi];

        // skip air
        if (thisblock.textures === undefined) {
          continue;
        }

        // get chunk location
        const fx = x + offset[0];
        const fy = y + offset[1];
        const fz = z + offset[2];

        // calculate vertexes
        const v000: vec3 = [fx + 0, fy + 0, fz + 0];
        const v100: vec3 = [fx + 1, fy + 0, fz + 0];
        const v001: vec3 = [fx + 0, fy + 0, fz + 1];
        const v101: vec3 = [fx + 1, fy + 0, fz + 1];
        const v010: vec3 = [fx + 0, fy + 1, fz + 0];
        const v110: vec3 = [fx + 1, fy + 1, fz + 0];
        const v011: vec3 = [fx + 0, fy + 1, fz + 1];
        const v111: vec3 = [fx + 1, fy + 1, fz + 1];

        const blockCenter: vec3 = [fx + 0.5, fy + 0.5, fz + 0.5];

        // the array to put the faces into depends on 
        const vertexes = thisblock.transparent
          ? transparent
          : solid;

        // left face
        if (
          x === 0
            ? shouldRender(thisblock, bm.defs[leftBlocks[chunkDataIndex(CHUNK_X_SIZE - 1, y, z)]])
            : shouldRender(thisblock, bm.defs[blocks[chunkDataIndex(x - 1, y, z)]])
        ) {
          const v = bi * 6 + Face.LEFT;
          vertexes.push({ position: v000, tuv: [1, 0, v] });
          vertexes.push({ position: v001, tuv: [0, 0, v] });
          vertexes.push({ position: v010, tuv: [1, 1, v] });
          vertexes.push({ position: v001, tuv: [0, 0, v] });
          vertexes.push({ position: v011, tuv: [0, 1, v] });
          vertexes.push({ position: v010, tuv: [1, 1, v] });
          if (thisblock.light) {
            lights.push({
              pos: blockCenter,
              dir: getNormal(Face.LEFT),
            });
          }
        }
        // right face
        if (
          x === CHUNK_X_SIZE - 1
            ? shouldRender(thisblock, bm.defs[rightBlocks[chunkDataIndex(0, y, z)]])
            : shouldRender(thisblock, bm.defs[blocks[chunkDataIndex(x + 1, y, z)]])
        ) {
          const v = bi * 6 + Face.RIGHT;
          vertexes.push({ position: v100, tuv: [0, 0, v] });
          vertexes.push({ position: v110, tuv: [0, 1, v] });
          vertexes.push({ position: v101, tuv: [1, 0, v] });
          vertexes.push({ position: v101, tuv: [1, 0, v] });
          vertexes.push({ position: v110, tuv: [0, 1, v] });
          vertexes.push({ position: v111, tuv: [1, 1, v] });
          if (thisblock.light) {
            lights.push({
              pos: blockCenter,
              dir: getNormal(Face.RIGHT),
            });
          }
        }
        // upper face
        if (
          y === 0
            ? shouldRender(thisblock, bm.defs[upBlocks[chunkDataIndex(x, CHUNK_Y_SIZE - 1, z)]])
            : shouldRender(thisblock, bm.defs[blocks[chunkDataIndex(x, y - 1, z)]])
        ) {
          const v = bi * 6 + Face.UP;
          vertexes.push({ position: v001, tuv: [1, 1, v] });
          vertexes.push({ position: v000, tuv: [1, 0, v] });
          vertexes.push({ position: v100, tuv: [0, 0, v] });
          vertexes.push({ position: v001, tuv: [1, 1, v] });
          vertexes.push({ position: v100, tuv: [0, 0, v] });
          vertexes.push({ position: v101, tuv: [0, 1, v] });
          if (thisblock.light) {
            lights.push({
              pos: blockCenter,
              dir: getNormal(Face.UP),
            });
          }
        }
        // lower face
        if (
          y === CHUNK_Y_SIZE - 1
            ? shouldRender(thisblock, bm.defs[downBlocks[chunkDataIndex(x, 0, z)]])
            : shouldRender(thisblock, bm.defs[blocks[chunkDataIndex(x, y + 1, z)]])
        ) {
          const v = bi * 6 + Face.DOWN;
          vertexes.push({ position: v010, tuv: [0, 0, v] });
          vertexes.push({ position: v011, tuv: [0, 1, v] });
          vertexes.push({ position: v110, tuv: [1, 0, v] });
          vertexes.push({ position: v110, tuv: [1, 0, v] });
          vertexes.push({ position: v011, tuv: [0, 1, v] });
          vertexes.push({ position: v111, tuv: [1, 1, v] });
          if (thisblock.light) {
            lights.push({
              pos: blockCenter,
              dir: getNormal(Face.DOWN),
            });
          }
        }
        // back face
        if (
          z === 0
            ? shouldRender(thisblock, bm.defs[backBlocks[chunkDataIndex(x, y, CHUNK_Z_SIZE - 1)]])
            : shouldRender(thisblock, bm.defs[blocks[chunkDataIndex(x, y, z - 1)]])
        ) {
          const v = bi * 6 + Face.BACK;
          vertexes.push({ position: v000, tuv: [0, 0, v] });
          vertexes.push({ position: v010, tuv: [0, 1, v] });
          vertexes.push({ position: v100, tuv: [1, 0, v] });
          vertexes.push({ position: v100, tuv: [1, 0, v] });
          vertexes.push({ position: v010, tuv: [0, 1, v] });
          vertexes.push({ position: v110, tuv: [1, 1, v] });
          if (thisblock.light) {
            lights.push({
              pos: blockCenter,
              dir: getNormal(Face.BACK),
            });
          }
        }
        // front face
        if (
          z === CHUNK_Z_SIZE - 1
            ? shouldRender(thisblock, bm.defs[frontBlocks[chunkDataIndex(x, y, 0)]])
            : shouldRender(thisblock, bm.defs[blocks[chunkDataIndex(x, y, z + 1)]])
        ) {
          const v = bi * 6 + Face.FRONT;
          vertexes.push({ position: v011, tuv: [1, 1, v] });
          vertexes.push({ position: v001, tuv: [1, 0, v] });
          vertexes.push({ position: v101, tuv: [0, 0, v] });
          vertexes.push({ position: v011, tuv: [1, 1, v] });
          vertexes.push({ position: v101, tuv: [0, 0, v] });
          vertexes.push({ position: v111, tuv: [0, 1, v] });
          if (thisblock.light) {
            lights.push({
              pos: blockCenter,
              dir: getNormal(Face.FRONT),
            });
          }
        }
      }
    }
  }
  return {
    solid,
    transparent,
    lights
  };
}

function createMeshHighlight(coords: vec3, face: Face, bm: BlockManager) {
  // how much to raise the face
  const faceRaise = 0.05;
  const off0 = -faceRaise;
  const off1 = 1 + faceRaise;

  const vertexes: Vertex[] = [];

  // draw the value of the first pixel on there (probably black)
  const bi = 2;

  // get chunk location
  const fx = coords[0];
  const fy = coords[1];
  const fz = coords[2];

  // calculate vertexes
  const v000: vec3 = [fx + off0, fy + off0, fz + off0];
  const v100: vec3 = [fx + off1, fy + off0, fz + off0];
  const v001: vec3 = [fx + off0, fy + off0, fz + off1];
  const v101: vec3 = [fx + off1, fy + off0, fz + off1];
  const v010: vec3 = [fx + off0, fy + off1, fz + off0];
  const v110: vec3 = [fx + off1, fy + off1, fz + off0];
  const v011: vec3 = [fx + off0, fy + off1, fz + off1];
  const v111: vec3 = [fx + off1, fy + off1, fz + off1];

  switch (face) {
    case Face.LEFT: {
      const v = bi * 6 + Face.LEFT;
      vertexes.push({ position: v000, tuv: [1, 0, v] });
      vertexes.push({ position: v001, tuv: [0, 0, v] });
      vertexes.push({ position: v010, tuv: [1, 1, v] });
      vertexes.push({ position: v001, tuv: [0, 0, v] });
      vertexes.push({ position: v011, tuv: [0, 1, v] });
      vertexes.push({ position: v010, tuv: [1, 1, v] });
      break;
    }
    case Face.RIGHT: {
      const v = bi * 6 + Face.RIGHT;
      vertexes.push({ position: v100, tuv: [0, 0, v] });
      vertexes.push({ position: v110, tuv: [0, 1, v] });
      vertexes.push({ position: v101, tuv: [1, 0, v] });
      vertexes.push({ position: v101, tuv: [1, 0, v] });
      vertexes.push({ position: v110, tuv: [0, 1, v] });
      vertexes.push({ position: v111, tuv: [1, 1, v] });
      break;
    }
    case Face.UP: {
      const v = bi * 6 + Face.UP;
      vertexes.push({ position: v001, tuv: [1, 1, v] });
      vertexes.push({ position: v000, tuv: [1, 0, v] });
      vertexes.push({ position: v100, tuv: [0, 0, v] });
      vertexes.push({ position: v001, tuv: [1, 1, v] });
      vertexes.push({ position: v100, tuv: [0, 0, v] });
      vertexes.push({ position: v101, tuv: [0, 1, v] });
      break;
    }
    case Face.DOWN: {
      const v = bi * 6 + Face.DOWN;
      vertexes.push({ position: v010, tuv: [0, 0, v] });
      vertexes.push({ position: v011, tuv: [0, 1, v] });
      vertexes.push({ position: v110, tuv: [1, 0, v] });
      vertexes.push({ position: v110, tuv: [1, 0, v] });
      vertexes.push({ position: v011, tuv: [0, 1, v] });
      vertexes.push({ position: v111, tuv: [1, 1, v] });
      break;
    }
    case Face.BACK: {
      const v = bi * 6 + Face.BACK;
      vertexes.push({ position: v000, tuv: [0, 0, v] });
      vertexes.push({ position: v010, tuv: [0, 1, v] });
      vertexes.push({ position: v100, tuv: [1, 0, v] });
      vertexes.push({ position: v100, tuv: [1, 0, v] });
      vertexes.push({ position: v010, tuv: [0, 1, v] });
      vertexes.push({ position: v110, tuv: [1, 1, v] });
      break;
    }
    case Face.FRONT: {
      const v = bi * 6 + Face.FRONT;
      vertexes.push({ position: v011, tuv: [1, 1, v] });
      vertexes.push({ position: v001, tuv: [1, 0, v] });
      vertexes.push({ position: v101, tuv: [0, 0, v] });
      vertexes.push({ position: v011, tuv: [1, 1, v] });
      vertexes.push({ position: v101, tuv: [0, 0, v] });
      vertexes.push({ position: v111, tuv: [0, 1, v] });
      break;
    }
  }
  return vertexes;
}
export default World;

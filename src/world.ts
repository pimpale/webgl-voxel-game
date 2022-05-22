import { makeNoise3D } from 'open-simplex-noise';
import { Vertex } from './game';
import { vec2, vec3, vec3_add, vec3_sub, vec3_dot, assert } from './utils';
import { BlockDef, BlockManager, Face, Kind } from './block';

const MAX_CHUNKS_TO_GEN = 1;
const MAX_CHUNKS_TO_MESH = 1;

const CHUNK_X_SIZE = 16;
const CHUNK_Y_SIZE = 16;
const CHUNK_Z_SIZE = 16;

// how many chunks to render
const RENDER_RADIUS_X = 2;
const RENDER_RADIUS_Y = 2;
const RENDER_RADIUS_Z = 2;

type ChunkGraphics = {
  // will be drawn when calculating shadowmap
  solidVao: WebGLVertexArrayObject,
  solidBuffer: WebGLBuffer,
  solidVertexCount: number,
  // will not be drawn when calculating shadowmap
  transparentVao: WebGLVertexArrayObject,
  transparentBuffer: WebGLBuffer,
  transparentVertexCount: number
}

type Chunk = {
  // array must be CHUNK_X_SIZE*CHUNK_Y_SIZE*CHUNK_Z_SIZE
  blocks: Uint16Array,
  graphics?: ChunkGraphics
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



class World {

  private worldChunkCenterLoc: vec3;

  // noise function
  private readonly seed: number;
  private readonly noiseFn: (x: number, y: number, z: number) => number;

  // highlight
  private highlighted: boolean;
  private highlightVao: WebGLVertexArrayObject;
  private highlightBuffer: WebGLBuffer;
  private highlightVertexes: number;

  // list of active lights
  private lights: Light[];

  // hashmap storing chunks
  private chunk_map: Map<string, Chunk>;

  // vector of the coordinates of chunks to generate
  private togenerate: Set<string>;
  // vector of the coordinates of chunks to mesh
  private tomesh: Set<string>;
  // vector of the coordinates of ready chunks
  private ready: Set<string>;

  private gl: WebGL2RenderingContext;
  private blockManager: BlockManager

  private glPositionLoc: number;
  private glUvLoc: number;

  getWorldChunkLoc = (cameraLoc: vec3) => [
    Math.floor(cameraLoc[0] / CHUNK_X_SIZE),
    Math.floor(cameraLoc[1] / CHUNK_Y_SIZE),
    Math.floor(cameraLoc[2] / CHUNK_Z_SIZE),
  ] as vec3;

  constructor(seed: number, cameraLoc: vec3, gl: WebGL2RenderingContext, positionLoc: number, uvLoc: number, blockManager: BlockManager) {
    this.gl = gl;
    this.blockManager = blockManager;
    this.glPositionLoc = positionLoc;
    this.glUvLoc = uvLoc;
    this.seed = seed;
    this.noiseFn = makeNoise3D(seed);
    this.worldChunkCenterLoc = this.getWorldChunkLoc(cameraLoc);
    this.chunk_map = new Map();
    this.lights = [];

    this.togenerate = new Set();
    this.tomesh = new Set();
    this.ready = new Set();

    // initialize highlight
    {
      this.highlighted = false;
      this.highlightVertexes = 0;
      this.highlightVao = this.gl.createVertexArray()!;
      this.gl.bindVertexArray(this.highlightVao);

      this.highlightBuffer = this.gl.createBuffer()!;
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.highlightBuffer);
      // setup our attributes to tell WebGL how to pull
      // the data from the buffer above to the position attribute
      this.gl.enableVertexAttribArray(this.glPositionLoc);
      this.gl.vertexAttribPointer(
        this.glPositionLoc,
        3,              // size (num components)
        this.gl.FLOAT,  // type of data in buffer
        false,          // normalize
        5 * 4,          // stride (0 = auto)
        0 * 4,          // offset
      );
      this.gl.enableVertexAttribArray(this.glUvLoc);
      this.gl.vertexAttribPointer(
        this.glUvLoc,
        2,              // size (num components)
        this.gl.FLOAT,  // type of data in buffer
        false,          // normalize
        5 * 4,          // stride (0 = auto)
        3 * 4,          // offset
      );
    }






    this.updateCameraLoc();
  }

  private shouldBeLoaded = (worldChunkCoords: vec3) => {
    const disp = vec3_sub(worldChunkCoords, this.worldChunkCenterLoc);
    return (disp[0] >= -RENDER_RADIUS_X && disp[0] <= RENDER_RADIUS_X) &&
      (disp[1] >= -RENDER_RADIUS_Y && disp[1] <= RENDER_RADIUS_Y) &&
      (disp[2] >= -RENDER_RADIUS_Z && disp[2] <= RENDER_RADIUS_Z);
  }

  // if the camera new chunk coords misalign with our current chunk coords then
  private updateCameraLoc = () => {
    // if any togenerate chunks now shouldn't be generated, remove them
    for (const coord of this.togenerate) {
      if (!this.shouldBeLoaded(JSON.parse(coord))) {
        this.togenerate.delete(coord);
      }
    }

    // if any tomesh chunks now shouldn't be loaded, unload them
    for (const coord of this.tomesh) {
      if (!this.shouldBeLoaded(JSON.parse(coord))) {
        let chunk = this.chunk_map.get(coord);
        if (chunk !== undefined) {
          if (chunk.graphics !== undefined) {
            this.deleteChunkGraphics(chunk.graphics);
          }
        }
        this.chunk_map.delete(coord);
        this.tomesh.delete(coord);
      }
    }

    // if any ready chunks shouldnt be loaded, unload them
    for (const coord of this.ready) {
      if (!this.shouldBeLoaded(JSON.parse(coord))) {
        let chunk = this.chunk_map.get(coord);
        if (chunk !== undefined) {
          if (chunk.graphics !== undefined) {
            this.deleteChunkGraphics(chunk.graphics);
          }
        }
        this.chunk_map.delete(coord);
        this.ready.delete(coord);
      }
    }

    // initialize all of our neighboring chunks to be on the load list
    for (let x = -RENDER_RADIUS_X; x <= RENDER_RADIUS_X; x++) {
      for (let y = -RENDER_RADIUS_Y; y <= RENDER_RADIUS_Y; y++) {
        for (let z = -RENDER_RADIUS_Z; z <= RENDER_RADIUS_Z; z++) {
          const chunkCoord = vec3_add(this.worldChunkCenterLoc, [x, y, z]);
          this.togenerate.add(JSON.stringify(chunkCoord));
        }
      }
    }
  }

  private makeChunkGraphics = (blocks: Uint16Array, offset: vec3) => {
    const vertexes = createMesh(blocks, offset, this.blockManager);
    const nVertexes = vertexes.length;

    const data = vertexes.flatMap(v => [...v.position, ...v.uv]);

    const vao = this.gl.createVertexArray()!;
    this.gl.bindVertexArray(vao);

    const buffer = this.gl.createBuffer()!;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
    this.gl.bufferData(
      this.gl.ARRAY_BUFFER,
      new Float32Array(data),
      this.gl.STATIC_DRAW
    );

    // setup our attributes to tell WebGL how to pull
    // the data from the buffer above to the position attribute
    this.gl.enableVertexAttribArray(this.glPositionLoc);
    this.gl.vertexAttribPointer(
      this.glPositionLoc,
      3,              // size (num components)
      this.gl.FLOAT,  // type of data in buffer
      false,          // normalize
      5 * 4,          // stride (0 = auto)
      0 * 4,          // offset
    );
    this.gl.enableVertexAttribArray(this.glUvLoc);
    this.gl.vertexAttribPointer(
      this.glUvLoc,
      2,              // size (num components)
      this.gl.FLOAT,  // type of data in buffer
      false,          // normalize
      5 * 4,          // stride (0 = auto)
      3 * 4,          // offset
    );

    return {
      vao,
      buffer,
      nVertexes
    };
  }

  deleteChunkGraphics = (graphics: ChunkGraphics) => {
    this.gl.deleteBuffer(graphics.buffer);
    this.gl.deleteVertexArray(graphics.vao);
  }

  update = (cameraLoc: vec3, cameraDir: vec3) => {
    const ray = this.castRay(cameraLoc, cameraDir, 100);

    if (ray) {
      this.highlighted = true;
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.highlightBuffer);
      const vertexes = createMeshHighlight(ray.coords, ray.face, this.blockManager);
      this.highlightVertexes = vertexes.length;
      const vertexData = vertexes.flatMap(v => [...v.position, ...v.uv]);
      this.gl.bufferData(
        this.gl.ARRAY_BUFFER,
        new Float32Array(vertexData),
        this.gl.DYNAMIC_DRAW
      );
    } else {
      this.highlighted = false;
    }

    // generate at most MAX_CHUNKS_TO_GEN chunks
    let genned_chunks = 0;
    for (const coord of this.togenerate) {
      if (genned_chunks < MAX_CHUNKS_TO_GEN) {
        this.togenerate.delete(coord);
        this.chunk_map.set(coord, {
          blocks: genChunkData(JSON.parse(coord), this.noiseFn),
        });
        this.tomesh.add(coord);
        genned_chunks++;
      }
    }

    // mesh at most MAX_CHUNKS_TO_MESH chunks
    let meshed_chunks = 0;
    for (const coord of this.tomesh) {
      if (meshed_chunks < MAX_CHUNKS_TO_MESH) {
        this.tomesh.delete(coord);
        let chunk = this.chunk_map.get(coord);
        if (chunk !== undefined) {
          if (chunk.graphics !== undefined) {
            this.deleteChunkGraphics(chunk.graphics);
          }
          const parsedCoord = JSON.parse(coord);
          const offset: vec3 = [parsedCoord[0] * CHUNK_X_SIZE, parsedCoord[1] * CHUNK_Y_SIZE, parsedCoord[2] * CHUNK_Z_SIZE];
          chunk.graphics = this.makeChunkGraphics(chunk.blocks, offset);
          this.ready.add(coord);
          meshed_chunks++;
        }
      }
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
    for (const coord of this.ready) {
      let chunk = this.chunk_map.get(coord);
      if (chunk !== undefined && chunk.graphics !== undefined) {
        this.gl.bindVertexArray(chunk.graphics.vao);
        this.gl.drawArrays(this.gl.TRIANGLES, 0, chunk.graphics.nVertexes);
      }
    }
    if (this.highlighted) {
      this.gl.bindVertexArray(this.highlightVao);
      this.gl.drawArrays(this.gl.TRIANGLES, 0, this.highlightVertexes);
    }
  }

  getBlock = (coords: vec3) => {
    const mod = (n: number, d: number) => {
      const ret = n % d;
      if (ret < 0) {
        return ret + d;
      } else {
        return ret;
      }
    }
    const chunk = this.chunk_map.get(JSON.stringify(this.getWorldChunkLoc(coords)));
    if (chunk) {
      return chunk.blocks[chunkDataIndex(
        mod(coords[0], CHUNK_X_SIZE),
        mod(coords[1], CHUNK_Y_SIZE),
        mod(coords[2], CHUNK_Z_SIZE),
      )];
    } else {
      return null;
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

  private castRay = (origin: vec3, direction: vec3, max_dist: number) => {
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

      if (this.blockManager.defs[blockIndex] !== Kind.Air) {
        return {
          coords: [x, y, z] as vec3,
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

function createMesh(blocks: Uint16Array, offset: vec3, bm: BlockManager) {

  // which faces we shouldn't render
  function shouldRenderFace(thisblock: BlockDef, otherblock: BlockDef) {
    // dont render air
    if (thisblock.kind == Kind.Air) {
      return false;
    }
    // dont render if both blocks are solid
    if (thisblock.kind == Kind.Solid && otherblock.kind == Kind.Solid) {
      return false;
    }
    // dont render if both blocks are the same type
    if (thisblock == otherblock) {
      return false;
    }
    return true;
  }

  const light:Light[] = [];
  const solid: Vertex[] = [];
  const translucent: Vertex[] = [];

  for (let x = 0; x < CHUNK_X_SIZE; x++) {
    for (let y = 0; y < CHUNK_Y_SIZE; y++) {
      for (let z = 0; z < CHUNK_Z_SIZE; z++) {
        const bi = blocks[chunkDataIndex(x, y, z)];
        // block definition of this block
        const thisblock = bm.defs[bi];

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

        const xoff = bm.tileTexXsize;
        const yoff = bm.tileTexYsize;

        const blockCenter:vec3 = [fx + 0.5, fy + 0.5, fz + 0.5];

        // the array to put the faces into depends on 
        const vertexes = thisblock.kind === Kind.Solid
        ? solid
        : translucent;

        // left face
        if (x === 0 || shouldRenderFace(thisblock, bm.defs[blocks[chunkDataIndex(x - 1, y, z)]])) {
          const bx = bm.tileTexXsize * Face.LEFT;
          const by = bm.tileTexYsize * bi;
          vertexes.push({ position: v000, uv: [bx + 0.00, by + 0.00] });
          vertexes.push({ position: v010, uv: [bx + 0.00, by + yoff] });
          vertexes.push({ position: v001, uv: [bx + xoff, by + 0.00] });
          vertexes.push({ position: v001, uv: [bx + xoff, by + 0.00] });
          vertexes.push({ position: v010, uv: [bx + 0.00, by + yoff] });
          vertexes.push({ position: v011, uv: [bx + xoff, by + yoff] });

          if(thisblock.kind == Kind.Light) {
              lights.push({
                  pos: blockCenter,
                  dir:   // TODO!
          }
        }
        // right face
        if (x === CHUNK_X_SIZE - 1 || shouldRenderFace(thisblock, bm.defs[blocks[chunkDataIndex(x + 1, y, z)]])) {
          const bx = bm.tileTexXsize * Face.RIGHT;
          const by = bm.tileTexYsize * bi;
          vertexes.push({ position: v100, uv: [bx + xoff, by + 0.00] });
          vertexes.push({ position: v101, uv: [bx + 0.00, by + 0.00] });
          vertexes.push({ position: v110, uv: [bx + xoff, by + yoff] });
          vertexes.push({ position: v101, uv: [bx + 0.00, by + 0.00] });
          vertexes.push({ position: v111, uv: [bx + 0.00, by + yoff] });
          vertexes.push({ position: v110, uv: [bx + xoff, by + yoff] });
        }
        // upper face
        if (y === 0 || shouldRenderFace(thisblock, bm.defs[blocks[chunkDataIndex(x, y - 1, z)]])) {
          const bx = bm.tileTexXsize * Face.UP;
          const by = bm.tileTexYsize * bi;
          vertexes.push({ position: v001, uv: [bx + 0.00, by + yoff] });
          vertexes.push({ position: v100, uv: [bx + xoff, by + 0.00] });
          vertexes.push({ position: v000, uv: [bx + 0.00, by + 0.00] });
          vertexes.push({ position: v001, uv: [bx + 0.00, by + yoff] });
          vertexes.push({ position: v101, uv: [bx + xoff, by + yoff] });
          vertexes.push({ position: v100, uv: [bx + xoff, by + 0.00] });
        }
        // lower face
        if (y === CHUNK_Y_SIZE - 1 || shouldRenderFace(thisblock, bm.defs[blocks[chunkDataIndex(x, y + 1, z)]])) {
          const bx = bm.tileTexXsize * Face.DOWN;
          const by = bm.tileTexYsize * bi;
          vertexes.push({ position: v010, uv: [bx + xoff, by + 0.00] });
          vertexes.push({ position: v110, uv: [bx + 0.00, by + 0.00] });
          vertexes.push({ position: v011, uv: [bx + xoff, by + yoff] });
          vertexes.push({ position: v110, uv: [bx + 0.00, by + 0.00] });
          vertexes.push({ position: v111, uv: [bx + 0.00, by + yoff] });
          vertexes.push({ position: v011, uv: [bx + xoff, by + yoff] });
        }
        // back face
        if (z === 0 || shouldRenderFace(thisblock, bm.defs[blocks[chunkDataIndex(x, y, z - 1)]])) {
          const bx = bm.tileTexXsize * Face.BACK;
          const by = bm.tileTexYsize * bi;
          vertexes.push({ position: v000, uv: [bx + xoff, by + 0.00] });
          vertexes.push({ position: v100, uv: [bx + 0.00, by + 0.00] });
          vertexes.push({ position: v010, uv: [bx + xoff, by + yoff] });
          vertexes.push({ position: v100, uv: [bx + 0.00, by + 0.00] });
          vertexes.push({ position: v110, uv: [bx + 0.00, by + yoff] });
          vertexes.push({ position: v010, uv: [bx + xoff, by + yoff] });
        }
        // front face
        if (z === CHUNK_Z_SIZE - 1 || shouldRenderFace(thisblock, bm.defs[blocks[chunkDataIndex(x, y, z + 1)]])) {
          const bx = bm.tileTexXsize * Face.FRONT;
          const by = bm.tileTexYsize * bi;
          vertexes.push({ position: v011, uv: [bx + 0.00, by + yoff] });
          vertexes.push({ position: v101, uv: [bx + xoff, by + 0.00] });
          vertexes.push({ position: v001, uv: [bx + 0.00, by + 0.00] });
          vertexes.push({ position: v011, uv: [bx + 0.00, by + yoff] });
          vertexes.push({ position: v111, uv: [bx + xoff, by + yoff] });
          vertexes.push({ position: v101, uv: [bx + xoff, by + 0.00] });
        }
      }
    }
  }
  return vertexes;
}

function createMeshHighlight(coords: vec3, face: Face, bm: BlockManager) {
  // how much to raise the face
  const faceRaise = 0.05;
  const off0 = -faceRaise;
  const off1 = 1 + faceRaise;

  const vertexes: Vertex[] = [];

  // draw the value of the first pixel on there (probably black)
  const bi = 0;

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

  const xoff = bm.tileTexXsize;
  const yoff = bm.tileTexYsize;

  switch (face) {
    case Face.LEFT: {
      const bx = bm.tileTexXsize * Face.LEFT;
      const by = bm.tileTexYsize * bi;
      vertexes.push({ position: v000, uv: [bx + 0.00, by + 0.00] });
      vertexes.push({ position: v010, uv: [bx + 0.00, by + yoff] });
      vertexes.push({ position: v001, uv: [bx + xoff, by + 0.00] });
      vertexes.push({ position: v001, uv: [bx + xoff, by + 0.00] });
      vertexes.push({ position: v010, uv: [bx + 0.00, by + yoff] });
      vertexes.push({ position: v011, uv: [bx + xoff, by + yoff] });
      break;
    }
    case Face.RIGHT: {
      const bx = bm.tileTexXsize * Face.RIGHT;
      const by = bm.tileTexYsize * bi;
      vertexes.push({ position: v100, uv: [bx + xoff, by + 0.00] });
      vertexes.push({ position: v101, uv: [bx + 0.00, by + 0.00] });
      vertexes.push({ position: v110, uv: [bx + xoff, by + yoff] });
      vertexes.push({ position: v101, uv: [bx + 0.00, by + 0.00] });
      vertexes.push({ position: v111, uv: [bx + 0.00, by + yoff] });
      vertexes.push({ position: v110, uv: [bx + xoff, by + yoff] });
      break;
    }
    case Face.UP: {
      const bx = bm.tileTexXsize * Face.UP;
      const by = bm.tileTexYsize * bi;
      vertexes.push({ position: v001, uv: [bx + 0.00, by + yoff] });
      vertexes.push({ position: v100, uv: [bx + xoff, by + 0.00] });
      vertexes.push({ position: v000, uv: [bx + 0.00, by + 0.00] });
      vertexes.push({ position: v001, uv: [bx + 0.00, by + yoff] });
      vertexes.push({ position: v101, uv: [bx + xoff, by + yoff] });
      vertexes.push({ position: v100, uv: [bx + xoff, by + 0.00] });
      break;
    }
    case Face.DOWN: {
      const bx = bm.tileTexXsize * Face.DOWN;
      const by = bm.tileTexYsize * bi;
      vertexes.push({ position: v010, uv: [bx + xoff, by + 0.00] });
      vertexes.push({ position: v110, uv: [bx + 0.00, by + 0.00] });
      vertexes.push({ position: v011, uv: [bx + xoff, by + yoff] });
      vertexes.push({ position: v110, uv: [bx + 0.00, by + 0.00] });
      vertexes.push({ position: v111, uv: [bx + 0.00, by + yoff] });
      vertexes.push({ position: v011, uv: [bx + xoff, by + yoff] });
      break;
    }
    case Face.BACK: {
      const bx = bm.tileTexXsize * Face.BACK;
      const by = bm.tileTexYsize * bi;
      vertexes.push({ position: v000, uv: [bx + xoff, by + 0.00] });
      vertexes.push({ position: v100, uv: [bx + 0.00, by + 0.00] });
      vertexes.push({ position: v010, uv: [bx + xoff, by + yoff] });
      vertexes.push({ position: v100, uv: [bx + 0.00, by + 0.00] });
      vertexes.push({ position: v110, uv: [bx + 0.00, by + yoff] });
      vertexes.push({ position: v010, uv: [bx + xoff, by + yoff] });
      break;
    }
    case Face.FRONT: {
      const bx = bm.tileTexXsize * Face.FRONT;
      const by = bm.tileTexYsize * bi;
      vertexes.push({ position: v011, uv: [bx + 0.00, by + yoff] });
      vertexes.push({ position: v101, uv: [bx + xoff, by + 0.00] });
      vertexes.push({ position: v001, uv: [bx + 0.00, by + 0.00] });
      vertexes.push({ position: v011, uv: [bx + 0.00, by + yoff] });
      vertexes.push({ position: v111, uv: [bx + xoff, by + yoff] });
      vertexes.push({ position: v101, uv: [bx + xoff, by + 0.00] });
      break;
    }
  }
  return vertexes;
}
export default World;

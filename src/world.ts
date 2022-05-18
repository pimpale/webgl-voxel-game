import { makeNoise3D } from 'open-simplex-noise';
import { Vertex } from './game';
import { vec2, vec3 } from './utils';
import * as Block from './block';

const CHUNK_X_SIZE = 16;
const CHUNK_Y_SIZE = 16;
const CHUNK_Z_SIZE = 16;

type Chunk = {
  // array must be CHUNK_X_SIZE*CHUNK_Y_SIZE*CHUNK_Z_SIZE
  blocks: Uint16Array,
  buffer: WebGLBuffer
}

class World {

  private centerLoc: vec3;

  // noise function
  private readonly seed: number;
  private readonly noiseFn: (x: number, y: number, z: number) => number;

  // hashmap storing chunks
  private chunk_map: Map<string, Chunk>;

  // vector of the coordinates of chunks to generate
  private togenerate: vec3[];
  // vector of the coordinates of chunks to mesh
  private tomesh: vec3[];
  // vector of the coordinates of ready chunks
  private ready: vec3[];
  // vector of the coordinates of chunks to unload
  private tounload: vec3[];

  constructor(seed: number, centerLoc: vec3) {
    this.seed = seed;
    this.noiseFn = makeNoise3D(seed);
    this.centerLoc = centerLoc;
    this.chunk_map = new Map();

    this.togenerate = [];
    this.tomesh = [];
    this.ready = [];
    this.tounload = [];
  }


  update = () => {

  }


}

// generate chunk data
function genChunkData(    //
  worldChunkCoords: vec3, //
  noise: (x: number, y: number, z: number) => number//
): Uint16Array {
  // generate chunk, we need to give it the block coordinate to generate at
  const chunkOffset = [
    worldChunkCoords[0] * CHUNK_X_SIZE,
    worldChunkCoords[1] * CHUNK_Y_SIZE,
    worldChunkCoords[2] * CHUNK_Z_SIZE
  ];

  const blocks = new Uint16Array(CHUNK_X_SIZE * CHUNK_Y_SIZE * CHUNK_Z_SIZE);

  const scale1 = 20.0;
  for (let x = 0; x < CHUNK_X_SIZE; x++) {
    const off_x = x * CHUNK_Y_SIZE * CHUNK_Z_SIZE;
    for (let y = 0; y < CHUNK_Y_SIZE; y++) {
      const off_xy = off_x + y * CHUNK_Z_SIZE;
      for (let z = 0; z < CHUNK_Z_SIZE; z++) {
        // this is the offset within the blocks array to store the value
        const off_xyz = off_xy + z;

        // calculate world coordinates in blocks
        const wx = x + chunkOffset[0];
        const wy = y + chunkOffset[1];
        const wz = z + chunkOffset[2];
        const val = noise(wx / scale1, wy / scale1, wz / scale1);
        const val2 = noise(wx / scale1, (wy - 1) / scale1, wz / scale1);

        if (val > 0 && val2 < 0) {
          blocks[off_xyz] = 1; // grass
        } else if (val > 0) {
          blocks[off_xyz] = 2; // grass
        } else {
          blocks[off_xyz] = 0; // air
        }
      }
    }
  }

  return blocks;
}

function createMesh(
  blocks: Uint16Array,
  offset: vec3,
) {
  function index(x: number, y: number, z: number) {
    return x * CHUNK_Y_SIZE * CHUNK_Z_SIZE + y * CHUNK_Z_SIZE + z;
  }

  const vertexes: Vertex[] = [];

  for (let x = 0; x < CHUNK_X_SIZE; x++) {
    for (let y = 0; y < CHUNK_Y_SIZE; y++) {
      for (let z = 0; z < CHUNK_Z_SIZE; z++) {
        const bi = blocks[index(x, y, z)];
        // check that its not transparent
        if (Block.DEFS[bi].transparent) {
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

        const xoff = Block.TILE_TEX_XSIZE;
        const yoff = Block.TILE_TEX_YSIZE;

        // left face
        if (x == 0 || Block.DEFS[blocks[index(x - 1, y, z)]].transparent) {
          const bx = Block.TILE_TEX_XSIZE * Block.LEFT;
          const by = Block.TILE_TEX_YSIZE * bi;
          vertexes.push({ position: v000, uv: [bx + 0.00, by + 0.00] });
          vertexes.push({ position: v010, uv: [bx + 0.00, by + yoff] });
          vertexes.push({ position: v001, uv: [bx + xoff, by + 0.00] });
          vertexes.push({ position: v001, uv: [bx + xoff, by + 0.00] });
          vertexes.push({ position: v010, uv: [bx + 0.00, by + yoff] });
          vertexes.push({ position: v011, uv: [bx + xoff, by + yoff] });
        }
        // right face
        if (x == CHUNK_X_SIZE - 1 || Block.DEFS[blocks[index(x + 1, y, z)]].transparent) {
          const bx = Block.TILE_TEX_XSIZE * Block.RIGHT;
          const by = Block.TILE_TEX_YSIZE * bi;
          vertexes.push({ position: v100, uv: [bx + xoff, by + 0.00] });
          vertexes.push({ position: v101, uv: [bx + 0.00, by + 0.00] });
          vertexes.push({ position: v110, uv: [bx + xoff, by + yoff] });
          vertexes.push({ position: v101, uv: [bx + 0.00, by + 0.00] });
          vertexes.push({ position: v111, uv: [bx + 0.00, by + yoff] });
          vertexes.push({ position: v110, uv: [bx + xoff, by + yoff] });
        }
        // upper face
        if (y == 0 || Block.DEFS[blocks[index(x, y - 1, z)]].transparent) {
          const bx = Block.TILE_TEX_XSIZE * Block.UP;
          const by = Block.TILE_TEX_YSIZE * bi;
          vertexes.push({ position: v001, uv: [bx + 0.00, by + yoff] });
          vertexes.push({ position: v100, uv: [bx + xoff, by + 0.00] });
          vertexes.push({ position: v000, uv: [bx + 0.00, by + 0.00] });
          vertexes.push({ position: v001, uv: [bx + 0.00, by + yoff] });
          vertexes.push({ position: v101, uv: [bx + xoff, by + yoff] });
          vertexes.push({ position: v100, uv: [bx + xoff, by + 0.00] });
        }
        // lower face
        if (y == CHUNK_Y_SIZE - 1 || Block.DEFS[blocks[index(x, y + 1, z)]].transparent) {
          const bx = Block.TILE_TEX_XSIZE * Block.DOWN;
          const by = Block.TILE_TEX_YSIZE * bi;
          vertexes.push({ position: v010, uv: [bx + xoff, by + 0.00] });
          vertexes.push({ position: v110, uv: [bx + 0.00, by + 0.00] });
          vertexes.push({ position: v011, uv: [bx + xoff, by + yoff] });
          vertexes.push({ position: v110, uv: [bx + 0.00, by + 0.00] });
          vertexes.push({ position: v111, uv: [bx + 0.00, by + yoff] });
          vertexes.push({ position: v011, uv: [bx + xoff, by + yoff] });
        }
        // back face
        if (z == 0 || Block.DEFS[blocks[index(x, y, z - 1)]].transparent) {
          const bx = Block.TILE_TEX_XSIZE * Block.BACK;
          const by = Block.TILE_TEX_YSIZE * bi;
          vertexes.push({ position: v000, uv: [bx + xoff, by + 0.00] });
          vertexes.push({ position: v100, uv: [bx + 0.00, by + 0.00] });
          vertexes.push({ position: v010, uv: [bx + xoff, by + yoff] });
          vertexes.push({ position: v100, uv: [bx + 0.00, by + 0.00] });
          vertexes.push({ position: v110, uv: [bx + 0.00, by + yoff] });
          vertexes.push({ position: v010, uv: [bx + xoff, by + yoff] });
        }
        // front face
        if (z == CHUNK_Z_SIZE - 1 || Block.DEFS[blocks[index(x, y, z + 1)]].transparent) {
          const bx = Block.TILE_TEX_XSIZE * Block.FRONT;
          const by = Block.TILE_TEX_YSIZE * bi;
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

import { makeNoise3D } from 'open-simplex-noise';

import { vec3 } from './utils';

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

  constructor(seed: number, centerLoc:vec3) {
    this.seed = seed;
    this.noiseFn = makeNoise3D(seed);
    this.centerLoc = centerLoc;
    this.chunk_map = new Map();

    this.togenerate = [];
    this.tomesh = [];
    this.ready = [];
    this.tounload = [];
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
      const off_xy = off_x + y * CHUNK_Y_SIZE;
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

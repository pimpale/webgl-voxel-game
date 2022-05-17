import {makeNoise3D} from 'open-simplex-noise';

import {vec3} from './utils';

const CHUNK_X_SIZE = 16;
const CHUNK_Y_SIZE = 16;
const CHUNK_Z_SIZE = 16;

class World {
  private centerLoc: vec3;

  // noise function
  private readonly seed: number;
  private readonly noiseFn: (x:number, y:number, z:number) => number;

  // hashmap storing chunks
  private chunk_map: Map<string, { blocks: Uint16Array, buffer: WebGLBuffer}>;

  // vector of the coordinates of chunks to generate
  ivec3_vec *togenerate;
  // vector of the coordinates of chunks that are asynchronously generating
  ivec3_vec *generating;
  // vector of the coordinates of chunks to mesh
  ivec3_vec *tomesh;
  // vector of the coordinates of ready chunks
  ivec3_vec *ready;
  // vector of the coordinates of chunks to unload
  ivec3_vec *tounload;


}

// generate chunk data
void worldgen_state_gen_chunk(    //
    ChunkData *pCd,               //
    const ivec3 worldChunkCoords, //
    const worldgen_state *state   //
) {
  // generate chunk, we need to give it the block coordinate to generate at
  vec3 chunkOffset;
  worldChunkCoords_to_blockCoords(chunkOffset, worldChunkCoords);

  double scale1 = 20.0;
  for (uint32_t x = 0; x < CHUNK_X_SIZE; x++) {
    for (uint32_t y = 0; y < CHUNK_Y_SIZE; y++) {
      for (uint32_t z = 0; z < CHUNK_Z_SIZE; z++) {
        // calculate world coordinates in blocks
        double wx = x + (double)chunkOffset[0];
        double wy = y + (double)chunkOffset[1];
        double wz = z + (double)chunkOffset[2];
        double val = open_simplex_noise3(state->noiseCtx, wx / scale1,
                                         wy / scale1, wz / scale1);
        double val2 = open_simplex_noise3(state->noiseCtx, wx / scale1,
                                          (wy - 1) / scale1, wz / scale1);
        if (val > 0 && val2 < 0) {
          pCd->blocks[x][y][z] = 1; // grass
        } else if (val > 0) {
          pCd->blocks[x][y][z] = 2; // grass
        } else {
          pCd->blocks[x][y][z] = 0; // air
        }
      }
    }
  }
}

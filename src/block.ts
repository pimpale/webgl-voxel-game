import { assert, vec3 } from './utils';
// this file contains block definitions
export enum Face {
  LEFT = 0,
  RIGHT = 1,
  UP = 2,
  DOWN = 3,
  FRONT = 4,
  BACK = 5,
}

export function getNormal(face: Face) {
  switch (face) {
    case Face.LEFT: {
      return [-1, 0, 0] as vec3
    }
    case Face.RIGHT: {
      return [+1, 0, 0] as vec3
    }
    case Face.UP: {
      return [0, -1, 0] as vec3
    }
    case Face.DOWN: {
      return [0, +1, 0] as vec3
    }
    case Face.BACK: {
      return [0, 0, -1] as vec3
    }
    case Face.FRONT: {
      return [0, 0, +1] as vec3
    }
  }
}

export type BlockTextures = [
  left: HTMLImageElement,
  right: HTMLImageElement,
  up: HTMLImageElement,
  down: HTMLImageElement,
  front: HTMLImageElement,
  back: HTMLImageElement
];

export type BlockDef = {
  // name of block
  name: string,
  // if the block is solid to pointer
  pointable: boolean,
  // if the block emits light
  light: boolean,
  // if the block should be treated with transparency
  // light implies this. Otherwise only the block face will be lit up
  transparent: boolean
  // if undefined the block is invisible
  textures?: BlockTextures
}

export class BlockManager {
  readonly defs: BlockDef[];
  readonly tileSize: number;

  constructor(tileSize: number, defs: BlockDef[]) {
    this.tileSize = tileSize;
    this.defs = defs;
    // validate tiles
    for (let block_index = 0; block_index < this.defs.length; block_index++) {
      const block = this.defs[block_index];
      if (block.textures === undefined) {
        continue;
      }
      for (let face_index = 0; face_index < block.textures.length; face_index++) {
        const img = block.textures[face_index];
        assert(img.height === tileSize, `block #${block_index} face #${face_index} height != ${tileSize}, found ${img.height}`);
        assert(img.width === tileSize, `block #${block_index} face #${face_index} width != ${tileSize}, found ${img.width}`);
      }
    }

  }

  buildTextureAtlas = (gl: WebGL2RenderingContext) => {
    let tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); // see https://webglfundamentals.org/webgl/lessons/webgl-data-textures.html
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    // initialize image by loading with transparent black for now
    const data = new Uint8Array(this.tileSize * this.tileSize * this.defs.length *  6 * 4);

    // (required to initialize before doing texSubImage3D)
    gl.texImage3D(
      gl.TEXTURE_2D_ARRAY, // texture kind
      0, // write at 0 level
      gl.RGBA, // internalformat
      this.tileSize, // width
      this.tileSize, // height
      this.defs.length * 6, // depth (has to be enough to store all faces)
      0, // border
      gl.RGBA, // format
      gl.UNSIGNED_BYTE, // type
      data, // pixels
    );

    for (let block_index = 0; block_index < this.defs.length; block_index++) {
      const block = this.defs[block_index];
      // do nothing if transparent block
      if (block.textures === undefined) {
        continue;
      }
      // write each face
      for (let face_index = 0; face_index < block.textures.length; face_index++) {
        gl.texSubImage3D(
          gl.TEXTURE_2D_ARRAY, // texture kind
          0, // write at 0 level
          0, // x offset
          0, // y offset
          block_index * 6 + face_index, // z offset
          this.tileSize, // width
          this.tileSize, // height
          1, // depth
          gl.RGBA, // format
          gl.UNSIGNED_BYTE, // type
          block.textures[face_index]
        );
      }
    }

    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);

    return tex;
  }
}


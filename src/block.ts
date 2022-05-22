import { assert } from './utils';
// this file contains block definitions
export enum Face {
  LEFT = 0,
  RIGHT = 1,
  UP = 2,
  DOWN = 3,
  FRONT = 4,
  BACK = 5,
}

export type BlockDef =
  { name: string } &
  (
    {
      transparent: true
    } |
    {
      transparent: false,
      textures: [
        left: HTMLImageElement,
        right: HTMLImageElement,
        up: HTMLImageElement,
        down: HTMLImageElement,
        front: HTMLImageElement,
        back: HTMLImageElement
      ]
    }
  )

// TODO: create a const here that a texture atlas using the defs
// Each row represents a block. The first row will be ignored, since air is transparent
// The second row should be grass, and the third row should be stone.
// Each row of the texture atlas should have 6 images, making it 16*6 pixels wide


export class BlockManager {

  // The reason its 1/6 is that there are 6 faces on a cube.
  // The texture map tile takes up 1/6
  readonly tileTexXsize: number;
  readonly tileTexYsize: number;
  readonly defs: BlockDef[];
  readonly tileSize: number;

  constructor(tileSize: number, defs: BlockDef[]) {
    this.tileSize = tileSize;
    this.defs = defs;
    this.tileTexXsize = 1 / 6;
    this.tileTexYsize = 1 / defs.length;

    // validate tiles
    for (let block_index = 0; block_index < this.defs.length; block_index++) {
      const block = this.defs[block_index];
      if (block.transparent) {
        continue;
      }
      for (let face_index = 0; face_index < block.textures.length; face_index++) {
        const img = block.textures[face_index];
        assert(img.height === tileSize, `block #{block_index} face #{face_index} height != {tileSize}`);
        assert(img.width === tileSize, `block #{block_index} face #{face_index} width != {tileSize}`);
      }
    }

  }

  buildTextureAtlas = (gl: WebGL2RenderingContext) => {
    let tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); // see https://webglfundamentals.org/webgl/lessons/webgl-data-textures.html
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);


    // atlas must be big enough to store all the images
    const atlasXsize = this.tileSize*6;
    const atlasYsize = this.tileSize*this.defs.length;

    // initialize image by loading with black for now
    const data = new Uint8Array(atlasXsize*atlasYsize*4);

    // (required to initialize before doing texSubImage2D)
    gl.texImage2D(
      gl.TEXTURE_2D, // texture kind
      0, // write at 0 level
      gl.RGBA, // internalformat
      atlasXsize, // width
      atlasYsize, // height
      0, // border
      gl.RGBA, // format
      gl.UNSIGNED_BYTE, // type
      data, // pixels
    );


    for (let block_index = 0; block_index < this.defs.length; block_index++) {
      const block = this.defs[block_index];
      // do nothing if transparent block
      if (block.transparent) {
        continue;
      }
      // write each face
      for (let face_index = 0; face_index < block.textures.length; face_index++) {
        gl.texSubImage2D(
          gl.TEXTURE_2D, // texture kind
          0, // write at 0 level
          face_index * this.tileSize, // x offset
          block_index * this.tileSize, // y offset
          this.tileSize, // width
          this.tileSize, // height
          gl.RGBA, // format
          gl.UNSIGNED_BYTE, // type
          block.textures[face_index]
        );
      }
    }

    gl.generateMipmap(gl.TEXTURE_2D);

    return tex;
  }
}

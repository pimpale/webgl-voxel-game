// this file contains block definitions
export const LEFT = 0;
export const RIGHT = 1;
export const UP = 2;
export const DOWN = 3;
export const FRONT = 4;
export const BACK = 5;

type BlockDef = {
  transparent: true
} | {
  transparent: false
  id: string,
}

export const DEFS: BlockDef[] = [
  // air
  { transparent: true },
  // grass
  { transparent: false, id:"grass"},
  // stone
  { transparent: false, id:"stone"},

];

// The reason its 1/6 is that there are 6 faces on a cube.
// The texture map tile takes up 1/6
export const TILE_TEX_XSIZE = 1 / 6;
export const TILE_TEX_YSIZE = 1 / DEFS.length;

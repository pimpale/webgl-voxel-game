// this file contains block definitions
export const LEFT = 0;
export const RIGHT = 1;
export const UP = 2;
export const DOWN = 3;
export const FRONT = 4;
export const BACK = 5;

type BlockDef = {
  transparent: boolean
  name: string,
}

export const DEFS: BlockDef[] = [
  { transparent: true, name: "air" },
  { transparent: false, name: "grass" },
  { transparent: false, name: "soil" },
  { transparent: false, name: "stone" },
  { transparent: false, name: "wood" },
  { transparent: false, name: "iron" },
  { transparent: false, name: "iron ore" },
  { transparent: false, name: "copper" },
  { transparent: false, name: "copper ore" },
];

// TODO: create a const here that a texture atlas using the defs
// Each row represents a block. The first row will be ignored, since air is transparent
// The second row should be grass, and the third row should be stone.
// Each row of the texture atlas should have 6 images, making it 16*6 pixels wide

// The reason its 1/6 is that there are 6 faces on a cube.
// The texture map tile takes up 1/6
export const TILE_TEX_XSIZE = 1 / 6;
export const TILE_TEX_YSIZE = 1 / DEFS.length;

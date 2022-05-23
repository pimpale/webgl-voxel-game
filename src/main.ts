import { BlockManager, BlockDef, BlockTextures, } from './block';
import Game from './game';

// setup canvas
const canvas = document.getElementById('canvas') as HTMLCanvasElement;

function getImgs(name: string) {
  return [
    document.getElementById(`${name}-left`) as HTMLImageElement,
    document.getElementById(`${name}-right`) as HTMLImageElement,
    document.getElementById(`${name}-up`) as HTMLImageElement,
    document.getElementById(`${name}-down`) as HTMLImageElement,
    document.getElementById(`${name}-front`) as HTMLImageElement,
    document.getElementById(`${name}-back`) as HTMLImageElement,
  ] as BlockTextures
}

const blockManager = new BlockManager(16, [
  { name: "air", pointable: false, light: false, transparent: true, },
  { name: "grass", pointable: true, light: false, transparent: false, textures: getImgs("grass"), },
  { name: "soil", pointable: true, light: false, transparent: false, textures: getImgs("soil"), },
  { name: "stone", pointable: true, light: false, transparent: false, textures: getImgs("stone"), },
  { name: "glass", pointable: true, light: false, transparent: true, textures: getImgs("glass"), },
  { name: "light", pointable: true, light: true, transparent: false, textures: getImgs("light"), },
]);



// make game from canvas
const game = new Game(canvas, blockManager);

// start game
game.displayHelp();

import { BlockManager, BlockDef, } from './block';
import Game from './game';

// setup canvas
const canvas = document.getElementById('canvas') as HTMLCanvasElement;

function getImgs(transparent: boolean, name: string): BlockDef {
  if (transparent) {
    return { transparent, name }
  } else {
    return {
      transparent,
      name,
      textures: [
        document.getElementById(`${name}-left`) as HTMLImageElement,
        document.getElementById(`${name}-right`) as HTMLImageElement,
        document.getElementById(`${name}-up`) as HTMLImageElement,
        document.getElementById(`${name}-down`) as HTMLImageElement,
        document.getElementById(`${name}-front`) as HTMLImageElement,
        document.getElementById(`${name}-back`) as HTMLImageElement,
      ]
    }
  }
}

const blockManager = new BlockManager(16,[
  getImgs(true, "air"),
  getImgs(false, "grass"),
  getImgs(false, "soil"),
  getImgs(false, "stone"),
  //getImgs(false, "wood"),
  //getImgs(false, "iron"),
  //getImgs(false, "iron-ore"),
  //getImgs(false, "copper"),
  //getImgs(false, "copper-ore"),
]);



// make game from canvas
const game = new Game(canvas, blockManager);

// start game
game.displayHelp();

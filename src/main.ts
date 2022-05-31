import { BlockManager, BlockDef, BlockTextures, } from './block';
import Game from './game';

async function waitLoad(str: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = document.getElementById(str) as HTMLImageElement;
    img.onerror = reject;
    img.onload = () => resolve(img)
    if (img.complete) {
      resolve(img);
    }
  });
}

async function getImgs(name: string) {
  return await Promise.all([
    waitLoad(`${name}-left`),
    waitLoad(`${name}-right`),
    waitLoad(`${name}-up`),
    waitLoad(`${name}-down`),
    waitLoad(`${name}-front`),
    waitLoad(`${name}-back`),
  ]) as BlockTextures
}

// setup canvas
async function main() {
  // load resources
  const blockManager = new BlockManager(16, [
    { name: "air", pointable: false, light: false, transparent: true, },
    { name: "grass", pointable: true, light: false, transparent: false, textures: await getImgs("grass"), },
    { name: "soil", pointable: true, light: false, transparent: false, textures: await getImgs("soil"), },
    { name: "stone", pointable: true, light: false, transparent: false, textures: await getImgs("stone"), },
    { name: "glass", pointable: true, light: false, transparent: true, textures: await getImgs("glass"), },
    { name: "lamp", pointable: true, light: true, transparent: false, textures: await getImgs("lamp"), },
    { name: "selector", pointable: true, light: false, transparent: false, textures: await getImgs("selector"), },
  ]);

  // make game from canvas
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const game = new Game(canvas, blockManager);

  // start game
  game.start();
}

main();

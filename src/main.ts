import { makeNoise4D } from 'open-simplex-noise';


class Game {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2')!
    this.gl.enable(this.gl.DEPTH_TEST);
  }

  displayHelp = () => null;


}

// setup canvas
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// make game from canvas
const game = new Game(canvas);

// start game
game.displayHelp();

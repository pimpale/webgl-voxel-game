import Game from './game';

// setup canvas
const canvas = document.getElementById('canvas') as HTMLCanvasElement;

// make game from canvas
const game = new Game(canvas);

// start game
game.displayHelp();

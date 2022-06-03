import { makeNoise4D } from 'open-simplex-noise';
import { createShader, createProgram } from './webgl';
import World from './world';
import { vec3, mat4_to_uniform } from './utils';
import { BlockManager } from './block';
import { Camera } from './camera';
import { Entity, PlayerControlComponent, CameraComponent, PhysicsComponent, BlockInteractionComponent } from './entity-component-system';

// must be right hand coordinate system
const worldup: vec3 = [0.0, -1.0, 0.0];
const worldright: vec3 = [-1.0, 0.0, 0.0];

class Game {

  private canvas: HTMLCanvasElement;
  private camera: Camera;
  private world: World;

  private entityList: Entity[];

  private blockManager: BlockManager;

  private gl: WebGL2RenderingContext;

  private filledbuffer!: WebGLBuffer;

  private requestID?: number;

  constructor(canvas: HTMLCanvasElement, blockManager: BlockManager) {
    this.canvas = canvas;
    this.blockManager = blockManager;

    this.camera = new Camera(
      // camera starts at origin
      [0, 0, 0],
      // camera starts looking in positive z direction
      [0, 0, 1],
      // camera rescales with canvas's aspect ratio
      this.canvas,
    );

    this.gl = canvas.getContext('webgl2')!

    this.world = new World(42, this.camera.getPos(), this.gl, blockManager, this.camera);

    // construct player
    const playerPhysics = new PhysicsComponent(this.world);
    const playerBlockInteraction = new BlockInteractionComponent(this.camera, this.world);
    const player = new Entity([
      // this component handles player interaction with controls
      new PlayerControlComponent(
        // click on the canvas to grab the cursor
        this.canvas,
        // physics to use
        playerPhysics,
        // block interaction to use
        playerBlockInteraction
      ),
      // this component updates the camera to follow the entity
      new CameraComponent(this.camera),
      // handle physics
      playerPhysics,
      // break blocks
      playerBlockInteraction,
    ], worldup, worldright)

    this.entityList = [player];

    // resize canvas on window
    this.resizeCanvas();
    window.addEventListener('resize', this.resizeCanvas);
  }

  resizeCanvas = () => {
    this.canvas.width = window.innerWidth/2;
    this.canvas.height = window.innerHeight/2;
  }

  start = () => this.animationLoop();


  animationLoop = () => {
    // update all entities
    for (const entity of this.entityList) {
      entity.update();
    }

    this.world.update(this.camera.getPos());
    this.world.render(this.camera.getMvp(worldup));

    this.requestID = window.requestAnimationFrame(this.animationLoop);
  }
}

export default Game;

import { makeNoise4D } from 'open-simplex-noise';
import { createShader, createProgram } from './webgl';
import World from './world';
import { vec3, mat4_to_uniform } from './utils';
import { BlockManager } from './block';
import { Camera } from './camera';
import { Entity, PlayerControlComponent, CameraComponent, PhysicsComponent, BlockInteractionComponent } from './entity-component-system';

const worldup: vec3 = [0.0, -1.0, 0.0];

export type Vertex = {
  position: vec3,
  tuv: vec3,
}

const vs = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_position;
layout(location=1) in vec3 a_tuv;

// premultiplied mvp matrix
uniform mat4 u_mvpMat;

out vec3 v_tuv;

void main() {
   v_tuv = a_tuv;
   gl_Position = u_mvpMat * vec4(a_position, 1.0);
}
`;

const fs = `#version 300 es
precision highp float;
precision highp sampler2DArray;

// the texture atlas for the blocks
uniform sampler2DArray u_textureAtlas;
// the normal atlas for the blocks
uniform sampler2DArray u_normalAtlas;

// texCoord
in vec3 v_tuv;

out vec4 v_outColor;

void main() {
  vec4 color = texture(u_textureAtlas, v_tuv);

  v_outColor = vec4(color.rgb*color.a, color.a);
}
`;

function makePlayer() {
}

class Game {

  private canvas: HTMLCanvasElement;
  private camera: Camera;
  private world: World;

  private entityList: Entity[];

  private blockManager: BlockManager;

  private gl: WebGL2RenderingContext;

  private textureAtlas: WebGLTexture;
  private normalAtlas: WebGLTexture;

  private mvpMatLoc: WebGLUniformLocation;
  private textureAtlasLoc: WebGLUniformLocation;
  private normalAtlasLoc: WebGLUniformLocation;

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
      // give camera worldup
      worldup
    );

    this.gl = canvas.getContext('webgl2')!

    const program = createProgram(
      this.gl,
      [
        createShader(this.gl, this.gl.VERTEX_SHADER, vs),
        createShader(this.gl, this.gl.FRAGMENT_SHADER, fs),
      ]
    )!;

    // set this program as current
    this.gl.useProgram(program);

    // get attribute locations
    const positionLoc = this.gl.getAttribLocation(program, 'a_position');
    const tuvLoc = this.gl.getAttribLocation(program, 'a_tuv');

    this.world = new World(0, this.camera.getPos(), this.gl, positionLoc, tuvLoc, blockManager);

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
    ], worldup)

    this.entityList = [player];

    // retrieve uniforms
    this.mvpMatLoc = this.gl.getUniformLocation(program, "u_mvpMat")!;
    this.textureAtlasLoc = this.gl.getUniformLocation(program, "u_textureAtlas")!;
    this.normalAtlasLoc = this.gl.getUniformLocation(program, "u_normalAtlas")!;

    // set texture 0 as current
    this.gl.activeTexture(this.gl.TEXTURE0);
    // create texture atlas at texture 0
    this.textureAtlas = this.blockManager.buildTextureAtlas(this.gl);
    // Tell the shader to get the textureAtlas texture from texture unit 0
    this.gl.uniform1i(this.textureAtlasLoc, 0);


    // set texture 1 as current
    this.gl.activeTexture(this.gl.TEXTURE1);
    // TODO! (use normal atlas, not yet defined)
    this.normalAtlas = this.blockManager.buildTextureAtlas(this.gl);
    // Tell the shader to get the normalAtlas texture from texture unit 1
    this.gl.uniform1i(this.normalAtlasLoc, 1);



    // resize canvas on window
    this.resizeCanvas();
    this.canvas.addEventListener('resize', this.resizeCanvas);
  }

  resizeCanvas = () => {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);
  }

  displayHelp = () => this.animationLoop();


  animationLoop = () => {
    // update all entities
    for (const entity of this.entityList) {
      entity.update();
    }

    // update the world with the camera position
    this.world.update(this.camera.getPos());

    {
      // set uniform
      const mvpMat = this.camera.getMvp();
      this.gl.uniformMatrix4fv(this.mvpMatLoc, false, mat4_to_uniform(mvpMat));

      // draw triangles
      this.world.render();
    }
    this.requestID = window.requestAnimationFrame(this.animationLoop);
  }

}


export default Game;

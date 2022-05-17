import { makeNoise4D } from 'open-simplex-noise';
import { createShader, createProgram } from './webgl';
import Camera from './camera';
import {vec2, mat4_to_uniform} from './utils';

const vs = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_position;
layout(location=1) in vec3 a_color;

// premultiplied mvp matrix
uniform mat4 u_mvpMat;

out vec3 v_color;

void main() {
   v_color = a_color;
   gl_Position = u_mvpMat * vec4(a_position, 1.0);
}
`;

const fs = `#version 300 es
precision highp float;
in vec3 v_color;

out vec4 v_outColor;

void main() {
  v_outColor = vec4(v_color, 1.0);
}
`;

function genPlane(xseg: number, yseg: number): vec2[] {

  let vertexes: vec2[] = [];

  for (let xi = 0; xi < xseg; xi++) {
    const x = xi / xseg;
    const nx = (xi+1) / xseg;
    for (let yi = 0; yi < yseg; yi++) {
      const y = yi / yseg;
      const ny = (yi+1) / yseg;

      // add two triangles

      // upper triangle
      vertexes.push([x, y]);
      vertexes.push([nx, y]);
      vertexes.push([x, ny]);
      // lower triangle
      vertexes.push([nx, y]);
      vertexes.push([nx, ny]);
      vertexes.push([x, ny]);
    }
  }

  return vertexes;
}
function convertColor(color: number) {
  return [
    (color >> 16) / 0xFF,
    ((color >> 8) & 0xFF) / 0xFF,
    (color & 0xFF) / 0xFF,
  ];
}



class Game {

  private canvas: HTMLCanvasElement;
  private camera: Camera;

  private gl: WebGL2RenderingContext;

  private mvpMatLoc: WebGLUniformLocation;

  private filledbuffer!: WebGLBuffer;

  private requestID?:number;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    this.camera = new Camera([0,0,0], this.canvas);


    this.gl = canvas.getContext('webgl2')!
    this.gl.enable(this.gl.DEPTH_TEST);

    const program = createProgram(
      this.gl,
      [
        createShader(this.gl, this.gl.VERTEX_SHADER, vs),
        createShader(this.gl, this.gl.FRAGMENT_SHADER, fs),
      ]
    )!;

    // get attribute locations
    const positionLoc = this.gl.getAttribLocation(program, 'a_position');
    const colorLoc = this.gl.getAttribLocation(program, 'a_color');


    const topcolor = convertColor(0x458588);
    const bottomcolor = convertColor(0xdc3545);
    const leftcolor = convertColor(0x98971a);
    const rightcolor = convertColor(0xb16286);
    const frontcolor = convertColor(0xd79921);
    const backcolor = convertColor(0xEBDBB2);


    // map different buffers
    let filled = [
      // top level
      ...genPlane(3,3).flatMap((v, i) => [v[0], 0, v[1], ...topcolor]),
      // bottomlevel
      ...genPlane(3,3).flatMap((v, i) => [v[0], 1, v[1], ...bottomcolor]),
      // left level
      ...genPlane(3,3).flatMap((v, i) => [0, v[0], v[1], ...leftcolor]),
      // right level
      ...genPlane(3,3).flatMap((v, i) => [1, v[0], v[1], ...rightcolor]),
      // front level
      ...genPlane(3,3).flatMap((v, i) => [v[0], v[1], 0, ...frontcolor]),
      // back level
      ...genPlane(3,3).flatMap((v, i) => [v[0], v[1], 1, ...backcolor]),
    ];


    this.filledbuffer = this.gl.createBuffer()!;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.filledbuffer);
    this.gl.bufferData(
      this.gl.ARRAY_BUFFER,
      new Float32Array(filled),
      this.gl.STATIC_DRAW
    );

    // setup our attributes to tell WebGL how to pull
    // the data from the buffer above to the position attribute
    this.gl.enableVertexAttribArray(positionLoc);
    this.gl.vertexAttribPointer(
      positionLoc,
      3,              // size (num components)
      this.gl.FLOAT,  // type of data in buffer
      false,          // normalize
      6 * 4,          // stride (0 = auto)
      0,              // offset
    );
    this.gl.enableVertexAttribArray(colorLoc);
    this.gl.vertexAttribPointer(
      colorLoc,
      3,              // size (num components)
      this.gl.FLOAT,  // type of data in buffer
      false,          // normalize
      6 * 4,          // stride (0 = auto)
      3 * 4,          // offset
    );

    // retrieve uniforms
    this.mvpMatLoc= this.gl.getUniformLocation(program, "u_mvpMat")!;

    this.gl.useProgram(program);

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
    this.camera.update()

    {
      // set uniform
      const mvpMat = this.camera.getMvp();
      this.gl.uniformMatrix4fv(this.mvpMatLoc, false, mat4_to_uniform(mvpMat));

      // draw triangles
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.filledbuffer);
      this.gl.drawArrays(this.gl.TRIANGLES, 0, 3 * 3 * 6 * 6);
    }
    this.requestID = window.requestAnimationFrame(this.animationLoop);
  }

}


export default Game;

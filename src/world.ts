import { makeNoise3D } from 'open-simplex-noise';
import { vec3, vec3_add, vec3_sub, vec3_dot, assert, mod, mat4_perspective, RADIANS, mat4_look_at, mat4_mul, mat4_to_uniform, mat4, mat4_transpose } from './utils';
import { BlockDef, BlockManager, Face, getNormal } from './block';
import { createProgram, createShader } from './webgl';
import { Camera } from './camera';

// We assign each step a cost.
// we stop doing work after the cost exceeds 1
const CHUNK_GEN_COST = 1;
const CHUNK_MESH_COST = 1;
const CHUNK_MKGRAPHICS_COST = 1;
const CHUNK_RENDERLIGHT_COST = 1;

const CHUNK_X_SIZE = 24;
const CHUNK_Y_SIZE = 24;
const CHUNK_Z_SIZE = 24;


// how many chunks to render
const RENDER_RADIUS_X = 1;
const RENDER_RADIUS_Y = 1;
const RENDER_RADIUS_Z = 1;

type Graphics = {
  vao: WebGLVertexArrayObject;
  buffer: WebGLBuffer;
  vertexCount: number;
}

type Chunk = {
  blocks?: Uint16Array,
  mesh?: { stale: boolean, solid: BlockFace[], transparent: BlockFace[], lights: BlockFace[] }
  graphics?: { stale: boolean, solid: Graphics, transparent: Graphics }
  lights?: { stale: boolean, tex: WebGLTexture, fbs: WebGLFramebuffer[], matrixes: mat4[] }
}

const N_LIGHTS = 16;


const vs = `#version 300 es
precision highp int;
precision highp float;
in vec3 a_position;
uniform mat4 u_mvpMat;

in vec3 a_tuv;
out vec3 v_tuv;

uniform int u_lightNumber;
uniform vec4 u_lightMvpArr[${N_LIGHTS}*4];
out vec4 v_lightspaceCoords[${N_LIGHTS}];

void main() {
   v_tuv = a_tuv;
   // actual location
   gl_Position = u_mvpMat * vec4(a_position, 1.0);

   // location as seen by each of these lights
   for(int i = 0; i < u_lightNumber; i++) {
     mat4 mvp = mat4(
         u_lightMvpArr[i*4 + 0],
         u_lightMvpArr[i*4 + 1],
         u_lightMvpArr[i*4 + 2],
         u_lightMvpArr[i*4 + 3]
     );
     v_lightspaceCoords[i] = mvp * vec4(a_position, 1.0);
   }
}
`;

const fs = `#version 300 es
precision highp int;
precision highp float;
precision highp sampler2DArray;

// the texture atlas for the blocks
uniform sampler2DArray u_textureAtlas;

uniform int u_lightNumber;

uniform float u_bias;

// the light depth maps
uniform sampler2DArray u_lightDepthArr;

// positions according to lights
in vec4 v_lightspaceCoords[${N_LIGHTS}];

// texCoord
in vec3 v_tuv;

out vec4 v_outColor;

void main() {
  vec4 color = texture(u_textureAtlas, v_tuv);

  float lightSum = 0.2;

  for(int i = 0; i < u_lightNumber; i++) {
    vec3 projectedCoord = v_lightspaceCoords[i].xyz / v_lightspaceCoords[i].w;
    bool inRange =
        projectedCoord.z >= -1.0 &&
        projectedCoord.z <= 1.0 &&
        projectedCoord.x >= -1.0 &&
        projectedCoord.x <= 1.0 &&
        projectedCoord.y >= -1.0 &&
        projectedCoord.y <= 1.0;

    // remap coords to texCoords
    vec2 texCoord = (projectedCoord.xy + vec2(1.0, 1.0))/2.0;

    float depthMapDepth = texture(u_lightDepthArr, vec3(texCoord, i)).r;
    float currentDepth = projectedCoord.z + u_bias;

    if(inRange && depthMapDepth > currentDepth) {
        lightSum += 1.0*(depthMapDepth - currentDepth);
    }
  }
  v_outColor = vec4(color.rgb*lightSum, color.a);
}
`;

const shadow_vs = `#version 300 es
precision highp float;
in vec3 a_tuv;
in vec3 a_position;
uniform mat4 u_mvpMat;
out vec3 v_tuv;
void main() {
   v_tuv = a_tuv;
   gl_Position = u_mvpMat * vec4(a_position, 1.0) ;
}
`;


const shadow_fs = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec3 v_tuv;
out vec4 v_outColor;

// the texture atlas for the blocks
uniform sampler2DArray u_textureAtlas;

void main() {
  v_outColor = vec4(texture(u_textureAtlas, v_tuv).xyz, 1.0);
}
`;

export type Highlight = {
  coords: vec3,
  face: Face
}

class World {
  private readonly POSITION_LOC = 0;
  private readonly TUV_LOC = 1;

  private readonly SHADOWMAP_SIZE = 128;

  private textureAtlas: WebGLTexture;

  private renderProgram: WebGLProgram;
  private renderMvpMatLoc: WebGLUniformLocation;
  private renderTextureAtlasLoc: WebGLUniformLocation;
  private renderLightDepthArr: WebGLUniformLocation;
  private renderLightNumber: WebGLUniformLocation;
  private renderBiasLoc: WebGLUniformLocation;
  // pass a bunch of mat4s in column major order
  private renderLightMvpArr: WebGLUniformLocation;

  private shadowProgram: WebGLProgram;
  private shadowMvpMatLoc: WebGLUniformLocation;
  private shadowTextureAtlasLoc: WebGLUniformLocation;

  readonly emptyChunk = new Uint16Array(CHUNK_X_SIZE * CHUNK_Y_SIZE * CHUNK_Z_SIZE);

  private worldChunkCenterLoc: vec3;

  // TODO: get rid of camera, only for debugging
  private camera: Camera;

  // worldgen function
  private readonly worldup: vec3;
  private readonly seed: number;
  private readonly noiseFn: (x: number, y: number, z: number) => number;

  // list of active <id, highlight> pairs
  private highlights: Map<string, Graphics>;

  // hashmap storing chunks
  private chunk_map: Map<string, Chunk>;

  private gl: WebGL2RenderingContext;
  private blockManager: BlockManager

  getWorldChunkLoc = (cameraLoc: vec3) => [
    Math.floor(cameraLoc[0] / CHUNK_X_SIZE),
    Math.floor(cameraLoc[1] / CHUNK_Y_SIZE),
    Math.floor(cameraLoc[2] / CHUNK_Z_SIZE),
  ] as vec3;

  constructor(seed: number, cameraLoc: vec3, worldup: vec3, gl: WebGL2RenderingContext, blockManager: BlockManager, camera: Camera) {
    this.gl = gl;
    this.blockManager = blockManager;
    this.seed = seed;
    this.worldup = worldup;
    this.noiseFn = makeNoise3D(seed);
    this.worldChunkCenterLoc = this.getWorldChunkLoc(cameraLoc);
    this.chunk_map = new Map();
    this.highlights = new Map();

    this.camera = camera;

    this.renderProgram = createProgram(
      this.gl,
      [
        createShader(this.gl, this.gl.VERTEX_SHADER, vs),
        createShader(this.gl, this.gl.FRAGMENT_SHADER, fs),
      ],
      new Map([
        [this.POSITION_LOC, 'a_position'],
        [this.TUV_LOC, 'a_tuv'],
      ])
    )!;

    // set this program as current
    this.gl.useProgram(this.renderProgram);

    // retrieve uniforms
    this.renderMvpMatLoc = this.gl.getUniformLocation(this.renderProgram, "u_mvpMat")!;
    this.renderTextureAtlasLoc = this.gl.getUniformLocation(this.renderProgram, "u_textureAtlas")!;
    this.renderLightNumber = this.gl.getUniformLocation(this.renderProgram, "u_lightNumber")!;
    this.renderLightDepthArr = this.gl.getUniformLocation(this.renderProgram, "u_lightDepthArr")!;
    this.renderLightMvpArr = this.gl.getUniformLocation(this.renderProgram, "u_lightMvpArr")!;
    this.renderBiasLoc = this.gl.getUniformLocation(this.renderProgram, "u_bias")!;


    // set texture 0 as current
    this.gl.activeTexture(this.gl.TEXTURE0);
    // create texture atlas at texture 0
    this.textureAtlas = this.blockManager.buildTextureAtlas(this.gl);
    // Tell the shader to get the textureAtlas texture from texture unit 0
    this.gl.uniform1i(this.renderTextureAtlasLoc, 0);
    // tell the shader to get its textures from this chunk
    this.gl.uniform1i(this.renderLightDepthArr, 1);

    // create program
    this.shadowProgram = createProgram(
      this.gl,
      [
        createShader(this.gl, this.gl.VERTEX_SHADER, shadow_vs),
        createShader(this.gl, this.gl.FRAGMENT_SHADER, shadow_fs),
      ],
      new Map([
        [this.POSITION_LOC, 'a_position'],
        [this.TUV_LOC, 'a_tuv'],
      ])
    )!;
    this.gl.useProgram(this.shadowProgram);
    this.shadowMvpMatLoc = this.gl.getUniformLocation(this.shadowProgram, "u_mvpMat")!;
    // Tell the shader to get the textureAtlas texture from texture unit 0
    this.shadowTextureAtlasLoc = this.gl.getUniformLocation(this.shadowProgram, "u_textureAtlas")!;
    this.gl.uniform1i(this.shadowTextureAtlasLoc, 0);

    this.updateCameraLoc();
  }

  createGraphics = (data: Float32Array) => {
    const vao = this.gl.createVertexArray()!;
    this.gl.bindVertexArray(vao);

    const buffer = this.gl.createBuffer()!;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, data, this.gl.DYNAMIC_DRAW);

    // setup our attributes to tell WebGL how to pull
    // the data from the buffer above to the attributes
    this.gl.enableVertexAttribArray(this.POSITION_LOC);
    this.gl.vertexAttribPointer(
      this.POSITION_LOC,
      3,              // size (num components)
      this.gl.FLOAT,  // type of data in buffer
      false,          // normalize
      6 * 4,          // stride (0 = auto)
      0 * 4,          // offset
    );
    this.gl.enableVertexAttribArray(this.TUV_LOC);
    this.gl.vertexAttribPointer(
      this.TUV_LOC,
      3,              // size (num components)
      this.gl.FLOAT,  // type of data in buffer
      false,          // normalize
      6 * 4,          // stride (0 = auto)
      3 * 4,          // offset
    );

    return {
      vao,
      buffer,
      vertexCount: data.length / 6,
    }
  }

  private deleteGraphics = (graphics: Graphics) => {
    this.gl.deleteBuffer(graphics.buffer);
    this.gl.deleteVertexArray(graphics.vao);
  }

  private deleteChunkGraphics = (graphics: { solid: Graphics, transparent: Graphics }) => {
    this.deleteGraphics(graphics.solid);
    this.deleteGraphics(graphics.transparent);
  }

  private deleteChunkLights = (lights: { tex: WebGLTexture }) => {
    this.gl.deleteTexture(lights.tex);
  }

  private shouldBeLoaded = (worldChunkCoords: vec3) => {
    const disp = vec3_sub(worldChunkCoords, this.worldChunkCenterLoc);
    return (disp[0] >= -RENDER_RADIUS_X && disp[0] <= RENDER_RADIUS_X) &&
      (disp[1] >= -RENDER_RADIUS_Y && disp[1] <= RENDER_RADIUS_Y) &&
      (disp[2] >= -RENDER_RADIUS_Z && disp[2] <= RENDER_RADIUS_Z);
  }
  // if the camera new chunk coords misalign with our current chunk coords then
  private updateCameraLoc = () => {

    // delete any generated chunks
    for (const [coord, chunk] of this.chunk_map) {
      if (!this.shouldBeLoaded(JSON.parse(coord))) {
        if (chunk.graphics !== undefined) {
          this.deleteChunkGraphics(chunk.graphics);
        }
        if (chunk.lights !== undefined) {
          this.deleteChunkLights(chunk.lights);
        }
        this.chunk_map.delete(coord);
      }
    }

    // initialize all of our neighboring chunks to be on the load list
    for (let x = -RENDER_RADIUS_X; x <= RENDER_RADIUS_X; x++) {
      for (let y = -RENDER_RADIUS_Y; y <= RENDER_RADIUS_Y; y++) {
        for (let z = -RENDER_RADIUS_Z; z <= RENDER_RADIUS_Z; z++) {
          const chunkCoord = JSON.stringify(vec3_add(this.worldChunkCenterLoc, [x, y, z]));
          if (this.chunk_map.get(chunkCoord) === undefined) {
            this.chunk_map.set(chunkCoord, {});
          }
        }
      }
    }
  }

  addHighlight = (id: string, ray: Highlight) => {
    const highlight = this.highlights.get(id);
    if (highlight !== undefined) {
      this.deleteGraphics(highlight);
    }
    const graphics = this.createGraphics(writeMesh([{
      bi: 5,
      cubeLoc: ray.coords,
      face: ray.face,
    }]));
    this.highlights.set(id, graphics);
  }

  removeHighlight = (id: string) => {
    const highlight = this.highlights.get(id);
    if (highlight !== undefined) {
      this.deleteGraphics(highlight);
      this.highlights.delete(id);
    }
  }

  private createLightMatrix = (face: BlockFace): mat4 => {
    // actual location of the light is in the center of the block
    const lightLoc = vec3_add(face.cubeLoc, [0.5, 0.5, 0.5]);
    // note that the near plane starts slightly after the face
    // the far plane is less than the chunk size
    const projectionMat = mat4_perspective(RADIANS(90.0), 1, 0.49, 10.49);

    const up: vec3 = face.face === Face.UP || face.face === Face.DOWN
      ? [-1, 0, 0]
      : [0, -1, 0];

    const viewMat = mat4_look_at(lightLoc, vec3_add(lightLoc, getNormal(face.face)), up);
    // compute final matrix
    return mat4_mul(projectionMat, viewMat);
  }

  // we use a 3d texture to store all of the textures in a cube
  private createLightData = (): { tex: WebGLTexture, fbs: WebGLFramebuffer[] } => {
    const depthTexture = this.gl.createTexture()!;
    this.gl.bindTexture(this.gl.TEXTURE_2D_ARRAY, depthTexture);
    this.gl.texImage3D(
      this.gl.TEXTURE_2D_ARRAY,      // target
      0,                    // mip level
      this.gl.DEPTH_COMPONENT32F, // internal format
      this.SHADOWMAP_SIZE,   // width
      this.SHADOWMAP_SIZE,   // height
      N_LIGHTS,   // height
      0,                  // border
      this.gl.DEPTH_COMPONENT, // format
      this.gl.FLOAT,           // type
      null,              // data
    );
    this.gl.texParameteri(this.gl.TEXTURE_2D_ARRAY, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D_ARRAY, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D_ARRAY, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D_ARRAY, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);

    const fbs: WebGLFramebuffer[] = []

    for (let i = 0; i < N_LIGHTS; i++) {
      const depthFramebuffer = this.gl.createFramebuffer()!;
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, depthFramebuffer);
      this.gl.framebufferTextureLayer(
        this.gl.FRAMEBUFFER,       // target
        this.gl.DEPTH_ATTACHMENT,  // attachment point
        depthTexture,              // texture
        0,                         // mip level
        i,                         // layer
      );
      fbs.push(depthFramebuffer);
    }

    return { tex: depthTexture, fbs };
  }

  private renderShadowMap = (
    tex: WebGLTexture,
    fb: WebGLFramebuffer,
    mvpMat: mat4,
    solids: Graphics[]
  ) => {
    this.gl.useProgram(this.shadowProgram);

    // bind the texture 0 to render atlas
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D_ARRAY, this.textureAtlas);

    // bind mvpMat matrix
    this.gl.uniformMatrix4fv(this.shadowMvpMatLoc, false, mat4_to_uniform(mvpMat));

    // set settings
    this.gl.viewport(0, 0, this.SHADOWMAP_SIZE, this.SHADOWMAP_SIZE);
    this.gl.enable(this.gl.DEPTH_TEST); // enable depth tests
    this.gl.enable(this.gl.CULL_FACE) // remove reversed faces
    this.gl.enable(this.gl.BLEND) // enable blending
    this.gl.blendFunc(this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA) // blend by adding together alpha

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, fb);
    this.gl.clear(this.gl.DEPTH_BUFFER_BIT);

    // actually draw
    for (const solid of solids) {
      this.gl.bindVertexArray(solid.vao);
      this.gl.drawArrays(this.gl.TRIANGLES, 0, solid.vertexCount);
    }
  }

  adjacentChunkLocs = (chunkLoc: vec3): vec3[] => {
    const offsets: vec3[] = [
      [-1, 0, 0],
      [+1, 0, 0],
      [0, -1, 0],
      [0, +1, 0],
      [0, 0, -1],
      [0, 0, +1],
    ];
    return offsets.map(x => vec3_add(chunkLoc, x));
  }

  neighboringChunkLocs = (chunkLoc: vec3): vec3[] => {
    const offsets: vec3[] = []
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          if (z !== 0 || y !== 0 || x !== 0) {
            offsets.push(vec3_add(chunkLoc, [x, y, z]));
          }
        }
      }
    }
    return offsets;
  }

  getChunkBlocksIfExists = (coord: vec3) => {
    const blocks = this.chunk_map.get(JSON.stringify(coord))?.blocks;
    if (blocks) {
      return blocks;
    } else {
      return this.emptyChunk;
    }
  }

  update = (cameraLoc: vec3) => {
    let current_cost = 0;

    CHUNK_UPDATE_LOOP:
    for (const [coord, chunk] of this.chunk_map) {
      const parsedCoord = JSON.parse(coord) as vec3;
      if (chunk.blocks === undefined) {
        chunk.blocks = genChunkData(parsedCoord, this.noiseFn);
        // mark neighboring chunks as stale
        for (const loc of this.adjacentChunkLocs(parsedCoord)) {
          const chunk = this.chunk_map.get(JSON.stringify(loc));
          if (chunk && chunk.mesh) {
            chunk.mesh.stale = true
          }
        }
        current_cost += CHUNK_GEN_COST;
      }

      if (current_cost > 1) { break CHUNK_UPDATE_LOOP; }

      const offset: vec3 = [parsedCoord[0] * CHUNK_X_SIZE, parsedCoord[1] * CHUNK_Y_SIZE, parsedCoord[2] * CHUNK_Z_SIZE];

      if (chunk.mesh === undefined || chunk.mesh.stale) {

        // if an adjacent chunk should be loaded but isn't generated
        // then skip this chunk
        for (const neighborLoc of this.adjacentChunkLocs(parsedCoord)) {
          if (this.shouldBeLoaded(neighborLoc)) {
            const chunk = this.chunk_map.get(JSON.stringify(neighborLoc));
            if (chunk === undefined || chunk.blocks === undefined) {
              // skip this chunk
              continue CHUNK_UPDATE_LOOP;
            }
          }
        }

        const { solid, transparent, lights } = createMesh(
          // offset to store at
          offset,
          // block manager
          this.blockManager,
          // core
          chunk.blocks,
          // left
          this.getChunkBlocksIfExists(vec3_add(parsedCoord, [-1, 0, 0])),
          // right
          this.getChunkBlocksIfExists(vec3_add(parsedCoord, [+1, 0, 0])),
          // up
          this.getChunkBlocksIfExists(vec3_add(parsedCoord, [0, -1, 0])),
          // down
          this.getChunkBlocksIfExists(vec3_add(parsedCoord, [0, +1, 0])),
          // back
          this.getChunkBlocksIfExists(vec3_add(parsedCoord, [0, 0, -1])),
          // front
          this.getChunkBlocksIfExists(vec3_add(parsedCoord, [0, 0, +1])),
        );

        chunk.mesh = {
          solid,
          transparent,
          lights,
          stale: false
        }
        if (chunk.graphics !== undefined) {
          chunk.graphics.stale = true;
        }
        if (chunk.lights !== undefined) {
          chunk.lights.stale = true
        }
        current_cost += CHUNK_MESH_COST;
      }

      if (current_cost > 1) { break CHUNK_UPDATE_LOOP; }

      if (chunk.graphics === undefined || chunk.graphics.stale) {
        if (chunk.graphics !== undefined) {
          this.deleteChunkGraphics(chunk.graphics);
        }
        chunk.graphics = {
          solid: this.createGraphics(writeMesh(chunk.mesh.solid)),
          transparent: this.createGraphics(writeMesh(chunk.mesh.transparent)),
          stale: false
        }
        current_cost += CHUNK_MKGRAPHICS_COST;
      }

      if (current_cost > 1) { break CHUNK_UPDATE_LOOP; }

      if (chunk.lights === undefined || chunk.lights.stale) {
        let matrixes = chunk.mesh.lights
          .slice(0, N_LIGHTS)
          .map(face => this.createLightMatrix(face));
        if (chunk.lights === undefined) {
          const data = this.createLightData();
          chunk.lights = {
            tex: data.tex,
            fbs: data.fbs,
            matrixes,
            stale: true,
          }
        } else {
          chunk.lights.matrixes = matrixes;
        }

        const solidsToRender = [chunk.graphics.solid];
        for (const coord of this.neighboringChunkLocs(parsedCoord)) {
          const chunk = this.chunk_map.get(JSON.stringify(coord));
          if (chunk !== undefined && chunk.graphics !== undefined) {
            solidsToRender.push(chunk.graphics.solid);
          }
        }

        // now iterate through our graphics map and render world
        for (let i = 0; i < chunk.lights.matrixes.length; i++) {
          this.renderShadowMap(chunk.lights.tex, chunk.lights.fbs[i], chunk.lights.matrixes[i], solidsToRender);
        }

        // mark not stale
        chunk.lights.stale = false;
        current_cost += CHUNK_RENDERLIGHT_COST;
      }

      if (current_cost > 1) { break CHUNK_UPDATE_LOOP; }
    }

    // TODO: debugging only
    return;

    const cameraChunkLoc = this.getWorldChunkLoc(cameraLoc);
    if (
      cameraChunkLoc[0] !== this.worldChunkCenterLoc[0] ||
      cameraChunkLoc[1] !== this.worldChunkCenterLoc[1] ||
      cameraChunkLoc[2] !== this.worldChunkCenterLoc[2]
    ) {
      this.worldChunkCenterLoc = cameraChunkLoc;
      this.updateCameraLoc();
    }
  }

  render = (mvpMat: mat4) => {
    // use render program
    this.gl.useProgram(this.renderProgram);

    // render to canvas
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);

    // bind matrix
    this.gl.uniformMatrix4fv(this.renderMvpMatLoc, false, mat4_to_uniform(mvpMat));

    this.gl.enable(this.gl.DEPTH_TEST); // enable depth tests
    this.gl.enable(this.gl.CULL_FACE) // remove reversed faces
    this.gl.enable(this.gl.BLEND) // enable blending
    this.gl.blendFunc(this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA) // blend by adding together alpha

    this.gl.clearColor(0.0, 0.0, 0.0, 1.0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);

    const oof = 0.012//0.04 + 0.1*Math.cos(Date.now()/1000);
    this.gl.uniform1f(this.renderBiasLoc, oof);
    console.log(oof);

    for (const chunk of this.chunk_map.values()) {
      if (chunk.graphics !== undefined && chunk.lights !== undefined) {
        // bind this chunk's vertex array
        this.gl.bindVertexArray(chunk.graphics.solid.vao);

        // bind the texture 0 to render atlas
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D_ARRAY, this.textureAtlas);

        // bind this chunk's lights to tex 1
        this.gl.activeTexture(this.gl.TEXTURE1);
        this.gl.bindTexture(this.gl.TEXTURE_2D_ARRAY, chunk.lights.tex);

        // set n lights correctly
        this.gl.uniform1i(this.renderLightNumber, chunk.lights.matrixes.length);

        if (chunk.lights.matrixes.length > 0) {
          // set shadow matrixes correctly
          const data = new Float32Array(chunk.lights.matrixes.length * 16);
          for (let i = 0; i < chunk.lights.matrixes.length; i++) {
            data.set(mat4_to_uniform(chunk.lights.matrixes[i]), i * 16);
          }
          this.gl.uniform4fv(this.renderLightMvpArr, data);
        }

        this.gl.drawArrays(this.gl.TRIANGLES, 0, chunk.graphics.solid.vertexCount);
      }
    }

    // draw translucent
    this.gl.depthMask(false);
    for (const chunk of this.chunk_map.values()) {
      if (chunk.graphics !== undefined) {
        this.gl.bindVertexArray(chunk.graphics.transparent.vao);
        this.gl.drawArrays(this.gl.TRIANGLES, 0, chunk.graphics.transparent.vertexCount);
      }
    }
    this.gl.depthMask(true);

    this.gl.disable(this.gl.DEPTH_TEST);
    for (const highlight of this.highlights.values()) {
      this.gl.bindVertexArray(highlight.vao);
      this.gl.drawArrays(this.gl.TRIANGLES, 0, highlight.vertexCount);
    }
  }

  getBlock = (coords: vec3) => {
    const chunk = this.chunk_map.get(JSON.stringify(this.getWorldChunkLoc(coords)));
    if (chunk && chunk.blocks) {
      return chunk.blocks[chunkDataIndex(
        mod(coords[0], CHUNK_X_SIZE),
        mod(coords[1], CHUNK_Y_SIZE),
        mod(coords[2], CHUNK_Z_SIZE),
      )];
    } else {
      return null;
    }
  }

  setBlock = (coords: vec3, val: number) => {
    const chunkCoord = this.getWorldChunkLoc(coords);
    const chunk = this.chunk_map.get(JSON.stringify(chunkCoord));
    if (chunk && chunk.blocks) {

      const x = mod(coords[0], CHUNK_X_SIZE);
      const y = mod(coords[1], CHUNK_Y_SIZE);
      const z = mod(coords[2], CHUNK_Z_SIZE);

      chunk.blocks[chunkDataIndex(x, y, z)] = val;

      // means we need to recompute the mesh of this
      if (chunk.mesh !== undefined) {
        chunk.mesh.stale = true;
      }
      // TODO: could be optimized, only mark when x y and z are bordering another chunk
      for (const loc of this.neighboringChunkLocs(chunkCoord)) {
        const chunk = this.chunk_map.get(JSON.stringify(loc));
        if (chunk && chunk.mesh) {
          chunk.mesh.stale = true
        }
      }
      return true;
    } else {
      return false;
    }
  }

  private intbound = (s: number, ds: number) => {
    // Some kind of edge case, see:
    // http://gamedev.stackexchange.com/questions/47362/cast-ray-to-select-block-in-voxel-game#comment160436_49423
    const sIsInteger = Math.round(s) == s;
    if (ds < 0 && sIsInteger)
      return 0;

    let ceils: number;
    if (s == 0.0) {
      ceils = 1.0;
    } else {
      ceils = Math.ceil(s);
    }

    return (ds > 0 ? ceils - s : s - Math.floor(s)) / Math.abs(ds);
  }

  castRay = (origin: vec3, direction: vec3, max_dist: number): Highlight | null => {
    // From "A Fast Voxel Traversal Algorithm for Ray Tracing"
    // by John Amanatides and Andrew Woo, 1987
    // <http://www.cse.yorku.ca/~amana/research/grid.pdf>
    // <http://citeseer.ist.psu.edu/viewdoc/summary?doi=10.1.1.42.3443>
    // Extensions to the described algorithm:
    //   • Imposed a distance limit.
    //   • The face passed through to reach the current cube is provided to
    //     the callback.

    // The foundation of this algorithm is a parameterized representation of
    // the provided ray,
    //                    origin + t * direction,
    // except that t is not actually stored; rather, at any given point in the
    // traversal, we keep track of the *greater* t values which we would have
    // if we took a step sufficient to cross a cube boundary along that axis
    // (i.e. change the integer part of the coordinate) in the variables
    // tMaxX, tMaxY, and tMaxZ.

    // Cube containing origin point.
    let x = Math.floor(origin[0]);
    let y = Math.floor(origin[1]);
    let z = Math.floor(origin[2]);
    // Break out direction vector.
    const [dx, dy, dz] = direction;
    // Direction to increment x,y,z when stepping.
    const stepX = Math.sign(dx);
    const stepY = Math.sign(dy);
    const stepZ = Math.sign(dz);
    // See description above. The initial values depend on the fractional
    // part of the origin.
    let tMaxX = this.intbound(origin[0], dx);
    let tMaxY = this.intbound(origin[1], dy);
    let tMaxZ = this.intbound(origin[2], dz);
    // The change in t when taking a step (always positive).
    const tDeltaX = stepX / dx;
    const tDeltaY = stepY / dy;
    const tDeltaZ = stepZ / dz;

    // Avoids an infinite loop.
    // reject if the direction is zero
    assert(vec3_dot(direction, direction) !== 0, "direction vector is 0");

    // Rescale from units of 1 cube-edge to units of 'direction' so we can
    // compare with 't'.
    const radius = max_dist / Math.sqrt(dx * dx + dy * dy + dz * dz);

    let face = Face.UP;

    while (true) {
      // get block here
      const blockIndex = this.getBlock([x, y, z]);
      if (blockIndex === null) {
        break;
      }

      if (this.blockManager.defs[blockIndex].pointable) {
        return {
          coords: [x, y, z],
          face
        };
      }

      // tMaxX stores the t-value at which we cross a cube boundary along the
      // X axis, and similarly for Y and Z. Therefore, choosing the least tMax
      // chooses the closest cube boundary. Only the first case of the four
      // has been commented in detail.
      if (tMaxX < tMaxY) {
        if (tMaxX < tMaxZ) {
          if (tMaxX > radius)
            break;
          // Update which cube we are now in.
          x += stepX;
          // Adjust tMaxX to the next X-oriented boundary crossing.
          tMaxX += tDeltaX;
          // Record the normal vector of the cube face we entered.
          face = stepX == 1 ? Face.LEFT : Face.RIGHT;
        } else {
          if (tMaxZ > radius)
            break;
          z += stepZ;
          tMaxZ += tDeltaZ;
          face = stepZ == 1 ? Face.BACK : Face.FRONT;
        }
      } else {
        if (tMaxY < tMaxZ) {
          if (tMaxY > radius)
            break;
          y += stepY;
          tMaxY += tDeltaY;
          face = stepY == 1 ? Face.UP : Face.DOWN;
        } else {
          // Identical to the second case, repeated for simplicity in
          // the conditionals.
          if (tMaxZ > radius)
            break;
          z += stepZ;
          tMaxZ += tDeltaZ;
          face = stepZ == 1 ? Face.BACK : Face.FRONT;
        }
      }
    }
    return null;
  }

}

// get chunk data index
function chunkDataIndex(x: number, y: number, z: number) {
  return Math.floor(x) * CHUNK_Y_SIZE * CHUNK_Z_SIZE + Math.floor(y) * CHUNK_Z_SIZE + Math.floor(z);
}


// generate chunk data
function genChunkData(worldChunkCoords: vec3, noise: (x: number, y: number, z: number) => number) {
  // generate chunk, we need to give it the block coordinate to generate at
  const chunkOffset = [
    worldChunkCoords[0] * CHUNK_X_SIZE,
    worldChunkCoords[1] * CHUNK_Y_SIZE,
    worldChunkCoords[2] * CHUNK_Z_SIZE
  ];

  const blocks = new Uint16Array(CHUNK_X_SIZE * CHUNK_Y_SIZE * CHUNK_Z_SIZE);

  const scale1 = 20.0;
  for (let x = 0; x < CHUNK_X_SIZE; x++) {
    for (let y = 0; y < CHUNK_Y_SIZE; y++) {
      for (let z = 0; z < CHUNK_Z_SIZE; z++) {
        // this is the offset within the blocks array to store the value
        const off_xyz = chunkDataIndex(x, y, z);

        // calculate world coordinates in blocks
        const wx = x + chunkOffset[0];
        const wy = y + chunkOffset[1];
        const wz = z + chunkOffset[2];
        const valHere = noise(wx / scale1, wy / scale1, wz / scale1);
        const valAbove = noise(wx / scale1, (wy - 1) / scale1, wz / scale1);

        if (valHere > 0) {
          if (valAbove > 0) {
            blocks[off_xyz] = 3; // stone
          } else {
            blocks[off_xyz] = 1; // grass
          }
        } else {
          blocks[off_xyz] = 0; // air
        }
      }
    }
  }

  blocks[chunkDataIndex(16, 16, 16)] = 5;

  return blocks;
}

type ChunkMesh = {
  solid: BlockFace[],
  transparent: BlockFace[],
  lights: BlockFace[]
}

function shouldRender(thisblock: BlockDef, otherblock: BlockDef) {
  // dont render air
  if (thisblock.textures === undefined) {
    return false;
  }
  // dont render if both blocks are solid
  if (!thisblock.transparent && !otherblock.transparent) {
    return false;
  }
  // dont render if both blocks are the same type
  if (thisblock == otherblock) {
    return false;
  }
  return true;
}

type BlockFace = {
  bi: number,
  face: Face,
  cubeLoc: vec3,
}

function createMesh(
  offset: vec3,
  bm: BlockManager,
  blocks: Uint16Array,
  leftBlocks: Uint16Array,
  rightBlocks: Uint16Array,
  upBlocks: Uint16Array,
  downBlocks: Uint16Array,
  backBlocks: Uint16Array,
  frontBlocks: Uint16Array,
): ChunkMesh {
  const lights: BlockFace[] = [];
  const solid: BlockFace[] = [];
  const transparent: BlockFace[] = [];

  for (let x = 0; x < CHUNK_X_SIZE; x++) {
    for (let y = 0; y < CHUNK_Y_SIZE; y++) {
      for (let z = 0; z < CHUNK_Z_SIZE; z++) {
        const bi = blocks[chunkDataIndex(x, y, z)];
        const cubeLoc = [offset[0] + x, offset[1] + y, offset[2] + z] as vec3;

        // block definition of this block
        const thisblock = bm.defs[bi];

        // skip air
        if (thisblock.textures === undefined) {
          continue;
        }

        // the array to put the faces into depends on 
        const dest = thisblock.transparent
          ? transparent
          : solid;

        // left face
        if (
          x === 0
            ? shouldRender(thisblock, bm.defs[leftBlocks[chunkDataIndex(CHUNK_X_SIZE - 1, y, z)]])
            : shouldRender(thisblock, bm.defs[blocks[chunkDataIndex(x - 1, y, z)]])
        ) {
          const val = { bi, cubeLoc, face: Face.LEFT };
          dest.push(val);
          if (thisblock.light) {
            lights.push(val);
          }
        }
        // right face
        if (
          x === CHUNK_X_SIZE - 1
            ? shouldRender(thisblock, bm.defs[rightBlocks[chunkDataIndex(0, y, z)]])
            : shouldRender(thisblock, bm.defs[blocks[chunkDataIndex(x + 1, y, z)]])
        ) {
          const val = { bi, cubeLoc, face: Face.RIGHT };
          dest.push(val);
          if (thisblock.light) {
            lights.push(val);
          }
        }
        // upper face
        if (
          y === 0
            ? shouldRender(thisblock, bm.defs[upBlocks[chunkDataIndex(x, CHUNK_Y_SIZE - 1, z)]])
            : shouldRender(thisblock, bm.defs[blocks[chunkDataIndex(x, y - 1, z)]])
        ) {
          const val = { bi, cubeLoc, face: Face.UP };
          dest.push(val);
          if (thisblock.light) {
            lights.push(val);
          }
        }
        // lower face
        if (
          y === CHUNK_Y_SIZE - 1
            ? shouldRender(thisblock, bm.defs[downBlocks[chunkDataIndex(x, 0, z)]])
            : shouldRender(thisblock, bm.defs[blocks[chunkDataIndex(x, y + 1, z)]])
        ) {
          const val = { bi, cubeLoc, face: Face.DOWN };
          dest.push(val);
          if (thisblock.light) {
            lights.push(val);
          }
        }
        // back face
        if (
          z === 0
            ? shouldRender(thisblock, bm.defs[backBlocks[chunkDataIndex(x, y, CHUNK_Z_SIZE - 1)]])
            : shouldRender(thisblock, bm.defs[blocks[chunkDataIndex(x, y, z - 1)]])
        ) {
          const val = { bi, cubeLoc, face: Face.BACK };
          dest.push(val);
          if (thisblock.light) {
            lights.push(val);
          }
        }
        // front face
        if (
          z === CHUNK_Z_SIZE - 1
            ? shouldRender(thisblock, bm.defs[frontBlocks[chunkDataIndex(x, y, 0)]])
            : shouldRender(thisblock, bm.defs[blocks[chunkDataIndex(x, y, z + 1)]])
        ) {
          const val = { bi, cubeLoc, face: Face.FRONT };
          dest.push(val);
          if (thisblock.light) {
            lights.push(val);
          }
        }
      }
    }
  }
  return { solid, transparent, lights };
}

function writeMesh(faces: BlockFace[]): Float32Array {
  const data = new Float32Array(faces.length * 6 * 6);

  let i = 0;
  for (const { bi, face, cubeLoc: [fx, fy, fz] } of faces) {
    // calculate vertexes
    const v000: vec3 = [fx + 0, fy + 0, fz + 0];
    const v100: vec3 = [fx + 1, fy + 0, fz + 0];
    const v001: vec3 = [fx + 0, fy + 0, fz + 1];
    const v101: vec3 = [fx + 1, fy + 0, fz + 1];
    const v010: vec3 = [fx + 0, fy + 1, fz + 0];
    const v110: vec3 = [fx + 1, fy + 1, fz + 0];
    const v011: vec3 = [fx + 0, fy + 1, fz + 1];
    const v111: vec3 = [fx + 1, fy + 1, fz + 1];

    // the texture id to use
    const v = bi * 6 + face;

    switch (face) {
      case Face.LEFT: {
        data.set(v000, i); i += 3; data.set([1, 0, v], i); i += 3;
        data.set(v001, i); i += 3; data.set([0, 0, v], i); i += 3;
        data.set(v010, i); i += 3; data.set([1, 1, v], i); i += 3;
        data.set(v001, i); i += 3; data.set([0, 0, v], i); i += 3;
        data.set(v011, i); i += 3; data.set([0, 1, v], i); i += 3;
        data.set(v010, i); i += 3; data.set([1, 1, v], i); i += 3;
        break;
      }
      case Face.RIGHT: {
        data.set(v100, i); i += 3; data.set([0, 0, v], i); i += 3;
        data.set(v110, i); i += 3; data.set([0, 1, v], i); i += 3;
        data.set(v101, i); i += 3; data.set([1, 0, v], i); i += 3;
        data.set(v101, i); i += 3; data.set([1, 0, v], i); i += 3;
        data.set(v110, i); i += 3; data.set([0, 1, v], i); i += 3;
        data.set(v111, i); i += 3; data.set([1, 1, v], i); i += 3;
        break;
      }
      case Face.UP: {
        data.set(v001, i); i += 3; data.set([1, 1, v], i); i += 3;
        data.set(v000, i); i += 3; data.set([1, 0, v], i); i += 3;
        data.set(v100, i); i += 3; data.set([0, 0, v], i); i += 3;
        data.set(v001, i); i += 3; data.set([1, 1, v], i); i += 3;
        data.set(v100, i); i += 3; data.set([0, 0, v], i); i += 3;
        data.set(v101, i); i += 3; data.set([0, 1, v], i); i += 3;
        break;
      }
      case Face.DOWN: {
        data.set(v010, i); i += 3; data.set([0, 0, v], i); i += 3;
        data.set(v011, i); i += 3; data.set([0, 1, v], i); i += 3;
        data.set(v110, i); i += 3; data.set([1, 0, v], i); i += 3;
        data.set(v110, i); i += 3; data.set([1, 0, v], i); i += 3;
        data.set(v011, i); i += 3; data.set([0, 1, v], i); i += 3;
        data.set(v111, i); i += 3; data.set([1, 1, v], i); i += 3;
        break;
      }
      case Face.BACK: {
        data.set(v000, i); i += 3; data.set([0, 0, v], i); i += 3;
        data.set(v010, i); i += 3; data.set([0, 1, v], i); i += 3;
        data.set(v100, i); i += 3; data.set([1, 0, v], i); i += 3;
        data.set(v100, i); i += 3; data.set([1, 0, v], i); i += 3;
        data.set(v010, i); i += 3; data.set([0, 1, v], i); i += 3;
        data.set(v110, i); i += 3; data.set([1, 1, v], i); i += 3;
        break;
      }
      case Face.FRONT: {
        data.set(v011, i); i += 3; data.set([1, 1, v], i); i += 3;
        data.set(v001, i); i += 3; data.set([1, 0, v], i); i += 3;
        data.set(v101, i); i += 3; data.set([0, 0, v], i); i += 3;
        data.set(v011, i); i += 3; data.set([1, 1, v], i); i += 3;
        data.set(v101, i); i += 3; data.set([0, 0, v], i); i += 3;
        data.set(v111, i); i += 3; data.set([0, 1, v], i); i += 3;
        break;
      }
    }
  }
  return data;
}

export default World;

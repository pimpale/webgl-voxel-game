import { makeNoise3D } from 'open-simplex-noise';
import { vec3, vec3_add, vec3_sub, vec3_dot, assert, mod, mat4_perspective, RADIANS, mat4_look_at, mat4_mul, mat4_to_uniform, mat4, mat4_transpose, vec3_length } from './utils';
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
const RENDER_RADIUS_X = 2;
const RENDER_RADIUS_Y = 2;
const RENDER_RADIUS_Z = 2;

type Graphics = {
  vao: WebGLVertexArrayObject;
  buffer: WebGLBuffer;
  vertexCount: number;
}

type Chunk = {
  blocks?: Uint16Array,
  mesh?: { stale: boolean, solid: BlockFace[], transparent: BlockFace[], lights: BlockFace[] }
  graphics?: { stale: boolean, solid: Graphics, transparent: Graphics }
  lights?: { stale: boolean, data: ChunkLightingGPUData, nLights: number }
}

// these should not get deleted! they merely transfer ownership (to avoid the massive costs of creation/deletion)
type ChunkLightingGPUData = {
  // Texture array containing an array of all the light shadow maps
  shadowTexArr: WebGLTexture,
  // array of fbs, one for each texture in the texture array
  shadowFbs: WebGLFramebuffer[],
  // texture array that's packed with data per light
  // each texture is 5x1, first pixel contains light location (rgb)
  // next 4 pixels represent the columns of the light matrix (rgba),
  lightDataTexArr: WebGLTexture,
}

const SHADOWMAP_SIZE = 128;
// max number of lights to render per chunk
const LIGHTS_PER_CHUNK = 18;
// there are 9 chunks surrounding us
const N_LIGHTS = 9 * LIGHTS_PER_CHUNK;


const vs = `#version 300 es
precision highp int;
precision highp float;
uniform mat4 u_mvpMat;

in vec3 a_position;
out vec3 v_position;

in vec3 a_tuv;
out vec3 v_tuv;

in vec3 a_normal;
out vec3 v_normal;

void main() {
   v_tuv = a_tuv;
   v_normal = a_normal;
   v_position = a_position;
   // actual location
   gl_Position = u_mvpMat * vec4(a_position, 1.0);
}
`;

const fs = `#version 300 es
precision highp int;
precision highp float;
precision highp sampler2DArray;

// the texture atlas for the blocks
uniform sampler2DArray u_textureAtlas;

uniform int u_lightNumber;

// the light depth maps array
uniform sampler2DArray u_lightDepthArr;

// the light data array
uniform sampler2DArray u_lightDataArr;

// position
in vec3 v_position;

// normal
in vec3 v_normal;

// texCoord
in vec3 v_tuv;

out vec4 v_outColor;

void main() {
  vec4 color = texture(u_textureAtlas, v_tuv);

  float lightSum = 0.3;

  for(int i = 0; i < u_lightNumber; i++) {
    // get light position from texture
    vec3 lightPos = texelFetch(u_lightDataArr, ivec3(0, 0, i), 0).rgb;
    mat4 lightMvp = mat4(
        texelFetch(u_lightDataArr, ivec3(1, 0, i), 0),
        texelFetch(u_lightDataArr, ivec3(2, 0, i), 0),
        texelFetch(u_lightDataArr, ivec3(3, 0, i), 0),
        texelFetch(u_lightDataArr, ivec3(4, 0, i), 0)
    );
    vec4 lightSpacePosition = lightMvp * vec4(v_position, 1.0);

    vec3 projectedCoord = lightSpacePosition.xyz / lightSpacePosition.w;
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
    const float bias = 0.01;
    float currentDepth = (projectedCoord.z + 1.0)/2.0 - bias;

    if(inRange && currentDepth <= depthMapDepth) {
        float intensity = (1.0-currentDepth);
        vec3 lightDir = normalize(lightPos - v_position);
        float diffuseIntensity = max(dot(v_normal, lightDir), 0.0);
        lightSum += 7.0*diffuseIntensity*intensity;
    }
  }
  v_outColor = vec4(color.rgb*lightSum, color.a);
}
`;

const shadow_vs = `#version 300 es
precision highp float;
in vec3 a_position;
uniform mat4 u_mvpMat;
void main() {
   gl_Position = u_mvpMat * vec4(a_position, 1.0);
}
`;


const shadow_fs = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec3 v_tuv;
out vec4 v_outColor;

void main() {
  v_outColor = vec4(0.0, 0.0, 0.0, 1.0);
}
`;

export type Highlight = {
  coords: vec3,
  face: Face
}

class World {
  private readonly POSITION_LOC = 0;
  private readonly NORMAL_LOC = 1;
  private readonly TUV_LOC = 2;


  private textureAtlas: WebGLTexture;

  private renderProgram: WebGLProgram;
  private renderMvpMatLoc: WebGLUniformLocation;
  private renderTextureAtlasLoc: WebGLUniformLocation;
  private renderLightNumber: WebGLUniformLocation;
  private renderLightDepthArr: WebGLUniformLocation;
  private renderLightDataArr: WebGLUniformLocation;

  private shadowProgram: WebGLProgram;
  private shadowMvpMatLoc: WebGLUniformLocation;

  readonly emptyChunk = new Uint16Array(CHUNK_X_SIZE * CHUNK_Y_SIZE * CHUNK_Z_SIZE);

  private worldChunkCenterLoc: vec3;

  // worldgen function
  private readonly seed: number;
  private readonly noiseFn: (x: number, y: number, z: number) => number;

  // list of active <id, highlight> pairs
  private highlights: Map<string, Graphics>;

  // list storing free ChunkLightingGPUData (put here after a chunk is deleted)
  private freeChunkLightingGPUData: ChunkLightingGPUData[];

  // hashmap storing chunks
  private chunk_map: Map<string, Chunk>;

  private gl: WebGL2RenderingContext;
  public blockManager: BlockManager

  getWorldChunkLoc = (cameraLoc: vec3) => [
    Math.floor(cameraLoc[0] / CHUNK_X_SIZE),
    Math.floor(cameraLoc[1] / CHUNK_Y_SIZE),
    Math.floor(cameraLoc[2] / CHUNK_Z_SIZE),
  ] as vec3;

  constructor(seed: number, cameraLoc: vec3, gl: WebGL2RenderingContext, blockManager: BlockManager, camera: Camera) {
    this.gl = gl;
    this.blockManager = blockManager;
    this.seed = seed;
    this.noiseFn = makeNoise3D(seed);
    this.worldChunkCenterLoc = this.getWorldChunkLoc(cameraLoc);
    this.chunk_map = new Map();
    this.highlights = new Map();

    this.renderProgram = createProgram(
      this.gl,
      [
        createShader(this.gl, this.gl.VERTEX_SHADER, vs),
        createShader(this.gl, this.gl.FRAGMENT_SHADER, fs),
      ],
      new Map([
        [this.POSITION_LOC, 'a_position'],
        [this.NORMAL_LOC, 'a_normal'],
        [this.TUV_LOC, 'a_tuv'],
      ])
    )!;

    // set this program as current
    this.gl.useProgram(this.renderProgram);

    console.log(this.gl.getParameter(this.gl.MAX_VARYING_VECTORS));

    // retrieve uniforms
    this.renderMvpMatLoc = this.gl.getUniformLocation(this.renderProgram, "u_mvpMat")!;
    this.renderTextureAtlasLoc = this.gl.getUniformLocation(this.renderProgram, "u_textureAtlas")!;
    this.renderLightNumber = this.gl.getUniformLocation(this.renderProgram, "u_lightNumber")!;
    this.renderLightDepthArr = this.gl.getUniformLocation(this.renderProgram, "u_lightDepthArr")!;
    this.renderLightDataArr = this.gl.getUniformLocation(this.renderProgram, "u_lightDataArr")!;

    // set texture 0 as current
    this.gl.activeTexture(this.gl.TEXTURE0);
    // create texture atlas at texture 0
    this.textureAtlas = this.blockManager.buildTextureAtlas(this.gl);
    // Tell the shader to get the textureAtlas texture from texture unit 0
    this.gl.uniform1i(this.renderTextureAtlasLoc, 0);
    // tell the shader to get its light depth textures from texutre unit 1
    this.gl.uniform1i(this.renderLightDepthArr, 1);
    // tell the shader to get its textures from this from texture unit 2
    this.gl.uniform1i(this.renderLightDataArr, 2);

    // create program
    this.shadowProgram = createProgram(
      this.gl,
      [
        createShader(this.gl, this.gl.VERTEX_SHADER, shadow_vs),
        createShader(this.gl, this.gl.FRAGMENT_SHADER, shadow_fs),
      ],
      new Map([
        [this.POSITION_LOC, 'a_position'],
      ])
    )!;
    this.gl.useProgram(this.shadowProgram);
    this.shadowMvpMatLoc = this.gl.getUniformLocation(this.shadowProgram, "u_mvpMat")!;

    // create data SUPER EXPENSIVE
    this.freeChunkLightingGPUData = [];
    for (let i = 0; i < (RENDER_RADIUS_X * 2 + 1) * (RENDER_RADIUS_Y * 2 + 1) * (RENDER_RADIUS_Z * 2 + 1); i++) {
      this.freeChunkLightingGPUData.push(createChunkLightingGPUData(this.gl));
    }

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
      9 * 4,          // stride (0 = auto)
      0 * 4,          // offset
    );
    this.gl.enableVertexAttribArray(this.NORMAL_LOC);
    this.gl.vertexAttribPointer(
      this.NORMAL_LOC,
      3,              // size (num components)
      this.gl.FLOAT,  // type of data in buffer
      false,          // normalize
      9 * 4,          // stride (0 = auto)
      3 * 4,          // offset
    );
    this.gl.enableVertexAttribArray(this.TUV_LOC);
    this.gl.vertexAttribPointer(
      this.TUV_LOC,
      3,              // size (num components)
      this.gl.FLOAT,  // type of data in buffer
      false,          // normalize
      9 * 4,          // stride (0 = auto)
      6 * 4,          // offset
    );

    return {
      vao,
      buffer,
      vertexCount: data.length / 9,
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
          this.freeChunkLightingGPUData.push(chunk.lights.data);
        }
        this.chunk_map.delete(coord);
      }
    }

    // create list of all locs that should be rendered
    const toLoad: vec3[] = []
    for (let x = -RENDER_RADIUS_X; x <= RENDER_RADIUS_X; x++) {
      for (let y = -RENDER_RADIUS_Y; y <= RENDER_RADIUS_Y; y++) {
        for (let z = -RENDER_RADIUS_Z; z <= RENDER_RADIUS_Z; z++) {
          toLoad.push(vec3_add(this.worldChunkCenterLoc, [x, y, z]));
        }
      }
    }

    // sort by closest to us
    toLoad.sort((a, b) => {
      const a_d = vec3_length(vec3_sub(a, this.worldChunkCenterLoc));
      const b_d = vec3_length(vec3_sub(b, this.worldChunkCenterLoc));

      return a_d - b_d;
    });

    // initialize if not exists
    for (const coord of toLoad) {
      const strCoord = JSON.stringify(coord);
      const chunk = this.chunk_map.get(strCoord);
      if (chunk === undefined) {
        this.chunk_map.set(strCoord, {})
      }
    }
  }

  addHighlight = (id: string, ray: Highlight) => {
    const highlight = this.highlights.get(id);
    if (highlight !== undefined) {
      this.deleteGraphics(highlight);
    }
    const graphics = this.createGraphics(writeMesh([{
      bi: 6,
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

  private createLightData = (face: BlockFace): [vec3, mat4] => {
    // actual location of the light is in the center of the block
    const lightLoc = vec3_add(face.cubeLoc, [0.5, 0.5, 0.5]);
    // note that the near plane starts slightly after the face
    // the far plane is less than the chunk size
    const projectionMat = mat4_perspective(RADIANS(90.0), 1, 0.5, 10);

    const up: vec3 = face.face === Face.UP || face.face === Face.DOWN
      ? [-1, 0, 0]
      : [0, -1, 0];

    const viewMat = mat4_look_at(lightLoc, vec3_add(lightLoc, getNormal(face.face)), up);
    // compute final matrix
    const lightMvp = mat4_mul(projectionMat, viewMat)
    // return
    return [lightLoc, lightMvp];
  }

  private updateLightDataTex = (tex: WebGLTexture, lightData: [vec3, mat4][]) => {
    // 5 pixels, 4 channels = 20 floats per entry
    const data = new Float32Array(lightData.length * 20);
    for (let i = 0; i < lightData.length; i++) {
      let [loc, mat] = lightData[i];
      let [m0, m1, m2, m3] = mat4_transpose(mat);
      data.set(loc, i * 20);
      data.set(m0, i * 20 + 4);
      data.set(m1, i * 20 + 8);
      data.set(m2, i * 20 + 12);
      data.set(m3, i * 20 + 16);
    }

    this.gl.bindTexture(this.gl.TEXTURE_2D_ARRAY, tex);
    this.gl.texSubImage3D(
      this.gl.TEXTURE_2D_ARRAY, //target
      0, // level
      0, // xoffset
      0, // yoffset
      0, // zoffset
      5, // width
      1, // height
      lightData.length, // depth
      this.gl.RGBA, // format
      this.gl.FLOAT, // type
      data, // pixels
    );
  }

  // we use a 3d texture to store all of the textures in a cube
  private renderShadowMap = (
    tex: WebGLTexture,
    fb: WebGLFramebuffer,
    mvpMat: mat4,
    solids: Graphics[]
  ) => {
    this.gl.useProgram(this.shadowProgram);

    // bind mvpMat matrix
    this.gl.uniformMatrix4fv(this.shadowMvpMatLoc, false, mat4_to_uniform(mvpMat));

    // set settings
    this.gl.viewport(0, 0, SHADOWMAP_SIZE, SHADOWMAP_SIZE);
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
        // update our graphics
        if (chunk.graphics !== undefined) {
          chunk.graphics.stale = true;
        }
        // lights for all surrounding chunks will need to rerender
        if (chunk.lights !== undefined) {
          chunk.lights.stale = true;
        }
        for (const coord of this.neighboringChunkLocs(parsedCoord)) {
          const chunk = this.chunk_map.get(JSON.stringify(coord));
          if (chunk && chunk.lights) {
            chunk.lights.stale = true;
          }
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
        // all the chunks we'll use
        const relevantChunkCoords = [
          coord,
          ...this.neighboringChunkLocs(parsedCoord).map(x => JSON.stringify(x))
        ];

        // gather up to LIGHTS_PER_CHUNK lights from each chunk surrounding us
        const lightData = relevantChunkCoords
          // grab up to LIGHTS_PER_CHUNK lights from each chunk
          .flatMap(coord => {
            const chunk = this.chunk_map.get(coord);
            if (chunk && chunk.mesh) {
              return chunk.mesh.lights.slice(0, LIGHTS_PER_CHUNK);
            } else {
              return [];
            }
          })
          // limit to n_lights at max
          .slice(0, N_LIGHTS)
          // create light data for each one
          .map(this.createLightData)
          ;

        //console.log(lightData);

        // update data
        if (chunk.lights === undefined) {
          const data = this.freeChunkLightingGPUData.pop();
          if (data === undefined) {
            continue;
          }
          chunk.lights = { data, stale: true, nLights: lightData.length }
        } else {
          chunk.lights.nLights = lightData.length;
        }

        // only want to render solid part of scene
        const solidsToRender: Graphics[] = [];
        for (const coord of relevantChunkCoords) {
          const chunk = this.chunk_map.get(coord);
          if (chunk && chunk.graphics) {
            solidsToRender.push(chunk.graphics.solid);
          }
        }

        // now iterate through our graphics map and render world
        for (let i = 0; i < lightData.length; i++) {
          this.renderShadowMap(chunk.lights.data.shadowTexArr, chunk.lights.data.shadowFbs[i], lightData[i][1], solidsToRender);
        }

        // update light data
        this.updateLightDataTex(chunk.lights.data.lightDataTexArr, lightData);

        // mark not stale
        chunk.lights.stale = false;
        current_cost += CHUNK_RENDERLIGHT_COST;
      }

      if (current_cost > 1) { break CHUNK_UPDATE_LOOP; }
    }

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

    // bind the texture 0 to render atlas
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D_ARRAY, this.textureAtlas);

    this.gl.enable(this.gl.DEPTH_TEST); // enable depth tests
    this.gl.enable(this.gl.CULL_FACE) // remove reversed faces
    this.gl.enable(this.gl.BLEND) // enable blending
    this.gl.blendFunc(this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA) // blend by adding together alpha

    this.gl.clearColor(0.0, 0.0, 0.0, 1.0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);

    for (const chunk of this.chunk_map.values()) {
      if (chunk.graphics !== undefined && chunk.lights !== undefined) {
        // bind this chunk's vertex array
        this.gl.bindVertexArray(chunk.graphics.solid.vao);

        // set n lights correctly
        this.gl.uniform1i(this.renderLightNumber, chunk.lights.nLights);

        // bind this chunk's light depths to tex 1
        this.gl.activeTexture(this.gl.TEXTURE1);
        this.gl.bindTexture(this.gl.TEXTURE_2D_ARRAY, chunk.lights.data.shadowTexArr);

        // bind this chunk's light data to tex 2
        this.gl.activeTexture(this.gl.TEXTURE2);
        this.gl.bindTexture(this.gl.TEXTURE_2D_ARRAY, chunk.lights.data.lightDataTexArr);

        // draw arrays
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
    const setMeshStaleIfExists = (chunkLoc: vec3) => {
      const chunk = this.chunk_map.get(JSON.stringify(chunkLoc));
      if (chunk && chunk.mesh) {
        chunk.mesh.stale = true;
      }
    }

    const chunkCoord = this.getWorldChunkLoc(coords);
    const chunk = this.chunk_map.get(JSON.stringify(chunkCoord));
    if (chunk && chunk.blocks) {
      const x = Math.floor(mod(coords[0], CHUNK_X_SIZE));
      const y = Math.floor(mod(coords[1], CHUNK_Y_SIZE));
      const z = Math.floor(mod(coords[2], CHUNK_Z_SIZE));

      chunk.blocks[chunkDataIndex(x, y, z)] = val;

      // means we need to recompute the mesh of this and neighboring chunks (if affected)
      setMeshStaleIfExists(chunkCoord);
      if (x === 0) {
        setMeshStaleIfExists(vec3_add(chunkCoord, [-1, 0, 0]));
      }
      if (x === CHUNK_X_SIZE - 1) {
        setMeshStaleIfExists(vec3_add(chunkCoord, [+1, 0, 0]));
      }
      if (y === 0) {
        setMeshStaleIfExists(vec3_add(chunkCoord, [0, -1, 0]));
      }
      if (y === CHUNK_Y_SIZE - 1) {
        setMeshStaleIfExists(vec3_add(chunkCoord, [0, +1, 0]));
      }
      if (z === 0) {
        setMeshStaleIfExists(vec3_add(chunkCoord, [0, 0, -1]));
      }
      if (z === CHUNK_Z_SIZE - 1) {
        setMeshStaleIfExists(vec3_add(chunkCoord, [0, 0, +1]));
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

        if (valHere > 0.5) {
          if (valAbove > 0.5) {
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

  blocks[CHUNK_X_SIZE - 2] = 5;

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
  const data = new Float32Array(faces.length * 6 * 9);

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


    const nLeft: vec3 = [-1, 0, 0];
    const nRight: vec3 = [+1, 0, 0];
    const nUp: vec3 = [0, -1, 0];
    const nDown: vec3 = [0, +1, 0];
    const nBack: vec3 = [0, 0, -1];
    const nFront: vec3 = [0, 0, +1];

    switch (face) {
      case Face.LEFT: {
        data.set(v000, i); i += 3; data.set(nLeft, i); i += 3; data.set([1, 0, v], i); i += 3;
        data.set(v001, i); i += 3; data.set(nLeft, i); i += 3; data.set([0, 0, v], i); i += 3;
        data.set(v010, i); i += 3; data.set(nLeft, i); i += 3; data.set([1, 1, v], i); i += 3;
        data.set(v001, i); i += 3; data.set(nLeft, i); i += 3; data.set([0, 0, v], i); i += 3;
        data.set(v011, i); i += 3; data.set(nLeft, i); i += 3; data.set([0, 1, v], i); i += 3;
        data.set(v010, i); i += 3; data.set(nLeft, i); i += 3; data.set([1, 1, v], i); i += 3;
        break;
      }
      case Face.RIGHT: {
        data.set(v100, i); i += 3; data.set(nRight, i); i += 3; data.set([0, 0, v], i); i += 3;
        data.set(v110, i); i += 3; data.set(nRight, i); i += 3; data.set([0, 1, v], i); i += 3;
        data.set(v101, i); i += 3; data.set(nRight, i); i += 3; data.set([1, 0, v], i); i += 3;
        data.set(v101, i); i += 3; data.set(nRight, i); i += 3; data.set([1, 0, v], i); i += 3;
        data.set(v110, i); i += 3; data.set(nRight, i); i += 3; data.set([0, 1, v], i); i += 3;
        data.set(v111, i); i += 3; data.set(nRight, i); i += 3; data.set([1, 1, v], i); i += 3;
        break;
      }
      case Face.UP: {
        data.set(v001, i); i += 3; data.set(nUp, i); i += 3; data.set([1, 1, v], i); i += 3;
        data.set(v000, i); i += 3; data.set(nUp, i); i += 3; data.set([1, 0, v], i); i += 3;
        data.set(v100, i); i += 3; data.set(nUp, i); i += 3; data.set([0, 0, v], i); i += 3;
        data.set(v001, i); i += 3; data.set(nUp, i); i += 3; data.set([1, 1, v], i); i += 3;
        data.set(v100, i); i += 3; data.set(nUp, i); i += 3; data.set([0, 0, v], i); i += 3;
        data.set(v101, i); i += 3; data.set(nUp, i); i += 3; data.set([0, 1, v], i); i += 3;
        break;
      }
      case Face.DOWN: {
        data.set(v010, i); i += 3; data.set(nDown, i); i += 3; data.set([0, 0, v], i); i += 3;
        data.set(v011, i); i += 3; data.set(nDown, i); i += 3; data.set([0, 1, v], i); i += 3;
        data.set(v110, i); i += 3; data.set(nDown, i); i += 3; data.set([1, 0, v], i); i += 3;
        data.set(v110, i); i += 3; data.set(nDown, i); i += 3; data.set([1, 0, v], i); i += 3;
        data.set(v011, i); i += 3; data.set(nDown, i); i += 3; data.set([0, 1, v], i); i += 3;
        data.set(v111, i); i += 3; data.set(nDown, i); i += 3; data.set([1, 1, v], i); i += 3;
        break;
      }
      case Face.BACK: {
        data.set(v000, i); i += 3; data.set(nBack, i); i += 3; data.set([0, 0, v], i); i += 3;
        data.set(v010, i); i += 3; data.set(nBack, i); i += 3; data.set([0, 1, v], i); i += 3;
        data.set(v100, i); i += 3; data.set(nBack, i); i += 3; data.set([1, 0, v], i); i += 3;
        data.set(v100, i); i += 3; data.set(nBack, i); i += 3; data.set([1, 0, v], i); i += 3;
        data.set(v010, i); i += 3; data.set(nBack, i); i += 3; data.set([0, 1, v], i); i += 3;
        data.set(v110, i); i += 3; data.set(nBack, i); i += 3; data.set([1, 1, v], i); i += 3;
        break;
      }
      case Face.FRONT: {
        data.set(v011, i); i += 3; data.set(nFront, i); i += 3; data.set([1, 1, v], i); i += 3;
        data.set(v001, i); i += 3; data.set(nFront, i); i += 3; data.set([1, 0, v], i); i += 3;
        data.set(v101, i); i += 3; data.set(nFront, i); i += 3; data.set([0, 0, v], i); i += 3;
        data.set(v011, i); i += 3; data.set(nFront, i); i += 3; data.set([1, 1, v], i); i += 3;
        data.set(v101, i); i += 3; data.set(nFront, i); i += 3; data.set([0, 0, v], i); i += 3;
        data.set(v111, i); i += 3; data.set(nFront, i); i += 3; data.set([0, 1, v], i); i += 3;
        break;
      }
    }
  }
  return data;
}

const createChunkLightingGPUData = (gl: WebGL2RenderingContext): ChunkLightingGPUData => {
  const lightDataTexArr = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, lightDataTexArr);
  gl.texImage3D(
    gl.TEXTURE_2D_ARRAY,      // target
    0,                    // mip level
    gl.RGBA32F, // internal format
    5,   // width
    1,   // height
    N_LIGHTS,         // depth
    0,                  // border
    gl.RGBA, // format
    gl.FLOAT,           // type
    null,              // data
  );
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);


  const shadowTexArr = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, shadowTexArr);
  gl.texImage3D(
    gl.TEXTURE_2D_ARRAY,      // target
    0,                    // mip level
    gl.DEPTH_COMPONENT32F, // internal format
    SHADOWMAP_SIZE,   // width
    SHADOWMAP_SIZE,   // height
    N_LIGHTS,   // depth
    0,                  // border
    gl.DEPTH_COMPONENT, // format
    gl.FLOAT,           // type
    null,              // data
  );
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const shadowFbs: WebGLFramebuffer[] = []

  for (let i = 0; i < N_LIGHTS; i++) {
    const depthFramebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, depthFramebuffer);
    gl.framebufferTextureLayer(
      gl.FRAMEBUFFER,       // target
      gl.DEPTH_ATTACHMENT,  // attachment point
      shadowTexArr,              // texture
      0,                         // mip level
      i,                         // layer
    );
    shadowFbs.push(depthFramebuffer);
  }

  return { shadowTexArr, shadowFbs, lightDataTexArr, };
}



export default World;

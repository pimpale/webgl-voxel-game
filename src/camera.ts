import { clamp, RADIANS, vec3_norm, vec3_cross, vec3_add, vec3_scale, vec3, mat4, mat4_perspective, mat4_mul, mat4_transpose, mat4_look_at, } from './utils';

const worldup: vec3 = [0.0, -1.0, 0.0];

export class CameraBasis {
  readonly front: vec3;
  readonly right: vec3;
  readonly up: vec3;
  constructor(pitch: number, yaw: number) {

    // calculate front vector from yaw and pitch
    this.front = vec3_norm([
      Math.cos(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.sin(yaw) * Math.cos(pitch),
    ]);

    // calculate others from via gram schmidt process
    this.right = vec3_norm(vec3_cross(this.front, worldup));
    this.up = vec3_norm(vec3_cross(this.right, this.front));
  }
}

// The camera struct
class Camera {
  // global camera position
  private pos: vec3;
  // pitch and yaw values in radians
  private pitch: number = 0.0;
  private yaw: number = RADIANS(-90.0);
  // the camera's basis
  private basis: CameraBasis;

  private canvas: HTMLCanvasElement;

  private controlsEnabled: boolean = false;
  private fast: boolean = false;
  private keys: Set<string> = new Set();

  constructor(loc: vec3, canvas: HTMLCanvasElement) {
    this.pos = loc;
    this.canvas = canvas;
    this.basis = new CameraBasis(this.pitch, this.yaw);

    window.addEventListener("keypress", e => {
      if (e.key === "f") {
        this.fast = !this.fast;
      }
    })

    window.addEventListener("keydown", e => this.keys.add(e.code));
    window.addEventListener("keyup", e => this.keys.delete(e.code));

    // grab pointer lock on click
    this.canvas.addEventListener("click", e => {
      this.canvas.requestPointerLock();
    });

    // controls are enabled if and only if pointer is locked
    document.addEventListener('pointerlockchange', e => {
      this.controlsEnabled = document.pointerLockElement === this.canvas;
    });

    // enable looking
    this.canvas.addEventListener('mousemove', e => {
      if (!this.controlsEnabled) {
        return;
      }

      const rotscale = 0.001;

      this.yaw -= e.movementX * rotscale;
      this.pitch -= e.movementY * rotscale;

      // clamp camera->pitch between +/-89 degrees
      this.pitch = clamp(this.pitch, RADIANS(-89.9), RADIANS(89.9));

      // rebuild basis vectors
      this.basis = new CameraBasis(this.pitch, this.yaw);
    });
  }

  update = () => {
    if (!this.controlsEnabled) {
      return;
    }

    let movscale = 0.02;
    if (this.fast) {
      movscale *= 5;
    }

    const forwarddir = vec3_norm(vec3_cross(this.basis.right, worldup));
    if (this.keys.has('KeyW')) {
      this.pos = vec3_add(this.pos, vec3_scale(forwarddir, movscale));
    }
    if (this.keys.has('KeyS')) {
      this.pos = vec3_add(this.pos, vec3_scale(forwarddir, -movscale));
    }
    if (this.keys.has('KeyA')) {
      this.pos = vec3_add(this.pos, vec3_scale(this.basis.right, movscale));
    }
    if (this.keys.has('KeyD')) {
      this.pos = vec3_add(this.pos, vec3_scale(this.basis.right, -movscale));
    }
    if (this.keys.has('ShiftLeft')) {
      this.pos = vec3_add(this.pos, vec3_scale(worldup, -movscale));
    }
    if (this.keys.has('Space')) {
      this.pos = vec3_add(this.pos, vec3_scale(worldup, movscale));
    }
  }

  getMvp = () => {
    const fov = RADIANS(90.0);
    const aspect_ratio = this.canvas.width / this.canvas.height;
    const projection = mat4_perspective(fov, aspect_ratio, 0.001, 1000.0);

    // the place we're looking at is in the opposite direction as front
    const look_pos = vec3_add(this.pos, vec3_scale(this.basis.front, -1));

    // calculate the view matrix using our camera basis
    const view = mat4_look_at(this.pos, look_pos, worldup);

    // compute final matrix
    return mat4_mul(projection, view);
  }

  getLoc = () => [this.pos[0], this.pos[1], this.pos[2]] as vec3
}

export default Camera

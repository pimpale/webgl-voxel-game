import { clamp, RADIANS, vec3_norm, vec3_cross, vec3_add, vec3_scale, vec3, mat4, mat4_perspective, mat4_mul, mat4_transpose, mat4_look_at, } from './utils';
import { MatrixProd } from './utils';


const worldup: vec3 = [0.0, 1.0, 0.0];

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
  private pitch: number;
  private yaw: number;
  // the camera's basis
  private basis: CameraBasis;

  private canvas: HTMLCanvasElement;

  private controlsEnabled: boolean;
  private fast: boolean;
  private keys: {
    w: boolean,
    a: boolean,
    s: boolean,
    d: boolean,
    space: boolean,
    shift: boolean,
  };

  constructor(loc: vec3, canvas: HTMLCanvasElement) {
    this.pos = loc;
    this.canvas = canvas;
    this.pitch = 0.0;
    this.yaw = RADIANS(-90.0);
    this.basis = new CameraBasis(this.pitch, this.yaw);

    this.controlsEnabled = false;
    this.fast = false;
    this.keys = { w: false, a: false, s: false, d: false, space: false, shift: false };

    window.addEventListener("keydown", e => {
      switch (e.key) {
        case "w": {
          this.keys.w = true;
          break;
        }
        case "a": {
          this.keys.a = true;
          break;
        }
        case "s": {
          this.keys.s = true;
          break;
        }
        case "d": {
          this.keys.d = true;
          break;
        }
        case " ": {
          this.keys.space = true;
          break;
        }
        case "Shift": {
          this.keys.shift = true;
          break;
        }
      }
    });

    window.addEventListener("keyup", e => {
      switch (e.key) {
        case "w": {
          this.keys.w = false;
          break;
        }
        case "a": {
          this.keys.a = false;
          break;
        }
        case "s": {
          this.keys.s = false;
          break;
        }
        case "d": {
          this.keys.d = false;
          break;
        }
        case " ": {
          this.keys.space = false;
          break;
        }
        case "Shift": {
          this.keys.shift = false;
          break;
        }
      }
    });

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

      this.yaw += e.movementX * rotscale;
      this.pitch += e.movementY * rotscale;

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
      movscale *= 2;
    }

    const forwarddir = vec3_norm(vec3_cross(this.basis.right, worldup));
    if (this.keys.w) {
      this.pos = vec3_add(this.pos, vec3_scale(forwarddir, movscale));
    }
    if (this.keys.s) {
      this.pos = vec3_add(this.pos, vec3_scale(forwarddir, -movscale));
    }
    if (this.keys.a) {
      this.pos = vec3_add(this.pos, vec3_scale(this.basis.right, movscale));
    }
    if (this.keys.d) {
      this.pos = vec3_add(this.pos, vec3_scale(this.basis.right, -movscale));
    }
    if (this.keys.shift) {
      this.pos = vec3_add(this.pos, vec3_scale(worldup, -movscale));
    }
    if (this.keys.space) {
      this.pos = vec3_add(this.pos, vec3_scale(worldup, movscale));
    }
  }

  q = 0;

  getMvp = () => {
    const fov = RADIANS(90.0);
    const aspect_ratio = this.canvas.width / this.canvas.height;
    const projection = mat4_perspective(fov, aspect_ratio, 0.001, 1000.0);

    // the place we're looking at is in the opposite direction as front
    const look_pos = vec3_add(this.pos, vec3_scale(this.basis.front, -1));

    // calculate the view matrix using our camera basis
    const view = mat4_look_at(this.pos, look_pos, worldup);

    this.q++;
    if (this.q % 100 == 0) {
      console.log("pos");
      console.log(this.pos);
    }


    // compute final matrix
    return MatrixProd(projection, view);
  }
}

export default Camera

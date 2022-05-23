import { RADIANS, vec3, vec3_cross, vec3_add, vec3_scale, vec3_norm, clamp } from './utils';
import { Camera, CameraBasis } from './camera'

type GlobalComponentData = {

}


export abstract class Component {
  // must override
  abstract applySystem: (e: Entity) => void;
}

export class Entity {
  // location of the entity
  pos: vec3;
  // vector the entity is looking at
  dir: vec3;

  components: Component[]

  constructor(components: Component[], pos?: vec3, dir?: vec3) {
    this.components = components;
    this.pos = pos === undefined ? [0, 0, 0] : pos;
    this.dir = dir === undefined ? [1, 0, 0] : dir;
  }

  // update all components
  update = () => {
    for (const component of this.components) {
      component.applySystem(this);
    }
  }
}

export class PlayerControlComponent extends Component {

  // the element that is clicked to regain control after clicking away
  private readonly grabControlElement: HTMLElement;

  readonly worldup: vec3;

  // pitch and yaw values in radians
  private pitch: number = 0.0;
  private yaw: number = RADIANS(-90.0);

  private controlsEnabled: boolean = false;
  private fast: boolean = false;
  private fly: boolean = true;

  private keys: Set<string> = new Set();

  private leftMouseDown = false;
  private rightMouseDown = false;

  constructor(worldup: vec3, grabControlElement: HTMLElement) {
    super();
    this.worldup = worldup;
    this.grabControlElement = grabControlElement;
    window.addEventListener("keypress", e => {
      if (e.key === "f") {
        this.fast = !this.fast;
      }
    })

    window.addEventListener("keydown", e => this.keys.add(e.code));
    window.addEventListener("keyup", e => this.keys.delete(e.code));

    // grab pointer lock on click
    this.grabControlElement.addEventListener("click", e => {
      this.grabControlElement.requestPointerLock();
    });

    // controls are enabled if and only if pointer is locked
    document.addEventListener('pointerlockchange', e => {
      this.controlsEnabled = document.pointerLockElement === this.grabControlElement;
    });

    // enable looking
    window.addEventListener('mousemove', e => {
      if (!this.controlsEnabled) {
        return;
      }

      const rotscale = 0.001;

      this.yaw -= e.movementX * rotscale;
      this.pitch -= e.movementY * rotscale;

      // clamp camera->pitch between +/-89 degrees
      this.pitch = clamp(this.pitch, RADIANS(-89.9), RADIANS(89.9));

    });

    window.addEventListener('mousedown', e => {
      if (e.button === 0) {
        this.leftMouseDown = true;
      } else if (e.button === 2) {
        this.rightMouseDown = true;
      }
    });
    window.addEventListener('mouseup', e => {
      if (e.button === 0) {
        this.leftMouseDown = false;
      } else if (e.button === 2) {
        this.rightMouseDown = false;
      }
    });
  }

  applySystem = (e: Entity) => {
    // build basis vectors
    const basis = new CameraBasis(this.pitch, this.yaw, this.worldup);
    // the player basis is in the opposite direction as the direction the camera looks
    e.dir = vec3_scale(basis.front, -1);

    // only do things if control is locked
    if (this.controlsEnabled) {
      const forwarddir = vec3_norm(vec3_cross(basis.right, this.worldup));
      let movscale = this.fast ? 0.1 : 0.02;
      if (this.fly) {
        // fly
        if (this.keys.has('KeyW')) {
          e.pos = vec3_add(e.pos, vec3_scale(forwarddir, movscale));
        }
        if (this.keys.has('KeyS')) {
          e.pos = vec3_add(e.pos, vec3_scale(forwarddir, -movscale));
        }
        if (this.keys.has('KeyA')) {
          e.pos = vec3_add(e.pos, vec3_scale(basis.right, movscale));
        }
        if (this.keys.has('KeyD')) {
          e.pos = vec3_add(e.pos, vec3_scale(basis.right, -movscale));
        }
        if (this.keys.has('ShiftLeft')) {
          e.pos = vec3_add(e.pos, vec3_scale(this.worldup, -movscale));
        }
        if (this.keys.has('Space')) {
          e.pos = vec3_add(e.pos, vec3_scale(this.worldup, movscale));
        }
      } else {
        // walk
        if (this.keys.has('KeyW')) {
          e.pos = vec3_add(e.pos, vec3_scale(forwarddir, movscale));
        }
        if (this.keys.has('KeyS')) {
          e.pos = vec3_add(e.pos, vec3_scale(forwarddir, -movscale));
        }
        if (this.keys.has('KeyA')) {
          e.pos = vec3_add(e.pos, vec3_scale(basis.right, movscale));
        }
        if (this.keys.has('KeyD')) {
          e.pos = vec3_add(e.pos, vec3_scale(basis.right, -movscale));
        }
        if (this.keys.has('Space')) {
            requestJump()
        }
      }

      // break/place block
      if (this.leftMouseDown) {
        // submit request to

      }



    }

  }
}

// makes the camera follow this entity
export class CameraComponent extends Component {
  private camera: Camera;

  constructor(camera: Camera) {
    super();
    this.camera = camera;
  }

  applySystem = (e: Entity) => {
    this.camera.setDir(e.dir);
    this.camera.setPos(e.pos);
  }
}

export class PhysicsComponent extends Component {
  // gravity pulls you in the opposite of this direction
  private readonly worldup: vec3;

  private

  constructor(gravity: vec3) {
    super();

  }
}

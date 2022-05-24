import { RADIANS, vec3, vec3_cross, vec3_add, vec3_scale, vec3_norm, clamp } from './utils';
import { Camera, CameraBasis } from './camera'
import World, { Highlight } from './world'
import { getNormal } from './block';

type GlobalComponentData = {

}


export abstract class Component {
  // must override
  abstract applySystem: (e: Entity) => void;
}



// https://stackoverflow.com/questions/1349404/generate-random-string-characters-in-javascript
// generateId :: Integer -> String
function generateId(len: number) {
  // dec2hex :: Integer -> String
  // i.e. 0-255 -> '00'-'ff'
  function dec2hex(dec: number) {
    return dec.toString(16).padStart(2, "0")
  }
  const arr = new Uint8Array(len / 2)
  window.crypto.getRandomValues(arr)
  return Array.from(arr, dec2hex).join('')
}

export class Entity {
  // location of the entity
  pos: vec3;
  // vector the entity is looking at
  dir: vec3;
  // the up of this entity.
  // Gravity should affect it this way
  worldup: vec3;

  components: Component[]

  constructor(components: Component[], worldup: vec3, pos?: vec3, dir?: vec3) {
    this.components = components;
    this.worldup = worldup;
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

  private physics: PhysicsComponent;
  private blockInteraction: BlockInteractionComponent;

  // the element that is clicked to regain control after clicking away
  private readonly grabControlElement: HTMLElement;

  // pitch and yaw values in radians
  private pitch: number = 0.0;
  private yaw: number = RADIANS(-90.0);

  private controlsEnabled: boolean = false;
  private fast: boolean = false;
  private fly: boolean = true;

  private keys: Set<string> = new Set();

  private leftMouseDown = false;
  private rightMouseDown = false;

  constructor(grabControlElement: HTMLElement, physics: PhysicsComponent, blockInteraction: BlockInteractionComponent) {
    super();
    this.physics = physics;
    this.blockInteraction = blockInteraction;
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

      const rotscale = 0.0015;

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
    const basis = new CameraBasis(this.pitch, this.yaw, e.worldup);
    // the player basis is in the opposite direction as the direction the camera looks
    e.dir = vec3_scale(basis.front, -1);

    // only do things if control is locked
    if (this.controlsEnabled) {
      const forwarddir = vec3_norm(vec3_cross(basis.right, e.worldup));
      let movscale = this.fast ? 0.1 : 0.02;
      if (this.fly) {
        // fly
        if (this.keys.has('KeyW')) {
          this.physics.go(vec3_scale(forwarddir, movscale));
        }
        if (this.keys.has('KeyS')) {
          this.physics.go(vec3_scale(forwarddir, -movscale));
        }
        if (this.keys.has('KeyA')) {
          this.physics.go(vec3_scale(basis.right, movscale));
        }
        if (this.keys.has('KeyD')) {
          this.physics.go(vec3_scale(basis.right, -movscale));
        }
        if (this.keys.has('ShiftLeft')) {
          this.physics.go(vec3_scale(e.worldup, -movscale));
        }
        if (this.keys.has('Space')) {
          this.physics.go(vec3_scale(e.worldup, movscale));
        }
      } else {
        // walk
        if (this.keys.has('KeyW')) {
          this.physics.go(vec3_scale(forwarddir, movscale));
        }
        if (this.keys.has('KeyS')) {
          this.physics.go(vec3_scale(forwarddir, -movscale));
        }
        if (this.keys.has('KeyA')) {
          this.physics.go(vec3_scale(basis.right, movscale));
        }
        if (this.keys.has('KeyD')) {
          this.physics.go(vec3_scale(basis.right, -movscale));
        }
        if (this.keys.has('Space')) {
          this.physics.jump()
        }
      }

      // break/place block
      if (this.leftMouseDown) {
        this.blockInteraction.breakSelectedBlock();
      } else if(this.rightMouseDown) {
        this.blockInteraction.placeSelectedBlock();
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

// TODO: this component should be implementing collision code
export class PhysicsComponent extends Component {
  private world: World;

  private upVel = 0;

  private wantGo: vec3 = [0, 0, 0];
  private wantJump = false;

  constructor(world: World) {
    super();
    this.world = world;
  }

  go = (disp: vec3) => {
    this.wantGo = vec3_add(this.wantGo, disp);
  }

  jump = () => {
    this.wantJump = true;
  }

  // TODO: Apply collision detection here.
  // get world status and set entity location to something
  // also do jumping using up velocity
  applySystem = (e: Entity) => {
    // TODO: this system only lets you fly
    e.pos = vec3_add(e.pos, this.wantGo);
    this.wantGo = [0, 0, 0];
  };
}

// this component manages selecting and breaking blocks
export class BlockInteractionComponent extends Component {
  readonly uniqueId: string;
  private camera: Camera;
  private world: World;

  private ray: Highlight | null = null;

  private lastBlockTime = 0;

  constructor(camera: Camera, world: World,) {
    super();
    this.uniqueId = generateId(32);
    this.camera = camera;
    this.world = world;
  }

  // tell the world to break any block we have selected
  breakSelectedBlock = () => {
    const now = Date.now();
    // figure out where camera is pointing
    if (this.ray) {
      // check that we arent breaking too many blocks at once
      if (this.lastBlockTime + 50 < now ) {
        this.world.setBlock(this.ray.coords, 0);
        this.lastBlockTime = now;
      }
    }
  }

  // tell the world to break any block we have selected
  placeSelectedBlock = () => {
    const now = Date.now();
    // figure out where camera is pointing
    if (this.ray) {
      // check that we arent breaking too many blocks at once
      if (this.lastBlockTime + 50 < now ) {
        const newBlockCoord= vec3_add(this.ray.coords, getNormal(this.ray.face));
        this.world.setBlock(newBlockCoord, 4);
        this.lastBlockTime = now;
      }
    }
  }

  // figure out where camera is looking and break block
  applySystem = (e: Entity) => {
    this.ray = this.world.castRay(this.camera.getPos(), this.camera.getDir(), 100);
    if (this.ray) {
      this.world.addHighlight(this.uniqueId, this.ray);
    } else {
      this.world.removeHighlight(this.uniqueId);
    }
  }
}

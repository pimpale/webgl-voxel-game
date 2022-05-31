import { RADIANS, vec3, vec3_cross, vec3_add, vec3_scale, vec3_norm, clamp, vec3_sub } from './utils';
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
      if (e.key === "m") {
        if (this.fly) {
          this.fly = false;
          this.physics.enablePhysics();
        } else {
          this.fly = true;
          this.physics.disablePhysics();
        }
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
      let movscale = this.fast ? 0.1 : 0.04;
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
          this.physics.jump();
        }
      }

      if (this.keys.has('Digit1')) {
        this.blockInteraction.placeID = 1;
      }
      if (this.keys.has('Digit2')) {
        this.blockInteraction.placeID = 2;
      }
      if (this.keys.has('Digit3')) {
        this.blockInteraction.placeID = 3;
      }
      if (this.keys.has('Digit4')) {
        this.blockInteraction.placeID = 4;
      }
      if (this.keys.has('Digit5')) {
        this.blockInteraction.placeID = 5;
      }


      // break/place block
      if (this.leftMouseDown) {
        this.blockInteraction.breakSelectedBlock();
      } else if (this.rightMouseDown) {
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

type BoundingBox = {
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  minZ: number,
  maxZ: number,
}

function intersects(a: BoundingBox, b: BoundingBox) {
  return (a.minX <= b.maxX && a.maxX >= b.minX) &&
    (a.minY <= b.maxY && a.maxY >= b.minY) &&
    (a.minZ <= b.maxZ && a.maxZ >= b.minZ);
}

// TODO: this component should be implementing collision code
export class PhysicsComponent extends Component {
  private world: World;

  private upVel = 0;

  private wantGo: vec3 = [0, 0, 0];
  private wantJump = false;

  private readonly x_rad = 0.3;
  private readonly z_rad = 0.3;
  private readonly p_y_rad = 1.5;
  private readonly n_y_rad = 0.3;

  private readonly side_depth = 0.1;
  private readonly head_depth = 0.1;
  private readonly foot_depth = 0.6;

  private physicsEnabled = false;

  constructor(world: World) {
    super();
    this.world = world;
  }

  // physics
  enablePhysics = () => this.physicsEnabled = true;
  disablePhysics = () => {
      this.physicsEnabled = false;
      this.upVel = 0;
  }
  getPhysicsEnabled = () => this.physicsEnabled;


  go = (disp: vec3) => {
    this.wantGo = vec3_add(this.wantGo, disp);
  }

  jump = () => {
    this.wantJump = true;
  }

  // this function calculates where the player should go
  private calculatePlayerIntersection = (desiredLoc: vec3) => {
    // calculate 6 player bounding boxes
    let bbLeft: BoundingBox = {
      minX: desiredLoc[0] - this.x_rad,
      maxX: desiredLoc[0] - this.x_rad + this.side_depth,
      minY: desiredLoc[1] - this.n_y_rad + this.head_depth,
      maxY: desiredLoc[1] + this.p_y_rad - this.foot_depth ,
      minZ: desiredLoc[2] - this.z_rad,
      maxZ: desiredLoc[2] + this.z_rad,
    };
    let bbRight: BoundingBox = {
      minX: desiredLoc[0] + this.x_rad - this.side_depth,
      maxX: desiredLoc[0] + this.x_rad,
      minY: desiredLoc[1] - this.n_y_rad + this.head_depth,
      maxY: desiredLoc[1] + this.p_y_rad - this.foot_depth ,
      minZ: desiredLoc[2] - this.z_rad,
      maxZ: desiredLoc[2] + this.z_rad,
    };
    let bbBack: BoundingBox = {
      minX: desiredLoc[0] - this.x_rad,
      maxX: desiredLoc[0] + this.x_rad,
      minY: desiredLoc[1] - this.n_y_rad + this.head_depth,
      maxY: desiredLoc[1] + this.p_y_rad - this.foot_depth ,
      minZ: desiredLoc[2] - this.z_rad,
      maxZ: desiredLoc[2] - this.z_rad + this.side_depth,
    };
    let bbFront: BoundingBox = {
      minX: desiredLoc[0] - this.x_rad,
      maxX: desiredLoc[0] + this.x_rad,
      minY: desiredLoc[1] - this.n_y_rad + this.head_depth,
      maxY: desiredLoc[1] + this.p_y_rad - this.foot_depth ,
      minZ: desiredLoc[2] + this.z_rad - this.side_depth,
      maxZ: desiredLoc[2] + this.z_rad,
    };
    let bbUp: BoundingBox = {
      minX: desiredLoc[0] - this.x_rad,
      maxX: desiredLoc[0] + this.x_rad,
      minY: desiredLoc[1] - this.n_y_rad,
      maxY: desiredLoc[1] - this.n_y_rad + this.head_depth,
      minZ: desiredLoc[2] - this.z_rad,
      maxZ: desiredLoc[2] + this.z_rad,
    };
    let bbDown: BoundingBox = {
      minX: desiredLoc[0] - this.x_rad,
      maxX: desiredLoc[0] + this.x_rad,
      minY: desiredLoc[1] + this.p_y_rad - this.foot_depth,
      maxY: desiredLoc[1] + this.p_y_rad,
      minZ: desiredLoc[2] - this.z_rad,
      maxZ: desiredLoc[2] + this.z_rad,
    };

    let intersectLeft = false;
    let intersectRight = false;
    let intersectUp = false;
    let intersectDown = false;
    let intersectBack = false;
    let intersectFront = false;

    for (let x = -2; x <= 2; x++) {
      for (let y = -2; y <= 2; y++) {
        for (let z = -2; z <= 2; z++) {
          const pos = vec3_add(desiredLoc, [x, y, z]).map(x => Math.floor(x)) as vec3;
          const block = this.world.getBlock(pos);
          if (block != null && this.world.blockManager.defs[block].pointable) {
            // create bounding box of block
            let bbBlock: BoundingBox = {
              minX: pos[0],
              maxX: pos[0] + 1,
              minY: pos[1],
              maxY: pos[1] + 1,
              minZ: pos[2],
              maxZ: pos[2] + 1,
            };
            if (!intersectLeft && intersects(bbLeft, bbBlock)) {
              intersectLeft = true;
            }
            if (!intersectRight && intersects(bbRight, bbBlock)) {
              intersectRight = true;
            }
            if (!intersectUp && intersects(bbUp, bbBlock)) {
              intersectUp = true;
            }
            if (!intersectDown && intersects(bbDown, bbBlock)) {
              intersectDown = true;
            }
            if (!intersectBack && intersects(bbBack, bbBlock)) {
              intersectBack = true;
            }
            if (!intersectFront && intersects(bbFront, bbBlock)) {
              intersectFront = true;
            }
          }
        }
      }
    }

    return {
      left: intersectLeft,
      right: intersectRight,
      up: intersectUp,
      down: intersectDown,
      back: intersectBack,
      front: intersectFront,
    };
  }


  applySystem = (e: Entity) => {
    // fly mode
    if (!this.physicsEnabled) {
      e.pos = vec3_add(e.pos, this.wantGo);
      this.wantGo = [0, 0, 0];
      return;
    }

    // decrement up velocity due to gravity (while making sure it remains within reasonable limits)
    this.upVel -= 0.001;
    this.upVel = clamp(this.upVel, -0.1, 0.1);

    // find where we want to go, taking into account our upward velocity
    this.wantGo = vec3_add(this.wantGo, vec3_scale(e.worldup, this.upVel));
    let desiredLoc = vec3_add(e.pos, this.wantGo);

    const intersection = this.calculatePlayerIntersection(desiredLoc);

    // if we want to jump, and the player has their feet in the ground
    if (this.wantJump && intersection.down) {
      this.upVel = 0.05;
    }
    this.wantJump = false;

    // now adjust wantGo to avoid intersections
    if(intersection.left) {
        this.wantGo[0] = Math.max(this.wantGo[0], 0);
    }
    if(intersection.right) {
        this.wantGo[0] = Math.min(this.wantGo[0], 0);
    }
    if(intersection.up) {
        this.wantGo[1] = Math.max(this.wantGo[1], 0);
        // cancel out upwards velocity
        this.upVel = Math.min(this.upVel, 0);
    }
    if(intersection.down) {
        this.wantGo[1] = Math.min(this.wantGo[1], 0);
        // cancel out downwards velocity
        this.upVel = Math.max(this.upVel, 0);
    }
    if(intersection.back) {
        this.wantGo[2] = Math.max(this.wantGo[2], 0);
    }
    if(intersection.front) {
        this.wantGo[2] = Math.min(this.wantGo[2], 0);
    }

    // set player location
    e.pos = vec3_add(e.pos, this.wantGo);

    this.wantGo = [0, 0, 0];
  };
}

// this component manages selecting and breaking blocks
export class BlockInteractionComponent extends Component {
  readonly uniqueId: string;
  private camera: Camera;
  private world: World;

  placeID = 2;

  private ray: Highlight | null = null;

  private breakRequests = new Map<string, number>();
  private placeRequests = new Map<string, number>();

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
      const dest = JSON.stringify(this.ray.coords);
      const n = this.breakRequests.get(dest);
      this.breakRequests.set(dest, n === undefined ? 0 : n + 1);
    }
  }

  // tell the world to break any block we have selected
  placeSelectedBlock = () => {
    const now = Date.now();
    // figure out where camera is pointing
    if (this.ray) {
      const dest = JSON.stringify(vec3_add(this.ray.coords, getNormal(this.ray.face)));
      const n = this.placeRequests.get(dest);
      this.placeRequests.set(dest, n === undefined ? 0 : n + 1);
    }
  }

  // figure out where camera is looking and break block
  applySystem = (e: Entity) => {
    for (const [loc, count] of this.breakRequests) {
      if (count > 30) {
        this.world.setBlock(JSON.parse(loc), 0);
        this.breakRequests.delete(loc);
      }
    }
    for (const [loc, count] of this.placeRequests) {
      if (count > 20) {
        this.world.setBlock(JSON.parse(loc), this.placeID);
        this.placeRequests.delete(loc);
      }
    }
    // update ray
    this.ray = this.world.castRay(this.camera.getPos(), this.camera.getDir(), 100);
    if (this.ray) {
      this.world.addHighlight(this.uniqueId, this.ray);
    } else {
      this.world.removeHighlight(this.uniqueId);
    }
  }
}

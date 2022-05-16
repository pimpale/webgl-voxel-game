import { RADIANS, vec3_norm, vec3_mul_cross, vec3, perspective_projection_matrix } from './utils';


const worldup: vec3 = [0.0, 1.0, 0.0];

export type CameraBasis = {
  front: vec3;
  right: vec3;
  up: vec3;
}

function makeCameraBasis(pitch: number, yaw: number) {

  // calculate front vector from yaw and pitch
  // note that front actually points in the opposite direction as the camera
  // view
  const front: vec3 = vec3_norm([
    Math.cos(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    Math.sin(yaw) * Math.cos(pitch),
  ]);

  // calculate others from via gram schmidt process
  const right = vec3_norm(vec3_mul_cross(front, worldup));
  const up = vec3_norm(vec3_mul_cross(right, front));

  return { front, right, up };
}

function calculate_projection_matrix(xsize: number, ysize: number) {
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

  private fast: boolean;

  constructor(loc: vec3, canvas: HTMLCanvasElement) {
    this.pos = loc;
    this.canvas = canvas;
    this.pitch = 0.0;
    this.yaw = RADIANS(-90.0);
    this.basis = makeCameraBasis(this.pitch, this.yaw);
    this.fast = false;

    this.canvas.addEventListener("onkeydown", this.handleKeyDown);
    this.canvas.addEventListener("onkeyup", this.handleKeyUp);
  }

  handleKeyDown = (e:Event) => {
      this.
  }

  update = () => {
    let movscale = 0.02;
    if (this.fast) {
      movscale *= 2;
    }
  }

  getMvp = () => {
    const fov = RADIANS(90.0);
    const aspect_ratio = this.canvas.width / this.canvas.height;
    const projection = perspective_projection_matrix(fov, aspect_ratio, 0.01, 1000.0);

  }
};


void updateCamera(Camera * camera, GLFWwindow * pWindow) {

  if (glfwGetKey(pWindow, GLFW_KEY_TAB) == GLFW_PRESS) {
    camera -> fast = !camera -> fast;
  }

  float movscale = 0.02f;
  if (camera -> fast) {
    movscale *= 10;
  }

  if (glfwGetKey(pWindow, GLFW_KEY_W) == GLFW_PRESS) {
    vec3 delta_pos;
    vec3_mul_cross(delta_pos, camera -> basis.right, worldup);
    vec_norm(delta_pos, delta_pos);
    vec3_scale(delta_pos, delta_pos, movscale);
    vec3_add(camera -> pos, camera -> pos, delta_pos);
  }
  if (glfwGetKey(pWindow, GLFW_KEY_S) == GLFW_PRESS) {
    vec3 delta_pos;
    vec3_mul_cross(delta_pos, camera -> basis.right, worldup);
    vec_norm(delta_pos, delta_pos);
    vec3_scale(delta_pos, delta_pos, -movscale);
    vec3_add(camera -> pos, camera -> pos, delta_pos);
  }
  if (glfwGetKey(pWindow, GLFW_KEY_A) == GLFW_PRESS) {
    vec3 delta_pos;
    vec3_scale(delta_pos, camera -> basis.right, movscale);
    vec3_add(camera -> pos, camera -> pos, delta_pos);
  }
  if (glfwGetKey(pWindow, GLFW_KEY_D) == GLFW_PRESS) {
    vec3 delta_pos;
    vec3_scale(delta_pos, camera -> basis.right, -movscale);
    vec3_add(camera -> pos, camera -> pos, delta_pos);
  }
  if (glfwGetKey(pWindow, GLFW_KEY_LEFT_SHIFT) == GLFW_PRESS || glfwGetKey(pWindow, GLFW_KEY_RIGHT_SHIFT) == GLFW_PRESS) {
    vec3 delta_pos;
    vec3_scale(delta_pos, worldup, movscale);
    vec3_add(camera -> pos, camera -> pos, delta_pos);
  }
  if (glfwGetKey(pWindow, GLFW_KEY_SPACE) == GLFW_PRESS) {
    vec3 delta_pos;
    vec3_scale(delta_pos, worldup, -movscale);
    vec3_add(camera -> pos, camera -> pos, delta_pos);
  }

  double x;
  double y;
  glfwGetCursorPos(pWindow, & x, & y);

  double dX = x - camera -> pX;
  double dY = y - camera -> pY;

  camera -> pX = x;
  camera -> pY = y;

  float rotscale = 0.01f;

  camera -> yaw += (float)dX * rotscale;
  camera -> pitch -= (float)dY * rotscale;

  // clamp camera->pitch between 89 degrees
  camera -> pitch = fminf(camera -> pitch, RADIANS(89.9f));
  camera -> pitch = fmaxf(camera -> pitch, RADIANS(-89.9f));

  // rebuild basis vectors
  camera -> basis = new_CameraBasis(camera -> pitch, camera -> yaw);
}


export type vec3 = [x: number, y: number, z: number];
export type vec4 = [x: number, y: number, z: number, w: number];

export function RADIANS(x: number) {
  return Math.PI * x / 180;
}

export function vec3_length(a:vec3): number {
  let sum = 0;
  for (const i of a) {
    sum += i * i;
  }
  return Math.sqrt(sum);
}

// normalizes a vector in place
export function vec3_norm(a: vec3): vec3 {
  const dist = vec3_length(a);
  return a.map(x => x / dist) as vec3;
}

export function vec3_dup([a1, a2, a3]: vec3): vec3{
    return [a1, a2, a3]
}

export function vec3_dot([a1, a2, a3]: vec3, [b1, b2, b3]: vec3): number {
  return a1 * b1 + a2 * b2 + a3 * b3;
}

export function vec3_cross([a1, a2, a3]: vec3, [b1, b2, b3]: vec3): vec3 {
  return [a2 * b3 - a3 * b2, a3 * b1 - a1 * b3, a1 * b2 - a2 * b1]
}

export function vec3_scale(v: vec3, a: number): vec3 {
  return [v[0] * a, v[1] * a, v[2] * a];
}

export function vec3_add(a: vec3, b: vec3): vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function vec3_sub(a: vec3, b: vec3): vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export type mat4 = [vec4, vec4, vec4, vec4];

export function mat4_transpose(m: mat4): mat4 {
  const [m0, m1, m2, m3] = m;
  return [
    [m0[0], m1[0], m2[0], m3[0]],
    [m0[1], m1[1], m2[1], m3[1]],
    [m0[2], m1[2], m2[2], m3[2]],
    [m0[3], m1[3], m2[3], m3[3]],
  ];
}

export function mat4_perspective(fov_y: number, aspect: number, near: number, far: number): mat4 {
  // perspective(): Frustum-shaped view volume for projection.
  const f = 1 / Math.tan(fov_y / 2), d = far - near;
  return [
    [f / aspect, 0, 0, 0],
    [0, f, 0, 0],
    [0, 0, -(near + far) / d, -2 * near * far / d],
    [0, 0, -1, 0]
  ];
}

export function mat4_look_at(eye: vec3, at: vec3, up: vec3) {
  // look_at():  Produce a traditional graphics camera "lookat" matrix.
  // Each input must be a 3x1 Vector.
  // Note:  look_at() assumes the result will be used for a camera and stores its
  // result in inverse space.
  // If you want to use look_at to point a non-camera towards something, you can
  // do so, but to generate the correct basis you must re-invert its result.

  // Compute vectors along the requested coordinate axes. "y" is the "updated" and orthogonalized local y axis.
  let z = vec3_norm(vec3_sub(at, eye));
  const x = vec3_norm(vec3_cross(z, up))
  const y = vec3_norm(vec3_cross(x, z));

  // Check for NaN, indicating a degenerate cross product, which
  // happens if eye == at, or if at minus eye is parallel to up.
  if (!x.every(i => i == i))
    throw "two parallel vectors were given";

  // Enforce right-handed coordinate system.
  z = vec3_scale(z, -1);

  const translation = mat4_translation(-vec3_dot(x, eye), -vec3_dot(y, eye), -vec3_dot(z, eye));

  const rotation: mat4 = [
    [x[0], x[1], x[2], 0],
    [y[0], y[1], y[2], 0],
    [z[0], z[1], z[2], 0],
    [0, 0, 0, 1],
  ];

  return mat4_mul(translation, rotation)
}

export function mat4_translation(x: number, y: number, z: number): mat4 {
  return [
    [1, 0, 0, x],
    [0, 1, 0, y],
    [0, 0, 1, z],
    [0, 0, 0, 1]
  ];
}

export function vec4_dot(a: vec4, b: vec4) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

export function mat4_mul(a: mat4, b: mat4): mat4 {
  const [a0, a1, a2, a3] = a;
  const [c0, c1, c2, c3] = mat4_transpose(b);

  return [
    [vec4_dot(a0, c0), vec4_dot(a0, c1), vec4_dot(a0, c2), vec4_dot(a0, c3)],
    [vec4_dot(a1, c0), vec4_dot(a1, c1), vec4_dot(a1, c2), vec4_dot(a1, c3)],
    [vec4_dot(a2, c0), vec4_dot(a2, c1), vec4_dot(a2, c2), vec4_dot(a2, c3)],
    [vec4_dot(a3, c0), vec4_dot(a3, c1), vec4_dot(a3, c2), vec4_dot(a3, c3)],
  ];
}

export function mat4_to_uniform(m: mat4) {
  const [c0, c1, c2, c3] = mat4_transpose(m);
  return [...c0, ...c1, ...c2, ...c3];
}

export function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max);
}

export function assert(cond: boolean, error: string) {
  if (!cond) {
    throw new Error(error)
  }
}

export function mod(n: number, d: number) {
  const ret = n % d;
  if (ret < 0) {
    return ret + d;
  } else {
    return ret;
  }
}

// takes in color as a hexadecimal number, returns a vec3 of color components
export function convertColor(color: number) {
  return [
    (color >> 16) / 0xFF,
    ((color >> 8) & 0xFF) / 0xFF,
    (color & 0xFF) / 0xFF,
  ] as vec3;
}




export type vec3 = [x: number, y: number, z: number];
export type vec4 = [x: number, y: number, z: number, w: number];

export function RADIANS(x: number) {
  return Math.PI * x / 180;
}

// normalizes a vector in place
export function vec3_norm(a: vec3): vec3 {
  let sum = 0;
  for (const i of a) {
    sum += i * i;
  }
  const dist = Math.sqrt(sum);

  return a.map(x => x / dist) as vec3;
}

export function vec3_mul_cross([a1, a2, a3]: vec3, [b1, b2, b3]: vec3): vec3 {
  return [a2 * b3 - a3 * b2, a3 * b1 - a1 * b3, a1 * b2 - a2 * b1]
}

export function vec3_scale(v: vec3, a: number): vec3 {
  return [v[0] * a, v[1] * a, v[2] * a];
}

export function vec3_add(a: vec3, b: vec3): vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
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

export function mat4_perspective(fov: number, aspect_ratio: number, near: number, far: number): mat4 {
  const s = 1 / Math.tan(fov / 2);
  return [
    [s / aspect_ratio, 0, 0, 0],
    [0, s, 0, 0],
    [0, 0, (far + near) / (near - far), (2 * far * near) / (near - far)],
    [0, 0, -1, 1],
  ];
}

export function vec4_dot(a: vec4, b: vec4) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

export function mat4_mul(a: mat4, b: mat4):mat4 {
  const [a0, a1, a2, a3] = a;
  const [c0, c1, c2, c3] = mat4_transpose(b);
  return [
    [vec4_dot(a0, c0), vec4_dot(a0, c1), vec4_dot(a0, c2), vec4_dot(a0, c3)],
    [vec4_dot(a1, c0), vec4_dot(a1, c1), vec4_dot(a1, c2), vec4_dot(a1, c3)],
    [vec4_dot(a2, c0), vec4_dot(a2, c1), vec4_dot(a2, c2), vec4_dot(a2, c3)],
    [vec4_dot(a3, c0), vec4_dot(a3, c1), vec4_dot(a3, c2), vec4_dot(a3, c3)],
  ];
}

export function mat4_to_uniform(m:mat4) {
  const [c0, c1, c2, c3] = mat4_transpose(m);
  return [...c0, ...c1, ...c2, ...c3];
}

export type vec2 = [x:number, y:number];

export function clamp(v:number, min:number, max:number) {
    return Math.min(Math.max(v, min), max);
}

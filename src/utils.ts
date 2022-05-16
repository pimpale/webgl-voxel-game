export type vec3 = [x: number, y: number, z: number];
export type vec4 = [x: number, y: number, z: number, w: number];

export function RADIANS(x: number) {
  return 180 * x / Math.PI
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
  return [a[0] + b[0], a[1] * b[1], a[2] * b[2]];
}



export type mat4 = [vec4, vec4, vec4, vec4];

export function mat4_perspective(fov: number, aspect_ratio: number, near: number, far: number): mat4 {
  const s = 1 / Math.tan(fov / 2);
  return [
    [s / aspect_ratio, 0, 0, 0],
    [0, s, 0, 0],
    [0, 0, (far + near) / (near - far), (2 * far * near) / (near - far)],
    [0, 0, -1, 0],
  ];
}

export function mat4_look_at(eye:vec3, center:vec3, up:vec3) {
}

export function vec4_dot(a:vec4, b:vec4) {
    return a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3];
}

// transforms vec4 with the given matrix
export function vec4_transform(v:vec4, m:mat4) {
  return [
      vec4_dot(v, m[0]),
      vec4_dot(v, m[1]),
      vec4_dot(v, m[2]),
      vec4_dot(v, m[3]),
  ];
}

export function mat4_mul(a:mat4, b:mat4) {
  return
}


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

export type mat4 = [vec4, vec4, vec4, vec4];

export function perspective_projection_matrix(fov: number, aspect_ratio: number, near: number, far: number): mat4 {
  const s = 1 / Math.tan(fov / 2);
  return [
    [s / aspect_ratio, 0, 0, 0],
    [0, s, 0, 0],
    [0, 0, (far + near) / (near - far), (2 * far * near) / (near - far)],
    [0, 0, -1, 0],
  ];
}

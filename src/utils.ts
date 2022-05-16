export type vec3 = [x: number, y: number, z: number];

export function RADIANS(x: number) {
  return 180 * x / Math.PI
}

// normalizes a vector
export function vec_norm<T extends number[]>(a: T): T {
  let sum = 0;
  for (const i of a) {
    sum += i * i;
  }
  const dist = Math.sqrt(sum);

  for (let i = 0; i < a.length; i++) {
    a[i] = a[i] / dist;
  }
}

export function vec3_mul_cross([a1, a2, a3]: vec3, [b1, b2, b3]: vec3): vec3 {
  return [a2 * b3 - a3 * b2, a3 * b1 - a1 * b3, a1 * b2 - a2 * b1]
}



// code from https://webgl2fundamentals.org/webgl/lessons/webgl-fundamentals.html


export function createShader(gl: WebGL2RenderingContext, shader_type: number, source: string) {
  const shader = gl.createShader(shader_type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

export function createProgram(gl: WebGL2RenderingContext, shaders: WebGLShader[]) {
  const program = gl.createProgram()!;
  for (const shader of shaders) {
    gl.attachShader(program, shader);
  }

  gl.linkProgram(program);
  const linkSuccess = gl.getProgramParameter(program, gl.LINK_STATUS);
  if (!linkSuccess) {
    let errorMessage = "";
    for (const shader of shaders) {
      const shaderSuccess = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
      if (!shaderSuccess) {
        console.log(gl.getShaderInfoLog(shader));
      }
      gl.deleteShader(shader);
    }
    console.log(gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  } else {
    return program;
  }
}


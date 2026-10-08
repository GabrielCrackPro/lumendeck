
export function shaderCanvasSize(
  screenW: number,
  screenH: number,
): { width: number; height: number } {
  const CAP = 3840;
  const w = Math.max(64, Math.floor(screenW));
  const h = Math.max(36, Math.floor(screenH));
  if (w <= CAP) return { width: w, height: h };
  const scale = CAP / w;
  return { width: CAP, height: Math.max(36, Math.floor(h * scale)) };
}

export const SHADER_SOURCES: Record<string, string> = {
  aurora: `#version 300 es
precision highp float;
uniform vec2 uRes; uniform float uTime;
out vec4 outColor;
// Smooth flowing aurora bands.
float band(vec2 uv, float offset, float freq, float speed) {
  float y = uv.y + 0.25 * sin(uv.x * freq + uTime * speed + offset);
  return exp(-28.0 * abs(uv.y - y));
}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 col = vec3(0.01, 0.02, 0.05);
  col += vec3(0.0, 0.9, 0.45) * band(uv, 0.0, 4.0, 0.7) * 0.9;
  col += vec3(0.25, 0.2, 0.95) * band(uv, 2.1, 3.0, 0.45) * 0.8;
  col += vec3(0.9, 0.25, 0.75) * band(uv, 4.4, 5.0, 0.3) * 0.5;
  float vign = smoothstep(1.2, 0.3, length(uv - 0.5));
  outColor = vec4(col * vign, 1.0);
}`,

  liquid: `#version 300 es
precision highp float;
uniform vec2 uRes; uniform float uTime;
out vec4 outColor;
// FBM-ish flowing liquid gradient.
vec3 pal(float t) {
  return 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + t));
}
void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - uRes) / min(uRes.x, uRes.y);
  float t = uTime * 0.15;
  vec2 p = uv;
  for (float i = 1.0; i < 5.0; i++) {
    p.x += 0.35 / i * sin(i * 2.4 * p.y + t * 2.0) ;
    p.y += 0.35 / i * cos(i * 2.0 * p.x + t * 1.6);
  }
  float v = 0.5 + 0.5 * sin(uv.x * 2.0 + p.x);
  outColor = vec4(pal(v + t * 0.2) * 0.85, 1.0);
}`,

  plasma: `#version 300 es
precision highp float;
uniform vec2 uRes; uniform float uTime;
out vec4 outColor;
// Classic plasma.
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = uv * 6.0;
  float v = sin(p.x + uTime)
          + sin((p.y + uTime) * 1.3)
          + sin((p.x + p.y + uTime) * 0.7)
          + sin(length(p - vec2(3.0 + 2.0 * sin(uTime * 0.3), 3.0 + 2.0 * cos(uTime * 0.2))) * 1.2);
  vec3 col = vec3(sin(v), sin(v + 2.1), sin(v + 4.2)) * 0.5 + 0.5;
  outColor = vec4(col * 0.9, 1.0);
}`,

  starfield: `#version 300 es
precision highp float;
uniform vec2 uRes; uniform float uTime;
out vec4 outColor;
// Drifting starfield with parallax layers.
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float starLayer(vec2 uv, float density, float speed) {
  vec2 g = floor(uv * density);
  vec2 f = fract(uv * density);
  float h = hash(g);
  if (h < 0.92) return 0.0;
  vec2 c = vec2(hash(g + 1.3), hash(g + 2.7));
  float d = length(f - c);
  float tw = 0.6 + 0.4 * sin(uTime * (1.0 + h * 3.0) + h * 40.0);
  return smoothstep(0.08, 0.0, d) * tw;
}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 col = vec3(0.015, 0.02, 0.045);
  float t = uTime;
  col += vec3(0.8) * starLayer(uv + vec2(t * 0.01, 0.0), 24.0, 1.0);
  col += vec3(0.9, 0.95, 1.0) * starLayer(uv + vec2(t * 0.03, t * 0.006), 40.0, 1.0);
  col += vec3(1.0, 0.85, 0.7) * starLayer(uv + vec2(t * 0.06, 0.0), 70.0, 1.0);
  outColor = vec4(col, 1.0);
}`,
};

export function compileShaderProgram(gl: WebGL2RenderingContext, src: string): WebGLProgram | null {
  const vs = gl.createShader(gl.VERTEX_SHADER);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  if (!vs || !fs) return null;
  gl.shaderSource(vs, `#version 300 es
precision highp float;
const vec2 verts[3] = vec2[3](vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
void main(){ gl_Position = vec4(verts[gl_VertexID], 0.0, 1.0); }`);
  gl.shaderSource(fs, src);
  gl.compileShader(vs);
  gl.compileShader(fs);
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error("shader link failed:", gl.getProgramInfoLog(prog));
    return null;
  }
  return prog;
}

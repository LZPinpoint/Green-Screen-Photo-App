import type { KeyParams } from '../../shared/types'
import { matteThresholds } from './chromaKey'

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

// Same maths as chromaKey.ts (without the CPU-only island/hole cleanup).
const FRAG = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform sampler2D u_bg;
uniform float u_hasBg;
uniform vec2 u_keyCbCr;
uniform vec2 u_t;       // t0, t1 (distance / 255 units)
uniform float u_spill;  // 0..1 already scaled (min(1, spill*2))
uniform float u_shrink; // extra t0 offset to approximate erosion
uniform vec4 u_stage;   // left, right, top, bottom margins to discard (0..1 of frame)

vec2 cbcr(vec3 c) {
  vec3 p = c * 255.0;
  return vec2(
    128.0 - 0.168736 * p.r - 0.331264 * p.g + 0.5 * p.b,
    128.0 + 0.5 * p.r - 0.418688 * p.g - 0.081312 * p.b);
}

void main() {
  vec2 uv = vec2(v_uv.x, v_uv.y);
  vec4 s = texture2D(u_tex, uv);
  float d = length(cbcr(s.rgb) - u_keyCbCr) / 255.0;
  float a = smoothstep(u_t.x + u_shrink, u_t.y + u_shrink, d);
  // texture is uploaded Y-flipped: uv.y = 1 is the TOP of the picture
  a *= step(u_stage.x, uv.x) * step(uv.x, 1.0 - u_stage.y) * step(uv.y, 1.0 - u_stage.z) * step(u_stage.w, uv.y);
  vec3 c = s.rgb;
  float lim = max(c.r, c.b);
  if (c.g > lim) c.g -= (c.g - lim) * u_spill;
  vec3 outRgb = c * a; // premultiplied
  float outA = a;
  if (u_hasBg > 0.5) {
    vec3 bg = texture2D(u_bg, uv).rgb;
    outRgb = outRgb + bg * (1.0 - a);
    outA = 1.0;
  }
  gl_FragColor = vec4(outRgb, outA);
}`

export interface KeyPreview {
  start(): void
  stop(): void
  setBackground(img?: HTMLImageElement | HTMLCanvasElement | ImageBitmap): void
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(sh))
  return sh
}

/** Live GPU chroma-key preview. Output canvas is transparent (premultiplied) unless a background is set. */
export function createKeyPreview(
  canvas: HTMLCanvasElement,
  source: HTMLVideoElement | HTMLImageElement,
  getParams: () => KeyParams,
): KeyPreview {
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false }) as WebGLRenderingContext | null
  if (!gl) return { start() {}, stop() {}, setBackground() {} }

  const prog = gl.createProgram()!
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT))
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG))
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('program: ' + gl.getProgramInfoLog(prog))
  gl.useProgram(prog)

  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(prog, 'a_pos')
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

  const mkTex = () => {
    const t = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    return t
  }
  const texSrc = mkTex()
  const texBg = mkTex()
  const U = (n: string) => gl.getUniformLocation(prog, n)
  gl.uniform1i(U('u_tex'), 0)
  gl.uniform1i(U('u_bg'), 1)

  let bgImg: HTMLImageElement | HTMLCanvasElement | ImageBitmap | undefined
  let bgDirty = false
  let raf = 0
  let running = false

  const srcSize = (): [number, number] =>
    source instanceof HTMLVideoElement ? [source.videoWidth, source.videoHeight] : [source.naturalWidth, source.naturalHeight]

  const frame = () => {
    if (!running) return
    raf = requestAnimationFrame(frame)
    const [sw, sh] = srcSize()
    if (!sw || !sh) return
    if (source instanceof HTMLVideoElement && source.readyState < 2) return
    if (canvas.width !== sw || canvas.height !== sh) { canvas.width = sw; canvas.height = sh }
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texSrc)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    if (bgDirty) {
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, texBg)
      if (bgImg) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bgImg)
      bgDirty = false
    }
    const p = getParams()
    const kcb = 128 - 0.168736 * p.keyColor[0] - 0.331264 * p.keyColor[1] + 0.5 * p.keyColor[2]
    const kcr = 128 + 0.5 * p.keyColor[0] - 0.418688 * p.keyColor[1] - 0.081312 * p.keyColor[2]
    const { t0, t1 } = matteThresholds(p)
    gl.uniform2f(U('u_keyCbCr'), kcb, kcr)
    gl.uniform2f(U('u_t'), t0, t1)
    gl.uniform1f(U('u_spill'), Math.min(1, Math.max(0, p.spill) * 2))
    gl.uniform1f(U('u_shrink'), Math.max(0, p.edgeShrink) * 0.01)
    const st = p.stage
    gl.uniform4f(U('u_stage'), st ? Math.min(0.45, Math.max(0, st.left)) : 0, st ? Math.min(0.45, Math.max(0, st.right)) : 0, st ? Math.min(0.45, Math.max(0, st.top)) : 0, st ? Math.min(0.45, Math.max(0, st.bottom)) : 0)
    gl.uniform1f(U('u_hasBg'), bgImg ? 1 : 0)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  return {
    start() { if (running) return; running = true; raf = requestAnimationFrame(frame) },
    stop() { running = false; if (raf) cancelAnimationFrame(raf) },
    setBackground(img) { bgImg = img; bgDirty = true },
  }
}

// BGA pixel work on the GPU: EXBMP / SWBGA colour keys on video frames and the plane tint Canvas skins draw with. One
// WebGL2 context, shared by every video and image, draws each source through a small shader and the result is copied
// into the caller's 2D canvas — no `getImageData` readback per frame. A page holds only a handful of WebGL contexts
// before the browser starts dropping the oldest (which may be the renderer's own), so this never opens more than one.

import type { BmsARGB } from '@be-music/chart-model';

/** What to do to a source's pixels, matching `applyBMSColorKey` and the CPU tint they replace. */
export interface BGAPixelOperation {
  /** EXBMP key on a source without its own alpha: RGB within ±8, compared only when the key's alpha is 0. */
  bmsColorKey?: BmsARGB;
  /** SWBGA key: the source alpha must equal the key's, and RGB within ±8. */
  swBGAColorKey?: BmsARGB;
  /** 0xRRGGBB multiplied into each colour channel; alpha is kept. */
  tint?: number;
}

/** The shader's inputs for an operation: a key is `[r, g, b, a]` in 0–255 or `undefined` when it keys nothing. */
export interface BGAPixelUniforms {
  bmsKey: [number, number, number, number] | undefined;
  swKey: [number, number, number, number] | undefined;
  tint: [number, number, number];
}

function isValidKey(key: BmsARGB | undefined): key is BmsARGB {
  return (
    key !== undefined &&
    [key.a, key.r, key.g, key.b].every((value) => Number.isInteger(value) && value >= 0 && value <= 255) &&
    !(key.a === 0 && key.r === 0 && key.g === 0 && key.b === 0)
  );
}

/**
 * The uniforms for `operation`, with `applyBMSColorKey`'s rules folded in: an invalid or all-zero key keys nothing, and
 * an EXBMP key with a non-zero alpha keys nothing on a source without its own alpha.
 */
export function resolveBGAPixelUniforms(operation: BGAPixelOperation): BGAPixelUniforms {
  const bms = operation.bmsColorKey;
  const sw = operation.swBGAColorKey;
  const tint = operation.tint ?? 0xffffff;
  return {
    bmsKey: isValidKey(bms) && bms.a === 0 ? [bms.r, bms.g, bms.b, bms.a] : undefined,
    swKey: isValidKey(sw) ? [sw.r, sw.g, sw.b, sw.a] : undefined,
    tint: [((tint >>> 16) & 255) / 255, ((tint >>> 8) & 255) / 255, (tint & 255) / 255],
  };
}

const VERTEX_SHADER = `#version 300 es
in vec2 position;
out vec2 uv;
void main() {
  uv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D image;
uniform vec3 tint;
uniform bool bmsOn;
uniform vec4 bmsKey;
uniform bool swOn;
uniform vec4 swKey;
in vec2 uv;
out vec4 color;
bool near(vec3 rgb, vec3 key) {
  return all(lessThanEqual(abs(round(rgb * 255.0) - key), vec3(8.0)));
}
void main() {
  vec4 source = texture(image, uv);
  float alpha = source.a;
  if (bmsOn && near(source.rgb, bmsKey.rgb)) alpha = 0.0;
  if (swOn && round(source.a * 255.0) == swKey.a && near(source.rgb, swKey.rgb)) alpha = 0.0;
  color = vec4(alpha == 0.0 ? vec3(0.0) : source.rgb * tint, alpha);
}`;

interface Processor {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  uniforms: Record<'tint' | 'bmsOn' | 'bmsKey' | 'swOn' | 'swKey', WebGLUniformLocation | null>;
}

let processor: Processor | undefined;
/** Set once WebGL2 is missing or its context was lost: callers fall back to their CPU path for the session. */
let unavailable = false;

/** The shared context, or `undefined` where WebGL2 is missing or fails to set up (a driver can throw here). */
function createProcessor(): Processor | undefined {
  try {
    return setUpProcessor();
  } catch {
    return undefined;
  }
}

function setUpProcessor(): Processor | undefined {
  if (typeof document === 'undefined') return undefined;
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    antialias: false,
    depth: false,
    stencil: false,
  });
  if (!gl) return undefined;
  const compile = (type: number, source: string): WebGLShader | undefined => {
    const shader = gl.createShader(type);
    if (!shader) return undefined;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : undefined;
  };
  const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return undefined;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return undefined;
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  // One texel per output pixel, sampled exactly: nearest filtering and no edge wrap.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  // Straight (unpremultiplied) colour, as `getImageData` gave, with the image's top row at the top of the output.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.uniform1i(gl.getUniformLocation(program, 'image'), 0);
  canvas.addEventListener('webglcontextlost', () => {
    unavailable = true;
    processor = undefined;
  });
  const uniform = (name: string) => gl.getUniformLocation(program, name);
  return {
    canvas,
    gl,
    uniforms: {
      tint: uniform('tint'),
      bmsOn: uniform('bmsOn'),
      bmsKey: uniform('bmsKey'),
      swOn: uniform('swOn'),
      swKey: uniform('swKey'),
    },
  };
}

/**
 * Whether {@link drawBGAPixelsOnGPU} can run here, opening the shared context on first use. A 2D canvas that receives
 * its output should then skip `willReadFrequently`, which would keep it on the CPU.
 */
export function canDrawBGAPixelsOnGPU(): boolean {
  if (unavailable) return false;
  processor ??= createProcessor();
  if (!processor) unavailable = true;
  return processor !== undefined;
}

/**
 * Draws `source` (`width` × `height`) into `target` with `operation` applied, on the shared GPU context. Returns false,
 * leaving `target` alone, when WebGL2 is unavailable or the draw fails; the caller then does the work on the CPU.
 */
export function drawBGAPixelsOnGPU(
  source: TexImageSource,
  width: number,
  height: number,
  operation: BGAPixelOperation,
  target: CanvasRenderingContext2D,
): boolean {
  if (unavailable || width <= 0 || height <= 0) return false;
  processor ??= createProcessor();
  if (!processor) {
    unavailable = true;
    return false;
  }
  const { canvas, gl, uniforms } = processor;
  try {
    // The canvas only grows; each draw uses its bottom-left `width` × `height`, which is the top-left once flipped.
    if (canvas.width < width) canvas.width = width;
    if (canvas.height < height) canvas.height = height;
    gl.viewport(0, 0, width, height);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    const { bmsKey, swKey, tint } = resolveBGAPixelUniforms(operation);
    gl.uniform3f(uniforms.tint, tint[0], tint[1], tint[2]);
    gl.uniform1i(uniforms.bmsOn, bmsKey ? 1 : 0);
    gl.uniform4f(uniforms.bmsKey, ...(bmsKey ?? [0, 0, 0, 0]));
    gl.uniform1i(uniforms.swOn, swKey ? 1 : 0);
    gl.uniform4f(uniforms.swKey, ...(swKey ?? [0, 0, 0, 0]));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    target.clearRect(0, 0, width, height);
    target.drawImage(canvas, 0, canvas.height - height, width, height, 0, 0, width, height);
    return true;
  } catch {
    return false;
  }
}

/** Forgets the shared context, for tests. */
export function resetBGAPixelProcessorForTest(): void {
  processor = undefined;
  unavailable = false;
}

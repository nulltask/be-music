/**
 * An LRX chart's BGA drawn as plugout4 -ARCADE EDITION- draws it (`plugout4.exe` 0x4439be, 0x4442c0): the base and four
 * layers on a 1280×720 screen, each cropped, placed, tinted, blended and rotated as its note says and eased between
 * keyframes (`sampleLRXBGA`), or the POOR image alone for half a second after a miss. It feeds the BGA frame through
 * the same {@link BGAFeed} the camera uses, so every play scene shows it in place of the chart's BMS BGA planes.
 *
 * It draws with WebGL, as plugout draws with Direct3D 9: each image is a quad whose texels are multiplied by the note's
 * colour, blended into the screen by the same blend equation and factors plugout's driver sets for the note's `bld`
 * (`resolveLRXBGABlend`), which a 2D canvas cannot express.
 */

import { CanvasSource, Texture } from 'pixi.js';
import {
  LRX_BGA_HEIGHT,
  LRX_BGA_WIDTH,
  sampleLRXBGA,
  type LRXBGANode,
  type LRXBGAProgram,
  type LRXBGASprite,
} from '@be-music/chart-model';
import type { BGAFeed } from './bga-camera.ts';
import { fitBGACameraRect } from './bga-camera-fit.ts';
import { resolveLRXBGABlend, resolveLRXBGAPivot, resolveLRXBGAQuad } from './lrx-bga-draw.ts';

/** The side of the square picture a Canvas skin gets, the BMS BGA canvas. */
const SKIN_IMAGE_SIZE = 256;
/** plugout shows the POOR image for 500 ms after a miss (0x4439b7). */
export const LRX_POOR_SECONDS = 0.5;

type Drawable = TexImageSource;

const VERTEX_SHADER = `
attribute vec2 aPosition;
attribute vec2 aTexel;
varying vec2 vTexel;
void main() {
  vTexel = aTexel;
  gl_Position = vec4(aPosition.x / ${LRX_BGA_WIDTH}.0 * 2.0 - 1.0, 1.0 - aPosition.y / ${LRX_BGA_HEIGHT}.0 * 2.0, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D uImage;
uniform vec4 uColor;
varying vec2 vTexel;
void main() {
  gl_FragColor = texture2D(uImage, vTexel) * uColor;
}`;

/** The WebGL objects the compositor draws with. */
interface LRXBGAGL {
  readonly gl: WebGLRenderingContext;
  readonly buffer: WebGLBuffer;
  readonly color: WebGLUniformLocation;
  /** One texture per picture, a video's uploaded again each frame. */
  readonly textures: Map<Drawable, WebGLTexture>;
}

export interface LRXBGACompositorSources {
  /** The images by BMP key, black kept (the base plane's textures). */
  readonly textures: ReadonlyMap<string, Texture>;
  /** The layer planes' textures, black keyed out for LRX as for BMS; a layer falls back to {@link textures}. */
  readonly layerTextures: ReadonlyMap<string, Texture>;
  /** Video BGA elements by key. */
  readonly videos: ReadonlyMap<string, { readonly video: HTMLVideoElement }>;
}

export interface LRXBGACompositorClock {
  /** The chart second the play is at. */
  readonly seconds: () => number;
  /** Whether a miss happened within the last {@link LRX_POOR_SECONDS}, when plugout shows the POOR image alone. */
  readonly showsPoor: () => boolean;
}

export class LRXBGACompositor implements BGAFeed {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: LRXBGAGL | undefined;
  private readonly source: CanvasSource;
  private readonly plain: Texture;
  private skinCanvas: HTMLCanvasElement | undefined;
  /** The cue each slot's video started for, so a video seeks once when its note begins. */
  private readonly videoCues = new Map<number, string>();
  private drawnAt: number | undefined;
  private disposed = false;

  private readonly program: LRXBGAProgram;
  private readonly sources: LRXBGACompositorSources;
  private readonly clock: LRXBGACompositorClock;

  public constructor(program: LRXBGAProgram, sources: LRXBGACompositorSources, clock: LRXBGACompositorClock) {
    this.program = program;
    this.sources = sources;
    this.clock = clock;
    this.canvas = Object.assign(document.createElement('canvas'), { width: LRX_BGA_WIDTH, height: LRX_BGA_HEIGHT });
    this.gl = createLRXBGAGL(this.canvas);
    this.source = new CanvasSource({ resource: this.canvas });
    this.source.label = 'bga/lrx';
    this.plain = new Texture({ source: this.source, label: 'bga/lrx' });
  }

  public texture(): Texture | undefined {
    if (this.disposed) return undefined;
    this.draw();
    return this.plain;
  }

  public image(): HTMLCanvasElement | undefined {
    if (this.disposed) return undefined;
    this.draw();
    const canvas = (this.skinCanvas ??= Object.assign(document.createElement('canvas'), {
      width: SKIN_IMAGE_SIZE,
      height: SKIN_IMAGE_SIZE,
    }));
    const context = canvas.getContext('2d');
    if (context === null) return undefined;
    const placed = fitBGACameraRect(LRX_BGA_WIDTH, LRX_BGA_HEIGHT, {
      x: 0,
      y: 0,
      w: SKIN_IMAGE_SIZE,
      h: SKIN_IMAGE_SIZE,
    });
    context.fillStyle = '#000';
    context.fillRect(0, 0, SKIN_IMAGE_SIZE, SKIN_IMAGE_SIZE);
    context.drawImage(this.canvas, placed.x, placed.y, placed.w, placed.h);
    return canvas;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const { plain, source, gl } = this;
    const release = (): void => {
      plain.destroy(false);
      source.destroy();
      if (gl !== undefined) {
        for (const texture of gl.textures.values()) gl.gl.deleteTexture(texture);
        gl.textures.clear();
      }
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(release));
    else setTimeout(release, 50);
  }

  /** Redraws the screen for the play's current second, once per second value. */
  private draw(): void {
    const gl = this.gl;
    if (gl === undefined) return;
    const seconds = this.clock.seconds();
    if (this.drawnAt === seconds) return;
    this.drawnAt = seconds;
    gl.gl.viewport(0, 0, LRX_BGA_WIDTH, LRX_BGA_HEIGHT);
    gl.gl.clearColor(0, 0, 0, 1);
    gl.gl.clear(gl.gl.COLOR_BUFFER_BIT);
    const poor = this.clock.showsPoor() ? sampleLRXBGA(this.program, 5, seconds, this.sizeOf) : undefined;
    if (poor !== undefined) {
      this.drawSprite(gl, 5, poor, seconds);
    } else {
      for (let slot = 0; slot < 5; slot++) {
        const sprite = sampleLRXBGA(this.program, slot, seconds, this.sizeOf);
        if (sprite !== undefined) this.drawSprite(gl, slot, sprite, seconds);
      }
    }
    this.source.update();
  }

  private readonly sizeOf = (key: string): readonly [number, number] | undefined => {
    const image = this.imageOf(0, key);
    return image === undefined ? undefined : [image.width, image.height];
  };

  /** The picture a slot draws for `key`: a layer's black-keyed texture first, else the plain one, else a video. */
  private imageOf(slot: number, key: string): { source: Drawable; width: number; height: number } | undefined {
    const video = this.sources.videos.get(key)?.video;
    if (video !== undefined) {
      return video.videoWidth > 0 ? { source: video, width: video.videoWidth, height: video.videoHeight } : undefined;
    }
    const texture =
      (slot >= 1 && slot <= 4 ? this.sources.layerTextures.get(key) : undefined) ?? this.sources.textures.get(key);
    const resource = texture?.source.resource as Drawable | undefined;
    if (texture === undefined || resource === undefined) return undefined;
    return { source: resource, width: texture.source.width, height: texture.source.height };
  }

  private drawSprite(gl: LRXBGAGL, slot: number, sprite: LRXBGASprite, seconds: number): void {
    const image = this.imageOf(slot, sprite.key);
    if (image === undefined) return;
    this.syncVideo(slot, sprite.key, image.source, seconds);
    const [sx, sy, sw, sh] = sprite.src ?? [0, 0, image.width, image.height];
    const [dx, dy, dw, dh] =
      sprite.dst ??
      (sprite.fill === 'screen' ? [0, 0, LRX_BGA_WIDTH, LRX_BGA_HEIGHT] : [0, 0, image.width, image.height]);
    if (sw === 0 || sh === 0 || dw === 0 || dh === 0 || image.width <= 0 || image.height <= 0) return;
    const texture = this.textureOf(gl, image.source);
    if (texture === undefined) return;
    const quad = resolveLRXBGAQuad(dx, dy, dw, dh, resolveLRXBGAPivot(sprite.center, dx, dy, dw, dh), sprite.rotation);
    const u0 = sx / image.width;
    const v0 = sy / image.height;
    const u1 = (sx + sw) / image.width;
    const v1 = (sy + sh) / image.height;
    const texels = [
      [u0, v0],
      [u1, v0],
      [u0, v1],
      [u1, v1],
    ] as const;
    const vertices = new Float32Array(16);
    for (let corner = 0; corner < 4; corner++) {
      vertices.set([quad[corner]![0], quad[corner]![1], texels[corner]![0], texels[corner]![1]], corner * 4);
    }
    const context = gl.gl;
    context.bindBuffer(context.ARRAY_BUFFER, gl.buffer);
    context.bufferData(context.ARRAY_BUFFER, vertices, context.STREAM_DRAW);
    const [alpha, red, green, blue] = sprite.color;
    context.uniform4f(gl.color, red / 255, green / 255, blue / 255, alpha / 255);
    const blend = resolveLRXBGABlend(sprite.blend);
    context.blendEquation(context[blend.equation]);
    context.blendFunc(context[blend.source], context[blend.destination]);
    context.bindTexture(context.TEXTURE_2D, texture);
    context.drawArrays(context.TRIANGLE_STRIP, 0, 4);
  }

  /** The picture's texture, uploaded once (a video every frame). */
  private textureOf(gl: LRXBGAGL, source: Drawable): WebGLTexture | undefined {
    const context = gl.gl;
    let texture = gl.textures.get(source);
    const fresh = texture === undefined;
    if (texture === undefined) {
      const created = context.createTexture();
      if (created === null) return undefined;
      texture = created;
      gl.textures.set(source, texture);
      context.bindTexture(context.TEXTURE_2D, texture);
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR);
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);
    }
    if (fresh || source instanceof HTMLVideoElement) {
      context.bindTexture(context.TEXTURE_2D, texture);
      try {
        context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, context.RGBA, context.UNSIGNED_BYTE, source);
      } catch {
        // A video with no frame yet draws nothing this frame.
        return undefined;
      }
    }
    return texture;
  }

  /** A video starts from the moment its note began, once, and keeps playing. */
  private syncVideo(slot: number, key: string, source: Drawable, seconds: number): void {
    if (!(source instanceof HTMLVideoElement)) return;
    let node: LRXBGANode | undefined;
    for (const candidate of this.program.slots[slot] ?? []) {
      if (candidate.seconds > seconds) break;
      node = candidate;
    }
    const cue = `${key}@${node?.seconds ?? 0}`;
    if (this.videoCues.get(slot) !== cue) {
      this.videoCues.set(slot, cue);
      source.currentTime = Math.max(0, seconds - (node?.seconds ?? 0));
    }
    if (source.paused) void source.play().catch(() => {});
  }
}

/** A WebGL context on `canvas` with the compositor's program bound, or `undefined` where WebGL is unavailable. */
function createLRXBGAGL(canvas: HTMLCanvasElement): LRXBGAGL | undefined {
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    stencil: false,
  });
  if (gl === null) return undefined;
  const compile = (type: number, code: string): WebGLShader | undefined => {
    const shader = gl.createShader(type);
    if (shader === null) return undefined;
    gl.shaderSource(shader, code);
    gl.compileShader(shader);
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) === true ? shader : undefined;
  };
  const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  const buffer = gl.createBuffer();
  if (vertex === undefined || fragment === undefined || program === null || buffer === null) return undefined;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) return undefined;
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  const position = gl.getAttribLocation(program, 'aPosition');
  const texel = gl.getAttribLocation(program, 'aTexel');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(texel);
  gl.vertexAttribPointer(texel, 2, gl.FLOAT, false, 16, 8);
  const color = gl.getUniformLocation(program, 'uColor');
  if (color === null) return undefined;
  gl.uniform1i(gl.getUniformLocation(program, 'uImage'), 0);
  gl.activeTexture(gl.TEXTURE0);
  // Texels keep their own colour where they are transparent, as a Direct3D texture does.
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.enable(gl.BLEND);
  return { gl, buffer, color, textures: new Map() };
}

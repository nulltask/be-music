/**
 * An LRX chart's BGA drawn as plugout4 -ARCADE EDITION- draws it (`plugout4.exe` 0x4439be, 0x4442c0): the base and four
 * layers on a 1280×720 screen, each cropped, placed, tinted, blended and rotated as its note says and eased between
 * keyframes (`sampleLRXBGA`), or the POOR image alone for half a second after a miss. It feeds the BGA frame through
 * the same {@link BGAFeed} the camera uses, so every play scene shows it in place of the chart's BMS BGA planes.
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
import { resolveLRXBGAPivot, resolveLRXBGAComposite } from './lrx-bga-draw.ts';

/** The side of the square picture a Canvas skin gets, the BMS BGA canvas. */
const SKIN_IMAGE_SIZE = 256;
/** plugout shows the POOR image for 500 ms after a miss (0x4439b7). */
export const LRX_POOR_SECONDS = 0.5;

type Drawable = CanvasImageSource & { width?: number; height?: number };

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
  private readonly context: CanvasRenderingContext2D | null;
  private readonly source: CanvasSource;
  private readonly plain: Texture;
  private skinCanvas: HTMLCanvasElement | undefined;
  private tintCanvas: HTMLCanvasElement | undefined;
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
    this.context = this.canvas.getContext('2d');
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
    const { plain, source } = this;
    const release = (): void => {
      plain.destroy(false);
      source.destroy();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(release));
    else setTimeout(release, 50);
  }

  /** Redraws the screen for the play's current second, once per second value. */
  private draw(): void {
    const context = this.context;
    if (context === null) return;
    const seconds = this.clock.seconds();
    if (this.drawnAt === seconds) return;
    this.drawnAt = seconds;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    context.fillStyle = '#000';
    context.fillRect(0, 0, LRX_BGA_WIDTH, LRX_BGA_HEIGHT);
    const poor = this.clock.showsPoor() ? sampleLRXBGA(this.program, 5, seconds, this.sizeOf) : undefined;
    if (poor !== undefined) {
      this.drawSprite(context, 5, poor, seconds);
    } else {
      for (let slot = 0; slot < 5; slot++) {
        const sprite = sampleLRXBGA(this.program, slot, seconds, this.sizeOf);
        if (sprite !== undefined) this.drawSprite(context, slot, sprite, seconds);
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

  private drawSprite(context: CanvasRenderingContext2D, slot: number, sprite: LRXBGASprite, seconds: number): void {
    const image = this.imageOf(slot, sprite.key);
    if (image === undefined) return;
    this.syncVideo(slot, sprite.key, image.source, seconds);
    const [sx, sy, sw, sh] = sprite.src ?? [0, 0, image.width, image.height];
    const [dx, dy, dw, dh] =
      sprite.dst ??
      (sprite.fill === 'screen' ? [0, 0, LRX_BGA_WIDTH, LRX_BGA_HEIGHT] : [0, 0, image.width, image.height]);
    if (sw <= 0 || sh <= 0 || dw === 0 || dh === 0) return;
    const [alpha, red, green, blue] = sprite.color;
    if (alpha <= 0) return;
    const picture =
      red === 255 && green === 255 && blue === 255
        ? image.source
        : this.tint(image.source, sx, sy, sw, sh, red, green, blue);
    const crop = picture === image.source ? [sx, sy, sw, sh] : [0, 0, sw, sh];
    const [px, py] = resolveLRXBGAPivot(sprite.center, dx, dy, dw, dh);
    context.save();
    context.globalAlpha = Math.min(1, alpha / 255);
    context.globalCompositeOperation = resolveLRXBGAComposite(sprite.blend);
    context.translate(px, py);
    context.rotate((sprite.rotation * Math.PI) / 180);
    context.translate(-px, -py);
    try {
      context.drawImage(picture, crop[0]!, crop[1]!, crop[2]!, crop[3]!, dx, dy, dw, dh);
    } catch {
      // A video with no frame yet draws nothing this frame.
    }
    context.restore();
  }

  /** The cropped picture multiplied by the colour, its alpha kept. */
  private tint(
    source: Drawable,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    red: number,
    green: number,
    blue: number,
  ): HTMLCanvasElement {
    const canvas = (this.tintCanvas ??= document.createElement('canvas'));
    canvas.width = Math.max(1, Math.round(sw));
    canvas.height = Math.max(1, Math.round(sh));
    const context = canvas.getContext('2d')!;
    context.globalCompositeOperation = 'source-over';
    context.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    context.globalCompositeOperation = 'multiply';
    context.fillStyle = `rgb(${red}, ${green}, ${blue})`;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.globalCompositeOperation = 'destination-in';
    context.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas;
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

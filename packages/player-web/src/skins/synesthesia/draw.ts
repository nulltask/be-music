import type { Graphics } from 'pixi.js';
import type { Flock } from './boids.ts';
import {
  emberColor,
  projectPoint,
  rotateX,
  rotateY,
  viewPoint,
  type CameraPose,
  type CloudPoint,
  type Projected,
  type Vec3,
} from './space.ts';
import { SYN_CYAN, SYN_GLASS, SYN_MAGENTA, SYN_WHITE, synGlowTexture } from './style.ts';
import { hash01 } from '@be-music/skin-sdk';
import { pointLayerFor } from '../pixi-kit/index.ts';

/**
 * Shared Synesthesia drawing: hairline frames with lock-on corners (a rhythm-shooter targeting reticle) and projected point
 * clouds. Callers own the `Graphics`; these only append geometry.
 */

/** Most grains one square point breaks into. */
const MAX_GRAINS = 5;

/**
 * Where the grains of a point sit, as fractions of the point's size: a golden-angle spiral, so a cluster of any count
 * fills the point's square evenly without lining up into a pattern.
 */
const GRAIN_OFFSETS: Float32Array = (() => {
  const offsets = new Float32Array(MAX_GRAINS * 2);
  for (let index = 0; index < MAX_GRAINS; index += 1) {
    const radius = index === 0 ? 0 : 0.42 * Math.sqrt(index / (MAX_GRAINS - 1));
    const angle = index * 2.39996;
    offsets[index * 2] = Math.cos(angle) * radius;
    offsets[index * 2 + 1] = Math.sin(angle) * radius;
  }
  return offsets;
})();

/**
 * How a square point of `size` px and `alpha` breaks into fine grains: each grain is about half the point's size
 * (0.6–1.1 px), there are as many as it takes to cover a share of the point (1–5), and their alpha is set so the
 * cluster gives off about the light the point did. Pure.
 */
export function grainsFor(size: number, alpha: number): { count: number; size: number; alpha: number } {
  const grain = Math.max(0.6, Math.min(1.1, size * 0.5));
  const count = Math.max(1, Math.min(MAX_GRAINS, Math.round((size / grain) ** 2 * 0.45)));
  return { count, size: grain, alpha: Math.min(1, (alpha * size * size * 0.8) / (count * grain * grain)) };
}

/** Most grains one segment breaks into. */
const MAX_TRAIL_GRAINS = 32;

/** Most parallel lanes a wide segment's grains spread over. */
const MAX_TRAIL_LANES = 3;

/**
 * How a segment `length` px long and `width` px thick breaks into a trail of fine grains: grains about a pixel across,
 * spaced about 1.6 px apart (up to MAX_TRAIL_GRAINS per lane), laid in 1–3 parallel lanes across the stroke's width,
 * with their alpha set so the trail gives off about the light the stroke did. Pure.
 */
export function trailGrainsFor(
  length: number,
  width: number,
  alpha: number,
): { count: number; lanes: number; size: number; alpha: number } {
  const grain = Math.max(0.6, Math.min(1.1, width * 0.6));
  const count = Math.max(1, Math.min(MAX_TRAIL_GRAINS, Math.round(length / 1.6) + 1));
  const lanes = Math.max(1, Math.min(MAX_TRAIL_LANES, Math.round(width / 1.5)));
  const area = Math.max(grain * grain, length * width);
  return { count, lanes, size: grain, alpha: Math.min(1, (alpha * area * 0.8) / (count * lanes * grain * grain)) };
}

/**
 * Batches thousands of tiny additive shapes into a handful of draw instructions: rects and line segments are bucketed
 * by (target graphics, colour quantized to 4 bits per channel, alpha quantized to eighths, stroke width) and emitted as
 * one `fill` / `stroke` per bucket on {@link flush}. Emission order is bucket order, so only use it where overlap order does not matter
 * (additive light).
 */
export class ShapeBatch {
  /**
   * @param points When true, square rects are drawn as particles on the target's {@link pointLayerFor point layer}
   *   instead of `Graphics` geometry. Off for tests and for targets outside the scene graph.
   */
  private readonly points: boolean;

  public constructor(points = false) {
    this.points = points;
  }

  // Buckets are keyed by a packed integer and kept across flushes (only their data is reset), so a steady frame
  // allocates no keys, buckets, or arrays.
  private readonly rects = new Map<number, ShapeBucket>();
  private readonly lines = new Map<number, ShapeBucket>();
  private readonly ids = new Map<Graphics, number>();
  private readonly targets: Graphics[] = [];

  private id(graphics: Graphics): number {
    let id = this.ids.get(graphics);
    if (id === undefined) {
      id = this.targets.length;
      this.ids.set(graphics, id);
      this.targets.push(graphics);
    }
    return id;
  }

  public rect(graphics: Graphics, rawColor: number, alpha: number, x: number, y: number, w: number, h: number): void {
    const eighths = Math.round(Math.min(1, alpha) * 8);
    if (eighths <= 0) return;
    if (this.points && w === h) {
      // Square points become GPU particles (exact colour and alpha, no geometry rebuild), broken into fine grains so
      // every particle in the skin shares the audio orb's fine, dusty texture.
      const layer = pointLayerFor(graphics);
      const grains = grainsFor(w, Math.min(1, alpha));
      const cx = x + w / 2;
      const cy = y + h / 2;
      for (let index = 0; index < grains.count; index += 1) {
        layer.point(
          cx + GRAIN_OFFSETS[index * 2]! * w,
          cy + GRAIN_OFFSETS[index * 2 + 1]! * w,
          grains.size,
          rawColor,
          grains.alpha,
        );
      }
      return;
    }
    const key = (this.id(graphics) * 9 + eighths) * 4096 + colorIndex(rawColor);
    let bucket = this.rects.get(key);
    if (!bucket) {
      bucket = { target: this.id(graphics), color: quantizeColor(rawColor), alpha: eighths / 8, width: 0, data: [] };
      this.rects.set(key, bucket);
    }
    bucket.data.push(x, y, w, h);
  }

  /**
   * A soft glow sprite `size` px across centred on `(cx, cy)`, on its own particle layer next to `graphics`. Only drawn
   * in points mode; elsewhere (tests, targets outside the scene graph) it is skipped.
   */
  public glow(graphics: Graphics, color: number, alpha: number, cx: number, cy: number, size: number): void {
    if (!this.points || alpha <= 0.004 || size <= 0) return;
    pointLayerFor(graphics, synGlowTexture()).point(cx, cy, size, color, Math.min(1, alpha));
  }

  public line(
    graphics: Graphics,
    rawColor: number,
    alpha: number,
    width: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): void {
    const eighths = Math.round(Math.min(1, alpha) * 8);
    if (eighths <= 0) return;
    if (this.points) {
      // Segments break into a trail of fine grains too, so trails, fish and sparks share the dusty texture.
      const length = Math.hypot(x1 - x0, y1 - y0);
      const grains = trailGrainsFor(length, width, Math.min(1, alpha));
      const layer = pointLayerFor(graphics);
      // Wide strokes lay their grains in parallel lanes across the width, so a fatter stroke reads wider, not brighter.
      const nx = length > 0 ? -(y1 - y0) / length : 0;
      const ny = length > 0 ? (x1 - x0) / length : 0;
      for (let lane = 0; lane < grains.lanes; lane += 1) {
        const across = (lane - (grains.lanes - 1) / 2) * (width / grains.lanes);
        for (let index = 0; index < grains.count; index += 1) {
          const t = grains.count === 1 ? 0.5 : index / (grains.count - 1);
          layer.point(
            x0 + (x1 - x0) * t + nx * across,
            y0 + (y1 - y0) * t + ny * across,
            grains.size,
            rawColor,
            grains.alpha,
          );
        }
      }
      return;
    }
    const halfSteps = Math.min(63, Math.max(1, Math.round(width * 2)));
    const key = ((this.id(graphics) * 9 + eighths) * 64 + halfSteps) * 4096 + colorIndex(rawColor);
    let bucket = this.lines.get(key);
    if (!bucket) {
      bucket = {
        target: this.id(graphics),
        color: quantizeColor(rawColor),
        alpha: eighths / 8,
        width: halfSteps / 2,
        data: [],
      };
      this.lines.set(key, bucket);
    }
    bucket.data.push(x0, y0, x1, y1);
  }

  public flush(): void {
    for (const bucket of this.rects.values()) {
      const { data } = bucket;
      if (data.length === 0) continue;
      const graphics = this.targets[bucket.target]!;
      for (let index = 0; index < data.length; index += 4) {
        graphics.rect(data[index]!, data[index + 1]!, data[index + 2]!, data[index + 3]!);
      }
      graphics.fill({ color: bucket.color, alpha: bucket.alpha });
      data.length = 0;
    }
    for (const bucket of this.lines.values()) {
      const { data } = bucket;
      if (data.length === 0) continue;
      const graphics = this.targets[bucket.target]!;
      for (let index = 0; index < data.length; index += 4) {
        graphics.moveTo(data[index]!, data[index + 1]!).lineTo(data[index + 2]!, data[index + 3]!);
      }
      graphics.stroke({ color: bucket.color, width: bucket.width, alpha: bucket.alpha });
      data.length = 0;
    }
    // Pooled graphics can be handed out in a different order next frame; re-learn the targets each flush.
    this.ids.clear();
    this.targets.length = 0;
    if (this.rects.size + this.lines.size > 4096) {
      this.rects.clear();
      this.lines.clear();
    }
  }
}

/**
 * One batch shared by every Synesthesia renderer. Renderers draw synchronously and flush before returning, so sharing
 * is safe and lets steady frames reuse its buckets instead of allocating a batch per call.
 */
export const sharedShapeBatch: ShapeBatch = new ShapeBatch(true);

interface ShapeBucket {
  target: number;
  color: number;
  alpha: number;
  width: number;
  data: number[];
}

/** 12-bit index of a colour's {@link quantizeColor} bucket (the top nibble of each channel). */
function colorIndex(color: number): number {
  return ((color >> 12) & 0xf00) | ((color >> 8) & 0xf0) | ((color >> 4) & 0xf);
}

/** `color` snapped to 16 levels per channel (bucket-friendly, visually identical for light). */
function quantizeColor(color: number): number {
  return (color & 0xf0f0f0) | 0x080808;
}

/**
 * Lock-on reticle: four rounded corner brackets around `(x, y, w, h)` and an optional centre cross. `arm` is the
 * bracket length.
 */
export function drawReticle(
  graphics: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  alpha: number,
  options: { arm?: number; width?: number; cross?: boolean } = {},
): void {
  const arm = Math.min(options.arm ?? 10, w / 2, h / 2);
  const width = options.width ?? 1.5;
  const right = x + w;
  const bottom = y + h;
  const bend = Math.min(3, arm / 2);
  graphics
    .moveTo(x, y + arm)
    .lineTo(x, y + bend)
    .quadraticCurveTo(x, y, x + bend, y)
    .lineTo(x + arm, y)
    .moveTo(right - arm, y)
    .lineTo(right - bend, y)
    .quadraticCurveTo(right, y, right, y + bend)
    .lineTo(right, y + arm)
    .moveTo(right, bottom - arm)
    .lineTo(right, bottom - bend)
    .quadraticCurveTo(right, bottom, right - bend, bottom)
    .lineTo(right - arm, bottom)
    .moveTo(x + arm, bottom)
    .lineTo(x + bend, bottom)
    .quadraticCurveTo(x, bottom, x, bottom - bend)
    .lineTo(x, bottom - arm)
    .stroke({ color, width, alpha, cap: 'round' });
  if (options.cross) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const size = Math.min(w, h) * 0.08 + 2;
    graphics
      .moveTo(cx - size, cy)
      .lineTo(cx + size, cy)
      .moveTo(cx, cy - size)
      .lineTo(cx, cy + size)
      .stroke({ color, width: 1, alpha });
  }
}

/** A near-black frame with a warm hairline rim and bright lock-on corners — a targeting-HUD take on a panel. */
export function drawFrame(
  graphics: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  rim: number,
  options: { fill?: number; arm?: number } = {},
): void {
  graphics.rect(x, y, w, h).fill({ color: SYN_GLASS, alpha: options.fill ?? 0.55 });
  graphics.rect(x, y, w, h).stroke({ color: rim, width: 1, alpha: 0.22 });
  drawReticle(graphics, x - 1, y - 1, w + 2, h + 2, SYN_WHITE, 0.85, { arm: options.arm ?? 9, width: 1.25 });
}

export interface CloudTransform {
  /** Uniform scale applied to the unit shape. */
  scale: number;
  /** World offset after rotation. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch?: number;
}

/**
 * Projects `points` through (scale → yaw / pitch → offset) into screen space and draws each as a tiny additive-ready
 * square — nearer and heavier points are bigger and brighter. `colorOf` picks a colour per point; `shimmer` (0..1)
 * flickers individual points over time so the cloud looks alive. `skip` lets the caller drop points (e.g. inside a
 * live BGA).
 */
export function drawPointCloud(
  graphics: Graphics,
  points: readonly CloudPoint[],
  transform: CloudTransform,
  view: { cx: number; cy: number; focal: number; camera?: CameraPose; orbit?: number },
  style: {
    colorOf: (point: CloudPoint, index: number) => number;
    alpha: number;
    size: number;
    seconds?: number;
    shimmer?: number;
    /** Perspective scale at which `size` / `alpha` apply 1:1 (default 1) — set it near the cloud's depth. */
    referenceScale?: number;
    /** Heavy points also get a faint square halo this many times their size. */
    bokeh?: number;
    skip?: (x: number, y: number) => boolean;
  },
): void {
  const reference = style.referenceScale ?? 1;
  const seconds = style.seconds ?? 0;
  const shimmer = style.shimmer ?? 0;
  const batch = sharedShapeBatch;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    let world = { x: point.x * transform.scale, y: point.y * transform.scale, z: point.z * transform.scale };
    world = rotateY(world, transform.yaw);
    if (transform.pitch) world = rotateX(world, transform.pitch);
    const placed = { x: world.x + transform.x, y: world.y + transform.y, z: world.z + transform.z };
    const projected = projectPoint(
      view.camera ? viewPoint(placed, view.camera, view.orbit) : placed,
      view.cx,
      view.cy,
      view.focal,
    );
    if (!projected.visible) continue;
    if (style.skip?.(projected.x, projected.y)) continue;
    const flicker = shimmer > 0 ? 1 - shimmer * (0.5 + 0.5 * Math.sin(seconds * 7 + index * 2.39)) : 1;
    const depth = projected.scale / reference;
    const alpha = style.alpha * point.weight * flicker * Math.min(1.4, depth);
    if (alpha < 0.02) continue;
    const size = Math.max(0.6, style.size * (0.5 + point.weight) * depth);
    const color = style.colorOf(point, index);
    if (style.bokeh && point.weight > 0.75) {
      const halo = size * style.bokeh;
      batch.rect(
        graphics,
        color,
        Math.min(1, alpha) * 0.12,
        projected.x - halo / 2,
        projected.y - halo / 2,
        halo,
        halo,
      );
    }
    batch.rect(graphics, color, Math.min(1, alpha), projected.x - size / 2, projected.y - size / 2, size, size);
  }
  batch.flush();
}

/**
 * Draws a school of boids as fish of light: a tapering streak trailing each boid along its heading with a hot head,
 * nearer fish larger and brighter. `project` maps a world point to screen (camera + perspective); `skip` drops fish
 * (e.g. over a live BGA). `palette` picks the school's light: ember (with the odd blue fish), electric blue, or magenta.
 */
export function drawSchool(
  graphics: Graphics,
  flock: Flock,
  project: (point: Vec3) => Projected,
  style: {
    alpha: number;
    palette?: 'ember' | 'blue' | 'magenta';
    skip?: (x: number, y: number) => boolean;
    /** 0..1: how hard the latest kick is flicking every fish up, swollen and white-hot (see stepKick). */
    swell?: number;
    /** 0..1: the music's bass level; the fish's glow brightens and spreads with it. */
    bass?: number;
  },
): void {
  const palette = style.palette ?? 'ember';
  // On a kick each fish flicks up: a fatter body, a bigger head, a slightly longer stretch, flashing white.
  const swell = Math.max(0, Math.min(1, style.swell ?? 0));
  const girth = 1 + 1.6 * swell;
  const stretch = 0.16 * (1 + 0.5 * swell);
  // The glow follows the bass: a faint halo in quiet passages, bright and wide when the low end is loud.
  const bass = Math.max(0, Math.min(1, style.bass ?? 0));
  const glowGain = (0.35 + 2.2 * bass) * (1 + 2 * swell);
  const glowSpread = (1 + 0.6 * bass) * (1 + 0.9 * swell);
  const { position: p, velocity: v } = flock;
  const batch = sharedShapeBatch;
  for (let index = 0; index < flock.count; index += 1) {
    const x = p[index * 3]!;
    const y = p[index * 3 + 1]!;
    const z = p[index * 3 + 2]!;
    const head = project({ x, y, z });
    if (!head.visible) continue;
    if (style.skip?.(head.x, head.y)) continue;
    // Tail length follows speed, so a darting fish stretches.
    const tail = project({
      x: x - v[index * 3]! * stretch,
      y: y - v[index * 3 + 1]! * stretch,
      z: z - v[index * 3 + 2]! * stretch,
    });
    if (!tail.visible) continue;
    const nearness = Math.min(1, head.scale * 2.4);
    const heat = hash01(index * 5 + 3);
    const color =
      palette === 'blue'
        ? heat > 0.75
          ? SYN_WHITE
          : SYN_CYAN
        : palette === 'magenta'
          ? heat > 0.8
            ? 0xffb3d9
            : SYN_MAGENTA
          : index % 7 === 0
            ? SYN_CYAN
            : emberColor(0.55 + 0.4 * heat);
    const alpha = style.alpha * (0.35 + 0.65 * nearness) * (1 + 0.8 * swell);
    const lit = swell > 0.01 ? mixColor(color, SYN_WHITE, Math.min(1, swell * 1.2)) : color;
    const mx = (head.x + tail.x) / 2;
    const my = (head.y + tail.y) / 2;
    // Every fish carries a soft halo around its head, swelling with the bass and blooming on a kick.
    batch.glow(
      graphics,
      lit,
      style.alpha * (0.1 + 0.25 * nearness) * glowGain,
      head.x,
      head.y,
      (10 + 22 * nearness) * glowSpread,
    );
    batch.line(graphics, lit, alpha * 0.55, (0.6 + 1 * nearness) * girth, tail.x, tail.y, mx, my);
    batch.line(graphics, lit, alpha, (1 + 2 * nearness) * girth, mx, my, head.x, head.y);
    const size = (1.2 + 2.2 * nearness) * (1 + 1.4 * swell);
    batch.rect(
      graphics,
      heat > 0.8 ? SYN_WHITE : lit,
      Math.min(1, alpha * 1.3),
      head.x - size / 2,
      head.y - size / 2,
      size,
      size,
    );
  }
  batch.flush();
}

/** `from` blended toward `to` by `t` (0..1), per RGB channel. */
function mixColor(from: number, to: number, t: number): number {
  const r = Math.round(((from >> 16) & 255) + (((to >> 16) & 255) - ((from >> 16) & 255)) * t);
  const g = Math.round(((from >> 8) & 255) + (((to >> 8) & 255) - ((from >> 8) & 255)) * t);
  const b = Math.round((from & 255) + ((to & 255) - (from & 255)) * t);
  return (r << 16) | (g << 8) | b;
}

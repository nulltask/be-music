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
import { SYN_CYAN, SYN_GLASS, SYN_MAGENTA, SYN_WHITE } from './style.ts';
import { hash01 } from '@be-music/skin-sdk';
import { pointLayerFor } from '../pixi-kit/index.ts';

/**
 * Shared Synesthesia drawing: hairline frames with lock-on corners (a rhythm-shooter targeting reticle) and projected point
 * clouds. Callers own the `Graphics`; these only append geometry.
 */

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
      // Square points become GPU particles (exact colour and alpha, no geometry rebuild).
      pointLayerFor(graphics).point(x + w / 2, y + h / 2, w, rawColor, Math.min(1, alpha));
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
  style: { alpha: number; palette?: 'ember' | 'blue' | 'magenta'; skip?: (x: number, y: number) => boolean },
): void {
  const palette = style.palette ?? 'ember';
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
      x: x - v[index * 3]! * 0.16,
      y: y - v[index * 3 + 1]! * 0.16,
      z: z - v[index * 3 + 2]! * 0.16,
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
    const alpha = style.alpha * (0.35 + 0.65 * nearness);
    const mx = (head.x + tail.x) / 2;
    const my = (head.y + tail.y) / 2;
    batch.line(graphics, color, alpha * 0.55, 0.6 + 1 * nearness, tail.x, tail.y, mx, my);
    batch.line(graphics, color, alpha, 1 + 2 * nearness, mx, my, head.x, head.y);
    const size = 1.2 + 2.2 * nearness;
    batch.rect(
      graphics,
      heat > 0.8 ? SYN_WHITE : color,
      Math.min(1, alpha * 1.3),
      head.x - size / 2,
      head.y - size / 2,
      size,
      size,
    );
  }
  batch.flush();
}

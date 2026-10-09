import type { Graphics, Sprite } from 'pixi.js';
import type { Flock } from './boids.ts';
import {
  emberColor,
  limbGlow,
  orbitPosition,
  projectPoint,
  reflectedLight,
  rotateX,
  rotateY,
  viewPoint,
  type CameraPose,
  type CloudPoint,
  type OrbitParticle,
  type Projected,
  type Vec3,
} from './space.ts';
import { SYN_CYAN, SYN_GLASS, SYN_MAGENTA, SYN_WHITE, synGlowTexture } from './style.ts';
import { type AudioDrive, bandLevel, hash01 } from '../../skin-sdk/index.ts';
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

export interface MagnetoOrbOptions {
  /** World centre and rest shell radius. */
  x: number;
  y: number;
  z: number;
  radius: number;
  view: { cx: number; cy: number; focal: number; camera?: CameraPose; orbit?: number };
  drive: AudioDrive;
  seconds: number;
  alpha: number;
  /** Tilt of the shell's spin (radians) and spin speed (rad / s). */
  tilt?: number;
  spin?: number;
  /**
   * A black moon revolving round the orb like a satellite: `size` and `distance` are fractions of the shell radius,
   * `speed` in rad / s, `tilt` the orbit plane's inclination. Omit for none.
   */
  moon?: { size: number; distance: number; speed: number; phase: number; tilt?: number };
  /** Screen rect the orb must stay inside (e.g. the idle monitor). */
  clip?: { x: number; y: number; w: number; h: number };
}

/** The three layers an orb draws into, back to front: additive light, a normal-blend layer for the black moon, and
 * additive light again for the half of the shell facing the camera. */
export interface MagnetoOrbLayers {
  back: Graphics;
  moon: Graphics;
  front: Graphics;
}

const ORB_HAZE = 0x5a3cff;
const ORB_VIOLET = 0x8a6bff;
const ORB_BLUE = 0x5b8bff;
const ORB_PINK = 0xff7ad9;
const ORB_WHITE = 0xf2eaff;
const ORB_FIBER = 0xb9a8ff;
const ORB_MOON = 0x0b0518;
const SHELL_COLORS = [ORB_VIOLET, ORB_BLUE, ORB_WHITE, ORB_VIOLET, ORB_PINK, ORB_BLUE] as const;
/** Samples per orbit tail. */
const TRAIL_STEPS = 12;

/**
 * A particle-shell orb in the manner of classic music visualizers: a hollow shell of countless violet / blue / pink /
 * white sparks, brightest at its silhouette, bristling with fine fibres that shoot out from the surface, wrapped in a
 * violet haze and a few lights racing round on tilted orbits — and, for contrast, a black moon circling it. The
 * music drives it: each latitude swells and grows longer fibres with its spectrum band (lows south, highs north),
 * the shell breathes on the bass, onsets burst the fibres outward, the highs twinkle the sparks. Returns the
 * projected centre and shell radius.
 */
export function drawMagnetoOrb(
  layers: MagnetoOrbLayers,
  acquireSprite: () => Sprite,
  shell: readonly CloudPoint[],
  particles: readonly OrbitParticle[],
  options: MagnetoOrbOptions,
): { x: number; y: number; radius: number } | undefined {
  const { view, drive, clip } = options;
  const toScreen = (point: Vec3) =>
    projectPoint(view.camera ? viewPoint(point, view.camera, view.orbit) : point, view.cx, view.cy, view.focal);
  const centre = toScreen({ x: options.x, y: options.y, z: options.z });
  if (!centre.visible) return undefined;
  const outside = (x: number, y: number) =>
    clip !== undefined && (x < clip.x || x > clip.x + clip.w || y < clip.y || y > clip.y + clip.h);
  const levels = Array.from({ length: 16 }, (_, column) => bandLevel(drive.bands, column, 16));
  const glow = synGlowTexture();
  const sparkle = (x: number, y: number, size: number, tint: number, alpha: number) => {
    if (alpha < 0.02 || size < 0.8 || outside(x, y)) return;
    const node = acquireSprite();
    node.texture = glow;
    node.anchor.set(0.5);
    node.blendMode = 'add';
    node.position.set(x, y);
    node.width = size;
    node.height = size;
    node.tint = tint;
    node.alpha = Math.min(1, alpha);
  };
  const place = (local: Vec3) => toScreen({ x: options.x + local.x, y: options.y + local.y, z: options.z + local.z });
  const breathe = options.radius * (0.8 + 0.55 * drive.bass + 0.25 * drive.onset);
  const screenRadius = breathe * centre.scale;
  const spin = options.seconds * (options.spin ?? 0.25);
  const tilt = options.tilt ?? 0.35;

  // Thousands of dots, fibres, and tail segments go out as a handful of batched instructions.
  const batch = sharedShapeBatch;
  const addDot = (layer: Graphics, color: number, alpha: number, x: number, y: number, size: number) =>
    batch.rect(layer, color, alpha, x - size / 2, y - size / 2, size, size);
  const addLine = (
    layer: Graphics,
    color: number,
    alpha: number,
    width: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ) => batch.line(layer, color, alpha, width, x0, y0, x1, y1);

  // Violet haze behind everything.
  for (let ring = 4; ring >= 1; ring -= 1) {
    const r = screenRadius * (0.9 + 0.45 * ring);
    if (
      clip &&
      (centre.x - r < clip.x ||
        centre.x + r > clip.x + clip.w ||
        centre.y - r < clip.y ||
        centre.y + r > clip.y + clip.h)
    ) {
      continue;
    }
    layers.back
      .circle(centre.x, centre.y, r)
      .fill({ color: ORB_HAZE, alpha: (0.05 + 0.05 * drive.level) * options.alpha });
  }

  // The shell and its fibres; each point lands on the back or front layer by which way it faces.
  for (let index = 0; index < shell.length; index += 1) {
    const point = shell[index]!;
    const latitude = (1 - point.y) / 2;
    const band = levels[Math.min(15, Math.floor(latitude * 16))] ?? 0;
    const heat = hash01(index * 7 + 3);
    const radius = breathe * (1 + 0.22 * band);
    let normal: Vec3 = rotateY(point, spin);
    normal = rotateX(normal, tilt);
    const projected = place({ x: normal.x * radius, y: normal.y * radius, z: normal.z * radius });
    if (!projected.visible || outside(projected.x, projected.y)) continue;
    const limb = limbGlow(normal.z);
    const target = normal.z < 0 ? layers.front : layers.back;
    const depth = projected.scale / Math.max(1e-6, centre.scale);
    const color = SHELL_COLORS[index % SHELL_COLORS.length]!;
    const twinkle = 1 - 0.5 * drive.high * (0.5 + 0.5 * Math.sin(options.seconds * 9 + index * 1.7));
    const alpha = Math.min(1, options.alpha * limb * (0.35 + 0.65 * point.weight) * (0.75 + 0.5 * band) * twinkle);
    const size = Math.max(0.7, (0.8 + 1.7 * point.weight * limb) * depth * Math.min(1.6, centre.scale * 2.2));
    addDot(target, color, alpha, projected.x, projected.y, size);
    // Fibres: every other point bristles outward, longest where its band is loud and on onsets.
    if (index % 2 === 0 && limb > 0.3) {
      const length = breathe * (0.25 + 1.1 * band + 0.9 * drive.onset * heat) * (0.55 + 0.45 * point.weight);
      const mid = place({
        x: normal.x * (radius + length * 0.5),
        y: normal.y * (radius + length * 0.5),
        z: normal.z * (radius + length * 0.5),
      });
      const tip = place({
        x: normal.x * (radius + length),
        y: normal.y * (radius + length),
        z: normal.z * (radius + length),
      });
      if (mid.visible && tip.visible && !outside(tip.x, tip.y)) {
        const fibreAlpha = 0.45 * limb * (0.45 + band) * options.alpha;
        addLine(target, ORB_FIBER, fibreAlpha, 0.7, projected.x, projected.y, mid.x, mid.y);
        addLine(target, ORB_FIBER, fibreAlpha * 0.4, 0.5, mid.x, mid.y, tip.x, tip.y);
      }
    }
    if (heat > 0.95 && limb > 0.45) {
      sparkle(
        projected.x,
        projected.y,
        (8 + 14 * band) * Math.min(1.4, centre.scale * 2),
        heat > 0.975 ? ORB_WHITE : color,
        alpha * 0.8,
      );
    }
  }

  // A few lights racing round on tilted orbits, dragging tails.
  const speedUp = 1 + 0.8 * drive.level;
  const trailStep = 0.07 * (1 + 1.2 * drive.level);
  for (const particle of particles) {
    const band = levels[particle.band] ?? 0;
    const radius = breathe * particle.reach * (1 + 0.35 * band + 0.5 * drive.onset * (particle.weight > 0.7 ? 1 : 0.4));
    const color = particle.band < 5 ? ORB_PINK : particle.band < 11 ? ORB_VIOLET : ORB_WHITE;
    const head = particle.phase + options.seconds * particle.speed * speedUp;
    const direction = particle.speed > 0 ? -1 : 1;
    let previous: { x: number; y: number } | undefined;
    for (let step = 0; step <= TRAIL_STEPS; step += 1) {
      const local = orbitPosition(particle, head + direction * step * trailStep, radius);
      const point = place(local);
      if (!point.visible || outside(point.x, point.y)) {
        previous = undefined;
        continue;
      }
      const target = local.z < 0 ? layers.front : layers.back;
      if (previous) {
        const fade = (1 - step / (TRAIL_STEPS + 1)) ** 1.6;
        addLine(
          target,
          color,
          fade * (0.3 + 0.5 * band) * options.alpha,
          (0.5 + 1.2 * particle.weight) * Math.min(1.6, point.scale * 1.6),
          previous.x,
          previous.y,
          point.x,
          point.y,
        );
      } else if (step === 0) {
        sparkle(
          point.x,
          point.y,
          (5 + 6 * particle.weight) * Math.min(1.5, point.scale * 2) * (1 + band),
          color,
          (0.4 + 0.5 * band) * options.alpha,
        );
      }
      previous = { x: point.x, y: point.y };
    }
  }

  batch.flush();

  // The black moon: an opaque dark satellite revolving round the orb on a tilted orbit (traced faintly), catching a
  // thin violet rim. On the far side of its orbit the orb's front shell draws over it.
  if (options.moon) {
    const moon = options.moon;
    const path = { reach: 1, tiltX: moon.tilt ?? 0.28, tiltZ: -0.22, speed: moon.speed, phase: 0, band: 0, weight: 1 };
    const distance = options.radius * moon.distance;
    let previous: { x: number; y: number } | undefined;
    for (let step = 0; step <= 64; step += 1) {
      const point = place(orbitPosition(path, (step / 64) * Math.PI * 2, distance));
      if (!point.visible || outside(point.x, point.y)) {
        previous = undefined;
        continue;
      }
      if (previous) {
        layers.back
          .moveTo(previous.x, previous.y)
          .lineTo(point.x, point.y)
          .stroke({ color: ORB_VIOLET, width: 0.75, alpha: 0.18 * options.alpha });
      }
      previous = { x: point.x, y: point.y };
    }
    const orbit = orbitPosition(path, moon.phase + options.seconds * moon.speed, distance);
    const at = place(orbit);
    const r = breathe * moon.size * at.scale;
    if (at.visible && !outside(at.x - r, at.y - r) && !outside(at.x + r, at.y + r)) {
      const g = layers.moon;
      g.circle(at.x, at.y, r).fill({ color: ORB_MOON, alpha: 0.97 * options.alpha });
      // It reflects the orb: the side facing it glows violet → blue in soft bands, a specular glint sits toward the
      // light, and the orb's sparks are mirrored along the lit limb — all brighter when the orb is close and loud.
      const light = reflectedLight(
        centre.x - at.x,
        centre.y - at.y,
        Math.hypot(centre.x - at.x, centre.y - at.y),
        screenRadius,
        Math.max(drive.level, drive.bass),
      );
      const lit = light.strength * options.alpha;
      for (let band = 0; band < 5; band += 1) {
        const spread = 1.25 - band * 0.2;
        const radius = r * (0.93 - band * 0.11);
        g.moveTo(at.x + Math.cos(light.angle - spread) * radius, at.y + Math.sin(light.angle - spread) * radius);
        g.arc(at.x, at.y, radius, light.angle - spread, light.angle + spread).stroke({
          color: band < 2 ? ORB_BLUE : ORB_VIOLET,
          width: r * 0.12,
          alpha: lit * (0.45 - band * 0.07),
        });
      }
      const glintX = at.x + Math.cos(light.angle - 0.35) * r * 0.55;
      const glintY = at.y + Math.sin(light.angle - 0.35) * r * 0.55;
      g.circle(glintX, glintY, r * 0.26).fill({ color: ORB_VIOLET, alpha: 0.3 * lit });
      g.circle(glintX, glintY, r * 0.1).fill({ color: ORB_WHITE, alpha: Math.min(1, 1.1 * lit) });
      for (let spark = 0; spark < 7; spark += 1) {
        const angle = light.angle + (spark - 3) * 0.28 + Math.sin(options.seconds * 1.7 + spark) * 0.05;
        const twinkle = 0.5 + 0.5 * Math.sin(options.seconds * 6 + spark * 2.1);
        g.circle(at.x + Math.cos(angle) * r * 0.8, at.y + Math.sin(angle) * r * 0.8, Math.max(0.6, r * 0.045)).fill({
          color: SHELL_COLORS[spark % SHELL_COLORS.length]!,
          alpha: lit * (0.35 + 0.5 * twinkle * drive.high + 0.2 * twinkle),
        });
      }
      // A faint fresnel rim all the way round.
      g.circle(at.x, at.y, r).stroke({ color: ORB_VIOLET, width: 1, alpha: (0.25 + 0.35 * lit) * options.alpha });
    }
  }
  return { x: centre.x, y: centre.y, radius: screenRadius };
}

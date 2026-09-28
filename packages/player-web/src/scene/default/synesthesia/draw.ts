import type { Graphics } from 'pixi.js';
import { projectPoint, rotateX, rotateY, viewPoint, type CameraPose, type CloudPoint } from './space.ts';
import { SYN_GLASS, SYN_WHITE } from './style.ts';

/**
 * Shared Synesthesia drawing: hairline frames with lock-on corners (Rez's targeting reticle) and projected point
 * clouds. Callers own the `Graphics`; these only append geometry.
 */

/**
 * Rez lock-on reticle: four rounded corner brackets around `(x, y, w, h)` and an optional centre cross. `arm` is the
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

/** A near-black frame with a warm hairline rim and bright lock-on corners — the Rez take on a HUD panel. */
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
      graphics
        .rect(projected.x - halo / 2, projected.y - halo / 2, halo, halo)
        .fill({ color, alpha: Math.min(1, alpha) * 0.12 });
    }
    graphics
      .rect(projected.x - size / 2, projected.y - size / 2, size, size)
      .fill({ color, alpha: Math.min(1, alpha) });
  }
}

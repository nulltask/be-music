import type { Vec3 } from './space.ts';

/** Body length (world units, nose to tail root) and wingspan of a manta at rest. */
const MANTA_LENGTH = 16;
const MANTA_SPAN = 30;
/** Wingbeats per second, and how far (fraction of the span) a wingtip rises and falls. */
const MANTA_BEAT_HZ = 1.1;
const MANTA_FLAP = 0.32;

/** The outline of one manta in world space: nose, wingtips, the tail root, and the end of the tail whip. */
export interface MantaShape {
  nose: Vec3;
  leftTip: Vec3;
  rightTip: Vec3;
  tailRoot: Vec3;
  tailEnd: Vec3;
}

/** A fresh shape to fill with {@link mantaShapeInto} (one per caller, reused every frame). */
export function createMantaShape(): MantaShape {
  const point = (): Vec3 => ({ x: 0, y: 0, z: 0 });
  return { nose: point(), leftTip: point(), rightTip: point(), tailRoot: point(), tailEnd: point() };
}

/**
 * Lays a manta out around `position`, heading along `velocity` (world space, y pointing down), into `out` and returns
 * it. Its wings beat at {@link MANTA_BEAT_HZ} from `phase` (radians, so a school beats out of step) at `seconds`; a
 * `swell` in 0..1 (the kick) spreads the wings wider and beats them harder. A still manta faces +z.
 */
export function mantaShapeInto(
  out: MantaShape,
  position: Vec3,
  velocity: Vec3,
  seconds: number,
  phase: number,
  swell = 0,
): MantaShape {
  const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
  // Heading.
  const dx = speed > 1e-6 ? velocity.x / speed : 0;
  const dy = speed > 1e-6 ? velocity.y / speed : 0;
  const dz = speed > 1e-6 ? velocity.z / speed : 1;
  // Wing axis: heading × world up (0, -1, 0); a manta diving straight up or down falls back to the x axis.
  let sx = dz;
  let sz = -dx;
  const sideLength = Math.hypot(sx, sz);
  if (sideLength < 1e-6) {
    sx = 1;
    sz = 0;
  } else {
    sx /= sideLength;
    sz /= sideLength;
  }
  // The manta's own up: wing axis × heading.
  const ux = -sz * dy;
  const uy = sz * dx - sx * dz;
  const uz = sx * dy;

  const kick = Math.max(0, Math.min(1, swell));
  const span = MANTA_SPAN * (1 + 0.6 * kick);
  const lift = Math.sin(seconds * MANTA_BEAT_HZ * Math.PI * 2 + phase) * MANTA_FLAP * (1 + kick) * span;
  const set = (point: Vec3, along: number, across: number, up: number): void => {
    point.x = position.x + dx * along + sx * across + ux * up;
    point.y = position.y + dy * along + uy * up;
    point.z = position.z + dz * along + sz * across + uz * up;
  };
  set(out.nose, MANTA_LENGTH * 0.5, 0, 0);
  set(out.leftTip, -MANTA_LENGTH * 0.15, -span / 2, lift);
  set(out.rightTip, -MANTA_LENGTH * 0.15, span / 2, lift);
  set(out.tailRoot, -MANTA_LENGTH * 0.4, 0, 0);
  set(out.tailEnd, -MANTA_LENGTH * 1.3, 0, -lift * 0.15);
  return out;
}

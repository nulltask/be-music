import type { LaneCoverState } from '../play-state/lane-cover.ts';
import { AC32_HI_SPEED_BASE, NORMAL_HI_SPEED_GREEN_NUMBERS } from './normal-hi-speed.ts';
import { CLASSIC_HI_SPEED_STEPS } from './hi-speed.ts';

/** AC 32 LM measurements by masaoblue (2025-08-21); this is not an AC 34 calibration. */
export interface FloatingHiSpeedAnchor {
  readonly hiSpeed: number;
  readonly bpm: number;
  readonly visibleFraction: number;
}

/** The source preserves sub-cent precision internally, including its measured 1/300 scratch increment. */
export function clampFloatingHiSpeed(value: number): number | undefined {
  return Number.isFinite(value) ? Math.max(0.5, Math.min(10, value)) : undefined;
}

/** Capture the values at entry, independently of later keyboard adjustments and BPM changes. */
export function captureFloatingHiSpeed(
  hiSpeed: number,
  bpm: number,
  visibleFraction: number,
): FloatingHiSpeedAnchor | undefined {
  if (
    !Number.isFinite(hiSpeed) ||
    hiSpeed <= 0 ||
    !Number.isFinite(bpm) ||
    bpm <= 0 ||
    !Number.isFinite(visibleFraction) ||
    visibleFraction < 0 ||
    visibleFraction > 1
  )
    return undefined;
  return { hiSpeed, bpm, visibleFraction };
}

/** Recalculate on a cover operation, including one already at its boundary; BPM changes alone do not call this. */
export function resolveFloatingHiSpeed(
  anchor: FloatingHiSpeedAnchor,
  bpm: number,
  visibleFraction: number,
): number | undefined {
  if (
    !captureFloatingHiSpeed(anchor.hiSpeed, anchor.bpm, anchor.visibleFraction) ||
    !Number.isFinite(bpm) ||
    bpm <= 0 ||
    !Number.isFinite(visibleFraction) ||
    visibleFraction < 0 ||
    visibleFraction > 1
  )
    return undefined;
  const initialGreen = (AC32_HI_SPEED_BASE / anchor.hiSpeed / anchor.bpm) * anchor.visibleFraction;
  const speed =
    initialGreen <= 10
      ? (AC32_HI_SPEED_BASE / 10 / bpm) * visibleFraction
      : (((anchor.hiSpeed * visibleFraction) / anchor.visibleFraction) * anchor.bpm) / bpm;
  return clampFloatingHiSpeed(speed);
}

/** Keyboard: 0.5 per press. Uncovered scratch: 1/300 per measured tick. Clipping restarts from the boundary. */
export function stepFloatingHiSpeed(hiSpeed: number, direction: number, fine = false): number | undefined {
  if (!Number.isFinite(hiSpeed) || !Number.isFinite(direction)) return undefined;
  return clampFloatingHiSpeed(hiSpeed + Math.sign(direction) * (fine ? 1 / 300 : 0.5));
}

/** Source exit rounding differs from ordinary host edits: classic ties go up; normal has 50-green bands. */
export function resolveFloatingHiSpeedExit(
  hiSpeed: number,
  bpm: number,
  classic: boolean,
): { hiSpeed: number; normalLevel?: number } | undefined {
  if (!Number.isFinite(hiSpeed) || hiSpeed <= 0 || !Number.isFinite(bpm) || bpm <= 0) return undefined;
  if (classic) {
    const nearest = CLASSIC_HI_SPEED_STEPS.reduce((best, candidate) =>
      Math.abs(candidate - hiSpeed) <= Math.abs(best - hiSpeed) ? candidate : best,
    );
    return { hiSpeed: nearest };
  }
  const green = Math.ceil(AC32_HI_SPEED_BASE / hiSpeed / bpm);
  let index = 0;
  for (let next = 1; next < NORMAL_HI_SPEED_GREEN_NUMBERS.length; next += 1) {
    const upper = NORMAL_HI_SPEED_GREEN_NUMBERS[next - 1]!;
    const lower = NORMAL_HI_SPEED_GREEN_NUMBERS[next]!;
    const boundary = upper - lower === 50 ? lower + 30 : (upper + lower) / 2;
    if (green > boundary) break;
    index = next;
  }
  return { hiSpeed: AC32_HI_SPEED_BASE / NORMAL_HI_SPEED_GREEN_NUMBERS[index]! / bpm, normalLevel: index + 1 };
}

/** Measured 723-pixel AC lane: SUDDEN+ retains 30..723 pixels, LIFT 0..600, with no overlap while shown. */
export function normalizeFloatingLaneCover(cover: LaneCoverState): LaneCoverState {
  const lift = Math.max(0, Math.min(600, Math.round((Number.isFinite(cover.lift) ? cover.lift : 0) * 723))) / 723;
  const suddenMax = (cover.liftOn ?? false) ? 723 - Math.round(lift * 723) : 723;
  const sudden =
    Math.max(30, Math.min(suddenMax, Math.round((Number.isFinite(cover.sudden) ? cover.sudden : 0) * 723))) / 723;
  return { ...cover, absolute: true, lift, sudden };
}

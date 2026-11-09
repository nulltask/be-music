/**
 * Feedback for a held long note: a stream of sparks rising from the judgement line for as long as the note is held.
 * Computed from the hold's age alone, like every other skin effect, so a frame can be redrawn from scratch: sparks are
 * born at a fixed interval, each rises and fades over its life, and a seed per hold keeps their jitter steady from
 * frame to frame.
 */
import { hash01 } from './motion.ts';

/** One spark, relative to the lane's centre on the judgement line. */
export interface HoldSpark {
  /** Sideways offset from the lane's centre, in pixels. */
  offsetX: number;
  /** How far above the judgement line, in pixels. */
  rise: number;
  /** 1 when born, fading to 0 at the end of its life. */
  alpha: number;
  /** Side of the spark's square, in pixels. */
  size: number;
}

export interface HoldSparkOptions {
  /** One spark is born every `intervalMs`. Default 45. */
  intervalMs?: number;
  /** How long a spark lives. Default 520. */
  lifeMs?: number;
  /** Rise speed in pixels per millisecond, before each spark's own jitter. Default 0.18. */
  riseSpeed?: number;
  /** Share of the lane's width the sparks spread over. Default 0.8. */
  spread?: number;
  /**
   * Highest a spark may rise, in pixels: how far the held long note reaches above the judgement line (the lane's
   * `bottom - holdTop`), so the sparks stay on the note and never cover its end. A spark fades over the last
   * {@link HOLD_SPARK_CEILING_FADE} pixels below it and is gone above it. Unlimited by default.
   */
  maxRise?: number;
}

/** Pixels under {@link HoldSparkOptions.maxRise} over which a rising spark fades out. */
export const HOLD_SPARK_CEILING_FADE = 16;

/**
 * The sparks alive `holdAgeMs` after a hold began on a lane `width` pixels wide. At most `lifeMs / intervalMs + 1`
 * sparks, oldest first; none before the hold begins.
 */
export function holdSparks(
  holdAgeMs: number,
  seed: number,
  width: number,
  options: HoldSparkOptions = {},
): HoldSpark[] {
  const intervalMs = options.intervalMs ?? 45;
  const lifeMs = options.lifeMs ?? 520;
  const riseSpeed = options.riseSpeed ?? 0.18;
  const spread = options.spread ?? 0.8;
  const maxRise = options.maxRise ?? Number.POSITIVE_INFINITY;
  if (!(holdAgeMs >= 0) || intervalMs <= 0 || lifeMs <= 0) return [];
  const first = Math.max(0, Math.ceil((holdAgeMs - lifeMs) / intervalMs));
  const last = Math.floor(holdAgeMs / intervalMs);
  const sparks: HoldSpark[] = [];
  for (let index = first; index <= last; index += 1) {
    const ageMs = holdAgeMs - index * intervalMs;
    const life = ageMs / lifeMs;
    if (life >= 1) continue;
    const rise = riseSpeed * ageMs * (0.7 + 0.6 * hash01(seed * 131 + index));
    if (!(rise < maxRise)) continue;
    sparks.push({
      offsetX: (hash01(seed * 97 + index) - 0.5) * width * spread,
      rise,
      alpha: (1 - life) ** 1.5 * Math.min(1, (maxRise - rise) / HOLD_SPARK_CEILING_FADE),
      size: (1.5 + 2 * hash01(seed * 53 + index)) * (1 - life * 0.5),
    });
  }
  return sparks;
}

/**
 * Where a spark `size` pixels across, aimed at x `x`, sits so it stays inside a lane (or held note) `width` pixels wide
 * from `left`: its centre is clamped to the span its edges allow, or set on the middle when it is wider than the lane.
 * Pure.
 */
export function clampHoldSparkX(x: number, size: number, left: number, width: number): number {
  const half = size / 2;
  if (size >= width) return left + width / 2;
  return Math.min(left + width - half, Math.max(left + half, x));
}

/** A steady seed for one hold: its lane and when it began, so two holds on a lane never share their sparks. */
export function holdSeed(channel: string, startedAtMs: number): number {
  let seed = Math.floor(startedAtMs) % 100_003;
  for (let index = 0; index < channel.length; index += 1) seed = (seed * 31 + channel.charCodeAt(index)) % 1_000_003;
  return seed;
}

/** How long a long note's centre line takes to fade out after the player lets go early. */
export const LONG_NOTE_CENTRE_LINE_FADE_MS = 300;

/**
 * Opacity factor (0..1) of a long note's centre line `releasedElapsedMs` after the player let go early: full while the
 * note is held or untouched (`undefined`), then a linear fade to nothing over {@link LONG_NOTE_CENTRE_LINE_FADE_MS}.
 */
export function longNoteCentreLineAlpha(releasedElapsedMs: number | undefined): number {
  if (releasedElapsedMs === undefined || !(releasedElapsedMs > 0)) return 1;
  return Math.max(0, 1 - releasedElapsedMs / LONG_NOTE_CENTRE_LINE_FADE_MS);
}

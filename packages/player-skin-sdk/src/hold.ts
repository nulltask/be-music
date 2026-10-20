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
}

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
  if (!(holdAgeMs >= 0) || intervalMs <= 0 || lifeMs <= 0) return [];
  const first = Math.max(0, Math.ceil((holdAgeMs - lifeMs) / intervalMs));
  const last = Math.floor(holdAgeMs / intervalMs);
  const sparks: HoldSpark[] = [];
  for (let index = first; index <= last; index += 1) {
    const ageMs = holdAgeMs - index * intervalMs;
    const life = ageMs / lifeMs;
    if (life >= 1) continue;
    sparks.push({
      offsetX: (hash01(seed * 97 + index) - 0.5) * width * spread,
      rise: riseSpeed * ageMs * (0.7 + 0.6 * hash01(seed * 131 + index)),
      alpha: (1 - life) ** 1.5,
      size: (1.5 + 2 * hash01(seed * 53 + index)) * (1 - life * 0.5),
    });
  }
  return sparks;
}

/** A steady seed for one hold: its lane and when it began, so two holds on a lane never share their sparks. */
export function holdSeed(channel: string, startedAtMs: number): number {
  let seed = Math.floor(startedAtMs) % 100_003;
  for (let index = 0; index < channel.length; index += 1) seed = (seed * 31 + channel.charCodeAt(index)) % 1_000_003;
  return seed;
}

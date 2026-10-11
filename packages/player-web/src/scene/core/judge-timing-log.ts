import type { BeMusicJudge, BeMusicJudgeTiming } from '@be-music/skin-sdk';

/** How many judgements {@link JudgeTimingLog.recent} keeps. */
export const RECENT_JUDGE_TIMING_COUNT = 64;

const JUDGES: ReadonlySet<string> = new Set<BeMusicJudge>(['PERFECT', 'GREAT', 'GOOD', 'BAD', 'POOR']);

/**
 * The timed judgements of one play: every one of them ({@link all}, for the result screen) and the latest
 * {@link RECENT_JUDGE_TIMING_COUNT} ({@link recent}, for live timing meters). The recent ones sit in a ring buffer and
 * their oldest-first view is rebuilt in place only when a judgement arrives, so reading it every frame allocates
 * nothing.
 */
export class JudgeTimingLog {
  private readonly ring: BeMusicJudgeTiming[] = [];
  private readonly recentView: BeMusicJudgeTiming[] = [];
  private head = 0;
  private dirty = false;
  private allTimings: BeMusicJudgeTiming[] = [];
  private latest: number | undefined;
  private readonly capacity: number;

  // A plain field rather than a parameter property: the benchmarks run this file through Node's type stripping, which
  // only accepts erasable syntax.
  constructor(capacity = RECENT_JUDGE_TIMING_COUNT) {
    this.capacity = capacity;
  }

  /**
   * Records one judgement. Ignored (returns `false`) when it carries no finite timing or its grade isn't one of
   * PERFECT / GREAT / GOOD / BAD / POOR.
   */
  push(atMs: number, judge: string, deltaMs: number | undefined, channel?: string): boolean {
    if (deltaMs === undefined || !Number.isFinite(deltaMs) || !JUDGES.has(judge)) return false;
    const timing: BeMusicJudgeTiming = { atMs, deltaMs, judge: judge as BeMusicJudge };
    if (channel !== undefined) timing.channel = channel;
    this.allTimings.push(timing);
    this.latest = deltaMs;
    if (this.ring.length < this.capacity) {
      this.ring.push(timing);
    } else {
      this.ring[this.head] = timing;
      this.head = (this.head + 1) % this.capacity;
    }
    this.dirty = true;
    return true;
  }

  /** Signed offset (ms) of the latest recorded judgement, or `undefined` before the first. */
  get lastDeltaMs(): number | undefined {
    return this.latest;
  }

  /** The latest judgements, oldest first. The same array every call: read it, never keep it across judgements. */
  get recent(): readonly BeMusicJudgeTiming[] {
    if (this.dirty) {
      const { ring, head, recentView } = this;
      recentView.length = ring.length;
      for (let index = 0; index < ring.length; index += 1) {
        recentView[index] = ring[(head + index) % ring.length]!;
      }
      this.dirty = false;
    }
    return this.recentView;
  }

  /** Every recorded judgement of the play, oldest first. */
  get all(): readonly BeMusicJudgeTiming[] {
    return this.allTimings;
  }

  /** Forgets everything, for a new play. {@link all} becomes a fresh array, so a previous play's list stays intact. */
  clear(): void {
    this.ring.length = 0;
    this.recentView.length = 0;
    this.head = 0;
    this.dirty = false;
    this.allTimings = [];
    this.latest = undefined;
  }
}

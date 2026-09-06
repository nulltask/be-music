import type { GaugeSpec } from './definitions.ts';

/**
 * Judge indices used by every ruleset gauge table, matching beatoraja's ordering:
 * `0` PGREAT / `1` GREAT / `2` GOOD / `3` BAD / `4` missed POOR / `5` empty POOR.
 */
export const GAUGE_JUDGE_PGREAT = 0;
export const GAUGE_JUDGE_GREAT = 1;
export const GAUGE_JUDGE_GOOD = 2;
export const GAUGE_JUDGE_BAD = 3;
export const GAUGE_JUDGE_MISS_POOR = 4;
export const GAUGE_JUDGE_EMPTY_POOR = 5;

export type GaugeJudgeIndex = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * A gauge running under one ruleset's {@link GaugeSpec}.
 *
 * Shared by the live engine and the play-log simulator so a replayed run and the run that produced it agree to the
 * last decimal. The spec already carries the per-judge deltas with the ruleset's TOTAL modifier folded in; this
 * class only applies the runtime parts: low-gauge damage softening (`guts`), clamping, the LR2 death border, and
 * the survival-gauge "0 % is permanent" latch.
 */
export class RulesetGauge {
  value: number;
  /** Set once a survival gauge has bottomed out. The run keeps judging; the gauge stays dead. */
  failedMidPlay = false;
  private dead = false;
  readonly spec: GaugeSpec;

  constructor(spec: GaugeSpec) {
    this.spec = spec;
    this.value = spec.initial;
  }

  /** Applies one judgment. `rate` scales the delta (HCN hold ticks use a fraction of a GREAT / BAD). */
  applyJudge(judge: GaugeJudgeIndex, rate = 1): void {
    if (this.dead) return;
    let delta = this.spec.values[judge]! * rate;
    if (delta < 0) {
      for (const step of this.spec.guts) {
        if (step.inclusive === true ? this.value <= step.threshold : this.value < step.threshold) {
          delta *= step.multiplier;
          break;
        }
      }
    }
    this.set(this.value + delta);
  }

  /**
   * Applies a raw percentage delta that bypasses the per-judge table, the guts softening, and the TOTAL modifier —
   * landmine damage is specified directly as a gauge percentage in every ruleset.
   */
  applyRawDelta(delta: number): void {
    if (this.dead) return;
    this.set(this.value + delta);
  }

  cleared(): boolean {
    if (this.spec.survival) {
      return !this.failedMidPlay && this.value > 0;
    }
    return this.value >= this.spec.border;
  }

  private set(next: number): void {
    let value = Math.min(this.spec.max, Math.max(this.spec.min, next));
    if (this.spec.death !== undefined && value < this.spec.death) {
      value = 0;
    }
    if (this.spec.survival && value <= 0) {
      value = 0;
      this.dead = true;
      this.failedMidPlay = true;
    }
    this.value = value;
  }
}

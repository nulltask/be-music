import type { GaugeSpec } from './definitions.ts';

/**
 * Judgment indices used by every ruleset gauge table, matching beatoraja's ordering:
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
 * Shared by the live engine and the replay simulator so a replayed run and the run that produced it agree to the
 * last decimal. The spec already carries the per-judge deltas with the ruleset's TOTAL modifier folded in; this
 * class only applies the runtime parts: low-gauge damage softening (`guts`), clamping, the LR2 death border, and
 * the survival-gauge "0 % is permanent" latch.
 */
export class RulesetGauge {
  value: number;
  /** Set once a survival gauge has bottomed out. The run keeps judging; the gauge stays dead. */
  failedMidPlay = false;
  private dead = false;
  private activeSpec: GaugeSpec;

  get spec(): GaugeSpec {
    return this.activeSpec;
  }
  private fallback: RulesetGauge | undefined;
  private bank: RulesetGauge[] | undefined;
  private selectedIndex = 0;
  private bottomIndex = 0;

  /** Raw units for every parallel gauge; immutable snapshots keep course carries independent. */
  get values(): Record<string, number> | undefined {
    return this.bank && Object.fromEntries(this.bank.map((gauge) => [gauge.spec.id, gauge.value]));
  }

  constructor(spec: GaugeSpec, fallbackSpec?: GaugeSpec, bank?: { specs: readonly GaugeSpec[]; bottomIndex: number }) {
    if (bank !== undefined) {
      this.bank = bank.specs.map((value) => new RulesetGauge(value));
      this.selectedIndex = Math.max(
        0,
        bank.specs.findIndex((value) => value.id === spec.id),
      );
      this.bottomIndex = bank.bottomIndex;
    }
    if (fallbackSpec !== undefined && fallbackSpec.id !== spec.id) this.fallback = new RulesetGauge(fallbackSpec);
    this.activeSpec = spec;
    this.value = spec.initial;
    if (spec.survival && spec.initial <= 0) {
      this.dead = true;
      this.failedMidPlay = true;
    }
    if (this.bank !== undefined) this.selectBest();
  }

  /** Applies one judgment. `rate` scales the delta (HCN hold ticks use a fraction of a GREAT / BAD). */
  applyJudge(judge: GaugeJudgeIndex, rate = 1): void {
    if (this.bank !== undefined) {
      for (const gauge of this.bank) gauge.applyJudge(judge, rate);
      this.selectBest();
      return;
    }
    // beatoraja GrooveGauge.update updates the hidden gauge too, including on the fatal judgment.
    this.fallback?.applyJudge(judge, rate);
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
    this.selectFallback();
  }

  /**
   * Applies a raw percentage delta that bypasses the per-judge table, the guts softening, and the TOTAL modifier —
   * landmine damage is specified directly as a gauge percentage in every ruleset.
   */
  applyRawDelta(delta: number): void {
    if (this.bank !== undefined) {
      for (const gauge of this.bank) gauge.applyRawDelta(delta);
      this.selectBest();
      return;
    }
    this.fallback?.applyRawDelta(delta);
    if (this.dead) return;
    this.set(this.value + delta);
    this.selectFallback();
  }

  /**
   * Empties the gauge for good — below the spec's floor — and ignores every later judgment. LR2 does this when a play
   * ends with notes still unjudged after a negative-BPM reversal (`HP = 0`, OpenLR2 `LR2f.cpp:12980-12982`), so the
   * run is always FAILED. Not a mid-play survival death: `failedMidPlay` stays as it was.
   */
  drainToZero(): void {
    this.fallback = undefined;
    for (const gauge of this.bank ?? []) gauge.drainToZero();
    this.value = 0;
    this.dead = true;
  }

  cleared(): boolean {
    if (this.spec.survival) {
      return !this.failedMidPlay && this.value > 0;
    }
    return this.value >= this.spec.border;
  }

  /** BMSPlayer 0.8.9: highest positive qualified gauge; retain the lower-bound gauge when none qualifies. */
  private selectBest(): void {
    const bank = this.bank!;
    let selected = Math.min(this.selectedIndex, this.bottomIndex);
    for (let index = selected; index < bank.length; index++) {
      if (bank[index]!.value > 0 && bank[index]!.cleared()) selected = index;
    }
    this.selectedIndex = selected;
    const gauge = bank[selected]!;
    this.activeSpec = gauge.spec;
    this.value = gauge.value;
    this.dead = gauge.dead;
    this.failedMidPlay = gauge.failedMidPlay;
  }

  /** Source BMSPlayer: at zero switch to NORMAL's existing value, never refill it from survival HP. */
  private selectFallback(): void {
    if (this.value !== 0 || this.fallback === undefined) return;
    const fallback = this.fallback;
    this.fallback = undefined;
    this.activeSpec = fallback.spec;
    this.value = fallback.value;
    this.dead = fallback.dead;
    this.failedMidPlay = fallback.failedMidPlay;
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

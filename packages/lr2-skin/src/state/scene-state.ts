/**
 * What an LR2 skin reads of a scene: the ops that hold, and the value each `#SRC_NUMBER`, `#SRC_TEXT` and `#SRC_SLIDER`
 * draws. A resolver builds one from the scene's models; the renderer asks it for the ids the skin draws. `undefined`
 * leaves an element undrawn, as LR2 leaves a value it does not bind.
 */
export interface LR2SceneState {
  /** The ops (`dst_option`) that hold. Op 0 always holds and a negated op tests for absence: the renderer's part. */
  readonly ops: ReadonlySet<number>;
  /** The value a `#SRC_NUMBER` with this `num` draws (`LR2_NUM`). */
  number(num: number): number | undefined;
  /** The string a `#SRC_TEXT` with this `st` draws (`LR2_TEXT`). */
  text(st: number): string | undefined;
  /** Where a `#SRC_SLIDER` of this `type` sits along its range, 0..1 (`LR2_SLIDER`). */
  slider(type: number): number | undefined;
}

/**
 * The wall-clock time a skin shows (numbers 21-26), read by the host: the resolvers read no clock. `month` is 1-12, as
 * LR2 draws it.
 */
export interface LR2Clock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/**
 * LR2 timers to start and stop for a moment of a scene, as data: each started timer with the time it starts at (on the
 * clock the scene stamps its timers with), and the timers that stop. A timer that starts again restarts.
 */
export interface LR2TimerUpdate {
  readonly start: ReadonlyMap<number, number>;
  readonly stop: readonly number[];
}

/** An update that changes no timer. */
export const LR2_NO_TIMER_UPDATE: LR2TimerUpdate = { start: new Map(), stop: [] };

/** An update that starts `timers`, each at `at`, and stops `stop`. */
export function lr2TimerUpdate(timers: readonly number[], at: number, stop: readonly number[] = []): LR2TimerUpdate {
  return { start: new Map(timers.map((timer) => [timer, at])), stop };
}

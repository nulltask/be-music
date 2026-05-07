import { signal } from 'alien-signals';

type WritableSignal<T> = {
  (): T;
  (value: T): void;
};

export interface PlayerJudgeComboSignalState {
  judge: string;
  combo: number;
  channel?: string;
  /**
   * Hit timing offset for THIS judgement, in milliseconds. **Sign convention** matches the
   * engine's `signedDeltaMs`: positive = LATE (player pressed AFTER the note's nominal time —
   * this increments `summary.slow`), negative = EARLY (before the note — increments
   * `summary.fast`). `undefined` for synthetic publishes that carry no real timing — `READY`
   * resets, AUTO PLAY rebroadcasts (which are by definition timing-perfect), BAD/POOR verdicts
   * triggered by non-press events (mine hits, miss-without-press). Drives `timingvisualizer[]`
   * skin elements.
   */
  deltaMs?: number;
  updatedAtMs: number;
}

export interface PlayerStateSignals {
  readonly paused: WritableSignal<boolean>;
  readonly highSpeed: WritableSignal<number>;
  readonly judgeComboTick: WritableSignal<number>;
  /**
   * Returns the latest judge-combo state (legacy "single latch" view of the bus). Preserved for callers that
   * only care about the current combo / latest judge kind for HUD readout. New code that needs to react to
   * **every** publish — e.g. firing one bomb sprite per simultaneously-judged note in an AUTO PLAY chord —
   * should use {@link drainPendingJudgeCombos} instead, which returns every publish since the previous drain
   * in publish order.
   */
  getJudgeCombo: () => Readonly<PlayerJudgeComboSignalState>;
  /**
   * Returns every `publishJudgeCombo` event that has fired since the previous call, in publish order, then
   * clears the internal queue. Used by UI runtimes to fan out per-judge visual effects (lane bombs, NOWJUDGE
   * plate restarts, FC timer evaluations) without losing intermediate publishes when several judgements
   * resolve in the same engine tick — which is exactly what happens for AUTO PLAY chords, where one tick
   * can resolve a 2..7-note simultaneous-press in a single drain pass. Without the queue, a `getJudgeCombo()`
   * peek inside `drainWebUiSignals` only sees the LAST publish in the tick, so only one of the chord's
   * notes gets a bomb / FC update. With the queue, every publish surfaces.
   */
  drainPendingJudgeCombos: () => Readonly<PlayerJudgeComboSignalState>[];
  setPaused: (value: boolean) => void;
  setHighSpeed: (value: number) => void;
  publishJudgeCombo: (judge: string, combo: number, channel?: string, updatedAtMs?: number, deltaMs?: number) => void;
}

export function createPlayerStateSignals(initialHighSpeed: number): PlayerStateSignals {
  const paused = signal(false);
  const highSpeed = signal(initialHighSpeed);
  const judgeComboTick = signal(0);
  const judgeComboState: PlayerJudgeComboSignalState = {
    judge: 'READY',
    combo: 0,
    updatedAtMs: 0,
  };
  // Per-publish queue. Each `publishJudgeCombo` call pushes a frozen snapshot here so callers that drain the
  // bus see every individual judgement, not just the most recent one. Drained on `drainPendingJudgeCombos()`.
  const pendingJudgeCombos: PlayerJudgeComboSignalState[] = [];

  const setPaused = (value: boolean): void => {
    if (paused() === value) {
      return;
    }
    paused(value);
  };

  const setHighSpeed = (value: number): void => {
    if (highSpeed() === value) {
      return;
    }
    highSpeed(value);
  };

  const publishJudgeCombo = (
    judge: string,
    combo: number,
    channel?: string,
    updatedAtMs = Date.now(),
    deltaMs?: number,
  ): void => {
    const sanitizedCombo = Math.max(0, Math.floor(combo));
    const sanitizedDeltaMs = typeof deltaMs === 'number' && Number.isFinite(deltaMs) ? deltaMs : undefined;
    judgeComboState.judge = judge;
    judgeComboState.combo = sanitizedCombo;
    judgeComboState.channel = channel;
    judgeComboState.deltaMs = sanitizedDeltaMs;
    judgeComboState.updatedAtMs = updatedAtMs;
    // Push a fresh snapshot rather than the shared `judgeComboState` reference — a queued consumer that drains
    // late should still see the publish's exact `judge` / `combo` / `channel` / `deltaMs` values, even if
    // subsequent publishes have since overwritten the latch.
    pendingJudgeCombos.push({ judge, combo: sanitizedCombo, channel, deltaMs: sanitizedDeltaMs, updatedAtMs });
    judgeComboTick(judgeComboTick() + 1);
  };

  const drainPendingJudgeCombos = (): Readonly<PlayerJudgeComboSignalState>[] => {
    if (pendingJudgeCombos.length === 0) {
      return [];
    }
    const drained = pendingJudgeCombos.slice();
    pendingJudgeCombos.length = 0;
    return drained;
  };

  return {
    paused,
    highSpeed,
    judgeComboTick,
    getJudgeCombo: () => judgeComboState,
    drainPendingJudgeCombos,
    setPaused,
    setHighSpeed,
    publishJudgeCombo,
  };
}

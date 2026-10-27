import { setEngineScheduler, type EngineScheduler } from '../engine-clock.ts';

/**
 * Test support: a virtual clock the engine can run a play on (`setEngineScheduler`). Time only moves when the play has
 * nothing left to do but wait: {@link VirtualClock.run} lets every pending microtask settle, then jumps to the earliest
 * timer and fires it. Timers fire exactly when due, in the order they are due (then in the order they were set), so a
 * play on this clock is deterministic and takes no longer than its CPU time.
 */
export interface VirtualClock extends EngineScheduler {
  /**
   * Runs `play` on this clock until it settles, and resolves or rejects as it does. The engine reads its time from the
   * clock only while a run is going on.
   */
  run<T>(play: () => Promise<T>): Promise<T>;
  /** Calls `callback` at virtual time `atMs` (now if that has passed). */
  at(atMs: number, callback: () => void): () => void;
}

export interface VirtualClockOptions {
  /** `wallClockNow()` at virtual time 0. */
  wallClockOriginMs?: number;
  /** A run that reaches this virtual time fails, so a play that never ends cannot hang the test. Default 10 minutes. */
  limitMs?: number;
}

interface VirtualTimer {
  atMs: number;
  seq: number;
  callback: () => void;
}

/** Real turns of the event loop a run waits for something outside the clock (a module load, say) before it fails. */
const MAX_IDLE_TURNS = 200;

const hostTimers = globalThis as {
  setImmediate?: (callback: () => void) => unknown;
};

/** One real turn of the event loop: every pending microtask has run by the time it resolves. */
function nextTurn(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof hostTimers.setImmediate === 'function') {
      hostTimers.setImmediate(resolve);
    } else {
      setTimeout(resolve, 0);
    }
  });
}

export function createVirtualClock(options: VirtualClockOptions = {}): VirtualClock {
  const wallClockOriginMs = options.wallClockOriginMs ?? 1_700_000_000_000;
  const limitMs = options.limitMs ?? 600_000;
  let nowMs = 0;
  let nextSeq = 0;
  const timers: VirtualTimer[] = [];

  const schedule = (atMs: number, callback: () => void): (() => void) => {
    const timer: VirtualTimer = { atMs: Math.max(nowMs, atMs), seq: nextSeq++, callback };
    timers.push(timer);
    return () => {
      const index = timers.indexOf(timer);
      if (index >= 0) timers.splice(index, 1);
    };
  };

  const takeNextTimer = (): VirtualTimer | undefined => {
    let best = -1;
    for (let index = 0; index < timers.length; index += 1) {
      const timer = timers[index]!;
      const current = timers[best];
      if (
        current === undefined ||
        timer.atMs < current.atMs ||
        (timer.atMs === current.atMs && timer.seq < current.seq)
      ) {
        best = index;
      }
    }
    return best < 0 ? undefined : timers.splice(best, 1)[0];
  };

  const clock: VirtualClock = {
    now: () => nowMs,
    wallClockNow: () => wallClockOriginMs + nowMs,
    setTimeout: (callback, ms) => schedule(nowMs + Math.max(0, Number.isFinite(ms) ? ms : 0), callback),
    setImmediate: (callback) => schedule(nowMs, callback),
    at: (atMs, callback) => schedule(atMs, callback),
    run: async (play) => {
      setEngineScheduler(clock);
      try {
        let settled = false;
        const result = play();
        result.then(
          () => {
            settled = true;
          },
          () => {
            settled = true;
          },
        );
        let idleTurns = 0;
        while (!settled) {
          await nextTurn();
          if (settled) break;
          const timer = takeNextTimer();
          if (timer === undefined) {
            idleTurns += 1;
            if (idleTurns > MAX_IDLE_TURNS) {
              throw new Error('The play is waiting, but nothing is scheduled on the virtual clock.');
            }
            continue;
          }
          idleTurns = 0;
          nowMs = Math.max(nowMs, timer.atMs);
          if (nowMs > limitMs) {
            throw new Error(`The play ran past ${limitMs} ms of virtual time.`);
          }
          timer.callback();
        }
        return await result;
      } finally {
        timers.length = 0;
        setEngineScheduler(undefined);
      }
    },
  };
  return clock;
}

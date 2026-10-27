import { type AudioSession } from './engine-types.ts';

/**
 * The playback clock and the wall-clock helpers the drivers wait and stamp inputs with.
 */

/**
 * Where the engine reads the time and waits: the drivers' clock without an audio clock, their sleeps and waits, the
 * input wake-up's timeouts and the `pressedAt` correction all go through it. The host scheduler reads `performance` and
 * uses the host's timers. A test can swap in a virtual clock with {@link setEngineScheduler} to run plays
 * deterministically and faster than real time (`core/characterization/virtual-clock.ts`). Internal: no package entry
 * point exports it.
 */
export interface EngineScheduler {
  /** Monotonic milliseconds, the domain of `performance.now()`. */
  now(): number;
  /**
   * Wall-clock milliseconds shared across threads (`performance.timeOrigin + performance.now()`), the domain of an input
   * command's `pressedAt`.
   */
  wallClockNow(): number;
  /** Calls `callback` after `ms` milliseconds, like `setTimeout`. Returns a function that cancels it. */
  setTimeout(callback: () => void, ms: number): () => void;
  /** Calls `callback` on the next turn of the event loop, like `setImmediate`. Returns a function that cancels it. */
  setImmediate(callback: () => void): () => void;
}

const hostEngineScheduler: EngineScheduler = {
  now: () => performance.now(),
  wallClockNow: () => performance.timeOrigin + performance.now(),
  setTimeout: (callback, ms) => {
    const handle = setTimeout(callback, ms);
    return () => clearTimeout(handle);
  },
  setImmediate: (callback) => {
    const timers = globalThis as {
      setImmediate?: (callback: () => void) => unknown;
      clearImmediate?: (handle: unknown) => void;
    };
    if (typeof timers.setImmediate === 'function') {
      const handle = timers.setImmediate(callback);
      return () => timers.clearImmediate?.(handle);
    }
    const handle = setTimeout(callback, 0);
    return () => clearTimeout(handle);
  },
};

let activeEngineScheduler: EngineScheduler = hostEngineScheduler;

/** The scheduler the engine runs on now: the host's, unless a test swapped in its own. */
export function getEngineScheduler(): EngineScheduler {
  return activeEngineScheduler;
}

/**
 * Test-only: makes the engine read the time and wait through `scheduler` (`undefined` restores the host's). The
 * engine reads it on every call, so swap it only while no play is running.
 */
export function setEngineScheduler(scheduler: EngineScheduler | undefined): void {
  activeEngineScheduler = scheduler ?? hostEngineScheduler;
}

// Resolves after `ms` milliseconds (`node:timers/promises.setTimeout` without the Node import).
export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    activeEngineScheduler.setTimeout(resolve, ms);
  });

export interface PlaybackClock {
  nowMs: () => number;
  scheduledMs: () => number;
  isPaused: () => boolean;
  pause: () => boolean;
  resume: () => boolean;
  /** The source's reading (ms) at which the clock reads `clockMs`, as the clock runs now (paused time left out). */
  sourceMsAt: (clockMs: number) => number;
}

/** What a {@link PlaybackClock} runs on: the audio session's output clock, or the engine scheduler's. */
export interface PlaybackClockSource {
  nowMs: () => number;
  scheduledMs?: () => number;
}

export const TUI_FRAME_INTERVAL_MS: number = 1000 / 60;

export const PAUSE_POLL_INTERVAL_MS = 16;

export const REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS = 1e-6;

function createPerformancePlaybackClockSource(): PlaybackClockSource {
  return {
    nowMs: () => activeEngineScheduler.now(),
  };
}

export function createAudioPlaybackClockSource(audioSession: AudioSession | undefined): PlaybackClockSource {
  if (!audioSession?.getClockState) {
    return createPerformancePlaybackClockSource();
  }
  return {
    // Keep gameplay on the audible clock while exposing the buffered write head separately.
    nowMs: () => audioSession.getClockState!().outputSeconds * 1000,
    scheduledMs: () => {
      const clockState = audioSession.getClockState!();
      return Math.max(clockState.outputSeconds, clockState.scheduledSeconds) * 1000;
    },
  };
}

export function createPlaybackClock(source: PlaybackClockSource, startOffsetMs = 0): PlaybackClock {
  const sourceScheduledMs = source.scheduledMs ?? source.nowMs;
  const anchorMs = source.nowMs() + (Number.isFinite(startOffsetMs) ? startOffsetMs : 0);
  let paused = false;
  let pausedScheduledMs = 0;
  let pauseSourceMs = 0;
  let pausedSourceDurationMs = 0;

  const resolveNowMs = (): number => {
    const referenceSourceMs = paused ? pauseSourceMs : source.nowMs();
    return Math.max(0, referenceSourceMs - anchorMs - pausedSourceDurationMs);
  };

  const resolveScheduledMs = (): number => {
    if (paused) {
      return pausedScheduledMs;
    }
    const scheduledSourceMs = Math.max(source.nowMs(), sourceScheduledMs());
    return Math.max(0, scheduledSourceMs - anchorMs - pausedSourceDurationMs);
  };

  const nowMs = (): number => resolveNowMs();

  return {
    nowMs,
    scheduledMs: () => resolveScheduledMs(),
    isPaused: () => paused,
    sourceMsAt: (clockMs) => clockMs + anchorMs + pausedSourceDurationMs,
    pause: () => {
      if (paused) {
        return false;
      }
      paused = true;
      pauseSourceMs = source.nowMs();
      pausedScheduledMs = resolveScheduledMs();
      return true;
    },
    resume: () => {
      if (!paused) {
        return false;
      }
      pausedSourceDurationMs += Math.max(0, source.nowMs() - pauseSourceMs);
      paused = false;
      pausedScheduledMs = 0;
      pauseSourceMs = 0;
      return true;
    },
  };
}

/**
 * Adjusts a drain-time playback timestamp backwards by the wall-clock delta between the OS-level press event and
 * now, so judging a queued lane-input resolves against the player's actual press timing rather than the engine's
 * next-tick drain time. Without this, a press that lands a few ms before the next 60 Hz tick gets judged up to
 * ~16 ms late even though the player hit the note on time. With it, the judge timestamp matches the physical
 * press to within event-handler latency (= ~1–3 ms on typical hardware).
 *
 * `pressedAt` is in the **wall-clock-ms domain** (`Date.now()`-equivalent, but with sub-ms precision via
 * `performance.timeOrigin + performance.now()`), NOT the per-thread `performance.now()` domain. This matters
 * because the TUI's input runtime runs on the main thread and the engine runs in a `worker_threads` Worker —
 * each thread has its own `performance.timeOrigin`, so a raw `performance.now()` snapshot from the main thread
 * compared against the worker's `performance.now()` would always read as "in the future" (negative delta) and
 * the fallback would silently swallow every press. Wall-clock-ms is process-shared, so the comparison is
 * stable across worker boundaries, and `KeyboardEvent.timeStamp` on the web (also `performance.timeOrigin`-
 * relative) feeds the same domain after a `+ performance.timeOrigin` adjustment in the runtime adapter.
 *
 * Defensive bounds:
 * - Negative delta (`pressedAt` in the future) → fall back to drain time. Happens with synthetic / test inputs
 *   that supply a fixed timestamp ahead of the clock; the legacy semantics are still correct in that case.
 * - Delta > {@link PRESSED_AT_MAX_DELTA_MS} → fall back to drain time. Long stalls (pause-then-resume, GC) can
 *   make the wall-clock delta diverge from the playback delta because `playbackClock` pauses while the wall
 *   clock keeps ticking. Capping the adjustment prevents stale presses from being judged in the past after a
 *   pause.
 */
export function resolveJudgeNowMsFromPressedAt(drainNowMs: number, pressedAt: number | undefined): number {
  if (pressedAt === undefined) return drainNowMs;
  const deltaMs = activeEngineScheduler.wallClockNow() - pressedAt;
  if (deltaMs < 0 || deltaMs > PRESSED_AT_MAX_DELTA_MS) return drainNowMs;
  return Math.max(0, drainNowMs - deltaMs);
}

/**
 * Cap on the wall-clock delta we'll accept between `pressedAt` and drain time. Anything larger almost certainly
 * indicates a paused-then-resumed segment (where `performance.now()` ticked but the playback clock didn't), so
 * we fall back to drain-time semantics rather than over-subtract. 50 ms is comfortably above the engine's 16.67
 * ms TUI tick + a stutter-frame margin and well below any real pause duration.
 */
const PRESSED_AT_MAX_DELTA_MS = 50;

/**
 * Sleeps `delayMs`, cut short on the next input arrival (`inputSignals.pushCommand`). Returns `'timeout'` when the full
 * delay elapsed and `'input'` when an input woke us up early. The caller decides what to do on `'input'` — typically
 * re-drain the input queue and continue waiting for the rest of the original tick.
 *
 * The wait is one timer for the whole remainder (re-armed if the host fires it early). It used to sleep 4 ms short and
 * poll the rest with zero-delay timers so a tick landed on time; that kept the thread busy for the last few
 * milliseconds of every 60 Hz tick (about 5% of the browser's main thread in a dense chart) and bought nothing: a JUDGE
 * is timed by its `pressedAt`, audio is queued against the write head ahead of time, and the next tick reads the clock
 * wherever it lands.
 *
 * The input wake-up owns a cancellable input-vs-timeout wait. That matters for timeout-heavy runs: using
 * `Promise.race([wakeUp.wait(), timer])` leaves the losing wake-up branch attached to the shared input promise
 * until the next key press, which can retain a growing PromiseReaction chain during AUTO play or long no-input
 * stretches.
 *
 * Why the race exists at all: `pressedAt` ensures the JUDGE timestamp is correct regardless of drain timing,
 * but the audio / visual response (keysound playback, lane flash queueing) still happens at drain time.
 * Without this race the engine sleeps a full 16.67 ms tick before processing inputs that arrived mid-tick,
 * adding up to that much delay before the keysound is heard. With the race the engine wakes up within ~1 ms
 * of the press and triggers audio at that point — perceived as "immediate."
 */
export async function waitPreciseOrInput(
  delayMs: number,
  wakeUp: { waitForInputOrTimeout: (timeoutMs: number) => Promise<'timeout' | 'input'> },
): Promise<'timeout' | 'input'> {
  const scheduler = activeEngineScheduler;
  const target = scheduler.now() + Math.max(0, delayMs);
  let remaining = Math.max(0, delayMs);
  do {
    if ((await wakeUp.waitForInputOrTimeout(remaining)) === 'input') return 'input';
    remaining = target - scheduler.now();
  } while (remaining > 0);
  return 'timeout';
}

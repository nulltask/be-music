import { type AudioSession } from './engine-types.ts';

/**
 * The playback clock and the wall-clock helpers the drivers wait and stamp inputs with.
 */
// Resolves after `ms` milliseconds (`node:timers/promises.setTimeout` without the Node import).
export const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface PlaybackClock {
  nowMs: () => number;
  scheduledMs: () => number;
  isPaused: () => boolean;
  pause: () => boolean;
  resume: () => boolean;
}

interface PlaybackClockSource {
  nowMs: () => number;
  scheduledMs?: () => number;
}

export const TUI_FRAME_INTERVAL_MS = 1000 / 60;

export const PAUSE_POLL_INTERVAL_MS = 16;

export const REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS = 1e-6;

function createPerformancePlaybackClockSource(): PlaybackClockSource {
  return {
    nowMs: () => performance.now(),
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
  const deltaMs = performance.timeOrigin + performance.now() - pressedAt;
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
 * Precise sleep that cuts the wait short on the next input arrival
 * (`inputSignals.pushCommand`). Returns `'timeout'` when the full delay elapsed and `'input'` when an input
 * woke us up early. The caller decides what to do on `'input'` — typically re-drain the input queue and
 * continue waiting for the rest of the original tick.
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
  const target = performance.now() + Math.max(0, delayMs);
  while (true) {
    const remaining = target - performance.now();
    if (remaining <= 0) {
      return 'timeout';
    }
    if (remaining > 8) {
      const winner = await wakeUp.waitForInputOrTimeout(remaining - 4);
      if (winner === 'input') {
        return 'input';
      }
      continue;
    }
    const winner = await wakeUp.waitForInputOrTimeout(0);
    if (winner === 'input') {
      return 'input';
    }
  }
}

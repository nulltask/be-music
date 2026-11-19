/**
 * The play's chart clock, run on from the engine's frames: every frame carries the chart second it shows and the clock
 * that second holds at (`PlayerUIFramePayload.clock`: the audio clock's reading then, the tempo, whether the play is
 * paused), so the view needs no anchor of its own — a seek, a tempo change or a pause shows in the next frame.
 */

import type { PlayerUIFrameClock } from '@be-music/player-engine/signals';

/**
 * The chart second the play is at when the audio clock reads `outputSeconds`, run on from `frame`: the frame's second,
 * plus the audio time since at the frame's tempo, unless the play is paused. `undefined` for a frame without a clock.
 */
export function chartSecondsFromFrame(
  frame: { readonly currentSeconds: number; readonly clock?: PlayerUIFrameClock },
  outputSeconds: number,
): number | undefined {
  const clock = frame.clock;
  if (clock === undefined) return undefined;
  if (clock.paused) return frame.currentSeconds;
  return frame.currentSeconds + (outputSeconds - clock.outputSeconds) * clock.tempo;
}

/** How far back {@link createAudioClockSmoother} averages the audio clock against the wall clock, in milliseconds. */
export const AUDIO_CLOCK_SMOOTHING_WINDOW_MS = 1000;
/**
 * A reading this far (seconds) from the smoothed clock is a jump, not jitter: a pause, a resume or a stall. The smoother
 * starts over from it, and never strays this far from the raw reading.
 */
export const AUDIO_CLOCK_SMOOTHING_RESET_SECONDS = 0.03;
/** The most readings the smoother keeps, so many reads a frame cannot grow it. */
const AUDIO_CLOCK_SMOOTHING_CAPACITY = 256;

/**
 * Smooths `AudioContext.currentTime` for drawing. The audio clock moves a render callback at a time (5.8 ms steps at
 * 44.1 kHz in Chromium on macOS), so a playfield drawn on it each display frame advances 0, 1 or 2 steps and stutters
 * by up to a step. The wall clock (`performance.now()`) moves smoothly; the smoother keeps the average offset between
 * the two over the last {@link AUDIO_CLOCK_SMOOTHING_WINDOW_MS} and reads the wall clock plus that offset: the audio
 * clock, on average, without its steps. It follows the audio clock's drift within the window and starts over on a jump.
 * Drawing only: judging and the sounds stay on the raw audio clock.
 */
export interface AudioClockSmoother {
  /**
   * The smoothed audio clock (seconds) for the raw reading `contextSeconds` taken at wall-clock `nowMs`. A clock that is
   * not running (`running: false`, a suspended context) reads raw and starts over.
   */
  read(contextSeconds: number, nowMs: number, running?: boolean): number;
  /** Forgets the readings, so the next read starts over from the raw clock. */
  reset(): void;
}

/** Creates an {@link AudioClockSmoother}. Allocation-free per read: a ring of the recent readings. */
export function createAudioClockSmoother(): AudioClockSmoother {
  const times = new Float64Array(AUDIO_CLOCK_SMOOTHING_CAPACITY);
  const offsets = new Float64Array(AUDIO_CLOCK_SMOOTHING_CAPACITY);
  let head = 0;
  let count = 0;
  let sum = 0;
  const reset = (): void => {
    head = 0;
    count = 0;
    sum = 0;
  };
  const dropOldest = (): void => {
    sum -= offsets[head]!;
    head = (head + 1) % AUDIO_CLOCK_SMOOTHING_CAPACITY;
    count -= 1;
  };
  return {
    read(contextSeconds, nowMs, running = true) {
      if (!running || !Number.isFinite(contextSeconds) || !Number.isFinite(nowMs)) {
        reset();
        return contextSeconds;
      }
      const wallSeconds = nowMs / 1000;
      const offset = contextSeconds - wallSeconds;
      if (count > 0 && Math.abs(offset - sum / count) > AUDIO_CLOCK_SMOOTHING_RESET_SECONDS) reset();
      while (count > 0 && nowMs - times[head]! > AUDIO_CLOCK_SMOOTHING_WINDOW_MS) dropOldest();
      if (count === AUDIO_CLOCK_SMOOTHING_CAPACITY) dropOldest();
      const tail = (head + count) % AUDIO_CLOCK_SMOOTHING_CAPACITY;
      times[tail] = nowMs;
      offsets[tail] = offset;
      count += 1;
      sum += offset;
      const smoothed = wallSeconds + sum / count;
      return Math.min(
        contextSeconds + AUDIO_CLOCK_SMOOTHING_RESET_SECONDS,
        Math.max(contextSeconds - AUDIO_CLOCK_SMOOTHING_RESET_SECONDS, smoothed),
      );
    },
    reset,
  };
}

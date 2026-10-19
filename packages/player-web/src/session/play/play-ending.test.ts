import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import type { PlayViewTiming } from '../../view/types.ts';
import {
  beginExitSequence,
  FAILED_CLOSE_MS,
  resolvePlayEnding,
  type PlayEndingContext,
  type PlayEndingInput,
} from './play-ending.ts';
import type { PlayMoment } from './play-session-theme.ts';

const timing = { beatToSeconds: (beat: number) => beat * 0.5 };
const notes = [
  { beat: 4, seconds: 2 },
  { beat: 12, seconds: 6 },
];

function input(overrides: Partial<PlayEndingInput>): PlayEndingInput {
  return { summary: undefined, notes, timing, currentSeconds: 6, tempo: 1, ...overrides };
}

const failedMidPlay = { gauge: { failedMidPlay: true } } as PlayEndingInput['summary'];

describe('resolvePlayEnding', () => {
  test('holds a finished play for the lead-out', () => {
    expect(resolvePlayEnding(input({}))).toEqual({ failed: false, leadOutMs: 4000 });
  });

  test('takes the lead-out in chart time: at another tempo it is 1 / tempo as long', () => {
    expect(resolvePlayEnding(input({ tempo: 2 })).leadOutMs).toBe(2000);
  });

  test('ends a play cut short by its gauge at once', () => {
    expect(resolvePlayEnding(input({ summary: failedMidPlay, currentSeconds: 3 }))).toEqual({
      failed: true,
      leadOutMs: 0,
    });
  });

  test('ends normally when the gauge emptied but the play went on past the last note', () => {
    expect(resolvePlayEnding(input({ summary: failedMidPlay, currentSeconds: 6 })).failed).toBe(false);
  });
});

/** A play's exit as the session drives it: its theme's timing, the moments raised, the audio bus and a play clock. */
function createExit(viewTiming: Pick<PlayViewTiming, 'fadeOutMs' | 'closeMs'>) {
  const moments: PlayMoment[] = [];
  const fadeOutAudibleTo = vi.fn();
  const clock = { ms: 10_000 };
  const ctx = {
    theme: {
      timing: () => ({ loadEndOffsetMs: 0, playStartOffsetMs: 0, ...viewTiming }),
      moment: (moment: PlayMoment) => moments.push(moment),
      keyOnFadeMs: () => 0,
    },
    disposed: false,
    exiting: false,
    exitFadeOutMs: 0,
    exitFadeStartedAt: undefined,
    exitFadeOutHandle: undefined,
    exitCloseHandle: undefined,
    audioBus: { fadeOutAudibleTo },
    playClock: () => clock.ms,
  } as unknown as PlayEndingContext;
  return { ctx, moments, fadeOutAudibleTo, callback: vi.fn() };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('beginExitSequence', () => {
  // The stock LR2 play skins: `#FADEOUT,550`, `#CLOSE,2050`.
  const lr2 = { fadeOutMs: 550, closeMs: 2050 };

  test('a normal exit fades out on timer 2 alone and moves on after the fade-out, never waiting for #CLOSE', () => {
    const exit = createExit(lr2);
    beginExitSequence(exit.ctx, exit.callback);
    expect(exit.moments).toEqual([{ kind: 'exit-fade-out', at: 10_000 }]);
    expect(exit.fadeOutAudibleTo).toHaveBeenCalledWith(0, 550);
    expect([exit.ctx.exitFadeStartedAt, exit.ctx.exitFadeOutMs]).toEqual([10_000, 550]);
    vi.advanceTimersByTime(549);
    expect(exit.callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(exit.callback).toHaveBeenCalledTimes(1);
    // No timer 3 (`exit-close`): the FAILED plate is for failures only.
    vi.advanceTimersByTime(5000);
    expect(exit.moments.map((moment) => moment.kind)).toEqual(['exit-fade-out']);
  });

  test('the chart’s end lets its keysounds ring through the fade-out', () => {
    const exit = createExit(lr2);
    beginExitSequence(exit.ctx, exit.callback, { fadeAudio: false });
    expect(exit.moments.map((moment) => moment.kind)).toEqual(['exit-fade-out']);
    expect(exit.fadeOutAudibleTo).not.toHaveBeenCalled();
  });

  test('a theme without a fade-out moves on at once on a normal exit', () => {
    const exit = createExit({ fadeOutMs: 0, closeMs: 2050 });
    beginExitSequence(exit.ctx, exit.callback);
    expect(exit.callback).toHaveBeenCalledTimes(1);
    expect(exit.moments).toEqual([]);
  });

  test('a failed play stops at once: timer 3, the sound cut, the result after #CLOSE, no fade-out', () => {
    const exit = createExit(lr2);
    beginExitSequence(exit.ctx, exit.callback, { failed: true });
    expect(exit.moments).toEqual([{ kind: 'exit-close', at: 10_000 }]);
    expect(exit.fadeOutAudibleTo).toHaveBeenCalledWith(0, 0);
    // The picture does not fade: the skin's timer-3 chrome is what shows.
    expect([exit.ctx.exitFadeStartedAt, exit.ctx.exitFadeOutMs]).toEqual([undefined, 0]);
    vi.advanceTimersByTime(2049);
    expect(exit.callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(exit.callback).toHaveBeenCalledTimes(1);
    expect(exit.moments.map((moment) => moment.kind)).toEqual(['exit-close']);
  });

  test('a failed play on a theme without a close time holds for the minimum, fading its picture', () => {
    const exit = createExit({ fadeOutMs: 450, closeMs: 0 });
    beginExitSequence(exit.ctx, exit.callback, { failed: true });
    expect(exit.moments).toEqual([{ kind: 'exit-close', at: 10_000 }]);
    expect(exit.fadeOutAudibleTo).toHaveBeenCalledWith(0, 0);
    expect([exit.ctx.exitFadeStartedAt, exit.ctx.exitFadeOutMs]).toEqual([10_000, FAILED_CLOSE_MS]);
    vi.advanceTimersByTime(FAILED_CLOSE_MS - 1);
    expect(exit.callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(exit.callback).toHaveBeenCalledTimes(1);
  });

  test('a second exit while one runs hands over at once, and a disposed play never calls back', () => {
    const exit = createExit(lr2);
    beginExitSequence(exit.ctx, exit.callback);
    const second = vi.fn();
    beginExitSequence(exit.ctx, second);
    expect(second).toHaveBeenCalledTimes(1);
    expect(exit.moments).toHaveLength(1);
    (exit.ctx as { disposed: boolean }).disposed = true;
    vi.advanceTimersByTime(1000);
    expect(exit.callback).not.toHaveBeenCalled();
  });
});

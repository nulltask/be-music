import { afterEach, describe, expect, test, vi } from 'vite-plus/test';
import { PlaySession } from './play-session.ts';
import type { PlayMoment } from './play-session-theme.ts';
import type { PlayViewTiming } from '../../view/types.ts';

function setup(timing: PlayViewTiming) {
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
  const moments: PlayMoment[] = [];
  const play = new PlaySession(
    {},
    {
      timing: () => timing,
      moment: (event) => moments.push(event),
      keyOnFadeMs: () => 100,
    },
  );
  let now = 100;
  vi.spyOn(play, 'playClock').mockImplementation(() => now);
  return {
    play,
    moments,
    advance: async (ms: number) => {
      now += ms;
      await vi.advanceTimersByTimeAsync(ms);
    },
  };
}
const base = { loadEndOffsetMs: 500, playStartOffsetMs: 1500, fadeOutMs: 0, closeMs: 0 };
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('play intro stages', () => {
  test('waits the complete READY interval after slow media loading', async () => {
    const { play, moments, advance } = setup({ ...base, inputStartOffsetMs: 200, playStartAfterLoadEndMs: 1000 });
    let loaded!: () => void;
    play.assetsReadyPromise = new Promise<void>((resolve) => {
      loaded = resolve;
    });
    play.start();
    await advance(200);
    expect(moments.map((event) => event.kind)).toEqual(['scene-start', 'input-start']);
    await advance(4800);
    expect(moments).toHaveLength(2);
    loaded();
    await advance(0);
    expect(moments.at(-1)).toEqual({ kind: 'load-end', at: 5100 });
    await advance(999);
    expect(moments.at(-1)?.kind).toBe('load-end');
    await advance(1);
    expect(moments.at(-1)).toEqual({ kind: 'play-start', at: 6100 });
    expect(Number.isFinite(play.startTime)).toBe(true);
  });

  test('honors an explicit zero READY interval without the built-in three-second fallback', async () => {
    const { play, moments, advance } = setup({ ...base, loadEndOffsetMs: 0, playStartAfterLoadEndMs: 0 });
    play.start();
    await advance(0);
    expect(moments.map((event) => event.kind)).toEqual(['scene-start', 'load-end', 'play-start']);
  });

  test('preserves absolute LR2 timing and the built-in fallback', async () => {
    const { play, moments, advance } = setup(base);
    play.start();
    await advance(500);
    expect(moments.at(-1)?.kind).toBe('load-end');
    await advance(999);
    expect(moments.at(-1)?.kind).toBe('load-end');
    await advance(1);
    expect(moments.at(-1)?.kind).toBe('play-start');
  });

  test('keeps the built-in three-second fallback when no relative interval is authored', async () => {
    const { play, moments, advance } = setup({ ...base, playStartOffsetMs: 0 });
    play.start();
    await advance(2999);
    expect(moments.at(-1)?.kind).toBe('load-end');
    await advance(1);
    expect(moments.at(-1)?.kind).toBe('play-start');
  });

  test('does not start after an exit during READY and ignores repeated start calls', async () => {
    const { play, moments, advance } = setup({ ...base, playStartAfterLoadEndMs: 1000 });
    play.start();
    play.start();
    await advance(500);
    expect(moments.map((event) => event.kind)).toEqual(['scene-start', 'load-end']);
    play.exiting = true;
    await advance(1000);
    expect(moments.map((event) => event.kind)).toEqual(['scene-start', 'load-end']);
    expect(play.startTime).toBe(Number.POSITIVE_INFINITY);
  });

  test('does not schedule a new READY delay after disposal while media is loading', async () => {
    const { play, moments, advance } = setup({ ...base, playStartAfterLoadEndMs: 1000 });
    let loaded!: () => void;
    play.assetsReadyPromise = new Promise<void>((resolve) => {
      loaded = resolve;
    });
    play.start();
    play.disposed = true;
    loaded();
    await advance(5000);
    expect(moments.map((event) => event.kind)).toEqual(['scene-start']);
  });
});

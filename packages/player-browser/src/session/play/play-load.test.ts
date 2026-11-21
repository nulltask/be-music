import { afterEach, describe, expect, test, vi } from 'vite-plus/test';
import type { LibraryChart } from '@be-music/player-scene-model';
import { PlaySession } from './play-session.ts';
import type { PlayViewTiming } from '../../view/types.ts';

const mocks = vi.hoisted(() => ({
  decode: {
    resolve: () => {},
    progress: undefined as ((fraction: number) => void) | undefined,
    stretchProgress: undefined as ((fraction: number) => void) | undefined,
  },
  launchSharedEngine: vi.fn(),
  prepareBGA: vi.fn(async (_context: unknown, _progress?: (fraction: number) => void) => {}),
}));

vi.mock('./play-chart.ts', () => ({ prepareChart: vi.fn() }));
vi.mock('./play-media.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./play-media.ts')>()),
  openPlayAudio: vi.fn(() => true),
  decodePlayAudio: vi.fn(
    (_context, progress: (fraction: number) => void, stretchProgress: (fraction: number) => void) =>
      new Promise<void>((resolve) => {
        mocks.decode.resolve = resolve;
        mocks.decode.progress = progress;
        mocks.decode.stretchProgress = stretchProgress;
      }),
  ),
  prepareBGA: mocks.prepareBGA,
}));
vi.mock('./play-engine.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./play-engine.ts')>()),
  launchSharedEngine: mocks.launchSharedEngine,
}));

const TIMING: PlayViewTiming = { loadEndOffsetMs: 500, playStartOffsetMs: 1500, fadeOutMs: 0, closeMs: 0 };
const CHART = { id: 'a', chartPath: 'a.bms' } as unknown as LibraryChart;

function setup() {
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
  const moments: string[] = [];
  const play = new PlaySession(
    {},
    { timing: () => TIMING, moment: (event) => moments.push(event.kind), keyOnFadeMs: () => 100 },
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  mocks.launchSharedEngine.mockClear();
  mocks.prepareBGA.mockClear();
});

describe('play loading', () => {
  test('a play on the stage starts its intro while the samples decode, and holds the chart for them', async () => {
    const { play, moments, advance } = setup();
    play.entered = true;
    await play.load(CHART);
    // load returns with the samples still decoding: no engine yet, and the play shows as loading.
    expect(mocks.launchSharedEngine).not.toHaveBeenCalled();
    expect(play.assetsLoading).toBe(true);
    play.start();
    expect(mocks.launchSharedEngine).not.toHaveBeenCalled();
    await advance(1500);
    // The intro has run its course, but the chart waits on the samples.
    expect(moments).not.toContain('play-start');
    mocks.decode.resolve();
    await advance(0);
    expect(mocks.launchSharedEngine).toHaveBeenCalledOnce();
    expect(mocks.prepareBGA).toHaveBeenCalledOnce();
    expect(moments).toContain('play-start');
    expect(play.assetsLoading).toBe(false);
  });

  test('tracks audio and BGA progress while holding completion until the assets are ready', async () => {
    const { play, advance } = setup();
    let finishBGA!: () => void;
    mocks.prepareBGA.mockImplementationOnce(
      (_context, progress) =>
        new Promise<void>((resolve) => {
          progress?.(0.5);
          finishBGA = resolve;
        }),
    );
    play.entered = true;
    await play.load(CHART);
    expect(play.loadProgress).toBe(0.1);
    mocks.decode.progress?.(0.5);
    expect(play.loadProgress).toBeCloseTo(0.3);
    mocks.decode.progress?.(1);
    mocks.decode.stretchProgress?.(0.5);
    expect(play.loadProgress).toBeCloseTo(0.595);
    mocks.decode.resolve();
    await advance(0);
    expect(play.loadProgress).toBeCloseTo(0.825);
    expect(play.assetsLoading).toBe(true);
    finishBGA();
    await advance(0);
    expect(play.loadProgress).toBe(1);
    expect(play.assetsLoading).toBe(false);
  });

  test('a play behind a splash returns from load only once its samples have decoded', async () => {
    const { play } = setup();
    let loaded = false;
    const loading = play.load(CHART).then(() => {
      loaded = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(loaded).toBe(false);
    mocks.decode.resolve();
    await loading;
    expect(mocks.launchSharedEngine).toHaveBeenCalledOnce();
  });
});

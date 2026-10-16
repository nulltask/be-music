import type { PlaylogViewState } from '@be-music/player/playlog';
import {
  createHiSpeedState,
  createPlayState,
  laneCoversFromPlayOptions,
  PlaylogViewCursor,
  reducePlayState,
  resolveWhiteNumber,
} from '@be-music/scene-model';
import { describe, expect, test } from 'vite-plus/test';
import { HiSpeedTransition } from '../../scene/hi-speed.ts';
import type { PlaySessionTheme } from './play-session-theme.ts';
import {
  resolveLaneCovers,
  resolveVisibleMs,
  startPlaylogView,
  updatePlaylogView,
  type PlayViewSettingsContext,
} from './play-view-settings.ts';

/** A 1P lane 576 design pixels tall: eight beats at hi-speed 1 (`PIXELS_PER_BEAT` is 72). */
const LANE = { x: 0, w: 40, top: 0, bottom: 576 };

function createView(
  options: { replay?: PlaylogViewState; theme?: Partial<PlaySessionTheme> } = {},
): PlayViewSettingsContext {
  const covers = laneCoversFromPlayOptions(
    { hiddenSudden1P: 'SUDDEN', hiddenSudden2P: 'OFF', shutter: 0.25, laneCover: true },
    ['1P'],
  );
  return {
    options: {},
    playState: createPlayState({ view: { hiSpeed: createHiSpeedState({ hiSpeed: 2 }), covers, hsFix: 'OFF' } }),
    scrollHiSpeed: new HiSpeedTransition(2),
    laneX: new Map([['11', LANE]]),
    chartBpmRange: { minBpm: 120, maxBpm: 120, mainBpm: 120 },
    drawnLaneCovers: undefined,
    playlogViewCoalescer: undefined,
    replayViewCursor: options.replay !== undefined ? new PlaylogViewCursor(options.replay) : undefined,
    sharedEngineInputSignals: undefined,
    theme: options.theme ?? {},
    currentSeconds: () => 0,
  } as unknown as PlayViewSettingsContext;
}

describe("the play log's view on the built-in and LR2 play screens", () => {
  test('records the visible time as the white number over the lanes laid out', () => {
    const view = startPlaylogView(createView());
    expect(view).toEqual({
      hiSpeed: 2,
      hiSpeedScale: 'be-music',
      hsFix: 'OFF',
      covers: [{ side: '1P', sudden: 0.25, hidden: 0, lift: 0 }],
      // 8 beats / 2 × (1 - 0.25) at 120 BPM.
      visibleMs: 1500,
    });
    expect(view.visibleMs).toBe(resolveWhiteNumber({ laneBeats: 8, hiSpeed: 2, sudden: 0.25, bpm: 120 }));
  });

  test('leaves the LIFT out of the visible time, as beatoraja does', () => {
    const ctx = createView();
    ctx.playState = reducePlayState(ctx.playState, { type: 'cover-set', covers: [{ side: '1P', lift: 0.2 }] });
    const view = startPlaylogView(ctx);
    expect(view.covers).toEqual([{ side: '1P', sudden: 0.25, hidden: 0, lift: 0.2 }]);
    expect(view.visibleMs).toBe(1500);
    expect(resolveVisibleMs(ctx, resolveLaneCovers(ctx)[0], 120, 1)).toBe(1500);
  });

  test('shows the visible time over the scroll rate, and none before the lanes are laid out', () => {
    const ctx = createView();
    expect(resolveVisibleMs(ctx, resolveLaneCovers(ctx)[0], 120, 2)).toBe(750);
    ctx.laneX.clear();
    expect(resolveVisibleMs(ctx, resolveLaneCovers(ctx)[0], 120, 1)).toBeUndefined();
  });

  test('a replay recorded on another scale scrolls at the hi-speed that shows its visible time', () => {
    const ctx = createView({
      replay: {
        hiSpeed: 1.6,
        hiSpeedScale: 'beatoraja',
        visibleMs: 1000,
        covers: [{ side: '1P', sudden: 0.25, hidden: 0.1, lift: 0.1 }],
      },
    });
    updatePlaylogView(ctx, 0);
    // 8 beats × 0.75 at 120 BPM is 3000 ms at hi-speed 1, so 1000 ms is hi-speed 3.
    expect(ctx.playState.view.hiSpeed.drawn).toBe(3);
    expect(ctx.scrollHiSpeed.target).toBe(3);
    // SUDDEN+ and HIDDEN+ as recorded; the scene draws no LIFT.
    expect(resolveLaneCovers(ctx)).toEqual([{ side: '1P', sudden: 0.25, hidden: 0.1, lift: 0 }]);
  });

  test("records on the view's own scale when the view has one, with no lanes laid out", () => {
    const ctx = createView({
      theme: { playlogView: () => ({ scale: 'beatoraja', laneBeats: 4, mainBpm: 150 }) },
    });
    ctx.laneX.clear();
    const view = startPlaylogView(ctx);
    // 4 beats / 2 × (1 - 0.25) at 150 BPM.
    expect(view).toEqual({
      hiSpeed: 2,
      hiSpeedScale: 'beatoraja',
      hsFix: 'OFF',
      covers: [{ side: '1P', sudden: 0.25, hidden: 0, lift: 0 }],
      visibleMs: 600,
    });
  });

  test('a replay on the same scale takes the recorded hi-speed as drawn', () => {
    const ctx = createView({ replay: { hiSpeed: 2.5, hiSpeedScale: 'be-music', visibleMs: 900 } });
    updatePlaylogView(ctx, 0);
    expect(ctx.playState.view.hiSpeed.drawn).toBe(2.5);
  });
});

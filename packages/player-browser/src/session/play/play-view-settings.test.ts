import { createPlayerInputSignalBus } from '@be-music/player-engine/signals';
import type { ReplayPlaybackOptions, ReplayViewState } from '@be-music/player-engine/replay';
import {
  createHiSpeedState,
  createPlayState,
  HiSpeedTransition,
  laneCoversFromPlayOptions,
  ReplayViewCursor,
  reducePlayState,
  resolveWhiteNumber,
} from '@be-music/player-scene-model';
import { describe, expect, test, vi } from 'vite-plus/test';
import type { PlaySessionTheme } from './play-session-theme.ts';
import type { PlayTempoRange } from './tempo-range.ts';
import {
  resolveLaneCovers,
  changePlayView,
  resolveVisibleMs,
  startReplayView,
  updateReplayView,
  type PlayViewSettingsContext,
} from './play-view-settings.ts';

/** A 1P lane 576 design pixels tall: eight beats at hi-speed 1 (`PIXELS_PER_BEAT` is 72). */
const LANE = { x: 0, w: 40, top: 0, bottom: 576 };

function createView(
  options: { replay?: ReplayViewState; theme?: Partial<PlaySessionTheme>; replayView?: ReplayPlaybackOptions } = {},
): PlayViewSettingsContext {
  const covers = laneCoversFromPlayOptions(
    { hiddenSudden1P: 'SUDDEN', hiddenSudden2P: 'OFF', shutter: 0.25, laneCover: true },
    ['1P'],
  );
  return {
    options: options.replayView !== undefined ? { replayView: options.replayView } : {},
    playState: createPlayState({ view: { hiSpeed: createHiSpeedState({ hiSpeed: 2 }), covers, hsFix: 'OFF' } }),
    scrollHiSpeed: new HiSpeedTransition(2),
    laneX: new Map([['11', LANE]]),
    chartBPMRange: { minBPM: 120, maxBPM: 120, mainBPM: 120 },
    drawnLaneCovers: undefined,
    replayViewCoalescer: undefined,
    replayViewCursor: options.replay !== undefined ? new ReplayViewCursor(options.replay) : undefined,
    sharedEngineInputSignals: undefined,
    theme: options.theme ?? {},
    currentSeconds: () => 0,
  } as unknown as PlayViewSettingsContext;
}

describe("the replay's view on the built-in and LR2 play screens", () => {
  test('records the visible time as the white number over the lanes laid out', () => {
    const view = startReplayView(createView());
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
    ctx.playState = reducePlayState(ctx.playState, {
      type: 'cover-set',
      covers: [{ side: '1P', lift: 0.2, liftOn: true }],
    });
    const view = startReplayView(ctx);
    expect(view.covers).toEqual([{ side: '1P', sudden: 0.2, hidden: 0, lift: 0.2 }]);
    ctx.laneX.set('11', { ...LANE, bottom: LANE.bottom * 0.8, baseBottom: LANE.bottom, scrollScale: 0.8 });
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
    updateReplayView(ctx, 0);
    // 8 beats × 0.75 at 120 BPM is 3000 ms at hi-speed 1, so 1000 ms is hi-speed 3.
    expect(ctx.playState.view.hiSpeed.drawn).toBe(3);
    expect(ctx.scrollHiSpeed.target).toBe(3);
    // SUDDEN+ and HIDDEN+ as recorded; the scene draws no LIFT.
    expect(resolveLaneCovers(ctx)).toEqual([{ side: '1P', sudden: 0.25, hidden: 0.1, lift: 0 }]);
  });

  test("records on the view's own scale when the view has one, at the play's main BPM, with no lanes laid out", () => {
    const ctx = createView({ theme: { replayView: () => ({ scale: 'beatoraja', laneBeats: 4 }) } });
    ctx.laneX.clear();
    (ctx as { chartBPMRange: PlayTempoRange }).chartBPMRange = { minBPM: 120, maxBPM: 300, mainBPM: 150 };
    const view = startReplayView(ctx);
    // 4 beats / 2 × (1 - 0.25) at the main 150 BPM, the one HS-FIX reads on every family's play screen.
    expect(view).toEqual({
      hiSpeed: 2,
      hiSpeedScale: 'beatoraja',
      hsFix: 'OFF',
      covers: [{ side: '1P', sudden: 0.25, hidden: 0, lift: 0 }],
      visibleMs: 600,
    });
  });

  test('a replay on a view that draws the LIFT shows the recorded LIFT, HIDDEN+ as drawn over it', () => {
    const replay: ReplayViewState = {
      hiSpeed: 1.6,
      hiSpeedScale: 'beatoraja',
      visibleMs: 1000,
      covers: [{ side: '1P', sudden: 0.25, hidden: 0.18, lift: 0.1 }],
    };
    const theme = { replayView: () => ({ scale: 'beatoraja', laneBeats: 4 }), drawsLift: () => true };
    const ctx = createView({ replay, theme });
    updateReplayView(ctx, 0);
    expect(ctx.playState.view.hiSpeed.drawn).toBe(1.6);
    // The play state's HIDDEN+ is of the lane above the LIFT (0.18 / 0.9), so it draws the recorded 0.18 of the lane.
    expect(ctx.playState.view.covers[0]).toMatchObject({ lift: 0.1, hiddenOn: true });
    expect(ctx.playState.view.covers[0]!.hidden).toBeCloseTo(0.2, 10);
    const [drawn] = resolveLaneCovers(ctx);
    expect(drawn).toMatchObject({ side: '1P', sudden: 0.25, lift: 0.1 });
    expect(drawn!.hidden).toBeCloseTo(0.18, 10);

    // With the LIFT toggle off, the viewer keeps their own LIFT (none) and HIDDEN+ as recorded of the lane.
    const own = createView({ replay, theme, replayView: { tempo: true, hiSpeed: true, covers: true, lift: false } });
    updateReplayView(own, 0);
    expect(resolveLaneCovers(own)[0]).toMatchObject({ sudden: 0.25, hidden: 0.18, lift: 0 });
  });

  test('a replay on the same scale takes the recorded hi-speed as drawn', () => {
    const ctx = createView({ replay: { hiSpeed: 2.5, hiSpeedScale: 'be-music', visibleMs: 900 } });
    updateReplayView(ctx, 0);
    expect(ctx.playState.view.hiSpeed.drawn).toBe(2.5);
  });
});

test('records successive rendered view edits even within the former 100 ms debounce', () => {
  const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
  try {
    const bus = createPlayerInputSignalBus();
    const ctx = { ...createView(), sharedEngineInputSignals: bus };
    startReplayView(ctx);
    ctx.playState = reducePlayState(ctx.playState, { type: 'hi-speed-set', value: 2.1 });
    updateReplayView(ctx, 1);
    ctx.playState = reducePlayState(ctx.playState, { type: 'hi-speed-set', value: 2.2 });
    updateReplayView(ctx, 1.001);
    expect(
      bus
        .drainCommands()
        .filter((command) => command.kind === 'view')
        .map((command) => command.change.hiSpeed),
    ).toEqual([2.1, 2.2]);
  } finally {
    clock.mockRestore();
  }
});

test('floating cover commands sample the live BPM and restore the source display time', () => {
  const ctx = createView();
  ctx.playState = createPlayState({
    view: {
      hiSpeed: createHiSpeedState({ hiSpeed: 2, floating: true, bpm: 120, visibleFraction: 1 - 181 / 723 }),
      covers: [
        {
          side: '1P',
          sudden: 181 / 723,
          suddenOn: true,
          hidden: 0,
          hiddenOn: false,
          lift: 0,
          liftOn: false,
          absolute: true,
        },
      ],
    },
  });
  Object.assign(ctx, { timingResolver: { bpmAtBeat: () => 240 }, currentBeat: () => 0 });
  changePlayView(ctx, { type: 'cover-adjust', part: 'sudden', delta: 0 });
  expect(ctx.playState.view.hiSpeed.player).toBe(1);
  changePlayView(ctx, { type: 'hi-speed-step', delta: 0.1 });
  expect(ctx.playState.view.hiSpeed.player).toBe(1.5);
  changePlayView(ctx, { type: 'cover-adjust', part: 'sudden', delta: 0 });
  expect(ctx.playState.view.hiSpeed.player).toBe(1);
});

test('floating mode switches reach replay recording even before another render', () => {
  const ctx = createView();
  const commands: unknown[] = [];
  Object.assign(ctx, { sharedEngineInputSignals: { pushCommand: (command: unknown) => commands.push(command) } });
  changePlayView(ctx, { type: 'floating-speed-mode', enabled: true, bpm: 120, visibleFraction: 0.75 });
  changePlayView(ctx, { type: 'floating-speed-mode', enabled: false, bpm: 120, visibleFraction: 0.75 });
  expect(commands).toEqual([
    expect.objectContaining({ kind: 'options', values: expect.objectContaining({ floatingHiSpeed: true }) }),
    expect.objectContaining({ kind: 'options', values: expect.objectContaining({ floatingHiSpeed: false }) }),
  ]);
});

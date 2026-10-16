import { createPlayerUiSignalBus, type PlayerUiCommand } from '@be-music/player/core/ui-signal-bus';
import type { PlayerGaugeSummary, PlayerUiFramePayload } from '@be-music/player/core/ui-signal-bus';
import type { PlayerSummary } from '@be-music/player/core/engine';
import { createEmptyScore } from '@be-music/player/ruleset';
import { createPlayerStateSignals } from '@be-music/player/state-signals';
import { createHiSpeedState, createPlayState, type PlayState } from '@be-music/scene-model';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import type { BrowserSongEntry } from '../../collection/types.ts';
import { LongNoteTracker } from '../../view/shared/playfield/long-note-tracker.ts';
import { createPlaceholderGaugeState } from '../../scene/core/placeholder-gauge.ts';
import { HiSpeedTransition } from '../../scene/hi-speed.ts';
import { applyFinalSummary, drainSharedEngineSignals, type PlayEngineContext } from './play-engine.ts';
import { getResultData } from './play-ending.ts';

/** The chart's length the graphs are taken over, in seconds. */
const CHART_SECONDS = 10;
const SONG = { id: 'song', title: 'Song', chart: {} } as unknown as BrowserSongEntry;

/** A play of `total` notes as the engine side of a built-in / LR2 scene sees it: the scene's state and its buses. */
function createPlay(options: {
  total: number;
  autoPlay?: boolean;
  courseCarryIn?: { combo: number; maxCombo: number };
}) {
  const gauge = createPlaceholderGaugeState('GROOVE');
  const uiSignals = createPlayerUiSignalBus(frameAt(0, { gauge }));
  const stateSignals = createPlayerStateSignals(2);
  const clock = { seconds: 0, ms: 0 };
  const events: string[] = [];
  const ctx = {
    options: { autoPlay: options.autoPlay === true },
    song: SONG,
    playlog: undefined,
    disposed: false,
    sharedEngineSignals: { uiSignals, stateSignals },
    sharedEngineLastJudgeComboTick: 0,
    sharedEngineClockAnchored: true,
    audioContext: undefined,
    score: createEmptyScore(options.total),
    gaugeState: gauge,
    fastCount: 0,
    slowCount: 0,
    fullComboFired: false,
    playState: createPlayState({
      gauge: gauge.current,
      totalSeconds: CHART_SECONDS,
      ...(options.courseCarryIn !== undefined ? { courseCarryIn: options.courseCarryIn } : {}),
      view: { hiSpeed: createHiSpeedState({ hiSpeed: 2 }) },
    }),
    scrollHiSpeed: new HiSpeedTransition(2),
    playMoments: {},
    lastJudge: '',
    lastJudgeUntil: 0,
    lastJudgeAt: undefined,
    lastImpulseAt: undefined,
    lastImpulseKind: undefined,
    lastPoorAt: 0,
    judgeSideState: { '1P': { judge: '', until: 0, combo: 0 }, '2P': { judge: '', until: 0, combo: 0 } },
    chartPlayVariant: '7',
    longNotes: new LongNoteTracker(),
    lanePressedAt: new Map<string, number>(),
    laneReleasedAt: new Map<string, number>(),
    pressedChannels: new Set<string>(),
    timerStartedAt: new Map<number, number>(),
    keyOnFadeOutStart: new Map<number, number>(),
    keyFlashTimeouts: new Set<number>(),
    bombStartedAt: new Map<string, number>(),
    bombJudge: new Map<string, string>(),
    theme: {
      moment: (event: { kind: string }) => events.push(event.kind),
      keyOnFadeMs: () => 120,
    },
    playClock: () => clock.ms,
    currentSeconds: () => clock.seconds,
    resolveSongDurationSeconds: () => CHART_SECONDS,
    resolveEmptyPoorCountsInPoorDisplay: () => true,
    resolveJudgeRuleset: () => 'lr2',
    resolveKeyOnTimerId: () => undefined,
  } as unknown as PlayEngineContext;
  /** One engine frame at chart time `seconds` (play clock `seconds × 1000`), with its judgments and commands. */
  const step = (
    seconds: number,
    frame: { exScore?: number; gauge?: number; counts?: Partial<PlayerSummary> },
    judgments: readonly { judge: string; combo: number; channel?: string; deltaMs?: number }[] = [],
    commands: readonly PlayerUiCommand[] = [],
  ): void => {
    clock.seconds = seconds;
    clock.ms = seconds * 1000;
    uiSignals.publishFrame(
      frameAt(seconds, {
        gauge: { ...gauge, current: frame.gauge ?? gauge.current },
        exScore: frame.exScore ?? 0,
        counts: frame.counts ?? {},
      }),
    );
    for (const command of commands) uiSignals.pushCommand(command);
    for (const judgment of judgments) {
      stateSignals.publishJudgeCombo(judgment.judge, judgment.combo, judgment.channel, clock.ms, judgment.deltaMs);
    }
    drainSharedEngineSignals(ctx);
  };
  return { ctx, step, events, state: (): PlayState => ctx.playState };
}

function frameAt(
  seconds: number,
  input: { gauge: PlayerGaugeSummary; exScore?: number; counts?: Partial<PlayerSummary> },
): PlayerUiFramePayload {
  return {
    currentBeat: seconds * 2,
    currentSeconds: seconds,
    totalSeconds: 12,
    notes: [],
    summary: {
      total: 4,
      perfect: 0,
      fast: 0,
      slow: 0,
      great: 0,
      good: 0,
      bad: 0,
      poor: 0,
      emptyPoor: 0,
      exScore: input.exScore ?? 0,
      score: 0,
      ...input.counts,
      gauge: input.gauge,
    },
  } as PlayerUiFramePayload;
}

function summary(counts: Partial<PlayerSummary>, gauge: number): PlayerSummary {
  return {
    total: 4,
    perfect: 0,
    fast: 0,
    slow: 0,
    great: 0,
    good: 0,
    bad: 0,
    poor: 0,
    emptyPoor: 0,
    exScore: 0,
    score: 0,
    ...counts,
    gauge: { ...createPlaceholderGaugeState('GROOVE'), current: gauge, cleared: gauge >= 80 },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the play state of a built-in / LR2 play, fed from the engine', () => {
  test('frames, judgments and empty POORs reach one PlayState', () => {
    const play = createPlay({ total: 4 });
    play.step(1, { exScore: 2, gauge: 22 }, [{ judge: 'PERFECT', combo: 1, channel: '11', deltaMs: -3 }]);
    play.step(2, { exScore: 2, gauge: 20 }, [], [{ kind: 'trigger-poor-bga', seconds: 2 }]);
    play.step(3, { exScore: 3, gauge: 21 }, [{ judge: 'GREAT', combo: 2, channel: '12', deltaMs: 12 }]);
    play.step(4, { exScore: 3, gauge: 15 }, [{ judge: 'BAD', combo: 0, channel: '13', deltaMs: 40 }]);
    play.step(5, { exScore: 5, gauge: 17 }, [{ judge: 'PERFECT', combo: 1, channel: '14' }]);
    const state = play.state();
    expect(state.combo).toBe(1);
    expect(state.maxCombo).toBe(2);
    expect(state.gauge).toBe(17);
    expect(state.exScore).toBe(5);
    // Each sample takes the gauge and EX score of the frame drained with it, at its chart-time fraction.
    expect(state.gaugeHistory).toEqual([
      { progress: 0, value: 20 },
      { progress: 0.1, value: 22 },
      { progress: 0.2, value: 20 },
      { progress: 0.3, value: 21 },
      { progress: 0.4, value: 15 },
      { progress: 0.5, value: 17 },
    ]);
    expect(state.scoreHistory.map((sample) => sample.exScore)).toEqual([0, 2, 2, 3, 3, 5]);
    // Only judgments with a timing are kept, on the play clock and with their lane; the last one had none.
    expect(state.judgeTimings).toEqual([
      { atMs: 1000, deltaMs: -3, judge: 'PERFECT', channel: '11' },
      { atMs: 3000, deltaMs: 12, judge: 'GREAT', channel: '12' },
      { atMs: 4000, deltaMs: 40, judge: 'BAD', channel: '13' },
    ]);
    expect(state.lastJudgeDeltaMs).toBe(40);
    expect(state.earlyLate.PERFECT).toEqual({ early: 1, late: 0 });
    expect(state.earlyLate.GREAT).toEqual({ early: 0, late: 1 });
    // The per-side judge plate shows the combo at the side's last judgment.
    expect(play.ctx.judgeSideState['1P']).toMatchObject({ judge: 'PERFECT', combo: 1 });
  });

  test('a course stage runs the course combo on from the one carried in', () => {
    const play = createPlay({ total: 4, courseCarryIn: { combo: 5, maxCombo: 10 } });
    play.step(1, {}, [{ judge: 'PERFECT', combo: 1 }]);
    play.step(2, {}, [{ judge: 'PERFECT', combo: 2 }]);
    expect(play.state().courseCombo).toMatchObject({ combo: 7, maxCombo: 10 });
    expect(play.ctx.judgeSideState['1P'].courseCombo).toBe(7);
    play.step(3, {}, [{ judge: 'POOR', combo: 0 }]);
    expect(play.state().courseCombo).toMatchObject({ combo: 0, maxCombo: 10 });
  });

  test('the full combo event fires once the combo reaches every note', () => {
    const play = createPlay({ total: 2 });
    play.step(1, { counts: { total: 2, perfect: 1 } }, [{ judge: 'PERFECT', combo: 1 }]);
    expect(play.events).not.toContain('full-combo');
    play.step(2, { counts: { total: 2, perfect: 2 } }, [{ judge: 'PERFECT', combo: 2 }]);
    expect(play.events.filter((kind) => kind === 'full-combo')).toHaveLength(1);
  });

  test('the result is read off the play state, its graphs ending at the playhead', () => {
    const play = createPlay({ total: 4 });
    play.step(1, { exScore: 2, gauge: 22, counts: { perfect: 1 } }, [{ judge: 'PERFECT', combo: 1, deltaMs: 5 }]);
    play.step(6, { exScore: 2, gauge: 18, counts: { perfect: 1, poor: 1 } }, [{ judge: 'POOR', combo: 0 }]);
    play.step(8, { exScore: 2, gauge: 18, counts: { perfect: 1, poor: 1 } });
    const result = getResultData(play.ctx)!;
    expect(result.maxCombo).toBe(1);
    expect(result.gauge).toBe(18);
    expect(result.cleared).toBe(false);
    expect(result.gaugeType).toBe('GROOVE');
    expect(result.playSeconds).toBe(8);
    expect(result.gaugeHistory).toEqual([
      { progress: 0, value: 20 },
      { progress: 0.1, value: 22 },
      { progress: 0.6, value: 18 },
      { progress: 0.8, value: 18 },
    ]);
    expect(result.judgeTimings).toEqual([{ atMs: 1000, deltaMs: 5, judge: 'PERFECT' }]);
    expect(result.earlyLate?.PERFECT).toEqual({ early: 0, late: 1 });
    expect(result.judgeRuleset).toBe('lr2');
    expect(result.lamp).toBe('FAILED');
    expect(result.song).toBe(SONG);
  });

  test("an AUTO play's full combo counts every note as its max combo", () => {
    const play = createPlay({ total: 4, autoPlay: true });
    // An autoplayed chord publishes one combo for two notes.
    play.step(1, {}, [{ judge: 'PERFECT', combo: 1 }]);
    play.step(2, {}, [{ judge: 'PERFECT', combo: 3 }]);
    expect(play.state().maxCombo).toBe(3);
    applyFinalSummary(play.ctx, summary({ perfect: 4, exScore: 8 }, 30));
    expect(play.state().maxCombo).toBe(4);
    expect(play.state().combo).toBe(4);
    expect(getResultData(play.ctx)!.maxCombo).toBe(4);
  });

  test('a played full combo counts every note as its max combo too, the course combo included', () => {
    const play = createPlay({ total: 4, courseCarryIn: { combo: 2, maxCombo: 2 } });
    // The combo the engine published reached three of the four notes.
    play.step(1, {}, [{ judge: 'PERFECT', combo: 1, deltaMs: -2 }]);
    play.step(2, {}, [{ judge: 'GREAT', combo: 3, deltaMs: 9 }]);
    applyFinalSummary(play.ctx, summary({ perfect: 3, great: 1, exScore: 7 }, 30));
    expect(play.state().maxCombo).toBe(4);
    expect(play.state().courseCombo).toMatchObject({ combo: 6, maxCombo: 6 });
    expect(getResultData(play.ctx)!.maxCombo).toBe(4);
  });

  test('a play that broke its combo keeps the longest combo it reached', () => {
    const play = createPlay({ total: 4 });
    play.step(1, {}, [{ judge: 'PERFECT', combo: 1 }]);
    play.step(2, {}, [{ judge: 'PERFECT', combo: 2 }]);
    play.step(3, {}, [{ judge: 'POOR', combo: 0 }]);
    play.step(4, {}, [{ judge: 'PERFECT', combo: 1 }]);
    applyFinalSummary(play.ctx, summary({ perfect: 3, poor: 1, exScore: 6 }, 30));
    expect(play.state().maxCombo).toBe(2);
  });
});

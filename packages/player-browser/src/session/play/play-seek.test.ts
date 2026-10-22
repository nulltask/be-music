import { createEmptyJSON } from '@be-music/chart-source';
import { PlayerInterruptedError, type PlayerSummary } from '@be-music/player-engine';
import {
  createPlayerInputSignalBus,
  type PlayerInputCommand,
  type PlayerInputSignalBus,
  type PlayerUIFramePayload,
} from '@be-music/player-engine/signals';
import type { LibraryChart } from '@be-music/player-scene-model';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import { runEngineDriver, type EngineDriverOptions } from '../../runtime/engine-driver.ts';
import { launchSharedEngine } from './play-engine.ts';
import { canSeekPlay } from './play-seek.ts';
import { PlaySession } from './play-session.ts';

vi.mock('../../runtime/engine-driver.ts', () => ({ runEngineDriver: vi.fn() }));

/**
 * Seeking an AUTO play (`PlaySession.seek`) against a fake engine that answers a `seek` input command as the play loop
 * does (ADR 0016): a `seek` UI command with the snapshot of the notes before the second sought, then a frame of the
 * next generation there. The chart has a PGREAT every half second.
 */

const CHART: LibraryChart = {
  id: 'chart',
  sourceId: 'source',
  sourceLabel: 'Source',
  sourceKind: 'directory',
  chartPath: 'song/chart.bms',
  directoryLabel: 'song',
  fileLabel: 'chart.bms',
  title: 'Chart',
  totalNotes: 20,
  chart: createEmptyJSON('bms'),
};

/** The notes judged by chart second `seconds`: one every half second. */
const judgedBy = (seconds: number): number => Math.min(20, Math.floor(seconds * 2));

function summaryOf(perfect: number): PlayerSummary {
  return {
    total: 20,
    perfect,
    fast: 0,
    slow: 0,
    great: 0,
    good: 0,
    bad: 0,
    poor: 0,
    emptyPoor: 0,
    exScore: perfect * 2,
    score: Math.round((perfect / 20) * 200_000),
    combo: perfect,
    maxCombo: perfect,
  };
}

/** The engine run the session launched: its options, its input bus, and what it does as the real one does. */
interface FakeRun {
  readonly options: EngineDriverOptions;
  readonly inputSignals: PlayerInputSignalBus;
  /** The seek commands the session sent. */
  readonly seeks: number[];
  /** Publishes a frame at chart second `seconds` of seek generation `generation`, as the run's UI runtime does. */
  frame(seconds: number, generation?: number): void;
  /** Publishes a judge cue. */
  judge(combo: number): void;
  /** The engine's tick: applies the last seek asked for, if any, and answers it. */
  tick(): void;
}

interface FakeContext {
  readonly play: PlaySession;
  readonly runs: FakeRun[];
  readonly audioContext: { currentTime: number };
  /** Whether the engine's clock is paused (the session's toggle-pause commands flip it). */
  readonly engine: { paused: boolean };
}

/** An AUTO play on a fake audio clock and a fake engine; every launched run is kept in `runs`. */
function createSeekablePlay(): FakeContext {
  const audioContext = { currentTime: 100, resume: async () => {}, suspend: async () => {} };
  const engine = { paused: false };
  const runs: FakeRun[] = [];
  vi.mocked(runEngineDriver).mockImplementation((options) => {
    const inputSignals = createPlayerInputSignalBus();
    options.onInputSignalsReady?.({ inputSignals });
    const seeks: number[] = [];
    let generation = 0;
    let pendingSeek: number | undefined;
    // The run ends when the session interrupts it, as the engine does.
    let reject: (error: unknown) => void = () => {};
    const promise = new Promise<PlayerSummary>((_resolve, rejectRun) => {
      reject = rejectRun;
    });
    const drain = (commands: readonly PlayerInputCommand[]): void => {
      for (const command of commands) {
        if (command.kind === 'interrupt') reject(new PlayerInterruptedError(command.reason));
        else if (command.kind === 'toggle-pause') engine.paused = !engine.paused;
        else if (command.kind === 'seek') {
          seeks.push(command.seconds);
          pendingSeek = command.seconds;
        }
      }
    };
    const frameAt = (seconds: number, frameGeneration = generation): PlayerUIFramePayload => ({
      currentBeat: seconds * 2,
      currentSeconds: seconds,
      totalSeconds: 10,
      summary: summaryOf(judgedBy(seconds)),
      notes: [],
      generation: frameGeneration,
      clock: { outputSeconds: audioContext.currentTime, tempo: 1, paused: engine.paused },
    });
    const run: FakeRun = {
      options,
      inputSignals,
      seeks,
      frame: (seconds, frameGeneration) => options.ui.onFrame?.(frameAt(seconds, frameGeneration)),
      judge: (combo) =>
        options.ui.onJudgeCombo?.({
          judge: 'PERFECT',
          combo,
          channel: '11',
          updatedAtMs: audioContext.currentTime * 1000,
        }),
      tick: () => {
        drain(inputSignals.drainCommands());
        if (pendingSeek === undefined) return;
        const target = Math.max(0, Math.min(pendingSeek, 10));
        pendingSeek = undefined;
        generation += 1;
        const perfect = judgedBy(target);
        options.ui.onCommand?.({
          kind: 'seek',
          generation,
          seconds: target,
          snapshot: {
            summary: summaryOf(perfect),
            combo: perfect,
            maxCombo: perfect,
            judgments: Array.from({ length: perfect }, (_, index) => ({
              judge: 'PERFECT',
              combo: index + 1,
              channel: '11',
              seconds: (index + 1) / 2,
              exScore: (index + 1) * 2,
            })),
          },
        });
        options.ui.onFrame?.(frameAt(target));
      },
    };
    runs.push(run);
    return promise as ReturnType<typeof runEngineDriver>;
  });
  const play = new PlaySession({ autoPlay: true });
  Object.assign(play, {
    chart: CHART,
    audioContext,
    audioBus: {},
    chartDurationSeconds: 10,
    startTime: performance.now(),
    audioContextStartTime: audioContext.currentTime,
  });
  launchSharedEngine(play);
  return { play, runs, audioContext, engine };
}

/** The play runs from 0 to 3 s: six notes judged, one cue each, and a frame there. */
function playFirstThreeSeconds(context: FakeContext): FakeRun {
  const run = context.runs[0]!;
  run.frame(0);
  for (let combo = 1; combo <= 6; combo += 1) run.judge(combo);
  context.audioContext.currentTime += 3;
  run.frame(3);
  return run;
}

/** Seeks to `seconds` and lets the engine answer on its next tick; resolves when the seek does. */
async function seekAndTick(context: FakeContext, seconds: number): Promise<void> {
  const sought = context.play.seek(seconds);
  context.runs[0]!.tick();
  await sought;
}

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
});

afterEach(() => {
  vi.mocked(runEngineDriver).mockReset();
  vi.unstubAllGlobals();
});

describe('PlaySession.seek (a play-loop command)', () => {
  test('sends the running engine a seek, without starting it again, and resolves once it applied it', async () => {
    const context = createSeekablePlay();
    playFirstThreeSeconds(context);
    let resolved = false;
    const sought = context.play.seek(5).then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    context.runs[0]!.tick();
    await sought;
    expect(context.runs).toHaveLength(1);
    expect(context.runs[0]!.seeks).toEqual([5]);
    expect(context.play.seekGeneration).toBe(1);
  });

  test('resolves the seeks a later one replaced, and at once for a play that cannot seek', async () => {
    const context = createSeekablePlay();
    playFirstThreeSeconds(context);
    const first = context.play.seek(4);
    const second = context.play.seek(6);
    context.runs[0]!.tick();
    await Promise.all([first, second]);
    expect(context.play.currentSeconds()).toBeCloseTo(6, 6);
    const manual = new PlaySession({ autoPlay: false });
    expect(canSeekPlay(manual)).toBe(false);
    await manual.seek(3);
  });

  // D1: the relaunched run's frames moved the counts to the target, while the combo only followed judge cues, which a
  // run started partway published none of. The engine's seek snapshot rebuilds the combo, max combo and graphs.
  test('shows the combo of the notes before the second sought', async () => {
    const context = createSeekablePlay();
    playFirstThreeSeconds(context);
    await seekAndTick(context, 5);
    expect(context.play.score.perfect).toBe(10);
    expect(context.play.playState.combo).toBe(10);
    expect(context.play.playState.maxCombo).toBe(10);
    expect(context.play.playState.scoreHistory.at(-1)).toEqual({ progress: 0.5, exScore: 20 });
  });

  test('shows a lower combo after seeking back, and the same HUD as a play that reached the second', async () => {
    const context = createSeekablePlay();
    playFirstThreeSeconds(context);
    await seekAndTick(context, 1);
    expect(context.play.playState.combo).toBe(2);
    expect(context.play.playState.maxCombo).toBe(2);
    // Reached without seeking: two cues and a frame at 1 s.
    const straight = createSeekablePlay();
    const run = straight.runs.at(-1)!;
    run.frame(0);
    run.judge(1);
    run.judge(2);
    run.frame(1);
    expect(context.play.playState).toMatchObject({
      combo: straight.play.playState.combo,
      maxCombo: straight.play.playState.maxCombo,
      exScore: straight.play.playState.exScore,
    });
    expect(context.play.score).toEqual(straight.play.score);
  });

  // D2: the view's clock was anchored once, so a stale frame of the stopped run could move it. It now runs on from
  // every frame, and a frame older than the last seek is dropped.
  test('follows the second sought when a stale frame of the old position arrives', async () => {
    const context = createSeekablePlay();
    const run = playFirstThreeSeconds(context);
    await seekAndTick(context, 5);
    run.frame(3.1, 0);
    expect(context.play.currentSeconds()).toBeCloseTo(5, 6);
    context.audioContext.currentTime += 1;
    expect(context.play.currentSeconds()).toBeCloseTo(6, 6);
  });

  test('stays paused when sought while paused, at the second sought', async () => {
    const context = createSeekablePlay();
    playFirstThreeSeconds(context);
    context.play.requestTogglePause();
    context.runs[0]!.tick();
    await seekAndTick(context, 7);
    expect(context.play.isPaused()).toBe(true);
    expect(context.engine.paused).toBe(true);
    context.audioContext.currentTime += 2;
    expect(context.play.currentSeconds()).toBeCloseTo(7, 6);
  });

  test('voids what the play showed of the old position', async () => {
    const context = createSeekablePlay();
    playFirstThreeSeconds(context);
    context.runs[0]!.options.ui.onCommand?.({ kind: 'press-lane', channel: '11' });
    context.runs[0]!.options.ui.onCommand?.({ kind: 'trigger-poor-bga', seconds: 2.9 });
    expect(context.play.pressedChannels.has('11')).toBe(true);
    await seekAndTick(context, 1);
    expect(context.play.pressedChannels.size).toBe(0);
    expect(context.play.keyBeamStartedAt.size).toBe(0);
    expect(context.play.lastPoorAt).toBe(-Number.POSITIVE_INFINITY);
    expect(context.play.displayedScore).toBe(context.play.score.score);
  });

  test('plays on when sought back out of its lead-out', async () => {
    const context = createSeekablePlay();
    playFirstThreeSeconds(context);
    context.runs[0]!.options.engineOptions?.holdAfterChart?.onSettled?.();
    expect(context.play.chartEnded).toBe(true);
    expect(context.play.chartEndTimeout).toBeDefined();
    await seekAndTick(context, 2);
    expect(context.play.chartEnded).toBe(false);
    expect(context.play.chartEndTimeout).toBeUndefined();
    expect(context.play.sharedEngineChartSettled).toBe(false);
  });
});

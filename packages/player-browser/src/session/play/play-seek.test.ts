import { createEmptyJSON } from '@be-music/chart-source';
import { PlayerInterruptedError, type PlayerSummary } from '@be-music/player-engine';
import {
  createPlayerInputSignalBus,
  type PlayerInputSignalBus,
  type PlayerUIFramePayload,
} from '@be-music/player-engine/signals';
import type { LibraryChart } from '@be-music/player-scene-model';
import { afterEach, describe, expect, test, vi } from 'vite-plus/test';
import { runEngineDriver, type EngineDriverOptions } from '../../runtime/engine-driver.ts';
import { launchSharedEngine } from './play-engine.ts';
import { PlaySession } from './play-session.ts';

vi.mock('../../runtime/engine-driver.ts', () => ({ runEngineDriver: vi.fn() }));

/**
 * Seeking an AUTO play (`seekPlay`) against a fake engine that answers as the real one does today: a run launched with
 * `startAtSeconds` publishes the counts of the notes before it in its frames, and no judge cue for them. The failing
 * cases pin the defects of seeking by relaunching the engine (`docs/adr/0015-preview-seek.md`), which the seek command
 * of the play loop removes.
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
  totalNotes: 12,
  chart: createEmptyJSON('bms'),
};

/** One engine run the session launched: what it was launched with, its input bus, and its UI callbacks. */
interface FakeRun {
  readonly options: EngineDriverOptions;
  readonly inputSignals: PlayerInputSignalBus;
  /** Publishes a frame at chart second `seconds` with `perfect` PGREATs counted, as the run's UI runtime does. */
  frame(seconds: number, perfect: number): void;
  /** Publishes a judge cue. */
  judge(combo: number, channel: string): void;
  /**
   * Announces the run's start partway as the engine does on its first tick: a `seek` command with the snapshot of
   * `perfect` PGREATs judged before `seconds` (each half a second apart), then a frame there.
   */
  start(seconds: number, perfect: number): void;
}

function summaryOf(perfect: number): PlayerSummary {
  return {
    total: 12,
    perfect,
    fast: 0,
    slow: 0,
    great: 0,
    good: 0,
    bad: 0,
    poor: 0,
    emptyPoor: 0,
    exScore: perfect * 2,
    score: Math.round((perfect / 12) * 200_000),
    combo: perfect,
    maxCombo: perfect,
  };
}

function frameAt(seconds: number, perfect: number): PlayerUIFramePayload {
  return {
    currentBeat: seconds * 2,
    currentSeconds: seconds,
    totalSeconds: 10,
    summary: summaryOf(perfect),
    notes: [],
  };
}

/** An AUTO play on a fake audio clock and a fake engine; every launched run is kept in `runs`. */
function createSeekablePlay() {
  const audioContext = { currentTime: 100, resume: async () => {}, suspend: async () => {} };
  const runs: FakeRun[] = [];
  vi.mocked(runEngineDriver).mockImplementation((options) => {
    const inputSignals = createPlayerInputSignalBus();
    options.onInputSignalsReady?.({ inputSignals });
    // The run ends when the session interrupts it (F5, as a seek stops the engine), as the engine does.
    const promise = new Promise<PlayerSummary>((_resolve, reject) => {
      const drain = (): void => {
        if (inputSignals.drainCommands().some((command) => command.kind === 'interrupt')) {
          reject(new PlayerInterruptedError('restart'));
        }
      };
      inputSignals.pushCommand = ((push) => (command) => {
        push(command);
        queueMicrotask(drain);
      })(inputSignals.pushCommand);
    });
    runs.push({
      options,
      inputSignals,
      frame: (seconds, perfect) => options.ui.onFrame?.(frameAt(seconds, perfect)),
      judge: (combo, channel) =>
        options.ui.onJudgeCombo?.({ judge: 'PERFECT', combo, channel, updatedAtMs: audioContext.currentTime * 1000 }),
      start: (seconds, perfect) => {
        options.ui.onCommand?.({
          kind: 'seek',
          generation: 1,
          seconds,
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
        options.ui.onFrame?.(frameAt(seconds, perfect));
      },
    });
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
  return { play, runs, audioContext };
}

/** The first run plays from 0 to 3 s: six notes judged, one cue each, the view's clock anchored to the engine's. */
function playFirstThreeSeconds(context: ReturnType<typeof createSeekablePlay>): FakeRun {
  const first = context.runs[0]!;
  for (let combo = 1; combo <= 6; combo += 1) first.judge(combo, '11');
  context.audioContext.currentTime += 3;
  first.frame(3, 6);
  return first;
}

afterEach(() => {
  vi.mocked(runEngineDriver).mockReset();
});

describe('seekPlay (relaunching the engine)', () => {
  test('relaunches the engine at the second sought', async () => {
    const context = createSeekablePlay();
    playFirstThreeSeconds(context);
    await context.play.seek(5);
    expect(context.runs).toHaveLength(2);
    expect(context.runs[1]!.options.engineOptions?.startAtSeconds).toBe(5);
  });

  // D1: the counts followed the target from the relaunched run's frames, the combo only from judge cues, which a run
  // started partway publishes none of for the notes before its start. The engine's seek snapshot rebuilds them.
  test('shows the combo of the notes before the second sought', async () => {
    const context = createSeekablePlay();
    playFirstThreeSeconds(context);
    await context.play.seek(5);
    context.runs[1]!.start(5, 9);
    expect(context.play.score.perfect).toBe(9);
    expect(context.play.playState.combo).toBe(9);
    expect(context.play.playState.maxCombo).toBe(9);
    expect(context.play.playState.scoreHistory.at(-1)).toEqual({ progress: 0.45, exScore: 18 });
  });

  test('shows a lower combo after seeking back', async () => {
    const context = createSeekablePlay();
    playFirstThreeSeconds(context);
    await context.play.seek(1);
    context.runs[1]!.start(1, 2);
    expect(context.play.playState.combo).toBe(2);
    expect(context.play.playState.maxCombo).toBe(2);
  });

  // D2: the run being stopped can still publish a frame once the next run is anchored; the view's clock then
  // re-anchors to that stale frame's second and the next run's frames no longer move it.
  test.fails('follows the second sought when a stale frame of the stopped run arrives', async () => {
    const context = createSeekablePlay();
    const first = playFirstThreeSeconds(context);
    await context.play.seek(5);
    first.frame(3.1, 6);
    context.runs[1]!.frame(5, 9);
    expect(context.play.currentSeconds()).toBeCloseTo(5, 6);
  });
});

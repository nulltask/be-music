import { beforeEach, describe, expect, test, vi } from 'vite-plus/test';

// The engine writes to a mocked Node audio sink (shared state in test-support/player-fixtures.ts).
vi.mock('./audio-sink.ts', async () => (await import('./test-support/player-fixtures.ts')).mockAudioSinkModule());

import { computeChartFingerprint, computePlayFingerprint, drawRandomOutcomes, type RandomDraws } from '@be-music/chart';
import { createEmptyJson, type BeMusicJson } from '../../json/src/index.ts';
import { parseChart, parseChartFile, resolveBmsControlFlowWithDraws } from '../../parser/src/index.ts';
import { resolveBeatorajaDefaultTotal, resolveLr2DefaultTotal } from './ruleset/index.ts';
import {
  autoPlay,
  type PlayerLoadProgress,
  type PlayerRulesetInfo,
  extractPlayableNotes,
  manualPlay,
  formatRandomPatternSummary,
  PlayerInterruptedError,
  resolveBmsControlFlowForPlayback,
  resolvePlayChart,
  type PlayerSummary,
} from './index.ts';
import type { PlayerUiCommand } from './core/ui-signal-bus.ts';
import { simulatePlaylog, type BeMusicPlaylog } from './playlog/index.ts';
import {
  resetAudioSinkState,
  unifiedBmsChartPath,
  createLnobjLongNoteChart,
  createScratchLnobjLongNoteChart,
  createInvisibleOnlyChart,
  createPlayableOnlyChart,
  createBgmOnlyChart,
  createTimelineLoggingChart,
  createPoorBgaLoggingChart,
  createScheduledInputRuntime,
  type RecordedJudgeCombo,
  createJudgeComboRecorder,
  createLongNoteCommandRecorder,
  createPlaybackEndRecorder,
  hasAnyNonSilentAudioWrite,
} from './test-support/player-fixtures.ts';

beforeEach(resetAudioSinkState);

describe('player', () => {
  test('player: auto play finishes successfully', async () => {
    // The chart has `#RANDOM` blocks; the host resolves it once and hands the engine the result with its draws.
    const { chart: json, randomDraws } = resolvePlayChart(await parseChartFile(unifiedBmsChartPath));

    const summary = await autoPlay(json, {
      randomDraws,
      auto: true,
      speed: 48,
      leadInMs: 0,
      audio: false,
      tui: false,
    });

    expect(summary.total).toBeGreaterThan(0);
    expect(summary.perfect).toBe(summary.total);
    expect(summary.fast).toBe(0);
    expect(summary.slow).toBe(0);
    expect(summary.great).toBe(0);
    expect(summary.good).toBe(0);
    expect(summary.bad).toBe(0);
    expect(summary.poor).toBe(0);
    expect(summary.exScore).toBe(summary.total * 2);
    expect(summary.score).toBe(200000);
  });

  test('player: auto play waits for UI BGA playback tail', async () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.events = [{ measure: 0, channel: '11', position: [0, 1], value: '01' }];

    const frameEndSeconds: number[] = [];
    await autoPlay(json, {
      auto: true,
      speed: 240,
      leadInMs: 0,
      audio: false,
      createUiRuntime: createPlaybackEndRecorder(2, frameEndSeconds),
    });

    expect(frameEndSeconds.at(-1)).toBeGreaterThanOrEqual(2);
  });

  test('player: starts audio preparation while UI BGA initialization is still pending', async () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.events = [{ measure: 0, channel: '11', position: [0, 1] as const, value: '01' }];

    let resolveUiInitialization: (() => void) | undefined;
    const uiInitialization = new Promise<void>((resolve) => {
      resolveUiInitialization = resolve;
    });
    const progressUpdates: PlayerLoadProgress[] = [];

    const playPromise = autoPlay(json, {
      auto: true,
      speed: 240,
      leadInMs: 0,
      audio: false,
      onLoadProgress: (progress) => {
        progressUpdates.push(progress);
      },
      createUiRuntime: async () => {
        await uiInitialization;
        return undefined;
      },
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(progressUpdates.some((progress) => progress.message === 'Audio disabled; skipping audio setup.')).toBe(true);
    expect(
      progressUpdates.some(
        (progress) => progress.audioStatus?.state === 'disabled' && progress.graphicsStatus?.state === 'pending',
      ),
    ).toBe(true);

    resolveUiInitialization?.();
    await playPromise;
  });

  test('player: auto play does not sound invisible objects', async () => {
    await autoPlay(createInvisibleOnlyChart(), {
      auto: true,
      speed: 240,
      leadInMs: 0,
      audio: true,
      audioHeadPaddingMs: 0,
      audioLeadMs: 0,
      audioLeadMaxMs: 0,
      limiter: false,
      tui: false,
      writeOutput: () => undefined,
    });

    expect(hasAnyNonSilentAudioWrite()).toBe(false);
  });

  test.each(['31', '3A', '4Q'])('player: auto play does not trigger the invisible object on %s', async (channel) => {
    // bmson `keyboard-24k` hidden notes (`key_channels`) land on the extended invisible lanes `3A`-`3Q` / `4A`-`4Q`,
    // which must stay as silent in AUTO as the classic `31`-`49`.
    const output: string[] = [];
    await autoPlay(createInvisibleOnlyChart(channel), {
      auto: true,
      speed: 240,
      leadInMs: 0,
      tui: false,
      audio: true,
      writeOutput: (text) => {
        output.push(text);
      },
    });

    expect(output.filter((line) => line.includes('kind:sample-trigger'))).toEqual([]);
  });

  test('player: logs real-time triggered events when running without TUI', async () => {
    const json = createBgmOnlyChart();
    const output: string[] = [];

    await autoPlay(json, {
      auto: true,
      speed: 240,
      leadInMs: 0,
      tui: false,
      audio: true,
      writeOutput: (text) => {
        output.push(text);
      },
    });

    expect(
      output.some(
        (line) =>
          line.includes('kind:sample-trigger') &&
          line.includes('time:0:00.00') &&
          line.includes('source:realtime') &&
          line.includes('channel:01') &&
          line.includes('sample:01') &&
          line.includes('file:not-found.wav'),
      ),
    ).toBe(true);
  });

  test('player: logs timing and BGA timeline events when running without TUI', async () => {
    const json = createTimelineLoggingChart();
    const output: string[] = [];

    await autoPlay(json, {
      auto: true,
      speed: 240,
      leadInMs: 0,
      tui: false,
      audio: false,
      writeOutput: (text) => {
        output.push(text);
      },
    });

    expect(
      output.some(
        (line) =>
          line.includes('kind:measure-length-change') && line.includes('measure:1') && line.includes('length:0.5'),
      ),
    ).toBe(true);
    expect(
      output.some(
        (line) =>
          line.includes('kind:measure-length-change') && line.includes('measure:2') && line.includes('length:1'),
      ),
    ).toBe(true);
    expect(
      output.some(
        (line) => line.includes('kind:bpm-change') && line.includes('time:0:00.00') && line.includes('value:120'),
      ),
    ).toBe(true);
    expect(output.some((line) => line.includes('kind:bpm-change') && line.includes('value:180'))).toBe(true);
    expect(
      output.some(
        (line) => line.includes('kind:scroll-change') && line.includes('time:0:00.00') && line.includes('value:0.5'),
      ),
    ).toBe(true);
    expect(output.some((line) => line.includes('kind:speed-change') && line.includes('value:1.5'))).toBe(true);
    expect(output.some((line) => line.includes('kind:stop') && line.includes('state:start'))).toBe(true);
    expect(output.some((line) => line.includes('kind:stop') && line.includes('state:end'))).toBe(true);
    expect(
      output.some(
        (line) => line.includes('kind:judge-rank-change') && line.includes('time:0:00.00') && line.includes('rank:48'),
      ),
    ).toBe(true);
    expect(
      output.some(
        (line) =>
          line.includes('kind:bga-cue') &&
          line.includes('time:0:00.00') &&
          line.includes('layer:base') &&
          line.includes('key:01') &&
          line.includes('asset:base.png') &&
          line.includes('file:base.png'),
      ),
    ).toBe(true);
    expect(
      output.some(
        (line) =>
          line.includes('kind:bga-cue') &&
          line.includes('layer:poor') &&
          line.includes('key:02') &&
          line.includes('asset:poor.png') &&
          line.includes('file:poor.png'),
      ),
    ).toBe(true);
    expect(
      output.some(
        (line) =>
          line.includes('kind:bga-cue') &&
          line.includes('layer:layer') &&
          line.includes('key:03') &&
          line.includes('asset:layer.png') &&
          line.includes('file:layer.png'),
      ),
    ).toBe(true);
    expect(
      output.some(
        (line) =>
          line.includes('kind:bga-cue') &&
          line.includes('layer:layer2') &&
          line.includes('key:04') &&
          line.includes('asset:layer2.png') &&
          line.includes('file:layer2.png'),
      ),
    ).toBe(true);
  });

  test('player: logs POOR BGA activity when running without TUI', async () => {
    const json = createPoorBgaLoggingChart();
    const output: string[] = [];

    await manualPlay(json, {
      speed: 240,
      leadInMs: 0,
      tui: false,
      audio: false,
      writeOutput: (text) => {
        output.push(text);
      },
    });

    expect(output.some((line) => line.includes('kind:bga-poor') && line.includes('state:trigger'))).toBe(true);
    expect(output.some((line) => line.includes('key:00 asset:fallback.png file:fallback.png'))).toBe(true);
  });

  test('player: global volume 0 mutes playable sounds', async () => {
    await autoPlay(createPlayableOnlyChart(), {
      auto: true,
      speed: 240,
      leadInMs: 0,
      audio: true,
      audioHeadPaddingMs: 0,
      audioLeadMs: 0,
      audioLeadMaxMs: 0,
      volume: 0,
      limiter: false,
      tui: false,
      writeOutput: () => undefined,
    });

    expect(hasAnyNonSilentAudioWrite()).toBe(false);
  });

  test('player: global volume 0 mutes BGM sounds', async () => {
    await autoPlay(createBgmOnlyChart(), {
      auto: true,
      speed: 240,
      leadInMs: 0,
      audio: true,
      audioHeadPaddingMs: 0,
      audioLeadMs: 0,
      audioLeadMaxMs: 0,
      volume: 0,
      limiter: false,
      tui: false,
      writeOutput: () => undefined,
    });

    expect(hasAnyNonSilentAudioWrite()).toBe(false);
  });

  test('player: manual play waits for UI BGA playback tail after notes are judged', async () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.events = [{ measure: 0, channel: '11', position: [0, 1], value: '01' }];

    const frameEndSeconds: number[] = [];
    await manualPlay(json, {
      speed: 240,
      leadInMs: 0,
      audio: false,
      createUiRuntime: createPlaybackEndRecorder(2, frameEndSeconds),
    });

    expect(frameEndSeconds.at(-1)).toBeGreaterThanOrEqual(2);
  });

  test('player: browser fallback yield does not spin through queueMicrotask during manual play', async () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.events = [{ measure: 0, channel: '11', position: [0, 1], value: '01' }];

    const setImmediateDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'setImmediate');
    const queueMicrotaskDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'queueMicrotask');
    const originalQueueMicrotask = globalThis.queueMicrotask.bind(globalThis);
    const queueMicrotaskSpy = vi.fn((callback: VoidFunction) => originalQueueMicrotask(callback));
    Object.defineProperty(globalThis, 'setImmediate', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    Object.defineProperty(globalThis, 'queueMicrotask', {
      configurable: true,
      writable: true,
      value: queueMicrotaskSpy,
    });
    try {
      await manualPlay(json, {
        speed: 1000,
        leadInMs: 0,
        audio: false,
        tui: false,
        writeOutput: () => undefined,
      });
      expect(queueMicrotaskSpy).not.toHaveBeenCalled();
    } finally {
      if (setImmediateDescriptor) {
        Object.defineProperty(globalThis, 'setImmediate', setImmediateDescriptor);
      } else {
        delete (globalThis as { setImmediate?: unknown }).setImmediate;
      }
      if (queueMicrotaskDescriptor) {
        Object.defineProperty(globalThis, 'queueMicrotask', queueMicrotaskDescriptor);
      }
    }
  });

  test("player: derives the groove gauge TOTAL from LR2's note-count formula when #TOTAL is omitted", async () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.events = [{ measure: 0, channel: '11', position: [0, 1], value: '01' }];

    const summary = await autoPlay(json, {
      auto: true,
      speed: 48,
      leadInMs: 0,
      audio: false,
      tui: false,
    });

    // LR2 `LR2_bmsload.cpp`: `(n / 5 + 200) * 0.8` below 400 notes — one note yields 160.16, not the flat 160 the
    // engine used to assume. See `resolveLr2DefaultTotal`.
    expect(summary.gauge?.effectiveTotal).toBeCloseTo(resolveLr2DefaultTotal(1), 9);
    expect(summary.gauge?.current).toBe(100);
    expect(summary.gauge?.cleared).toBe(true);
  });

  test('player: the selected gauge governs the run, not just its label', async () => {
    // Regression guard for the era when the gauge picker was cosmetic: HARD rendered red but ran GROOVE's numbers
    // and reported CLEARED at 2 %. Every gauge now comes straight out of the active ruleset.
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.events = [{ measure: 0, channel: '11', position: [0, 1], value: '01' }];

    const groove = await autoPlay(json, { auto: true, speed: 48, leadInMs: 0, audio: false, tui: false });
    expect(groove.gauge?.type).toBe('GROOVE');
    expect(groove.gauge?.initial).toBe(20);
    expect(groove.gauge?.clearThreshold).toBe(80);
    expect(groove.gauge?.survival).toBe(false);

    const hard = await autoPlay(json, {
      auto: true,
      speed: 48,
      leadInMs: 0,
      audio: false,
      tui: false,
      gauge: 'HARD',
    });
    // LR2 HARD starts full and clears by surviving rather than by crossing a threshold.
    expect(hard.gauge?.type).toBe('HARD');
    expect(hard.gauge?.initial).toBe(100);
    expect(hard.gauge?.survival).toBe(true);
    expect(hard.gauge?.failedMidPlay).toBe(false);
    expect(hard.gauge?.cleared).toBe(true);
  });

  test('player: the judge ruleset picks the gauge line-up as well as the windows', async () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.events = [{ measure: 0, channel: '11', position: [0, 1], value: '01' }];

    // Each ruleset names its default recovery gauge differently, and beatoraja / IIDX derive TOTAL from their own
    // formulas rather than LR2's.
    const beatoraja = await autoPlay(json, {
      auto: true,
      speed: 48,
      leadInMs: 0,
      audio: false,
      tui: false,
      judgeRuleset: 'beatoraja',
    });
    expect(beatoraja.gauge?.type).toBe('NORMAL');
    expect(beatoraja.gauge?.effectiveTotal).toBeCloseTo(resolveBeatorajaDefaultTotal(1), 9);

    const iidx = await autoPlay(json, {
      auto: true,
      speed: 48,
      leadInMs: 0,
      audio: false,
      tui: false,
      judgeRuleset: 'iidx',
      gauge: 'DEATH',
    });
    // IIDX has no HAZARD-style gauge; `'DEATH'` folds onto its hardest survival gauge.
    expect(iidx.gauge?.type).toBe('EX-HARD');
    expect(iidx.gauge?.survival).toBe(true);
  });

  function sixteenMissesChart(): BeMusicJson {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.events = Array.from({ length: 16 }, (_, index) => ({
      measure: 0,
      channel: '11',
      position: [index, 16] as [number, number],
      value: '01',
    }));
    return json;
  }

  test('player: a survival gauge that bottoms out ends the run there', async () => {
    // No input at all — every note misses. Under LR2 HARD each POOR drains a TOTAL- and note-count-scaled chunk,
    // so the gauge reaches the death border well before the chart ends, and the play stops scoring there.
    const summary = await manualPlay(sixteenMissesChart(), {
      speed: 64,
      leadInMs: 0,
      audio: false,
      tui: false,
      gauge: 'HARD',
    });

    expect(summary.poor).toBeGreaterThan(0);
    expect(summary.poor).toBeLessThan(16);
    expect(summary.gauge?.current).toBe(0);
    expect(summary.gauge?.failedMidPlay).toBe(true);
    expect(summary.gauge?.cleared).toBe(false);
  });

  test('player: with endOnFailure off, a dead survival gauge keeps judging to the end and stays failed', async () => {
    const summary = await manualPlay(sixteenMissesChart(), {
      speed: 64,
      leadInMs: 0,
      audio: false,
      tui: false,
      gauge: 'HARD',
      endOnFailure: false,
    });

    expect(summary.poor).toBe(16);
    expect(summary.gauge?.current).toBe(0);
    expect(summary.gauge?.failedMidPlay).toBe(true);
    expect(summary.gauge?.cleared).toBe(false);
  });

  test('player: resolves control-flow branches at playback time', async () => {
    const json = await parseChartFile(unifiedBmsChartPath);

    expect(extractPlayableNotes(json).some((note) => note.event.measure >= 20 && note.event.measure <= 23)).toBe(false);

    const resolvedWhenRandomIs1 = resolveBmsControlFlowForPlayback(json, () => 0).resolvedJson;
    expect(resolvedWhenRandomIs1.events.some((event) => event.measure === 20 && event.channel === '12')).toBe(true);
    expect(resolvedWhenRandomIs1.events.some((event) => event.measure === 21 && event.channel === '16')).toBe(true);
    expect(resolvedWhenRandomIs1.events.some((event) => event.measure === 23 && event.channel === '22')).toBe(true);
    expect(resolvedWhenRandomIs1.events.some((event) => event.measure === 23 && event.channel === '23')).toBe(true);
    expect(resolvedWhenRandomIs1.events.some((event) => event.measure === 23 && event.channel === '24')).toBe(false);

    const resolvedWhenRandomIs2 = resolveBmsControlFlowForPlayback(json, () => 0.9999999).resolvedJson;
    expect(resolvedWhenRandomIs2.events.some((event) => event.measure === 23 && event.channel === '23')).toBe(false);
    expect(resolvedWhenRandomIs2.events.some((event) => event.measure === 23 && event.channel === '24')).toBe(true);
  });

  test('player: resolves RANDOM pattern summary for control-flow playback', () => {
    const json = createEmptyJson('bms');
    json.bms.controlFlow = [
      { kind: 'directive', command: 'RANDOM', value: '3' },
      { kind: 'directive', command: 'IF', value: '2' },
      {
        kind: 'object',
        measure: 0,
        channel: '11',
        events: [{ measure: 0, channel: '11', position: [0, 1], value: '01' }],
      },
      { kind: 'directive', command: 'ENDIF' },
      { kind: 'directive', command: 'ENDRANDOM' },
    ];

    const resolved = resolveBmsControlFlowForPlayback(json, () => 0.5);
    expect(formatRandomPatternSummary(resolved.randomPatterns)).toBe('RANDOM 2/3');
    expect(
      resolved.resolvedJson.events.some(
        (event) => event.channel === '11' && event.value === '01' && event.measure === 0 && event.position[0] === 0,
      ),
    ).toBe(true);
  });

  describe('player: replays each #RANDOM / #SWITCH draw into the branch it reported', () => {
    // The final `#RANDOM 2` block puts a note on lane 11 for branch 1 and on lane 12 for branch 2, so the played
    // branch can be read back from the resolved events and compared with the reported pattern.
    const finalBlock = ['#RANDOM 2', '#IF 1', '#00111:01', '#ENDIF', '#IF 2', '#00112:01', '#ENDIF', '#ENDRANDOM'];
    const cases: Array<{ name: string; prefix: string[]; draws: number[]; expected: number }> = [
      { name: '#RANDOM 1', prefix: ['#RANDOM 1', '#ENDRANDOM'], draws: [0.9], expected: 2 },
      { name: '#RANDOM without a value', prefix: ['#RANDOM', '#ENDRANDOM'], draws: [0.9], expected: 2 },
      { name: '#RANDOM 0', prefix: ['#RANDOM 0', '#ENDRANDOM'], draws: [0.9], expected: 2 },
      { name: '#SWITCH 1', prefix: ['#SWITCH 1', '#ENDSW'], draws: [0.9], expected: 2 },
      { name: '#SETRANDOM', prefix: ['#SETRANDOM 2', '#ENDRANDOM'], draws: [0.9], expected: 2 },
      { name: '#SETSWITCH', prefix: ['#SETSWITCH 2', '#ENDSW'], draws: [0.9], expected: 2 },
      { name: '#SWITCH 3', prefix: ['#SWITCH 3', '#ENDSW'], draws: [0.9, 0], expected: 1 },
      { name: '#RANDOM 3', prefix: ['#RANDOM 3', '#ENDRANDOM'], draws: [0, 0.9], expected: 2 },
      {
        name: 'a #RANDOM 1 nested in an inactive branch',
        prefix: ['#RANDOM 2', '#IF 1', '#RANDOM 1', '#ENDRANDOM', '#ENDIF', '#ENDRANDOM'],
        draws: [0.9, 0],
        expected: 1,
      },
      {
        name: 'a #RANDOM 2 nested in an inactive branch',
        prefix: ['#RANDOM 2', '#IF 1', '#RANDOM 2', '#ENDRANDOM', '#ENDIF', '#ENDRANDOM'],
        draws: [0.9, 0, 0.9],
        expected: 2,
      },
    ];

    for (const { name, prefix, draws, expected } of cases) {
      test(`after ${name}`, () => {
        const json = parseChart(['#BPM 120', ...prefix, ...finalBlock].join('\n'), 'bms');
        let drawn = 0;
        const resolved = resolveBmsControlFlowForPlayback(json, () => {
          const value = draws[drawn] ?? 0;
          drawn += 1;
          return value;
        });

        const playedBranches = resolved.resolvedJson.events
          .filter((event) => event.channel === '11' || event.channel === '12')
          .map((event) => (event.channel === '11' ? 1 : 2));
        expect(playedBranches).toEqual([expected]);
        expect(resolved.randomPatterns.at(-1)).toMatchObject({ current: expected, total: 2 });
        expect(drawn).toBe(draws.length);
      });
    }
  });

  test('player: formats multiple RANDOM pattern summaries in declaration order', () => {
    const summary = formatRandomPatternSummary([
      { index: 1, current: 2, total: 3 },
      { index: 2, current: 4, total: 9 },
    ]);
    expect(summary).toBe('RANDOM #1 2/3  #2 4/9');
  });

  test('player: keeps SETRANDOM and RANDOM order in pattern summary', () => {
    const json = createEmptyJson('bms');
    json.bms.controlFlow = [
      { kind: 'directive', command: 'SETRANDOM', value: '4' },
      { kind: 'directive', command: 'RANDOM', value: '2' },
      { kind: 'directive', command: 'ENDRANDOM' },
    ];

    const resolved = resolveBmsControlFlowForPlayback(json, () => 0);
    expect(formatRandomPatternSummary(resolved.randomPatterns)).toBe('RANDOM #1 4/4  #2 1/2');
  });

  test('player: restart interrupt uses zero exit code', () => {
    const error = new PlayerInterruptedError('restart');
    expect(error.exitCode).toBe(0);
  });

  test('player: auto play ignores landmine notes in score totals', async () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.events = [
      { measure: 0, channel: '11', position: [0, 1], value: '01' },
      { measure: 0, channel: 'D1', position: [1, 2], value: '10' },
    ];

    const summary = await autoPlay(json, {
      auto: true,
      speed: 48,
      leadInMs: 0,
      audio: false,
      tui: false,
    });

    expect(summary.total).toBe(1);
    expect(summary.perfect).toBe(1);
    expect(summary.bad).toBe(0);
    expect(summary.poor).toBe(0);
  });

  test('player: auto play confirms long note combo at the end', async () => {
    const judgeCombos: RecordedJudgeCombo[] = [];
    const summary = await autoPlay(createLnobjLongNoteChart(1), {
      auto: true,
      speed: 4,
      leadInMs: 0,
      audio: false,
      createUiRuntime: createJudgeComboRecorder(judgeCombos),
    });

    expect(summary.total).toBe(1);
    expect(summary.perfect).toBe(1);
    const perfect = judgeCombos.find((entry) => entry.judge === 'PERFECT');
    expect(perfect?.combo).toBe(1);
    expect(perfect?.seconds).toBeGreaterThan(1.2);
  });

  test('player: ignores free-zone channel for score and judgment totals', async () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.events = [{ measure: 0, channel: '17', position: [0, 1], value: '01' }];

    const summary = await autoPlay(json, {
      auto: true,
      speed: 48,
      leadInMs: 0,
      audio: false,
      tui: false,
    });

    expect(summary.total).toBe(0);
    expect(summary.perfect).toBe(0);
    expect(summary.great).toBe(0);
    expect(summary.good).toBe(0);
    expect(summary.bad).toBe(0);
    expect(summary.poor).toBe(0);
    expect(summary.exScore).toBe(0);
    expect(summary.score).toBe(0);
  });

  test('player: treats channel 17 as regular lane note in 9-key mode', async () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.bms.player = 3;
    json.events = [{ measure: 0, channel: '17', position: [0, 1], value: '01' }];

    const summary = await autoPlay(json, {
      auto: true,
      speed: 48,
      leadInMs: 0,
      audio: false,
      tui: false,
    });

    expect(summary.total).toBe(1);
    expect(summary.perfect).toBe(1);
    expect(summary.poor).toBe(0);
    expect(summary.exScore).toBe(2);
  });

  test('player: auto scratch judges 16ch/26ch notes in manual play', async () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.events = [
      { measure: 0, channel: '16', position: [0, 1], value: '01' },
      { measure: 0, channel: '11', position: [0, 1], value: '02' },
    ];

    const summary = await manualPlay(json, {
      autoScratch: true,
      speed: 64,
      leadInMs: 0,
      audio: false,
      tui: false,
    });

    expect(summary.total).toBe(2);
    expect(summary.perfect).toBe(1);
    expect(summary.fast).toBe(0);
    expect(summary.slow).toBe(0);
    expect(summary.poor).toBe(1);
    expect(summary.bad).toBe(0);
  });

  test('player: auto scratch confirms long note combo at the end', async () => {
    const judgeCombos: RecordedJudgeCombo[] = [];
    const summary = await manualPlay(createScratchLnobjLongNoteChart(), {
      autoScratch: true,
      speed: 4,
      leadInMs: 0,
      audio: false,
      createUiRuntime: createJudgeComboRecorder(judgeCombos),
    });

    expect(summary.total).toBe(1);
    expect(summary.perfect).toBe(1);
    const perfect = judgeCombos.find((entry) => entry.judge === 'PERFECT');
    expect(perfect?.combo).toBe(1);
    expect(perfect?.seconds).toBeGreaterThan(1.2);
  });

  test('player: auto play emits release-lane after the LN tail completes', async () => {
    // Regression test for the autoplay LN visual: every `hold-lane-until-beat` pushed at the LN head
    // must be paired with a `release-lane` at the tail so the LR2 LN-hold timer (70..89) and the lane
    // laser (100..117) fade out instead of staying lit indefinitely after the LN visually clears.
    const commands: { kind: string; channel?: string }[] = [];
    await autoPlay(createLnobjLongNoteChart(1), {
      auto: true,
      speed: 4,
      leadInMs: 0,
      audio: false,
      createUiRuntime: async (context) => {
        const original = context.uiSignals.pushCommand;
        context.uiSignals.pushCommand = (command) => {
          commands.push({ kind: command.kind, channel: 'channel' in command ? command.channel : undefined });
          original(command);
        };
        return {
          tuiEnabled: true,
          start: () => undefined,
          stop: () => undefined,
          dispose: () => undefined,
          triggerPoor: () => undefined,
          clearPoor: () => undefined,
        };
      },
    });

    const holdIndex = commands.findIndex((c) => c.kind === 'hold-lane-until-beat' && c.channel === '11');
    expect(holdIndex).toBeGreaterThanOrEqual(0);
    const releaseIndex = commands.findIndex((c, i) => i > holdIndex && c.kind === 'release-lane' && c.channel === '11');
    expect(releaseIndex).toBeGreaterThan(holdIndex);
  });

  test('player: auto scratch emits release-lane after the LN tail completes', async () => {
    // Regression test mirroring the autoplay LN release-lane test, but for the manual auto-scratch path
    // (`drainPendingAutoScratchLongNotes`). The tail must release the lane state so the scratch streak /
    // LN-hold timer doesn't keep glowing after the LN's visual end.
    const commands: { kind: string; channel?: string }[] = [];
    await manualPlay(createScratchLnobjLongNoteChart(), {
      autoScratch: true,
      speed: 4,
      leadInMs: 0,
      audio: false,
      createUiRuntime: async (context) => {
        const original = context.uiSignals.pushCommand;
        context.uiSignals.pushCommand = (command) => {
          commands.push({ kind: command.kind, channel: 'channel' in command ? command.channel : undefined });
          original(command);
        };
        return {
          tuiEnabled: true,
          start: () => undefined,
          stop: () => undefined,
          dispose: () => undefined,
          triggerPoor: () => undefined,
          clearPoor: () => undefined,
        };
      },
    });

    const holdIndex = commands.findIndex((c) => c.kind === 'hold-lane-until-beat' && c.channel === '16');
    expect(holdIndex).toBeGreaterThanOrEqual(0);
    const releaseIndex = commands.findIndex((c, i) => i > holdIndex && c.kind === 'release-lane' && c.channel === '16');
    expect(releaseIndex).toBeGreaterThan(holdIndex);
  });

  test('player: auto play announces each long note start and completion with the mode it plays in', async () => {
    const lr2Commands: PlayerUiCommand[] = [];
    await autoPlay(createLnobjLongNoteChart(2), {
      auto: true,
      speed: 4,
      leadInMs: 0,
      audio: false,
      createUiRuntime: createLongNoteCommandRecorder(lr2Commands),
    });
    // LR2 plays every long note as an LN, whatever `#LNMODE` says.
    expect(lr2Commands).toEqual([
      { kind: 'long-note-start', channel: '11', beat: 4, mode: 'ln' },
      { kind: 'long-note-end', channel: '11', outcome: 'complete' },
    ]);

    const beatorajaCommands: PlayerUiCommand[] = [];
    await autoPlay(createLnobjLongNoteChart(3), {
      auto: true,
      speed: 4,
      leadInMs: 0,
      audio: false,
      judgeRuleset: 'beatoraja',
      createUiRuntime: createLongNoteCommandRecorder(beatorajaCommands),
    });
    expect(beatorajaCommands).toEqual([
      { kind: 'long-note-start', channel: '11', beat: 4, mode: 'hcn' },
      { kind: 'long-note-end', channel: '11', outcome: 'complete' },
    ]);
  });

  test('player: auto scratch announces the scratch long note start and completion', async () => {
    const commands: PlayerUiCommand[] = [];
    await manualPlay(createScratchLnobjLongNoteChart(), {
      autoScratch: true,
      speed: 4,
      leadInMs: 0,
      audio: false,
      createUiRuntime: createLongNoteCommandRecorder(commands),
    });
    expect(commands).toEqual([
      { kind: 'long-note-start', channel: '16', beat: 4, mode: 'ln' },
      { kind: 'long-note-end', channel: '16', outcome: 'complete' },
    ]);
  });

  test('player: a long note held to its end completes', async () => {
    const commands: PlayerUiCommand[] = [];
    await manualPlay(createLnobjLongNoteChart(), {
      speed: 1,
      leadInMs: 0,
      audio: false,
      createUiRuntime: createLongNoteCommandRecorder(commands),
      createInputRuntime: createScheduledInputRuntime([
        { delayMs: 520, command: { kind: 'kitty-state', pressTokens: ['z'], repeatTokens: [], releaseTokens: [] } },
        { delayMs: 520, command: { kind: 'lane-input', tokens: ['z'] } },
        { delayMs: 1700, command: { kind: 'interrupt', reason: 'escape' } },
      ]),
    }).catch((error: unknown) => {
      if (!(error instanceof PlayerInterruptedError)) throw error;
    });
    expect(commands).toEqual([
      { kind: 'long-note-start', channel: '11', beat: 4, mode: 'ln' },
      { kind: 'long-note-end', channel: '11', outcome: 'complete' },
    ]);
  });

  test('player: a long note released early is dropped', async () => {
    const commands: PlayerUiCommand[] = [];
    await manualPlay(createLnobjLongNoteChart(1), {
      speed: 1,
      leadInMs: 0,
      audio: false,
      createUiRuntime: createLongNoteCommandRecorder(commands),
      createInputRuntime: createScheduledInputRuntime([
        { delayMs: 520, command: { kind: 'kitty-state', pressTokens: ['z'], repeatTokens: [], releaseTokens: [] } },
        { delayMs: 520, command: { kind: 'lane-input', tokens: ['z'] } },
        { delayMs: 900, command: { kind: 'kitty-state', pressTokens: [], repeatTokens: [], releaseTokens: ['z'] } },
        { delayMs: 1200, command: { kind: 'interrupt', reason: 'escape' } },
      ]),
    }).catch((error: unknown) => {
      if (!(error instanceof PlayerInterruptedError)) throw error;
    });
    expect(commands).toEqual([
      { kind: 'long-note-start', channel: '11', beat: 4, mode: 'ln' },
      { kind: 'long-note-end', channel: '11', outcome: 'dropped' },
    ]);
  });

  test('player: reports the resolved ruleset and its windows before playback', async () => {
    const manualInfos: PlayerRulesetInfo[] = [];
    await manualPlay(createLnobjLongNoteChart(), {
      speed: 4,
      leadInMs: 0,
      audio: false,
      tui: false,
      judgeRuleset: 'beatoraja',
      onRulesetResolved: (info) => manualInfos.push(info),
      createInputRuntime: createScheduledInputRuntime([
        { delayMs: 0, command: { kind: 'interrupt', reason: 'escape' } },
      ]),
    }).catch((error: unknown) => {
      if (!(error instanceof PlayerInterruptedError)) throw error;
    });
    expect(manualInfos).toHaveLength(1);
    expect(manualInfos[0]).toMatchObject({ id: 'beatoraja/0', rulesetId: 'beatoraja', longNoteStyle: 'per-note' });
    const [lateBoundUs, earlyBoundUs] = manualInfos[0]!.windows.note.judges[0];
    expect(lateBoundUs).toBeLessThan(0);
    expect(earlyBoundUs).toBeGreaterThan(0);

    // The debug BAD-window override (a replay restores it from the log) reaches the reported tables too.
    const autoInfos: PlayerRulesetInfo[] = [];
    await autoPlay(createLnobjLongNoteChart(), {
      auto: true,
      speed: 4,
      leadInMs: 0,
      audio: false,
      tui: false,
      judgeWindowMs: 300,
      onRulesetResolved: (info) => autoInfos.push(info),
    });
    expect(autoInfos).toHaveLength(1);
    expect(autoInfos[0]).toMatchObject({ id: 'lr2/0', rulesetId: 'lr2', longNoteStyle: 'ln' });
    expect(autoInfos[0]!.windows.note.judges[3][1]).toBe(300_000);
  });

  test('player: stray key in front of a note fires LR2 empty POOR — gauge -2, counters untouched', async () => {
    // BPM 240 → measure 1 starts at chart 1.0 s. The press lands at ~0.3 s, i.e. ~0.7 s before the note — outside
    // the BAD window but inside LR2's 1-second early 空POOR region.
    const json = createEmptyJson('bms');
    json.metadata.bpm = 240;
    json.events = [{ measure: 1, channel: '11', position: [0, 1], value: '01' }];

    const summary = await manualPlay(json, {
      speed: 1,
      leadInMs: 0,
      audio: false,
      tui: false,
      createInputRuntime: createScheduledInputRuntime([
        { delayMs: 300, command: { kind: 'lane-input', tokens: ['z'] } },
        { delayMs: 400, command: { kind: 'interrupt', reason: 'escape' } },
      ]),
    });

    expect(summary.total).toBe(1);
    expect(summary.perfect).toBe(0);
    expect(summary.great).toBe(0);
    expect(summary.good).toBe(0);
    expect(summary.bad).toBe(0);
    // Empty POOR (kara-poor / 空POOR) is NOT counted in `summary.poor` — that slot is reserved for miss POOR
    // (minogashi-poor / 見逃しPOOR, i.e. notes that passed without input). Matches LR2.
    expect(summary.poor).toBe(0);
    // GROOVE gauge starts at 20 and LR2's EMPTY_POOR delta is -2, giving 18. Matches LR2:
    // phantom presses lightly drain even on the forgiving gauges (HARD/DEATH drain harder).
    expect(summary.gauge?.current).toBeCloseTo(18, 9);
    expect(summary.gauge?.cleared).toBe(false);
  });

  test('player: stray key with no note within 1 s is harmless (LR2 — no empty POOR)', async () => {
    // BPM 60 → the only note sits at chart 4.0 s. A press at ~0 s is far outside LR2's 1-second early 空POOR
    // region, so nothing charges: no gauge drain, no POOR.
    const json = createEmptyJson('bms');
    json.metadata.bpm = 60;
    json.events = [{ measure: 1, channel: '11', position: [0, 1], value: '01' }];

    const output: string[] = [];
    const summary = await manualPlay(json, {
      speed: 64,
      leadInMs: 0,
      audio: false,
      tui: false,
      writeOutput: (text) => {
        output.push(text);
      },
      createInputRuntime: ({ inputSignals }) => ({
        start: () => {
          inputSignals.pushCommand({ kind: 'lane-input', tokens: ['z'] });
          inputSignals.pushCommand({ kind: 'interrupt', reason: 'escape' });
        },
        stop: () => undefined,
      }),
    });

    expect(summary.poor).toBe(0);
    expect(summary.gauge?.current).toBeCloseTo(20, 9);
    expect(output.some((line) => line.includes('result:EMPTY_POOR'))).toBe(false);
  });

  test('player: records the #RANDOM draws and the extension-aware fingerprints in the play log', async () => {
    const json = parseChart(
      [
        '#BPM 240',
        '#00111:01',
        '#RANDOM 2',
        '#IF 1',
        '#00113:01',
        '#ENDIF',
        '#IF 2',
        '#00114:01',
        '#ENDIF',
        '#ENDRANDOM',
      ].join('\n'),
      'bms',
    );
    const randomDraws = drawRandomOutcomes(json, () => 0.9);
    let playlog: BeMusicPlaylog | undefined;
    await autoPlay(json, {
      speed: 64,
      leadInMs: 0,
      audio: false,
      tui: false,
      laneModeExtension: '.pms',
      randomDraws,
      onPlaylogRecorded: (recorded) => {
        playlog = recorded;
      },
    });
    expect(playlog!.play.randomDraws).toEqual([{ command: 'RANDOM', range: 2, value: 2 }]);
    const replayed = resolveBmsControlFlowWithDraws(json, playlog!.play.randomDraws!);
    expect(playlog!.chart.playFingerprint).toBe(computePlayFingerprint(replayed, { chartPath: '.pms' }));
    expect(playlog!.chart.playFingerprint).not.toBe(computePlayFingerprint(replayed, { chartPath: undefined }));
    // The engine resolved `#RANDOM` itself, so its input is the source chart the chart fingerprint describes.
    expect(playlog!.chart.chartFingerprint).toBe(computeChartFingerprint(json, { chartPath: '.pms' }));
  });

  test('player: onPlaylogRecorded captures the resolved chart, raw inputs, and native result cache', async () => {
    // BPM 240 → measure 1 starts at chart 1.0 s. One press near the note, then natural chart end.
    const json = createEmptyJson('bms');
    json.metadata.bpm = 240;
    json.metadata.title = 'Playlog Test';
    json.metadata.total = 300;
    json.events = [{ measure: 1, channel: '11', position: [0, 1], value: '01' }];

    let playlog: BeMusicPlaylog | undefined;
    const summary = await manualPlay(json, {
      speed: 1,
      leadInMs: 0,
      audio: false,
      tui: false,
      recordPlaylog: { gauge: 'GROOVE', randomLane: { p1: 'MIRROR' } },
      onPlaylogRecorded: (recorded) => {
        playlog = recorded;
      },
      createInputRuntime: createScheduledInputRuntime([
        { delayMs: 1000, command: { kind: 'lane-input', tokens: ['z'] } },
      ]),
    });

    expect(playlog).toBeDefined();
    expect(playlog!.format).toBe('be-music-playlog');
    expect(playlog!.version).toBe(0);
    expect(playlog!.clock).toEqual({ unit: 'us', origin: 'chart-zero' });
    expect(playlog!.chart.title).toBe('Playlog Test');
    expect(playlog!.chart.total).toBe(300);
    expect(playlog!.chart.noteCount).toBe(1);
    expect(playlog!.chart.notes).toHaveLength(1);
    expect(playlog!.chart.notes[0]).toMatchObject({ id: 0, channel: '11', type: 'normal', timeUs: 1_000_000 });
    expect(playlog!.play).toMatchObject({ mode: 'manual', autoScratch: false, gauge: 'GROOVE' });
    expect(playlog!.play.randomLane).toEqual({ p1: 'MIRROR' });
    expect(playlog!.play.randomDraws).toBeUndefined();
    expect(playlog!.play.aborted).toBeUndefined();
    // The single scheduled press resolves against lane channel 11 with a chart-relative µs timestamp near the note.
    expect(playlog!.inputs).toHaveLength(1);
    expect(playlog!.inputs[0]).toMatchObject({ seq: 0, action: 'down', channels: ['11'] });
    expect(Math.abs(playlog!.inputs[0]!.timeUs - 1_000_000)).toBeLessThan(250_000);
    // The native cache mirrors the engine's own summary.
    const native = playlog!.results?.native;
    expect(native).toBeDefined();
    expect(native!.exScore).toBe(summary.exScore);
    expect(native!.judge.pgreat).toBe(summary.perfect);
    expect(native!.judge.poor).toBe(summary.poor);
    expect(native!.gauge.final).toBeCloseTo(summary.gauge?.current ?? -1, 6);
    // The recorded log feeds the ruleset simulators without further conversion.
    const lr2 = simulatePlaylog(playlog!, { ruleset: 'lr2' });
    expect(lr2.noteCount).toBe(1);
    expect(lr2.judge.pgreat + lr2.judge.great + lr2.judge.good + lr2.judge.bad + lr2.judge.poor).toBe(1);
  });

  test('player: replayInputs re-drives a recorded playlog deterministically', async () => {
    // BPM 240 → notes at 1.0 s ('11') and 1.5 s ('12'). Record a play with two slightly-off presses, then replay
    // the recorded input stream — the judgments must reproduce exactly, even at a different engine speed.
    const json = createEmptyJson('bms');
    json.metadata.bpm = 240;
    json.metadata.total = 300;
    json.events = [
      { measure: 1, channel: '11', position: [0, 2], value: '01' },
      { measure: 1, channel: '12', position: [1, 2], value: '01' },
    ];

    let recorded: BeMusicPlaylog | undefined;
    const original = await manualPlay(json, {
      speed: 1,
      leadInMs: 0,
      audio: false,
      tui: false,
      onPlaylogRecorded: (playlog) => {
        recorded = playlog;
      },
      createInputRuntime: createScheduledInputRuntime([
        { delayMs: 990, command: { kind: 'lane-input', tokens: ['z'] } },
        { delayMs: 1540, command: { kind: 'lane-input', tokens: ['s'] } },
      ]),
    });
    expect(recorded).toBeDefined();
    // The two presses, and the release the engine inferred for the first (the input reports none); the play is over
    // before the second key's hold grace lapses.
    expect(recorded!.inputs.map((input) => `${input.action}${input.inferred === true ? ' inferred' : ''}`)).toEqual([
      'down',
      'up inferred',
      'down',
    ]);
    const originalJudged = original.perfect + original.great + original.good + original.bad;
    expect(originalJudged).toBeGreaterThan(0);

    let replayed: BeMusicPlaylog | undefined;
    const replaySummary = await manualPlay(json, {
      // Chart-relative replay timestamps are speed-independent — run the replay fast to keep the test quick.
      speed: 8,
      leadInMs: 0,
      audio: false,
      tui: false,
      replayInputs: recorded!.inputs,
      onPlaylogRecorded: (playlog) => {
        replayed = playlog;
      },
    });

    expect(replaySummary.perfect).toBe(original.perfect);
    expect(replaySummary.great).toBe(original.great);
    expect(replaySummary.good).toBe(original.good);
    expect(replaySummary.bad).toBe(original.bad);
    expect(replaySummary.poor).toBe(original.poor);
    expect(replaySummary.exScore).toBe(original.exScore);
    expect(replaySummary.score).toBe(original.score);
    expect(replaySummary.fast).toBe(original.fast);
    expect(replaySummary.slow).toBe(original.slow);
    expect(replaySummary.gauge?.current).toBeCloseTo(original.gauge?.current ?? -1, 6);
    // The replayed run re-records an equivalent input stream (same actions, channels, and µs timestamps).
    expect(
      replayed!.inputs.map((input) => ({ action: input.action, timeUs: input.timeUs, channels: input.channels })),
    ).toEqual(
      recorded!.inputs.map((input) => ({ action: input.action, timeUs: input.timeUs, channels: input.channels })),
    );
  });

  test('player: a replay resolves #RANDOM with the recorded randomDraws', async () => {
    // BPM 240: branch 1 puts a note on lane 11 at 1.0 s, branch 2 on lane 12 at the same time.
    const json = parseChart(
      ['#BPM 240', '#RANDOM 2', '#IF 1', '#00111:01', '#ENDIF', '#IF 2', '#00112:01', '#ENDIF', '#ENDRANDOM'].join(
        '\n',
      ),
      'bms',
    );
    // Record a play of branch 2 with a press on lane 12 (`s`).
    let recorded: BeMusicPlaylog | undefined;
    const original = await manualPlay(json, {
      speed: 1,
      leadInMs: 0,
      audio: false,
      tui: false,
      randomDraws: drawRandomOutcomes(json, () => 0.9),
      onPlaylogRecorded: (playlog) => {
        recorded = playlog;
      },
      createInputRuntime: createScheduledInputRuntime([
        { delayMs: 1000, command: { kind: 'lane-input', tokens: ['s'] } },
      ]),
    });
    expect(recorded!.play.randomDraws).toEqual([{ command: 'RANDOM', range: 2, value: 2 }]);
    expect(original.perfect + original.great).toBe(1);

    const replay = async (randomDraws: RandomDraws): Promise<{ summary: PlayerSummary; playlog: BeMusicPlaylog }> => {
      let playlog: BeMusicPlaylog | undefined;
      const summary = await manualPlay(json, {
        speed: 8,
        leadInMs: 0,
        audio: false,
        tui: false,
        replayInputs: recorded!.inputs,
        randomDraws,
        onPlaylogRecorded: (log) => {
          playlog = log;
        },
      });
      return { summary, playlog: playlog! };
    };

    const withRecordedDraws = await replay(recorded!.play.randomDraws!);
    expect(withRecordedDraws.playlog.play.randomDraws).toEqual(recorded!.play.randomDraws);
    expect(withRecordedDraws.playlog.chart.notes.map((note) => note.channel)).toEqual(['12']);
    expect(withRecordedDraws.playlog.chart.playFingerprint).toBe(recorded!.chart.playFingerprint);
    expect(withRecordedDraws.playlog.chart.chartFingerprint).toBe(recorded!.chart.chartFingerprint);
    expect(withRecordedDraws.summary.exScore).toBe(original.exScore);
    expect(withRecordedDraws.summary.perfect).toBe(original.perfect);
    expect(withRecordedDraws.summary.great).toBe(original.great);

    // Other draws play branch 1, where the recorded press misses; the chart fingerprint stays the same.
    const otherDraws = await replay(drawRandomOutcomes(json, () => 0));
    expect(otherDraws.playlog.chart.notes.map((note) => note.channel)).toEqual(['11']);
    expect(otherDraws.playlog.chart.playFingerprint).not.toBe(recorded!.chart.playFingerprint);
    expect(otherDraws.playlog.chart.chartFingerprint).toBe(recorded!.chart.chartFingerprint);
    expect(otherDraws.summary.exScore).toBe(0);
  });

  test('player: judgeRuleset switches the manual judge windows (LR2 / beatoraja / IIDX)', async () => {
    // BPM 240 → one note at 1.0 s; the replayed press lands 35 ms LATE. Under the default (LR2, RANK 2 → GREAT
    // ±40 ms) and beatoraja (judgerank 75 % → GREAT ±45 ms) windows that is a GREAT; under IIDX (GREAT ±33.33 ms,
    // GOOD ±116.67 ms) it is a GOOD.
    const json = createEmptyJson('bms');
    json.metadata.bpm = 240;
    json.metadata.rank = 2;
    json.events = [{ measure: 1, channel: '11', position: [0, 1], value: '01' }];
    const replayInputs = [{ seq: 0, timeUs: 1_035_000, action: 'down' as const, channels: ['11'] }];
    const base = { speed: 8, leadInMs: 0, audio: false, tui: false, replayInputs } as const;

    const lr2 = await manualPlay(json, { ...base });
    const beatoraja = await manualPlay(json, { ...base, judgeRuleset: 'beatoraja' });
    const iidx = await manualPlay(json, { ...base, judgeRuleset: 'iidx' });

    expect(lr2.great).toBe(1);
    expect(lr2.good).toBe(0);
    expect(beatoraja.great).toBe(1);
    expect(beatoraja.good).toBe(0);
    expect(iidx.great).toBe(0);
    expect(iidx.good).toBe(1);
  });

  test("player: beatoraja's asymmetric BAD window reaches further late than early", async () => {
    // beatoraja SEVENKEYS BAD reaches 280 ms LATE but only 220 ms early at judgerank 100 (`#RANK 3`). A press
    // 250 ms late is inside it; the same press 250 ms early is out of reach entirely, so the note survives and
    // misses on its own deadline. The `19` note is only there to put the chart in 7-key mode — beatoraja's
    // five-key BAD window is symmetric.
    const json = createEmptyJson('bms');
    json.metadata.bpm = 240;
    json.metadata.rank = 3;
    json.events = [
      { measure: 1, channel: '11', position: [0, 1], value: '01' },
      { measure: 1, channel: '19', position: [0, 1], value: '01' },
    ];
    const base = { speed: 8, leadInMs: 0, audio: false, tui: false, judgeRuleset: 'beatoraja' } as const;

    const late = await manualPlay(json, {
      ...base,
      replayInputs: [{ seq: 0, timeUs: 1_250_000, action: 'down' as const, channels: ['11'] }],
    });
    const early = await manualPlay(json, {
      ...base,
      replayInputs: [{ seq: 0, timeUs: 750_000, action: 'down' as const, channels: ['11'] }],
    });

    expect(late.bad).toBe(1);
    expect(late.poor).toBe(1); // the untouched `19` note
    expect(early.bad).toBe(0);
    expect(early.poor).toBe(2); // the press never reached its note, so both miss
  });

  test("player: scratch lanes judge on the ruleset's own scratch window", async () => {
    // beatoraja widens the turntable: GREAT is ±60 ms on a key lane but ±70 ms on scratch, so the same 65 ms late
    // press is a GOOD on `11` and a GREAT on `16`.
    const chart = (): ReturnType<typeof createEmptyJson> => {
      const json = createEmptyJson('bms');
      json.metadata.bpm = 240;
      json.metadata.rank = 3;
      json.events = [
        { measure: 1, channel: '11', position: [0, 1], value: '01' },
        { measure: 1, channel: '16', position: [0, 1], value: '01' },
        { measure: 1, channel: '19', position: [0, 1], value: '01' },
      ];
      return json;
    };
    const base = { speed: 8, leadInMs: 0, audio: false, tui: false, judgeRuleset: 'beatoraja' } as const;
    const pressAt = (channel: string) => [{ seq: 0, timeUs: 1_065_000, action: 'down' as const, channels: [channel] }];

    const key = await manualPlay(chart(), { ...base, replayInputs: pressAt('11') });
    const scratch = await manualPlay(chart(), { ...base, replayInputs: pressAt('16') });

    expect(key.good).toBe(1);
    expect(key.great).toBe(0);
    expect(scratch.great).toBe(1);
    expect(scratch.good).toBe(0);
  });

  test('player: note selection follows the ruleset — LR2 takes the oldest note, beatoraja keeps the combo', async () => {
    // Two notes 160 ms apart on one lane, pressed 130 ms after the first. Under `#RANK 2` that press is a BAD on
    // the first note and a GREAT on the second under both rulesets' windows, so only the SELECTION differs:
    // LR2 (`lowest`) always clears the oldest note in reach, while beatoraja (`combo`) hands the press to the
    // second note once the first has fallen out of the late side of its GOOD window. The `19` note only puts the
    // chart in 7-key mode.
    const json = createEmptyJson('bms');
    json.metadata.bpm = 240; // one measure = 1 s
    json.metadata.rank = 2;
    json.events = [
      { measure: 1, channel: '11', position: [0, 1], value: '01' },
      { measure: 1, channel: '11', position: [4, 25], value: '01' }, // +160 ms
      { measure: 3, channel: '19', position: [0, 1], value: '01' },
    ];
    const base = {
      speed: 8,
      leadInMs: 0,
      audio: false,
      tui: false,
      replayInputs: [{ seq: 0, timeUs: 1_130_000, action: 'down' as const, channels: ['11'] }],
    };

    const lr2 = await manualPlay(json, { ...base });
    const beatoraja = await manualPlay(json, { ...base, judgeRuleset: 'beatoraja' });

    expect(lr2.bad).toBe(1);
    expect(lr2.great).toBe(0);
    expect(beatoraja.great).toBe(1);
    expect(beatoraja.bad).toBe(0);
  });
});

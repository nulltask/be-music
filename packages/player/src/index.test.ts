import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmptyJson } from '../../json/src/index.ts';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { parseChartFile } from '../../parser/src/index.ts';

const audioSinkState = vi.hoisted(() => ({
  writes: [] as Uint8Array[],
}));

vi.mock('./audio-sink.ts', () => ({
  createNodeAudioSink: vi.fn(async () => ({
    runtime: 'node',
    engine: 'webaudio',
    label: 'mock-audio',
    write: (chunk: Uint8Array) => {
      audioSinkState.writes.push(Uint8Array.from(chunk));
      return true;
    },
    waitWritable: async () => undefined,
    end: async () => undefined,
    destroy: () => undefined,
    onError: () => undefined,
  })),
}));

import {
  applyFastSlowForJudge,
  applyHighSpeedControlAction,
  autoPlay,
  type CreatePlayerUiRuntimeContext,
  extractInvisiblePlayableNotes,
  extractLandmineNotes,
  extractPlayableNotes,
  extractTimedNotes,
  manualPlay,
  resolveBgmHeadroomGain,
  shouldUseAutoMixBgmHeadroomControl,
  resolveHighSpeedControlActionFromLaneChannels,
  formatRandomPatternSummary,
  PlayerInterruptedError,
  resolveJudgeWindowsMs,
  resolveBmsControlFlowForPlayback,
} from './index.ts';
import type { PlayerInputCommand } from './core/input-signal-bus.ts';
import {
  resolveChartVolWavGain,
  resolveDisplayedJudgeRankLabel,
  resolveDisplayedJudgeRankValue,
} from './utils.ts';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const unifiedBmsChartPath = resolve(rootDir, 'examples/test/four-measure-command-combo-test.bms');

function createLnobjLongNoteChart(lnMode?: 1 | 2 | 3) {
  const json = createEmptyJson('bms');
  json.metadata.bpm = 480;
  json.bms.lnObjs = ['AA'];
  if (lnMode) {
    json.bms.lnMode = lnMode;
  }
  json.events = [
    { measure: 1, channel: '11', position: [0, 1] as const, value: '01' },
    { measure: 3, channel: '11', position: [0, 1] as const, value: 'AA' },
  ];
  return json;
}

function createScratchLnobjLongNoteChart() {
  const json = createEmptyJson('bms');
  json.metadata.bpm = 480;
  json.bms.lnObjs = ['AA'];
  json.events = [
    { measure: 1, channel: '16', position: [0, 1] as const, value: '01' },
    { measure: 3, channel: '16', position: [0, 1] as const, value: 'AA' },
  ];
  return json;
}

function createDynamicExRankChart() {
  const json = createEmptyJson('bms');
  json.metadata.bpm = 480;
  json.metadata.rank = 2;
  json.bms.exRank['AA'] = '48';
  json.bms.exRank['CC'] = '100';
  json.events = [
    { measure: 0, channel: 'A0', position: [0, 1] as const, value: 'AA' },
    { measure: 1, channel: '11', position: [0, 1] as const, value: '01' },
    { measure: 2, channel: 'A0', position: [0, 1] as const, value: 'CC' },
    { measure: 3, channel: '11', position: [0, 1] as const, value: '02' },
  ];
  return json;
}

function createInvisibleOnlyChart() {
  const json = createEmptyJson('bms');
  json.metadata.bpm = 120;
  json.resources.wav['01'] = 'not-found.wav';
  json.events = [{ measure: 0, channel: '31', position: [0, 1] as const, value: '01' }];
  return json;
}

function createScheduledInputRuntime(commands: Array<{ delayMs: number; command: PlayerInputCommand }>) {
  return ({ inputSignals }: { inputSignals: { pushCommand: (command: PlayerInputCommand) => void } }) => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    return {
      start: () => {
        for (const { delayMs, command } of commands) {
          timers.push(
            setTimeout(() => {
              inputSignals.pushCommand(command);
            }, delayMs),
          );
        }
      },
      stop: () => {
        for (const timer of timers) {
          clearTimeout(timer);
        }
      },
    };
  };
}

interface RecordedJudgeCombo {
  judge: string;
  combo: number;
  channel?: string;
  seconds: number;
}

function createJudgeComboRecorder(records: RecordedJudgeCombo[]) {
  return async (context: CreatePlayerUiRuntimeContext) => {
    const originalPublishJudgeCombo = context.stateSignals.publishJudgeCombo;
    context.stateSignals.publishJudgeCombo = (judge, combo, channel, updatedAtMs) => {
      records.push({
        judge,
        combo,
        channel,
        seconds: context.uiSignals.getFrame().currentSeconds,
      });
      originalPublishJudgeCombo(judge, combo, channel, updatedAtMs);
    };
    return {
      tuiEnabled: true,
      start: () => undefined,
      stop: () => undefined,
      dispose: () => undefined,
      triggerPoor: () => undefined,
      clearPoor: () => undefined,
    };
  };
}

function createPlaybackEndRecorder(targetSeconds: number, records: number[]) {
  return async (context: CreatePlayerUiRuntimeContext) => ({
    tuiEnabled: true,
    playbackEndSeconds: targetSeconds,
    start: () => undefined,
    stop: () => {
      records.push(context.uiSignals.getFrame().currentSeconds);
    },
    dispose: () => undefined,
    triggerPoor: () => undefined,
    clearPoor: () => undefined,
  });
}

function hasAnyNonSilentAudioWrite(): boolean {
  return audioSinkState.writes.some((chunk) => {
    for (let index = 0; index < chunk.length; index += 1) {
      if (chunk[index] !== 0) {
        return true;
      }
    }
    return false;
  });
}

beforeEach(() => {
  audioSinkState.writes = [];
});

describe('player', () => {
  test('player: auto play finishes successfully', async () => {
    const json = await parseChartFile(unifiedBmsChartPath);

    const summary = await autoPlay(json, {
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

  test('player: defaults groove gauge TOTAL to LR2 160 when #TOTAL is omitted', async () => {
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

    expect(summary.gauge?.effectiveTotal).toBe(160);
    expect(summary.gauge?.current).toBe(100);
    expect(summary.gauge?.cleared).toBe(true);
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

  test('player: stray key applies LR2 empty-poor groove gauge damage without changing note judgments', async () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 60;
    json.events = [{ measure: 1, channel: '11', position: [0, 1], value: '01' }];

    const summary = await manualPlay(json, {
      speed: 64,
      leadInMs: 0,
      audio: false,
      tui: false,
      createInputRuntime: ({ inputSignals }) => ({
        start: () => {
          inputSignals.pushCommand({ kind: 'lane-input', tokens: ['z'] });
          inputSignals.pushCommand({ kind: 'interrupt', reason: 'escape' });
        },
        stop: () => undefined,
      }),
    });

    expect(summary.total).toBe(1);
    expect(summary.perfect).toBe(0);
    expect(summary.great).toBe(0);
    expect(summary.good).toBe(0);
    expect(summary.bad).toBe(0);
    expect(summary.poor).toBe(0);
    expect(summary.gauge?.current).toBeCloseTo(18, 9);
    expect(summary.gauge?.cleared).toBe(false);
  });

  test('player: derives long-note end beat from bmson notes.l', () => {
    const json = createEmptyJson('bmson');
    json.metadata.bpm = 120;
    json.bmson.info.resolution = 240;
    json.events = [{ measure: 0, channel: '11', position: [0, 1], value: '01', bmson: { l: 240 } }];

    const notes = extractPlayableNotes(json);
    expect(notes).toHaveLength(1);
    expect(notes[0].beat).toBe(0);
    expect(notes[0].endBeat).toBeCloseTo(1, 6);
  });

  test('player: derives long-note end beat from bms #LNOBJ', () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.bms.lnObjs = ['AA'];
    json.events = [
      { measure: 0, channel: '11', position: [0, 1], value: '01' },
      { measure: 0, channel: '11', position: [1, 4], value: 'AA' },
      { measure: 0, channel: '11', position: [2, 4], value: '02' },
    ];

    const notes = extractPlayableNotes(json);
    expect(notes).toHaveLength(2);
    expect(notes[0].beat).toBe(0);
    expect(notes[0].endBeat).toBeCloseTo(1, 6);
    expect(notes[0].endSeconds).toBeCloseTo(0.5, 6);
    expect(notes[0].longNoteMode).toBe(1);
    expect(notes.some((note) => note.event.value === 'AA')).toBe(false);
    expect(notes[1].endBeat).toBeUndefined();
  });

  test('player: derives long-note end beat from multiple #LNOBJ declarations', () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.bms.lnObjs = ['AA', 'BB'];
    const startA = { measure: 0, channel: '11', position: [0, 1] as const, value: '01' };
    const endA = { measure: 0, channel: '11', position: [1, 4] as const, value: 'AA' };
    const startB = { measure: 0, channel: '12', position: [0, 1] as const, value: '02' };
    const endB = { measure: 0, channel: '12', position: [1, 4] as const, value: 'BB' };
    json.events = [startA, endA, startB, endB];

    const notes = extractPlayableNotes(json);
    expect(notes.find((note) => note.event === startA)?.endBeat).toBeCloseTo(1, 6);
    expect(notes.find((note) => note.event === startB)?.endBeat).toBeCloseTo(1, 6);
  });

  test('player: prioritizes 51-69 over LNOBJ when the same lane tick conflicts', () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.bms.lnObjs = ['AA'];
    const start = { measure: 0, channel: '11', position: [0, 1] as const, value: '01' };
    const lnobjEnd = { measure: 0, channel: '11', position: [2, 4] as const, value: 'AA' };
    const legacy = { measure: 0, channel: '51', position: [2, 4] as const, value: '02' };
    json.events = [start, lnobjEnd, legacy];

    const notes = extractPlayableNotes(json);
    expect(notes.find((note) => note.event === start)?.endBeat).toBeUndefined();
  });

  test('player: derives long-note end beat from bms LNTYPE=1 channels 51-59/61-69', () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.bms.lnType = 1;
    json.events = [
      { measure: 0, channel: '51', position: [0, 4], value: '01' },
      { measure: 0, channel: '51', position: [2, 4], value: '02' },
      { measure: 0, channel: '61', position: [1, 4], value: '03' },
      { measure: 1, channel: '61', position: [1, 4], value: '04' },
    ];

    const notes = extractPlayableNotes(json);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({
      channel: '11',
      beat: 0,
    });
    expect(notes[0]?.endBeat).toBeCloseTo(2, 6);
    expect(notes[1]).toMatchObject({
      channel: '21',
      beat: 1,
    });
    expect(notes[1]?.endBeat).toBeCloseTo(5, 6);
  });

  test('player: derives long-note span from bms LNTYPE=2 continuity channels', () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.bms.lnType = 2;
    json.events = [
      { measure: 0, channel: '51', position: [0, 4], value: '01' },
      { measure: 0, channel: '51', position: [1, 4], value: '01' },
      { measure: 0, channel: '51', position: [3, 4], value: '01' },
      { measure: 1, channel: '61', position: [3, 4], value: '02' },
      { measure: 2, channel: '61', position: [0, 4], value: '02' },
    ];

    const notes = extractPlayableNotes(json);
    expect(notes).toHaveLength(3);
    expect(notes[0]).toMatchObject({
      channel: '11',
      beat: 0,
    });
    expect(notes[0]?.endBeat).toBeCloseTo(2, 6);
    expect(notes[1]).toMatchObject({
      channel: '11',
      beat: 3,
    });
    expect(notes[1]?.endBeat).toBeCloseTo(4, 6);
    expect(notes[2]).toMatchObject({
      channel: '21',
      beat: 7,
    });
    expect(notes[2]?.endBeat).toBeCloseTo(9, 6);
  });

  test('player: can opt-in to infer LNTYPE=2 when #LNTYPE is omitted', () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.events = [
      { measure: 0, channel: '61', position: [0, 4], value: '01' },
      { measure: 0, channel: '61', position: [1, 4], value: '01' },
      { measure: 0, channel: '61', position: [2, 4], value: '01' },
    ];

    const defaultNotes = extractPlayableNotes(json);
    expect(defaultNotes).toHaveLength(2);
    expect(defaultNotes[0]?.endBeat).toBeCloseTo(1, 6);
    expect(defaultNotes[1]?.endBeat).toBeUndefined();

    const inferredNotes = extractPlayableNotes(json, {
      inferBmsLnTypeWhenMissing: true,
    });
    expect(inferredNotes).toHaveLength(1);
    expect(inferredNotes[0]?.channel).toBe('21');
    expect(inferredNotes[0]?.beat).toBe(0);
    expect(inferredNotes[0]?.endBeat).toBeCloseTo(3, 6);
  });

  test('player: extracts landmine objects and maps them to playable lanes', () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.events = [
      { measure: 0, channel: 'D1', position: [0, 1], value: '10' },
      { measure: 1, channel: 'E6', position: [0, 1], value: '20' },
      { measure: 2, channel: '11', position: [0, 1], value: '01' },
    ];

    const landmines = extractLandmineNotes(json);
    expect(landmines).toHaveLength(2);
    expect(landmines[0]?.channel).toBe('11');
    expect(landmines[1]?.channel).toBe('26');
    expect(landmines[0]?.mine).toBe(true);
  });

  test('player: extracts invisible channels and maps them to playable lanes', () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.events = [
      { measure: 0, channel: '31', position: [0, 1], value: '10' },
      { measure: 1, channel: '44', position: [0, 1], value: '20' },
      { measure: 2, channel: '11', position: [0, 1], value: '01' },
    ];

    const invisible = extractInvisiblePlayableNotes(json);
    expect(invisible).toHaveLength(2);
    expect(invisible[0]?.channel).toBe('11');
    expect(invisible[1]?.channel).toBe('24');
    expect(invisible[0]?.invisible).toBe(true);
  });

  test('player: extractTimedNotes matches the individual extraction helpers', () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.events = [
      { measure: 0, channel: '31', position: [0, 4], value: '10' },
      { measure: 0, channel: '11', position: [1, 4], value: '01' },
      { measure: 1, channel: 'D2', position: [0, 1], value: '20' },
      { measure: 2, channel: '44', position: [0, 1], value: '30' },
    ];

    const timed = extractTimedNotes(json, {
      includeLandmine: true,
      includeInvisible: true,
    });
    const snapshot = {
      playableNotes: timed.playableNotes.map((note) => ({
        channel: note.channel,
        beat: note.beat,
        endBeat: note.endBeat,
        invisible: note.invisible,
        mine: (note as { mine?: boolean }).mine,
      })),
      landmineNotes: timed.landmineNotes.map((note) => ({
        channel: note.channel,
        beat: note.beat,
        mine: note.mine,
      })),
      invisibleNotes: timed.invisibleNotes.map((note) => ({
        channel: note.channel,
        beat: note.beat,
        invisible: note.invisible,
      })),
    };

    expect(snapshot.playableNotes).toEqual(
      extractPlayableNotes(json).map((note) => ({
        channel: note.channel,
        beat: note.beat,
        endBeat: note.endBeat,
        invisible: note.invisible,
        mine: (note as { mine?: boolean }).mine,
      })),
    );
    expect(snapshot.landmineNotes).toEqual(
      extractLandmineNotes(json).map((note) => ({
        channel: note.channel,
        beat: note.beat,
        mine: note.mine,
      })),
    );
    expect(snapshot.invisibleNotes).toEqual(
      extractInvisiblePlayableNotes(json).map((note) => ({
        channel: note.channel,
        beat: note.beat,
        invisible: note.invisible,
      })),
    );
  });

  test('player: assigns quarter-note length to free-zone notes', () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.events = [{ measure: 0, channel: '17', position: [0, 1], value: '01' }];

    const notes = extractPlayableNotes(json);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.channel).toBe('17');
    expect(notes[0]?.beat).toBeCloseTo(0, 6);
    expect(notes[0]?.endBeat).toBeCloseTo(1, 6);
    expect(notes[0]?.endSeconds).toBeCloseTo(0.5, 6);
  });

  test('player: defaults BMS long notes to LNMODE=1 in manual play', async () => {
    const summary = await manualPlay(createLnobjLongNoteChart(), {
      speed: 1,
      leadInMs: 0,
      audio: false,
      tui: false,
      createInputRuntime: createScheduledInputRuntime([
        { delayMs: 520, command: { kind: 'kitty-state', pressTokens: ['z'], repeatTokens: [], releaseTokens: [] } },
        { delayMs: 520, command: { kind: 'lane-input', tokens: ['z'] } },
        { delayMs: 1700, command: { kind: 'interrupt', reason: 'escape' } },
      ]),
    });

    expect(summary.total).toBe(1);
    expect(summary.bad).toBe(0);
    expect(summary.poor).toBe(0);
    expect(summary.perfect + summary.great + summary.good).toBe(1);
  });

  test('player: LNMODE=1 treats early release as BAD', async () => {
    const summary = await manualPlay(createLnobjLongNoteChart(1), {
      speed: 1,
      leadInMs: 0,
      audio: false,
      tui: false,
      createInputRuntime: createScheduledInputRuntime([
        { delayMs: 520, command: { kind: 'kitty-state', pressTokens: ['z'], repeatTokens: [], releaseTokens: [] } },
        { delayMs: 520, command: { kind: 'lane-input', tokens: ['z'] } },
        { delayMs: 900, command: { kind: 'kitty-state', pressTokens: [], repeatTokens: [], releaseTokens: ['z'] } },
        { delayMs: 1200, command: { kind: 'interrupt', reason: 'escape' } },
      ]),
    });

    expect(summary.total).toBe(1);
    expect(summary.bad).toBe(1);
    expect(summary.poor).toBe(0);
  });

  test('player: LNMODE=2 keeps long notes active until the end timing', async () => {
    const summary = await manualPlay(createLnobjLongNoteChart(2), {
      speed: 1,
      leadInMs: 0,
      audio: false,
      tui: false,
      createInputRuntime: createScheduledInputRuntime([
        { delayMs: 520, command: { kind: 'lane-input', tokens: ['z'] } },
        { delayMs: 1100, command: { kind: 'interrupt', reason: 'escape' } },
      ]),
    });

    expect(summary.total).toBe(1);
    expect(summary.perfect).toBe(0);
    expect(summary.great).toBe(0);
    expect(summary.good).toBe(0);
    expect(summary.bad + summary.poor).toBe(1);
  });

  test('player: LNMODE=3 drains groove gauge while the hold is broken', async () => {
    expect(extractPlayableNotes(createLnobjLongNoteChart(3))[0]?.longNoteMode).toBe(3);
    const mode2Summary = await manualPlay(createLnobjLongNoteChart(2), {
      speed: 1,
      leadInMs: 0,
      audio: false,
      tui: false,
      createInputRuntime: createScheduledInputRuntime([
        { delayMs: 520, command: { kind: 'lane-input', tokens: ['z'] } },
        { delayMs: 1100, command: { kind: 'interrupt', reason: 'escape' } },
      ]),
    });
    const mode3Summary = await manualPlay(createLnobjLongNoteChart(3), {
      speed: 1,
      leadInMs: 0,
      audio: false,
      tui: false,
      createInputRuntime: createScheduledInputRuntime([
        { delayMs: 520, command: { kind: 'lane-input', tokens: ['z'] } },
        { delayMs: 1700, command: { kind: 'interrupt', reason: 'escape' } },
      ]),
    });

    expect(mode3Summary.total).toBe(1);
    expect(mode3Summary.bad + mode3Summary.poor).toBe(1);
    expect(mode3Summary.gauge?.current ?? 0).toBeLessThan(mode2Summary.gauge?.current ?? Number.POSITIVE_INFINITY);
  });

  test('player: uses baseline judge windows for bms RANK=2', () => {
    const json = createEmptyJson('bms');
    json.metadata.rank = 2;
    const windows = resolveJudgeWindowsMs(json);
    expect(windows.pgreat).toBeCloseTo(16.67, 6);
    expect(windows.great).toBeCloseTo(33.33, 6);
    expect(windows.good).toBeCloseTo(116.67, 6);
    expect(windows.bad).toBeCloseTo(250, 6);
  });

  test('player: FAST/SLOW are counted only for GREAT/GOOD', () => {
    const summary = {
      fast: 0,
      slow: 0,
    };

    applyFastSlowForJudge(summary, 'PERFECT', -12);
    applyFastSlowForJudge(summary, 'PERFECT', 8);
    expect(summary.fast).toBe(0);
    expect(summary.slow).toBe(0);

    applyFastSlowForJudge(summary, 'GREAT', -18);
    applyFastSlowForJudge(summary, 'GOOD', 27);
    applyFastSlowForJudge(summary, 'GOOD', 0);
    expect(summary.fast).toBe(1);
    expect(summary.slow).toBe(1);
  });

  test('player: bgm headroom gain does not mute BGM when play lane already clips', () => {
    const playable = {
      sampleRate: 44_100,
      left: new Float32Array([1.2, 0.8]),
      right: new Float32Array([1.1, 0.8]),
      durationSeconds: 2 / 44_100,
      peak: 1.2,
    };
    const bgm = {
      sampleRate: 44_100,
      left: new Float32Array([0.5, 0.5]),
      right: new Float32Array([0.5, 0.5]),
      durationSeconds: 2 / 44_100,
      peak: 0.5,
    };

    const gain = resolveBgmHeadroomGain(playable, bgm);
    expect(gain).toBeGreaterThan(0);
    expect(gain).toBeLessThanOrEqual(1);
  });

  test('player: auto mix headroom control is disabled while limiter is enabled', () => {
    expect(shouldUseAutoMixBgmHeadroomControl({})).toBe(false);
    expect(shouldUseAutoMixBgmHeadroomControl({ limiter: true })).toBe(false);
    expect(shouldUseAutoMixBgmHeadroomControl({ limiter: false })).toBe(true);
  });

  test('player: resolves #VOLWAV gain with 100 as default baseline', () => {
    const defaultChart = createEmptyJson('bms');
    expect(resolveChartVolWavGain(defaultChart)).toBe(1);

    defaultChart.bms.volWav = 100;
    expect(resolveChartVolWavGain(defaultChart)).toBe(1);

    defaultChart.bms.volWav = 200;
    expect(resolveChartVolWavGain(defaultChart)).toBe(2);
  });

  test('player: narrows judge windows for bms RANK=0', () => {
    const json = createEmptyJson('bms');
    json.metadata.rank = 0;
    const windows = resolveJudgeWindowsMs(json);
    expect(windows.pgreat).toBeCloseTo((16.67 * 25) / 75, 6);
    expect(windows.great).toBeCloseTo((33.33 * 25) / 75, 6);
    expect(windows.good).toBeCloseTo((116.67 * 25) / 75, 6);
    expect(windows.bad).toBeCloseTo((250 * 25) / 75, 6);
  });

  test('player: widens judge windows for bms RANK=4', () => {
    const json = createEmptyJson('bms');
    json.metadata.rank = 4;
    const windows = resolveJudgeWindowsMs(json);
    expect(windows.pgreat).toBeCloseTo((16.67 * 125) / 75, 6);
    expect(windows.great).toBeCloseTo((33.33 * 125) / 75, 6);
    expect(windows.good).toBeCloseTo((116.67 * 125) / 75, 6);
    expect(windows.bad).toBeCloseTo((250 * 125) / 75, 6);
  });

  test('player: scales judge windows from bms DEFEXRANK using NORMAL baseline', () => {
    const json = createEmptyJson('bms');
    json.metadata.rank = 0;
    json.bms.defExRank = 120;
    const windows = resolveJudgeWindowsMs(json);
    expect(windows.pgreat).toBeCloseTo(16.67 * 1.2, 6);
    expect(windows.great).toBeCloseTo(33.33 * 1.2, 6);
    expect(windows.good).toBeCloseTo(116.67 * 1.2, 6);
    expect(windows.bad).toBeCloseTo(250 * 1.2, 6);
  });

  test('player: resolves displayed judge rank from bms DEFEXRANK and defaults', () => {
    const defExRankChart = createEmptyJson('bms');
    defExRankChart.metadata.rank = 1;
    defExRankChart.bms.defExRank = 199.97;
    expect(resolveDisplayedJudgeRankValue(defExRankChart)).toBe(199.97);

    const defaultChart = createEmptyJson('bms');
    expect(resolveDisplayedJudgeRankValue(defaultChart)).toBe(2);

    const truncatedRankChart = createEmptyJson('bms');
    truncatedRankChart.metadata.rank = 3.9;
    expect(resolveDisplayedJudgeRankValue(truncatedRankChart)).toBe(3);
  });

  test('player: shows RANDOM label when dynamic EXRANK changes exist', () => {
    const json = createDynamicExRankChart();
    expect(resolveDisplayedJudgeRankLabel(json)).toBe('RANDOM');
  });

  test('player: resolves displayed judge rank from bmson judge rank', () => {
    const json = createEmptyJson('bmson');
    expect(resolveDisplayedJudgeRankValue(json)).toBe(100);

    json.bmson.info.judgeRank = 199.97;
    expect(resolveDisplayedJudgeRankValue(json)).toBe(199.97);
  });

  test('player: updates manual judge windows from dynamic EXRANK events', async () => {
    const json = createDynamicExRankChart();
    const summary = await manualPlay(json, {
      audio: false,
      tui: false,
      leadInMs: 0,
      createInputRuntime: createScheduledInputRuntime([
        {
          delayMs: 580,
          command: { kind: 'lane-input', tokens: ['z'] },
        },
        {
          delayMs: 1580,
          command: { kind: 'lane-input', tokens: ['z'] },
        },
      ]),
    });

    expect(summary.total).toBe(2);
    expect(summary.bad).toBe(1);
    expect(summary.good).toBe(1);
    expect(summary.perfect).toBe(0);
    expect(summary.great).toBe(0);
  });

  test('player: uses baseline judge windows for bmson judge_rank=100', () => {
    const json = createEmptyJson('bmson');
    json.bmson.info.judgeRank = 100;
    const windows = resolveJudgeWindowsMs(json);
    expect(windows.pgreat).toBeCloseTo(16.67, 6);
    expect(windows.great).toBeCloseTo(33.33, 6);
    expect(windows.good).toBeCloseTo(116.67, 6);
    expect(windows.bad).toBeCloseTo(250, 6);
  });

  test('player: debug judge window override affects BAD only', () => {
    const json = createEmptyJson('bms');
    json.metadata.rank = 4;
    const windows = resolveJudgeWindowsMs(json, 180);
    expect(windows.pgreat).toBeCloseTo((16.67 * 125) / 75, 6);
    expect(windows.great).toBeCloseTo((33.33 * 125) / 75, 6);
    expect(windows.good).toBeCloseTo((116.67 * 125) / 75, 6);
    expect(windows.bad).toBe(180);
  });

  test('player: maps in-play HIGH-SPEED control by odd/even lane channel', () => {
    expect(resolveHighSpeedControlActionFromLaneChannels(['11'])).toBe('decrease');
    expect(resolveHighSpeedControlActionFromLaneChannels(['12'])).toBe('increase');
    expect(resolveHighSpeedControlActionFromLaneChannels(['1A'])).toBe('increase');
    expect(resolveHighSpeedControlActionFromLaneChannels(['11', '13'])).toBe('decrease');
    expect(resolveHighSpeedControlActionFromLaneChannels(['12', '14'])).toBe('increase');
    expect(resolveHighSpeedControlActionFromLaneChannels(['11', '12'])).toBeUndefined();
    expect(resolveHighSpeedControlActionFromLaneChannels(['01'])).toBeUndefined();
  });

  test('player: applies in-play HIGH-SPEED controls with 0.5 steps and clamp', () => {
    expect(applyHighSpeedControlAction(1, 'increase')).toBe(1.5);
    expect(applyHighSpeedControlAction(1, 'decrease')).toBe(0.5);
    expect(applyHighSpeedControlAction(10, 'increase')).toBe(10);
    expect(applyHighSpeedControlAction(0.5, 'decrease')).toBe(0.5);
  });
});

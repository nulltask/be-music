import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmptyJson } from '../../json/src/index.ts';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { parseChart, parseChartFile } from '../../parser/src/index.ts';

const audioSinkState = vi.hoisted(() => ({
  writes: [] as Uint8Array[],
  startMs: 0,
  pausedAtMs: 0,
  pausedDurationMs: 0,
  paused: false,
  scheduledSeconds: 0,
}));

vi.mock('./audio-sink.ts', () => ({
  createNodeAudioSink: vi.fn(async (options: { sampleRate: number; channels: number }) => {
    audioSinkState.startMs = performance.now();
    audioSinkState.pausedAtMs = 0;
    audioSinkState.pausedDurationMs = 0;
    audioSinkState.paused = false;
    audioSinkState.scheduledSeconds = 0;

    const resolveOutputSeconds = (): number => {
      const referenceMs = audioSinkState.paused ? audioSinkState.pausedAtMs : performance.now();
      return Math.max(0, (referenceMs - audioSinkState.startMs - audioSinkState.pausedDurationMs) / 1000);
    };

    return {
      runtime: 'node',
      engine: 'webaudio',
      label: 'mock-audio',
      write: (chunk: Uint8Array) => {
        audioSinkState.writes.push(Uint8Array.from(chunk));
        const bytesPerFrame = Math.max(2, options.channels * 2);
        const frameCount = Math.floor(chunk.byteLength / bytesPerFrame);
        if (frameCount > 0) {
          const outputSeconds = resolveOutputSeconds();
          audioSinkState.scheduledSeconds =
            Math.max(outputSeconds, audioSinkState.scheduledSeconds) + frameCount / options.sampleRate;
        }
        return true;
      },
      waitWritable: async () => undefined,
      end: async () => undefined,
      destroy: () => undefined,
      onError: () => undefined,
      getClockState: () => {
        const outputSeconds = resolveOutputSeconds();
        return {
          outputSeconds,
          scheduledSeconds: Math.max(outputSeconds, audioSinkState.scheduledSeconds),
        };
      },
      suspend: async () => {
        if (audioSinkState.paused) {
          return;
        }
        audioSinkState.paused = true;
        audioSinkState.pausedAtMs = performance.now();
      },
      resume: async () => {
        if (!audioSinkState.paused) {
          return;
        }
        audioSinkState.pausedDurationMs += Math.max(0, performance.now() - audioSinkState.pausedAtMs);
        audioSinkState.paused = false;
        audioSinkState.pausedAtMs = 0;
      },
    };
  }),
}));

import {
  applyFastSlowForJudge,
  applyHighSpeedControlAction,
  type AudioSession,
  autoPlay,
  type CreateAudioSessionContext,
  type CreatePlayerUiRuntimeContext,
  type PlayerLoadProgress,
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
  preparePlaybackChartData,
  resolveJudgeWindowsMs,
  resolveBmsControlFlowForPlayback,
} from './index.ts';
import type { PlayerInputCommand } from './core/input-signal-bus.ts';
import { resolveChartVolWavGain, resolveDisplayedJudgeRankLabel, resolveDisplayedJudgeRankValue } from './utils.ts';
import { simulatePlaylog, type BeMusicPlaylog } from './playlog/index.ts';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const unifiedBmsChartPath = resolve(rootDir, 'examples/test/four-measure-command-combo-test.bms');

function createLnobjLongNoteChart(lnMode?: 1 | 2 | 3) {
  const json = createEmptyJson('bms');
  json.metadata.bpm = 480;
  json.bms.lnObjs = ['AA'];
  json.resources.wav['01'] = 'ln.wav';
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

function createPlayableOnlyChart() {
  const json = createEmptyJson('bms');
  json.metadata.bpm = 120;
  json.resources.wav['01'] = 'not-found.wav';
  json.events = [{ measure: 0, channel: '11', position: [0, 1] as const, value: '01' }];
  return json;
}

function createBgmOnlyChart() {
  const json = createEmptyJson('bms');
  json.metadata.bpm = 120;
  json.resources.wav['01'] = 'not-found.wav';
  json.events = [{ measure: 0, channel: '01', position: [0, 1] as const, value: '01' }];
  return json;
}

function createTimelineLoggingChart() {
  const json = createEmptyJson('bms');
  json.metadata.bpm = 120;
  json.measures.push({ index: 1, length: 0.5 });
  json.resources.wav['01'] = 'not-found.wav';
  json.resources.bmp['00'] = 'fallback.png';
  json.resources.bmp['01'] = 'base.png';
  json.resources.bmp['02'] = 'poor.png';
  json.resources.bmp['03'] = 'layer.png';
  json.resources.bmp['04'] = 'layer2.png';
  json.resources.bpm['01'] = 180;
  json.resources.stop['01'] = 192;
  json.bms.scroll['01'] = 0.5;
  json.bms.speed['01'] = 1.5;
  json.bms.exRank['01'] = '48';
  json.events = [
    { measure: 0, channel: '04', position: [0, 1] as const, value: '01' },
    { measure: 0, channel: '06', position: [0, 1] as const, value: '02' },
    { measure: 0, channel: '07', position: [0, 1] as const, value: '03' },
    { measure: 0, channel: '0A', position: [0, 1] as const, value: '04' },
    { measure: 0, channel: 'A0', position: [0, 1] as const, value: '01' },
    { measure: 0, channel: 'SC', position: [0, 1] as const, value: '01' },
    { measure: 0, channel: '09', position: [1, 2] as const, value: '01' },
    { measure: 1, channel: '08', position: [0, 1] as const, value: '01' },
    { measure: 1, channel: 'SP', position: [0, 1] as const, value: '01' },
    { measure: 2, channel: '11', position: [0, 1] as const, value: '01' },
  ];
  return json;
}

function createPoorBgaLoggingChart() {
  const json = createEmptyJson('bms');
  json.metadata.bpm = 120;
  json.resources.wav['01'] = 'not-found.wav';
  json.resources.bmp['00'] = 'fallback.png';
  json.events = [{ measure: 0, channel: '11', position: [0, 1] as const, value: '01' }];
  return json;
}

function createLandmineOnlyChart(options: { includeExplosionSound?: boolean; value?: string } = {}) {
  const { includeExplosionSound = true, value = '10' } = options;
  const json = createEmptyJson('bms');
  json.metadata.bpm = 120;
  if (includeExplosionSound) {
    json.resources.wav['00'] = 'explode.wav';
  }
  // Mine on measure 1 (chart 2.0 s at BPM 120) so a held key can deterministically detonate it as it crosses the
  // judge line. A mine on measure 0 (chart 0 s) is racy under LR2's passage-based detonation: with playback sped up,
  // a single poll tick can advance chart time past the mine's GOOD window before the input is processed.
  json.events = [{ measure: 1, channel: 'D1', position: [0, 1] as const, value }];
  return json;
}

// Deterministic landmine detonation — holds the 1P key-1 lane (`z` → channel 11) from 0.2 s through the mine's
// passage at chart 2.0 s, then ends the run at 2.3 s. Mirrors the proven hold-through test timing so CI doesn't race.
const HELD_LANDMINE_INPUT: Array<{ delayMs: number; command: PlayerInputCommand }> = [
  { delayMs: 200, command: { kind: 'kitty-state', pressTokens: ['z'], repeatTokens: [], releaseTokens: [] } },
  { delayMs: 2300, command: { kind: 'interrupt', reason: 'escape' } },
];

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
  audioSinkState.startMs = 0;
  audioSinkState.pausedAtMs = 0;
  audioSinkState.pausedDurationMs = 0;
  audioSinkState.paused = false;
  audioSinkState.scheduledSeconds = 0;
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
    // GROOVE gauge starts at 20 and the EMPTY_POOR delta is -2 (see `applyGrooveGaugeJudge`), giving 18. Matches LR2:
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
    expect(playlog!.version).toBe(1);
    expect(playlog!.clock).toEqual({ unit: 'us', origin: 'chart-zero' });
    expect(playlog!.chart.title).toBe('Playlog Test');
    expect(playlog!.chart.total).toBe(300);
    expect(playlog!.chart.noteCount).toBe(1);
    expect(playlog!.chart.notes).toHaveLength(1);
    expect(playlog!.chart.notes[0]).toMatchObject({ id: 0, channel: '11', type: 'normal', timeUs: 1_000_000 });
    expect(playlog!.play).toMatchObject({ mode: 'manual', autoScratch: false, gauge: 'GROOVE' });
    expect(playlog!.play.randomLane).toEqual({ p1: 'MIRROR' });
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
    expect(recorded!.inputs).toHaveLength(2);
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

  test('player: ESC-interrupted play records an aborted playlog', async () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 240;
    json.events = [{ measure: 1, channel: '11', position: [0, 1], value: '01' }];

    let playlog: BeMusicPlaylog | undefined;
    await manualPlay(json, {
      speed: 1,
      leadInMs: 0,
      audio: false,
      tui: false,
      onPlaylogRecorded: (recorded) => {
        playlog = recorded;
      },
      createInputRuntime: createScheduledInputRuntime([
        { delayMs: 100, command: { kind: 'interrupt', reason: 'escape' } },
      ]),
    });

    expect(playlog).toBeDefined();
    expect(playlog!.play.aborted).toBe(true);
    expect(playlog!.inputs).toHaveLength(0);
  });

  test('player: blank press between same-lane notes plays the previous keysound, not the next pending keysound', async () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 240;
    json.resources.wav = {
      '01': 'a.wav',
      '02': 'b.wav',
    };
    json.events = [
      { measure: 1, channel: '11', position: [0, 1] as const, value: '01' },
      { measure: 1, channel: '11', position: [1, 2] as const, value: '02' },
    ];
    const preparedChart = preparePlaybackChartData(json, {}, false, 0);
    expect(preparedChart.scorableNotes[0]?.seconds).toBeCloseTo(1, 6);
    expect(preparedChart.scorableNotes[1]?.seconds).toBeCloseTo(1.5, 6);

    const triggeredEvents: string[] = [];
    const output: string[] = [];
    const summary = await manualPlay(json, {
      speed: 1,
      leadInMs: 0,
      audio: true,
      tui: false,
      judgeWindowMs: 50,
      preparedChart,
      writeOutput: (text) => {
        output.push(text);
      },
      createAudioSession: async () => ({
        backendLabel: 'recording-audio',
        chartStartDelayMs: 0,
        start: () => undefined,
        pause: () => undefined,
        resume: () => undefined,
        finish: async () => undefined,
        dispose: async () => undefined,
        triggerEvent: (event) => {
          triggeredEvents.push(event.value);
        },
        stopChannel: () => undefined,
      }),
      createInputRuntime: createScheduledInputRuntime([
        { delayMs: 1300, command: { kind: 'lane-input', tokens: ['z'] } },
        { delayMs: 1380, command: { kind: 'interrupt', reason: 'escape' } },
      ]),
    });

    expect(triggeredEvents).toEqual(['01']);
    expect(preparedChart.scorableNotes[0]?.judged).toBe(true);
    expect(preparedChart.scorableNotes[1]?.judged).toBe(false);
    expect(summary.poor).toBe(1);
    expect(output.some((line) => line.includes('kind:sample-trigger') && line.includes('source:lane-fallback'))).toBe(
      true,
    );
    expect(output.some((line) => line.includes('kind:judge') && line.includes('result:EMPTY_POOR'))).toBe(true);
  });

  test('player: invisible objects update the same-lane fallback keysound', async () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 240;
    json.resources.wav = {
      '01': 'a.wav',
      '02': 'b.wav',
      '03': 'invisible.wav',
    };
    json.events = [
      { measure: 1, channel: '11', position: [0, 1] as const, value: '01' },
      { measure: 1, channel: '31', position: [1, 5] as const, value: '03' },
      { measure: 1, channel: '11', position: [1, 2] as const, value: '02' },
    ];
    const preparedChart = preparePlaybackChartData(json, {}, false, 0);
    expect(preparedChart.scorableNotes[0]?.seconds).toBeCloseTo(1, 6);
    expect(preparedChart.invisibleNotes[0]?.seconds).toBeCloseTo(1.2, 6);
    expect(preparedChart.scorableNotes[1]?.seconds).toBeCloseTo(1.5, 6);

    const triggeredEvents: string[] = [];
    const output: string[] = [];
    const summary = await manualPlay(json, {
      speed: 1,
      leadInMs: 0,
      audio: true,
      tui: false,
      judgeWindowMs: 50,
      preparedChart,
      writeOutput: (text) => {
        output.push(text);
      },
      createAudioSession: async () => ({
        backendLabel: 'recording-audio',
        chartStartDelayMs: 0,
        start: () => undefined,
        pause: () => undefined,
        resume: () => undefined,
        finish: async () => undefined,
        dispose: async () => undefined,
        triggerEvent: (event) => {
          triggeredEvents.push(event.value);
        },
        stopChannel: () => undefined,
      }),
      createInputRuntime: createScheduledInputRuntime([
        { delayMs: 1180, command: { kind: 'lane-input', tokens: ['z'] } },
        { delayMs: 1260, command: { kind: 'interrupt', reason: 'escape' } },
      ]),
    });

    expect(triggeredEvents).toEqual(['03']);
    expect(triggeredEvents).not.toContain('02');
    expect(preparedChart.scorableNotes[1]?.judged).toBe(false);
    expect(summary.poor).toBe(1);
    expect(output.some((line) => line.includes('kind:sample-trigger') && line.includes('value:03'))).toBe(true);
    expect(output.some((line) => line.includes('kind:judge') && line.includes('result:EMPTY_POOR'))).toBe(true);
  });

  test('player: invisible objects do not auto-trigger without lane input in manual play', async () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 240;
    json.resources.wav = {
      '03': 'invisible.wav',
    };
    json.events = [{ measure: 1, channel: '31', position: [1, 5] as const, value: '03' }];
    const preparedChart = preparePlaybackChartData(json, {}, false, 0);
    expect(preparedChart.invisibleNotes[0]?.seconds).toBeCloseTo(1.2, 6);

    const triggeredEvents: string[] = [];
    await manualPlay(json, {
      speed: 1,
      leadInMs: 0,
      audio: true,
      tui: false,
      preparedChart,
      writeOutput: () => undefined,
      createAudioSession: async () => ({
        backendLabel: 'recording-audio',
        chartStartDelayMs: 0,
        start: () => undefined,
        pause: () => undefined,
        resume: () => undefined,
        finish: async () => undefined,
        dispose: async () => undefined,
        triggerEvent: (event) => {
          triggeredEvents.push(event.value);
        },
        stopChannel: () => undefined,
      }),
      createInputRuntime: createScheduledInputRuntime([
        { delayMs: 1300, command: { kind: 'interrupt', reason: 'escape' } },
      ]),
    });

    expect(triggeredEvents).toEqual([]);
  });

  test('player: `#BASE 62` lowercase sample IDs are looked up case-sensitively at runtime', async () => {
    // Two separate samples with case-distinct IDs (`#WAV0a` != `#WAV0A`). On a base-36 chart the parser would have
    // collapsed these into one slot during ingest; under `#BASE 62` they stay distinct and the player must resolve them
    // via case-preserved keys when emitting `sample-trigger` logs.
    const json = parseChart(
      ['#BASE 62', '#TITLE Base62 Sample', '#BPM 120', '#WAV0a lower.wav', '#WAV0A upper.wav', '#00111:0a0A', ''].join(
        '\n',
      ),
    );
    expect(json.bms.base).toBe(62);
    expect(json.resources.wav['0a']).toBe('lower.wav');
    expect(json.resources.wav['0A']).toBe('upper.wav');

    const output: string[] = [];
    await autoPlay(json, {
      speed: 240,
      leadInMs: 0,
      audio: false,
      tui: false,
      writeOutput: (text) => {
        output.push(text);
      },
    });

    // First note (`0a`) must hit the lowercase entry — `lower.wav` — and the runtime log must report the same
    // case-preserved `sample:0a` token. Folding either side to uppercase would emit `file:upper.wav` / `sample:0A` and
    // break this assertion.
    expect(
      output.some(
        (line) =>
          line.includes('kind:sample-trigger') &&
          line.includes('source:auto-note') &&
          line.includes('sample:0a') &&
          line.includes('file:lower.wav'),
      ),
    ).toBe(true);
    expect(
      output.some(
        (line) =>
          line.includes('kind:sample-trigger') &&
          line.includes('source:auto-note') &&
          line.includes('sample:0A') &&
          line.includes('file:upper.wav'),
      ),
    ).toBe(true);
  });

  test('player: manual landmine hit triggers #WAV00 in runtime logs', async () => {
    const json = createLandmineOnlyChart();
    const output: string[] = [];

    const summary = await manualPlay(json, {
      speed: 1,
      leadInMs: 0,
      audio: false,
      tui: false,
      writeOutput: (text) => {
        output.push(text);
      },
      createInputRuntime: createScheduledInputRuntime(HELD_LANDMINE_INPUT),
    });

    expect(summary.total).toBe(0);
    // LR2 — mine hits never emit a verdict: gauge damage + explosion sound only.
    expect(summary.bad).toBe(0);
    expect(summary.poor).toBe(0);
    expect(
      output.some(
        (line) =>
          line.includes('kind:sample-trigger') &&
          line.includes('source:mine-hit') &&
          line.includes('channel:11') &&
          line.includes('sample:00') &&
          line.includes('file:explode.wav'),
      ),
    ).toBe(true);
    expect(output.some((line) => line.includes('kind:mine-hit') && line.includes('channel:11'))).toBe(true);
  });

  test('player: manual landmine hit applies the LR2 raw-value damage with no verdict', async () => {
    const summary = await manualPlay(createLandmineOnlyChart({ value: '08' }), {
      speed: 1,
      leadInMs: 0,
      audio: false,
      tui: false,
      createInputRuntime: createScheduledInputRuntime(HELD_LANDMINE_INPUT),
    });

    expect(summary.total).toBe(0);
    expect(summary.bad).toBe(0);
    expect(summary.poor).toBe(0);
    // LR2 / beatoraja interpret the mine value directly as the damage percent ('08' = 8 %, NOT the nanasi-memo
    // value/2): gauge 20 → 12.
    expect(summary.gauge?.current).toBeCloseTo(12, 9);
  });

  test('player: manual landmine hit clamps large mine damage at the groove gauge minimum', async () => {
    const summary = await manualPlay(createLandmineOnlyChart({ value: 'ZZ' }), {
      speed: 1,
      leadInMs: 0,
      audio: false,
      tui: false,
      createInputRuntime: createScheduledInputRuntime(HELD_LANDMINE_INPUT),
    });

    expect(summary.bad).toBe(0);
    // ZZ (= 1295 % raw) wipes the gauge; GROOVE's 2 % soft floor catches it (a survival gauge would die instead).
    expect(summary.gauge?.current).toBeCloseTo(2, 9);
  });

  test('player: bmson per-mine damage overrides the BMS value/2 rule', async () => {
    // bmson `key_channels[].notes[].damage` is an explicit gauge percentage carried on `event.bmson.damage`. When
    // present it wins over the BMS raw-value interpretation: value '08' alone would deal 8 %, the authored damage
    // of 7 must deal exactly 7 % (gauge 20 → 13).
    const json = createLandmineOnlyChart({ value: '08' });
    json.events[0]!.bmson = { damage: 7 };

    const summary = await manualPlay(json, {
      speed: 1,
      leadInMs: 0,
      audio: false,
      tui: false,
      createInputRuntime: createScheduledInputRuntime(HELD_LANDMINE_INPUT),
    });

    expect(summary.bad).toBe(0);
    expect(summary.gauge?.current).toBeCloseTo(13, 9);
  });

  test('player: bmson damage 0 is a valid no-damage decoration mine', async () => {
    const json = createLandmineOnlyChart({ value: '08' });
    json.events[0]!.bmson = { damage: 0 };

    const summary = await manualPlay(json, {
      speed: 1,
      leadInMs: 0,
      audio: false,
      tui: false,
      createInputRuntime: createScheduledInputRuntime(HELD_LANDMINE_INPUT),
    });

    expect(summary.bad).toBe(0);
    expect(summary.gauge?.current).toBeCloseTo(20, 9);
  });

  test('player: holding a key through a passing mine detonates it (LR2 hold-through)', async () => {
    // BPM 120 → measure 1 = 2.0 s. Hold the lane from ~0.2 s via kitty press state (no release) and let the mine
    // cross the judge line at 2.0 s — LR2 explodes mines that pass while the key is ON.
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.events = [{ measure: 1, channel: 'D1', position: [0, 1] as const, value: '0A' }]; // raw 10 %

    const summary = await manualPlay(json, {
      speed: 1,
      leadInMs: 0,
      audio: false,
      tui: false,
      createInputRuntime: createScheduledInputRuntime([
        { delayMs: 200, command: { kind: 'kitty-state', pressTokens: ['z'], repeatTokens: [], releaseTokens: [] } },
        { delayMs: 2300, command: { kind: 'interrupt', reason: 'escape' } },
      ]),
    });

    expect(summary.bad).toBe(0);
    expect(summary.gauge?.current).toBeCloseTo(10, 9); // 20 - 10
  });

  test('player: a mine passing with the key up is harmless (LR2)', async () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.events = [{ measure: 1, channel: 'D1', position: [0, 1] as const, value: '0A' }];

    const summary = await manualPlay(json, {
      speed: 1,
      leadInMs: 0,
      audio: false,
      tui: false,
      createInputRuntime: createScheduledInputRuntime([
        { delayMs: 2300, command: { kind: 'interrupt', reason: 'escape' } },
      ]),
    });

    expect(summary.bad).toBe(0);
    expect(summary.gauge?.current).toBeCloseTo(20, 9);
  });

  test('player: a press outside the GOOD window does not detonate an approaching mine (LR2)', async () => {
    // BPM 120, NORMAL rank → GOOD window ±100 ms. The mine sits at 2.0 s; a tap at ~1.7 s is 300 ms early —
    // outside the detonation range — and the key is up again (grace expired) by the time the mine crosses.
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.events = [{ measure: 1, channel: 'D1', position: [0, 1] as const, value: '0A' }];

    const summary = await manualPlay(json, {
      speed: 1,
      leadInMs: 0,
      audio: false,
      tui: false,
      createInputRuntime: createScheduledInputRuntime([
        { delayMs: 1700, command: { kind: 'lane-input', tokens: ['z'] } },
        { delayMs: 2300, command: { kind: 'interrupt', reason: 'escape' } },
      ]),
    });

    expect(summary.bad).toBe(0);
    expect(summary.gauge?.current).toBeCloseTo(20, 9);
  });

  test('player: routes audio through createAudioSession factory when supplied', async () => {
    // Phase 1 of the web-engine integration plan exposes a `createAudioSession` factory option so the browser
    // runtime can plug in a Web Audio backend without forking the engine. The factory's returned `AudioSession`
    // must short-circuit the bundled Node sink path entirely — verified here by asserting the Node sink mock
    // never received a `write()` call while the custom factory's `start` / `triggerEvent` / `finish` did.
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.events = [{ measure: 0, channel: '11', position: [0, 1] as const, value: '01' }];
    json.resources.wav = { '01': 'mock.wav' };

    audioSinkState.writes.length = 0;
    const triggeredEvents: string[] = [];
    let started = false;
    let finished = false;
    const customSession: AudioSession = {
      backendLabel: 'mock-web-audio',
      chartStartDelayMs: 0,
      start: () => {
        started = true;
      },
      pause: () => undefined,
      resume: () => undefined,
      finish: async () => {
        finished = true;
      },
      dispose: async () => undefined,
      triggerEvent: (event) => {
        triggeredEvents.push(event.value);
      },
      stopChannel: () => undefined,
    };
    const seenContexts: CreateAudioSessionContext[] = [];

    await autoPlay(json, {
      auto: true,
      speed: 240,
      leadInMs: 0,
      audio: true,
      tui: false,
      writeOutput: () => undefined,
      createAudioSession: async (context) => {
        seenContexts.push(context);
        return customSession;
      },
    });

    expect(seenContexts).toHaveLength(1);
    expect(seenContexts[0]?.mode).toBe('auto');
    // The factory receives the post-#RANDOM-resolution clone, not the caller's input. The clone preserves the
    // chart's identifying fields (bpm / events / resources) so a backend can re-derive everything it needs.
    expect(seenContexts[0]?.json.metadata.bpm).toBe(120);
    expect(seenContexts[0]?.json.events).toHaveLength(1);
    expect(started).toBe(true);
    expect(finished).toBe(true);
    expect(triggeredEvents).toContain('01');
    // The Node sink mock from the file's top-level `vi.mock` registers a `write` push for every audio chunk; the
    // factory short-circuit means it should remain untouched.
    expect(audioSinkState.writes.length).toBe(0);
  });

  test('player: falls back to the bundled Node sink when createAudioSession returns undefined', async () => {
    // Returning `undefined` from the factory must be treated as "no opinion" so a runtime can probe optional
    // backends without forfeiting the default sink. The Node sink mock should still receive writes in this path.
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.events = [{ measure: 0, channel: '11', position: [0, 1] as const, value: '01' }];

    audioSinkState.writes.length = 0;
    let factoryCalls = 0;
    await autoPlay(json, {
      auto: true,
      speed: 240,
      leadInMs: 0,
      audio: true,
      tui: false,
      writeOutput: () => undefined,
      createAudioSession: async () => {
        factoryCalls += 1;
        return undefined;
      },
    });

    expect(factoryCalls).toBe(1);
    expect(audioSinkState.writes.length).toBeGreaterThan(0);
  });

  test('player: manual landmine hit sounds #WAV00 when audio is enabled', async () => {
    // `explode.wav` doesn't exist on disk, so the audible assertion opts into the debug fallback tone — the
    // spec-compliant default for a missing sample is silence (covered by the companion test below).
    await manualPlay(createLandmineOnlyChart(), {
      speed: 1,
      leadInMs: 0,
      audio: true,
      audioHeadPaddingMs: 0,
      audioLeadMs: 0,
      audioLeadMaxMs: 0,
      limiter: false,
      tui: false,
      missingSampleToneSeconds: 0.06,
      writeOutput: () => undefined,
      createInputRuntime: createScheduledInputRuntime(HELD_LANDMINE_INPUT),
    });

    expect(hasAnyNonSilentAudioWrite()).toBe(true);
  });

  test('player: missing #WAVxx files are silent by default (no fallback tone)', async () => {
    await manualPlay(createLandmineOnlyChart(), {
      speed: 1,
      leadInMs: 0,
      audio: true,
      audioHeadPaddingMs: 0,
      audioLeadMs: 0,
      audioLeadMaxMs: 0,
      limiter: false,
      tui: false,
      writeOutput: () => undefined,
      createInputRuntime: createScheduledInputRuntime(HELD_LANDMINE_INPUT),
    });

    expect(hasAnyNonSilentAudioWrite()).toBe(false);
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
    // beatoraja bmson extension: unspecified `info.ln_type` / note `t` falls back to the LR2-aligned default LN
    // (mode 1, no tail release judgment) — the same default the BMS side uses for a missing #LNMODE.
    expect(notes[0].longNoteMode).toBe(1);
  });

  test('player: bmson note t overrides info.ln_type, which overrides the LN default', () => {
    const json = createEmptyJson('bmson');
    json.metadata.bpm = 120;
    json.bmson.info.resolution = 240;
    json.bmson.info.lnType = 2;
    json.events = [
      { measure: 0, channel: '11', position: [0, 1], value: '01', bmson: { l: 240, t: 3 } },
      { measure: 1, channel: '12', position: [0, 1], value: '02', bmson: { l: 240 } },
    ];

    const notes = extractPlayableNotes(json);
    expect(notes).toHaveLength(2);
    expect(notes[0].longNoteMode).toBe(3); // per-note t wins
    expect(notes[1].longNoteMode).toBe(2); // chart-level info.ln_type
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

  test('player: keeps a two-event same-value legacy LN pair as LNTYPE=1 when auto inference is enabled', () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.events = [
      { measure: 0, channel: '55', position: [0, 4], value: 'AA' },
      { measure: 0, channel: '55', position: [1, 4], value: 'AA' },
    ];

    const notes = extractPlayableNotes(json, { inferBmsLnTypeWhenMissing: true });

    expect(notes).toHaveLength(1);
    expect(notes[0]?.channel).toBe('15');
    expect(notes[0]?.beat).toBe(0);
    expect(notes[0]?.endBeat).toBeCloseTo(1, 6);
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

  test('player: mine notes inside an active LN hold deal silent gauge damage (upstream JudgeManager.java:253-259)', async () => {
    // When a mine passes the judge line while the same lane's LN is being held, upstream
    // beatoraja applies the mine's gauge damage but emits NO verdict — the player's combo
    // and score are preserved. Without this guard, an HCN-style chart that routes mine
    // columns through active holds was unclear-able: every mine inside a hold cost a BAD
    // (combo reset + scoreboard slot waste) on top of the gauge hit.
    //
    // BPM 480 → measure 1 = 0.5 sec, measure 3 = 1.5 sec.  Schedule:
    //   - Player taps 'z' at 520 ms (real time) → LN head at chart 0.5 sec (PERFECT).
    //   - Mine on D1 lands at chart 0.75 sec (measure 1.5) → 230 ms after head, inside
    //     the 380 ms initial hold grace window.
    //   - LN tail at chart 1.5 sec; the per-frame loop reaches it before the interrupt
    //     and finalizes with the head's PERFECT verdict.
    //   - Interrupt fires at 1700 ms (200 ms after tail) — well within the tail-finalize
    //     window, matching the LNMODE=3 baseline test's timing.
    //
    // We run a baseline scenario without the mine to capture the reference gauge value
    // (PERFECT-only run), then assert the mine-present run lands the SAME verdict counts
    // but a STRICTLY LOWER gauge — proving the mine drained gauge silently.
    // Two lane-input taps: the first hits the LN head, the second taps again at the mine
    // time so `handleMappedInputTokens` is called with the LN still active — that's the
    // codepath that resolves a mine candidate (the engine only looks for landmines on
    // lane-input dispatches, not as a per-frame sweep). Without the second tap, the mine
    // expires silently via `markExpiredLandmines` and the silent-damage branch never runs.
    const inputSchedule: Array<{ delayMs: number; command: PlayerInputCommand }> = [
      { delayMs: 520, command: { kind: 'lane-input', tokens: ['z'] } },
      { delayMs: 750, command: { kind: 'lane-input', tokens: ['z'] } },
      { delayMs: 1700, command: { kind: 'interrupt', reason: 'escape' } },
    ];
    const baselineSummary = await manualPlay(createLnobjLongNoteChart(2), {
      speed: 1,
      leadInMs: 0,
      audio: false,
      tui: false,
      createInputRuntime: createScheduledInputRuntime(inputSchedule),
    });

    const json = createLnobjLongNoteChart(2);
    json.events.push({ measure: 1, channel: 'D1', position: [1, 2] as const, value: '08' });

    const summary = await manualPlay(json, {
      speed: 1,
      leadInMs: 0,
      audio: false,
      tui: false,
      createInputRuntime: createScheduledInputRuntime(inputSchedule),
    });

    // Verdict counts MATCH the mine-free baseline — adding a mine inside the hold doesn't
    // add a BAD/POOR slot, doesn't reset combo. We compare against the baseline (rather
    // than pinning specific values) because the LN's tail-finalize verdict depends on
    // tick alignment that's independent of the mine-handling code path being verified.
    expect(summary.perfect).toBe(baselineSummary.perfect);
    expect(summary.great).toBe(baselineSummary.great);
    expect(summary.good).toBe(baselineSummary.good);
    expect(summary.bad).toBe(baselineSummary.bad);
    expect(summary.poor).toBe(baselineSummary.poor);
    expect(summary.total).toBe(baselineSummary.total);
    // Gauge took the mine's damage despite the silent treatment — strictly below the
    // mine-free baseline. This is the affirmative half: silent doesn't mean free.
    const baselineGauge = baselineSummary.gauge?.current ?? 100;
    const withMineGauge = summary.gauge?.current ?? 100;
    expect(withMineGauge).toBeLessThan(baselineGauge);
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

  test('player: no-TUI logs long-note, gauge, combo, sample-stop, and result events', async () => {
    const output: string[] = [];

    await manualPlay(createLnobjLongNoteChart(3), {
      speed: 1,
      leadInMs: 0,
      audio: false,
      tui: false,
      writeOutput: (text) => {
        output.push(text);
      },
      createInputRuntime: createScheduledInputRuntime([
        { delayMs: 520, command: { kind: 'lane-input', tokens: ['z'] } },
        { delayMs: 1700, command: { kind: 'interrupt', reason: 'escape' } },
      ]),
    });

    expect(
      output.some(
        (line) =>
          line.includes('kind:long-note') &&
          line.includes('state:start') &&
          line.includes('mode:3') &&
          line.includes('file:ln.wav'),
      ),
    ).toBe(true);
    expect(
      output.some(
        (line) =>
          line.includes('kind:long-note') &&
          line.includes('state:break') &&
          line.includes('mode:3') &&
          line.includes('file:ln.wav'),
      ),
    ).toBe(true);
    expect(
      output.some(
        (line) =>
          line.includes('kind:sample-stop') &&
          line.includes('reason:long-note-break') &&
          line.includes('sample:01') &&
          line.includes('file:ln.wav'),
      ),
    ).toBe(true);
    expect(output.some((line) => line.includes('kind:gauge-change') && line.includes('reason:hold-drain'))).toBe(true);
    expect(
      output.some(
        (line) => line.includes('kind:combo-change') && line.includes('value:0') && line.includes('judge:POOR'),
      ),
    ).toBe(true);
    expect(
      output.some(
        (line) =>
          line.includes('kind:result') &&
          line.includes('reason:complete') &&
          line.includes('poor:1') &&
          line.includes('gaugeCleared:false'),
      ),
    ).toBe(true);
  });

  test('player: uses baseline judge windows for bms RANK=2', () => {
    const json = createEmptyJson('bms');
    json.metadata.rank = 2;
    const windows = resolveJudgeWindowsMs(json);
    expect(windows.pgreat).toBeCloseTo(18, 6);
    expect(windows.great).toBeCloseTo(40, 6);
    expect(windows.good).toBeCloseTo(100, 6);
    expect(windows.bad).toBe(200);
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

  test('player: narrows judge windows for bms RANK=0 (LR2 VERY HARD)', () => {
    const json = createEmptyJson('bms');
    json.metadata.rank = 0;
    const windows = resolveJudgeWindowsMs(json);
    expect(windows.pgreat).toBeCloseTo(8, 6);
    expect(windows.great).toBeCloseTo(24, 6);
    expect(windows.good).toBeCloseTo(40, 6);
    expect(windows.bad).toBe(200);
  });

  test('player: bms RANK=4 maps onto NORMAL windows (LR2 behavior)', () => {
    const json = createEmptyJson('bms');
    json.metadata.rank = 4;
    const windows = resolveJudgeWindowsMs(json);
    expect(windows.pgreat).toBeCloseTo(18, 6);
    expect(windows.great).toBeCloseTo(40, 6);
    expect(windows.good).toBeCloseTo(100, 6);
    expect(windows.bad).toBe(200);
  });

  test('player: scales judge windows from bms DEFEXRANK via the LR2 anchor interpolation', () => {
    const json = createEmptyJson('bms');
    json.metadata.rank = 0;
    json.bms.defExRank = 120; // percent 90 — between NORMAL (75) and EASY (100)
    const windows = resolveJudgeWindowsMs(json);
    expect(windows.pgreat).toBeCloseTo(19.8, 6);
    expect(windows.great).toBeCloseTo(52, 6);
    expect(windows.good).toBeCloseTo(112, 6);
    expect(windows.bad).toBe(200);
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

  test('player: uses NORMAL windows for bmson judge_rank=100', () => {
    const json = createEmptyJson('bmson');
    json.bmson.info.judgeRank = 100;
    const windows = resolveJudgeWindowsMs(json);
    expect(windows.pgreat).toBeCloseTo(18, 6);
    expect(windows.great).toBeCloseTo(40, 6);
    expect(windows.good).toBeCloseTo(100, 6);
    expect(windows.bad).toBe(200);
  });

  test('player: debug judge window override affects BAD only', () => {
    const json = createEmptyJson('bms');
    json.metadata.rank = 4;
    const windows = resolveJudgeWindowsMs(json, 180);
    expect(windows.pgreat).toBeCloseTo(18, 6);
    expect(windows.great).toBeCloseTo(40, 6);
    expect(windows.good).toBeCloseTo(100, 6);
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

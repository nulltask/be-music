import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmptyJSON } from '../../../json/src/index.ts';
import { vi } from 'vite-plus/test';
import type { CreatePlayerUIRuntimeContext } from '../index.ts';
import { getEngineScheduler } from '../core/engine-clock.ts';
import type { PlayerInputCommand } from '../core/input-signal-bus.ts';
import type { PlayerUICommand } from '../core/ui-signal-bus.ts';

/**
 * Shared set-up of the player engine's tests (`*.test.ts` next to `index.ts`): a mocked Node audio sink whose clock
 * follows `performance.now()` and which records every write, and the small charts and input scripts the tests play.
 * Each test file mocks `./audio-sink.ts` with {@link mockAudioSinkModule} and calls {@link resetAudioSinkState} before
 * each test; the state lives here, so the mock and the tests see the same object.
 */

/** What the mocked audio sink has been written, and its clock. */
export const audioSinkState = {
  writes: [] as Uint8Array[],
  startMs: 0,
  pausedAtMs: 0,
  pausedDurationMs: 0,
  paused: false,
  scheduledSeconds: 0,
};

/** Clears the mocked sink's writes and clock; call before each test. */
export function resetAudioSinkState(): void {
  audioSinkState.writes = [];
  audioSinkState.startMs = 0;
  audioSinkState.pausedAtMs = 0;
  audioSinkState.pausedDurationMs = 0;
  audioSinkState.paused = false;
  audioSinkState.scheduledSeconds = 0;
}

/** The module `vi.mock('./audio-sink.ts', ...)` hands the engine: a Node sink that plays nothing and keeps time. */
export function mockAudioSinkModule() {
  return {
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
  };
}

export const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const unifiedBMSChartPath = resolve(rootDir, 'examples/test/four-measure-command-combo-test.bms');

export function createLNOBJLongNoteChart(lnMode?: 1 | 2 | 3) {
  const json = createEmptyJSON('bms');
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

export function createScratchLNOBJLongNoteChart() {
  const json = createEmptyJSON('bms');
  json.metadata.bpm = 480;
  json.bms.lnObjs = ['AA'];
  json.events = [
    { measure: 1, channel: '16', position: [0, 1] as const, value: '01' },
    { measure: 3, channel: '16', position: [0, 1] as const, value: 'AA' },
  ];
  return json;
}

export function createDynamicExRankChart() {
  const json = createEmptyJSON('bms');
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

export function createInvisibleOnlyChart(channel = '31') {
  const json = createEmptyJSON('bms');
  json.metadata.bpm = 120;
  json.resources.wav['01'] = 'not-found.wav';
  json.events = [{ measure: 0, channel, position: [0, 1] as const, value: '01' }];
  return json;
}

export function createPlayableOnlyChart() {
  const json = createEmptyJSON('bms');
  json.metadata.bpm = 120;
  json.resources.wav['01'] = 'not-found.wav';
  json.events = [{ measure: 0, channel: '11', position: [0, 1] as const, value: '01' }];
  return json;
}

export function createBGMOnlyChart() {
  const json = createEmptyJSON('bms');
  json.metadata.bpm = 120;
  json.resources.wav['01'] = 'not-found.wav';
  json.events = [{ measure: 0, channel: '01', position: [0, 1] as const, value: '01' }];
  return json;
}

export function createTimelineLoggingChart() {
  const json = createEmptyJSON('bms');
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

export function createPoorBGALoggingChart() {
  const json = createEmptyJSON('bms');
  json.metadata.bpm = 120;
  json.resources.wav['01'] = 'not-found.wav';
  json.resources.bmp['00'] = 'fallback.png';
  json.events = [{ measure: 0, channel: '11', position: [0, 1] as const, value: '01' }];
  return json;
}

export function createLandmineOnlyChart(options: { includeExplosionSound?: boolean; value?: string } = {}) {
  const { includeExplosionSound = true, value = '10' } = options;
  const json = createEmptyJSON('bms');
  json.metadata.bpm = 120;
  if (includeExplosionSound) {
    json.resources.wav['00'] = 'explode.wav';
  }
  // Mine on measure 1 (chart 2.0 s at BPM 120) so a held key can deterministically detonate it as it crosses the
  // judge line. A mine on measure 0 (chart 0 s) is racy under LR2's passage-based detonation: with playback sped up,
  // a single poll tick can advance chart time past the mine's PGREAT window before the input is processed.
  json.events = [{ measure: 1, channel: 'D1', position: [0, 1] as const, value }];
  return json;
}

// Deterministic landmine detonation — holds the 1P key-1 lane (`z` → channel 11) from 0.2 s through the mine's
// passage at chart 2.0 s, then ends the run at 2.3 s. Mirrors the proven hold-through test timing so CI doesn't race.
export const HELD_LANDMINE_INPUT: Array<{ delayMs: number; command: PlayerInputCommand }> = [
  { delayMs: 200, command: { kind: 'kitty-state', pressTokens: ['z'], repeatTokens: [], releaseTokens: [] } },
  { delayMs: 2300, command: { kind: 'interrupt', reason: 'escape' } },
];

/**
 * An input runtime that pushes `commands` after their delays from `start()`. The delays run on the engine's scheduler,
 * so they are host timers by default and exact when the play runs on a virtual clock (`core/characterization/
 * virtual-clock.ts`), which keeps timing-sensitive input off the wall clock.
 */
export function createScheduledInputRuntime(commands: Array<{ delayMs: number; command: PlayerInputCommand }>) {
  return ({ inputSignals }: { inputSignals: { pushCommand: (command: PlayerInputCommand) => void } }) => {
    const cancels: Array<() => void> = [];
    return {
      start: () => {
        const scheduler = getEngineScheduler();
        for (const { delayMs, command } of commands) {
          cancels.push(
            scheduler.setTimeout(() => {
              inputSignals.pushCommand(command);
            }, delayMs),
          );
        }
      },
      stop: () => {
        for (const cancel of cancels) {
          cancel();
        }
      },
    };
  };
}

export interface RecordedJudgeCombo {
  judge: string;
  combo: number;
  channel?: string;
  seconds: number;
}

export function createJudgeComboRecorder(records: RecordedJudgeCombo[]) {
  return async (context: CreatePlayerUIRuntimeContext) => {
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

/** UI runtime that records every long-note command the engine pushes (the UI must be enabled for them to fire). */
export function createLongNoteCommandRecorder(records: PlayerUICommand[]) {
  return async (context: CreatePlayerUIRuntimeContext) => {
    const original = context.uiSignals.pushCommand;
    context.uiSignals.pushCommand = (command) => {
      if (command.kind === 'long-note-start' || command.kind === 'long-note-end') {
        records.push(command);
      }
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
  };
}

export function createPlaybackEndRecorder(targetSeconds: number, records: number[]) {
  return async (context: CreatePlayerUIRuntimeContext) => ({
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

export function hasAnyNonSilentAudioWrite(): boolean {
  return audioSinkState.writes.some((chunk) => {
    for (let index = 0; index < chunk.length; index += 1) {
      if (chunk[index] !== 0) {
        return true;
      }
    }
    return false;
  });
}

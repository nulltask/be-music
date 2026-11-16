import { describe, expect, test } from 'vite-plus/test';
import { parseLRX } from '../../chart-parser/src/index.ts';
import type { BeMusicEvent } from '../../chart-source/src/index.ts';
import type { AudioSession, PlayerOptions } from './index.ts';
import { autoPlay, manualPlay } from './test-support/node-audio-player.ts';
import { createScheduledInputRuntime } from './test-support/player-fixtures.ts';

// BPM 120: a beat (480 ticks) lasts 0.5 s. The key note sounds `01` at 1 s; its chain note `02` follows 0.25 s later.
const chart = () =>
  parseLRX({
    lrs: [
      '<LRS>',
      '<n c="301" s="0" p="120" />',
      '<n c="300" s="0" />',
      '<n c="1" s="960" p="0" />',
      '<n c="1" s="1200" p="1" cn="1" />',
      '<n c="309" s="2400" />',
      '</LRS>',
    ].join(''),
  });

interface Triggered {
  value: string;
  atMs: number;
}

function recordingSession(triggered: Triggered[]): PlayerOptions['createAudioSession'] {
  const startedAt = performance.now();
  return async (): Promise<AudioSession> => ({
    backendLabel: 'recording-audio',
    chartStartDelayMs: 0,
    start: () => undefined,
    pause: () => undefined,
    resume: () => undefined,
    finish: async () => undefined,
    dispose: async () => undefined,
    triggerEvent: (event: BeMusicEvent) => {
      triggered.push({ value: event.value, atMs: performance.now() - startedAt });
    },
    stopChannel: () => undefined,
  });
}

const baseOptions = { speed: 1, leadInMs: 0, audio: true, tui: false, writeOutput: () => undefined } as const;

describe('LRX chain notes', () => {
  test('a press that sounds the note plays its chain note as far after the press', async () => {
    const triggered: Triggered[] = [];
    await manualPlay(chart(), {
      ...baseOptions,
      createAudioSession: recordingSession(triggered),
      createInputRuntime: createScheduledInputRuntime([
        // 150 ms early (a BAD): the chain note follows the press (at 1.1 s), not the chart (1.25 s).
        { delayMs: 850, command: { kind: 'lane-input', tokens: ['z'] } },
        { delayMs: 1600, command: { kind: 'interrupt', reason: 'escape' } },
      ]),
    });
    const key = triggered.find((sound) => sound.value === '01');
    const chain = triggered.find((sound) => sound.value === '02');
    expect(key).toBeDefined();
    expect(chain).toBeDefined();
    expect(chain!.atMs - key!.atMs).toBeGreaterThanOrEqual(200);
    expect(chain!.atMs - key!.atMs).toBeLessThan(400);
    expect(chain!.atMs).toBeLessThan(1200);
  });

  test('without a press the chain note stays silent', async () => {
    const triggered: Triggered[] = [];
    await manualPlay(chart(), {
      ...baseOptions,
      createAudioSession: recordingSession(triggered),
      createInputRuntime: createScheduledInputRuntime([
        { delayMs: 1600, command: { kind: 'interrupt', reason: 'escape' } },
      ]),
    });
    expect(triggered.map((sound) => sound.value)).not.toContain('02');
  });

  test('AUTO play sounds the chain note at its own time', async () => {
    const triggered: Triggered[] = [];
    await autoPlay(chart(), {
      ...baseOptions,
      createAudioSession: recordingSession(triggered),
      createInputRuntime: createScheduledInputRuntime([
        { delayMs: 1600, command: { kind: 'interrupt', reason: 'escape' } },
      ]),
    });
    expect(triggered.filter((sound) => sound.value === '02')).toHaveLength(1);
  });
});

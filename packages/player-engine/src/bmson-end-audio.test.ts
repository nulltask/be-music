import { expect, test } from 'vite-plus/test';
import { parseBmson } from '@be-music/chart-parser';
import { autoPlay, manualPlay, type AudioSession } from './index.ts';
import { createVirtualClock } from './core/characterization/virtual-clock.ts';
import { createScheduledInputRuntime } from './test-support/player-fixtures.ts';

function chart(type: number) {
  return parseBmson(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 240, mode_hint: 'beat-7k' },
      sound_channels: [
        { name: 'head.wav', notes: [{ x: 1, y: 240, l: 240, t: type }] },
        { name: 'end.wav', notes: [{ x: 1, y: 480, up: true }] },
      ],
    }),
  );
}

async function play(mode: 'auto' | 'manual', type: number, startAtSeconds = 0, input = true) {
  const clock = createVirtualClock();
  const calls: Array<{ value: string; at: number; offset?: number }> = [];
  const session: AudioSession = {
    backendLabel: 'test',
    chartStartDelayMs: 0,
    start() {},
    pause() {},
    resume() {},
    async finish() {},
    async dispose() {},
    triggerEvent(event) {
      calls.push({ value: event.value, at: clock.now() });
    },
    triggerEventAt(event, offset) {
      calls.push({ value: event.value, offset, at: clock.now() });
    },
    getActiveAudioVoiceCount: () => 0,
  };
  const source = chart(type);
  // Extend the seekable chart beyond the LN without adding another AUTO keysound.
  if (startAtSeconds > 0)
    source.events.push({ measure: 1, channel: 'D2', position: [0, 1], value: '00', bmson: { damage: 0 } });
  const summary = await clock.run(() =>
    (mode === 'auto' ? autoPlay : manualPlay)(source, {
      audio: true,
      tui: false,
      leadInMs: 0,
      startAtSeconds,
      judgeRuleset: 'beatoraja',
      createAudioSession: async () => session,
      writeOutput() {},
      createInputRuntime: createScheduledInputRuntime(
        mode === 'auto' || !input
          ? []
          : [
              {
                delayMs: 250,
                command: { kind: 'kitty-state', pressTokens: ['z'], releaseTokens: [], repeatTokens: [] },
              },
              { delayMs: 250, command: { kind: 'lane-input', tokens: ['z'] } },
              {
                delayMs: 500,
                command: { kind: 'kitty-state', pressTokens: [], releaseTokens: ['z'], repeatTokens: [] },
              },
            ],
      ),
    }),
  );
  return { calls, summary };
}

test.each([1, 2, 3])('AUTO schedules type %s end audio separately from the head', async (type) => {
  const { calls } = await play('auto', type);
  expect(calls.map((call) => call.value)).toEqual(['01', '02']);
  expect(calls[0]!.at).toBeCloseTo(250, 6);
  expect(calls[1]!.at).toBeGreaterThanOrEqual(499.999999);
  expect(calls[1]!.at - calls[0]!.at).toBeGreaterThan(200);
});

test.each([1, 2, 3])('manual type %s emits the attached tail once through the audio adapter', async (type) => {
  const { calls } = await play('manual', type);
  expect(calls.map((call) => call.value)).toEqual(['01', '02']);
  expect(calls[1]!.at).toBeGreaterThanOrEqual(499.999999);
});

test('AUTO seeks into the end sound with elapsed tail time instead of head time', async () => {
  const { calls } = await play('auto', 2, 0.6);
  expect(calls.map((call) => call.value)).toEqual(['01', '02']);
  expect(calls[0]!.offset).toBeCloseTo(0.35);
  expect(calls[1]!.offset).toBeCloseTo(0.1);
});

test('manual practice skips a preceding LN and its end sound without synthesizing release input', async () => {
  expect((await play('manual', 2, 0.4, false)).calls).toEqual([]);
});

import { parseBMS } from '@be-music/chart-parser';
import { expect, test } from 'vite-plus/test';
import { observePlay, type CharacterizationPlay } from './characterization/harness.ts';
import type { PlayerUIFramePayload } from './ui-signal-bus.ts';

const chart = (duration = 400, lane = '11') =>
  parseBMS(
    [
      '#BPM 240',
      '#WAV01 note.wav',
      '#00111:01',
      '#00311:01',
      `#SWBGA61 100:${duration}:${lane}:1:255,255,255,255 00010203`,
      '#000A5:61',
    ].join('\n'),
  );
const snapshot = (frame: Readonly<PlayerUIFramePayload>) => ({
  seconds: frame.currentSeconds,
  generation: frame.generation ?? 0,
  animation: frame.keyBoundBGA ? structuredClone(frame.keyBoundBGA) : undefined,
});
type Frame = ReturnType<typeof snapshot>;
function capture(frames: Frame[]): CharacterizationPlay['onFrame'] {
  return (frame) => frames.push(snapshot(frame));
}
const at = (frames: Frame[], seconds: number, generation = 0) =>
  frames.find((frame) => frame.generation === generation && frame.seconds >= seconds);

test('live presses drive engine SWBGA frames without changing judgments, audio triggers or the recorded inputs', async () => {
  const frames: Frame[] = [];
  const source = chart();
  const script = [
    { atMs: 1000, down: ['11'] },
    { atMs: 1060, up: ['11'] },
  ] as const;
  const enabled = await observePlay({ driver: 'manual', chart: source, script, onFrame: capture(frames) });
  const baseline = structuredClone(source);
  baseline.bms.swBGA = {};
  baseline.events = baseline.events.filter((event) => event.channel !== 'A5');
  const original = await observePlay({ driver: 'manual', chart: baseline, script });
  expect(enabled.outcome).toBe('completed');
  expect(enabled.summary).toEqual(original.summary);
  expect(enabled.audio).toEqual(original.audio);
  expect(enabled.replay!.inputs).toEqual(original.replay!.inputs);
  expect(at(frames, 0.5)?.animation).toBeUndefined();
  expect(at(frames, 1.01)?.animation).toMatchObject({ definitionId: '61', bmpKey: '00', channel: '11' });
  expect(at(frames, 1.2)?.animation?.bmpKey).toBe('02');
  expect(at(frames, 1.4)?.animation).toBeUndefined();
});

test.each([10, 60])(
  'replay frame spacing (%s FPS) preserves the input-driven animation and release boundary',
  async (uiFPS) => {
    const frames: Frame[] = [];
    const observed = await observePlay({
      driver: 'manual',
      chart: chart(0),
      options: {
        uiFPS,
        replayInputs: [
          { seq: 0, timeUs: 1000000, action: 'down', channels: ['11'] },
          { seq: 1, timeUs: 1350000, action: 'up', channels: ['11'] },
        ],
      },
      onFrame: capture(frames),
    });
    expect(observed.outcome).toBe('completed');
    expect(at(frames, 1.1)?.animation).toMatchObject({ bmpKey: '01', startedSeconds: 1 });
    expect(at(frames, 1.4)?.animation).toBeUndefined();
  },
);

test('AUTO supplies virtual taps and held LN edges on the same deterministic timeline', async () => {
  const source = chart(0);
  source.bms.lnType = 1;
  source.events.push(
    { channel: '51', measure: 2, position: [0, 1], value: '01' },
    { channel: '51', measure: 2, position: [1, 2], value: '01' },
  );
  const frames: Frame[] = [];
  const result = await observePlay({ driver: 'auto', chart: source, onFrame: capture(frames) });
  expect(result.outcome).toBe('completed');
  expect(result.replay!.inputs).toEqual([]);
  expect(at(frames, 1.01)?.animation?.bmpKey).toBe('00');
  expect(at(frames, 1.15)?.animation).toBeUndefined();
  expect(at(frames, 2.3)?.animation?.bmpKey).toBe('03');
  expect(at(frames, 2.5)?.animation).toBeUndefined();
});

test('AUTO SCRATCH drives only assisted lanes and manual seek clears live held animation state', async () => {
  const source = chart(0, '16');
  source.events.push({ channel: '16', measure: 1, position: [0, 1], value: '01' });
  const assisted: Frame[] = [];
  await observePlay({ driver: 'manual', chart: source, options: { autoScratch: true }, onFrame: capture(assisted) });
  expect(at(assisted, 1.01)?.animation?.channel).toBe('16');
  expect(at(assisted, 1.15)?.animation).toBeUndefined();
  const manual: Frame[] = [];
  await observePlay({
    driver: 'manual',
    chart: chart(0),
    script: [
      { atMs: 1000, down: ['11'] },
      { atMs: 1200, command: { kind: 'seek', seconds: 0.5 } },
    ],
    onFrame: capture(manual),
  });
  expect(at(manual, 1.01)?.animation).toBeDefined();
  expect(at(manual, 0.5, 1)?.animation).toBeUndefined();
});

test('replay seek reconstructs held animation state at the target and lets its recorded release expire it', async () => {
  const frames: Frame[] = [];
  const result = await observePlay({
    driver: 'manual',
    chart: chart(0),
    options: {
      replayInputs: [
        { seq: 0, timeUs: 1000000, action: 'down', channels: ['11'] },
        { seq: 1, timeUs: 1600000, action: 'up', channels: ['11'] },
      ],
    },
    script: [{ atMs: 1400, command: { kind: 'seek', seconds: 1.2 } }],
    onFrame: capture(frames),
  });
  expect(result.outcome).toBe('completed');
  expect(at(frames, 1.2, 1)?.animation).toMatchObject({ startedSeconds: 1, bmpKey: '02' });
  expect(at(frames, 1.6, 1)?.animation).toBeUndefined();
});

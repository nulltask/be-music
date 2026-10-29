import { expect, test } from 'vite-plus/test';
import { parseBmson } from '@be-music/chart-parser';
import { observePlay, tap, type CharacterizationPlay } from './characterization/harness.ts';
import type { PlayerUIFramePayload } from './ui-signal-bus.ts';

function chart(condition: 'play' | 'miss' | 'always' = 'play') {
  return parseBmson(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 120 },
      sound_channels: [
        {
          name: 'note.wav',
          notes: [
            { x: 1, y: 480 },
            { x: 1, y: 1440 },
          ],
        },
      ],
      bga: {
        bga_header: [
          { id: 20, name: 'a.png' },
          { id: 30, name: 'b.png' },
          { id: 40, name: 'c.png' },
        ],
        bga_sequence: [
          { id: 10, sequence: [{ time: 0, id: 0 }, { time: 100, id: 1 }, { time: 400 }] },
          { id: 11, sequence: [{ time: 0, id: 2 }, { time: 400 }] },
        ],
        layer_events: [{ y: 0, id_set: [10, 11], condition, interval: condition === 'always' ? 1000 : 0 }],
      },
    }),
  );
}
const snapshot = (frame: Readonly<PlayerUIFramePayload>) => ({
  seconds: frame.currentSeconds,
  generation: frame.generation ?? 0,
  paused: frame.clock?.paused ?? false,
  bga: frame.bmsonBGA ? { ...frame.bmsonBGA } : undefined,
});
type Frame = ReturnType<typeof snapshot>;
const capture =
  (frames: Frame[]): CharacterizationPlay['onFrame'] =>
  (frame) =>
    frames.push(snapshot(frame));
const at = (frames: Frame[], seconds: number, generation = 0) =>
  frames.find((frame) => frame.seconds >= seconds && frame.generation === generation);

test('manual successful judgments drive BGA without changing judging, replay or audio', async () => {
  const frames: Frame[] = [];
  const source = chart();
  const script = [...tap(1000, '11'), ...tap(3000, '11')];
  const result = await observePlay({ driver: 'manual', chart: source, script, onFrame: capture(frames) });
  const plain = chart();
  plain.bmson.bga = { header: [], events: [], layerEvents: [], poorEvents: [] };
  const baseline = await observePlay({ driver: 'manual', chart: plain, script });
  expect(result.summary).toEqual(baseline.summary);
  expect(result.replay!.inputs).toEqual(baseline.replay!.inputs);
  expect(result.audio).toEqual(baseline.audio);
  expect(at(frames, 0.5)?.bga).toBeUndefined();
  expect(at(frames, 1.01)?.bga).toMatchObject({ plane: 'layer', key: 'a.png', startedSeconds: 1 });
  expect(at(frames, 1.15)?.bga?.key).toBe('b.png');
  expect(at(frames, 1.5)?.bga).toBeUndefined();
  expect(at(frames, 3.01)?.bga?.key).toBe('c.png');
});

test('MISS uses actual failed judgments rather than input presses', async () => {
  const frames: Frame[] = [];
  await observePlay({ driver: 'manual', chart: chart('miss'), onFrame: capture(frames) });
  const active = frames.filter((frame) => frame.bga !== undefined);
  expect(active.length).toBeGreaterThan(0);
  expect(active[0]!.bga).toMatchObject({ plane: 'poor', key: 'a.png' });
  expect(active.some((frame) => frame.bga?.key === 'b.png')).toBe(true);
  expect(active.some((frame) => frame.bga?.key === 'c.png')).toBe(true);
});

test.each(['auto', 'replay'] as const)('%s seek rebuilds sequence history at the target', async (driver) => {
  const frames: Frame[] = [];
  await observePlay({
    driver: driver === 'auto' ? 'auto' : 'manual',
    chart: chart(),
    options:
      driver === 'replay'
        ? {
            replayInputs: [
              { seq: 0, timeUs: 1000000, action: 'down', channels: ['11'] },
              { seq: 1, timeUs: 1060000, action: 'up', channels: ['11'] },
              { seq: 2, timeUs: 3000000, action: 'down', channels: ['11'] },
              { seq: 3, timeUs: 3060000, action: 'up', channels: ['11'] },
            ],
          }
        : {},
    script: [{ atMs: 1400, command: { kind: 'seek', seconds: 1.2 } }],
    onFrame: capture(frames),
  });
  expect(at(frames, 1.2, 1)?.bga).toMatchObject({ key: 'b.png', startedSeconds: 1, frameStartSeconds: 1.1 });
  expect(at(frames, 3.01, 1)?.bga?.key).toBe('c.png');
});

test('manual seek clears prior live judgments and pause holds the sequence chart clock', async () => {
  const frames: Frame[] = [];
  await observePlay({
    driver: 'manual',
    chart: chart(),
    script: [
      ...tap(1000, '11'),
      { atMs: 1050, command: { kind: 'toggle-pause' } },
      { atMs: 1250, command: { kind: 'toggle-pause' } },
      { atMs: 1550, command: { kind: 'seek', seconds: 1.2 } },
    ],
    onFrame: capture(frames),
  });
  const paused = frames.filter((frame) => frame.paused && frame.bga !== undefined);
  expect(paused.length).toBeGreaterThan(0);
  expect(new Set(paused.map((frame) => frame.seconds)).size).toBe(1);
  expect(paused.every((frame) => frame.bga?.key === 'a.png')).toBe(true);
  expect(at(frames, 1.2, 1)?.bga).toBeUndefined();
  expect(frames.some((frame) => frame.bga?.key === 'a.png')).toBe(true);
});

test('an ordinary layer cue ends an earlier conditional selection', async () => {
  const source = chart();
  source.bmson.bga.layerEvents.push({ y: 960, id: 40 });
  const frames: Frame[] = [];
  await observePlay({ driver: 'auto', chart: source, onFrame: capture(frames) });
  expect(at(frames, 1.01)?.bga?.key).toBe('a.png');
  expect(at(frames, 3.01)?.bga).toBeUndefined();
});

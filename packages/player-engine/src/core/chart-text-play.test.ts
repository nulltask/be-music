import { expect, test } from 'vite-plus/test';
import { parseBMS } from '@be-music/chart-parser';
import { observePlay, tap } from './characterization/harness.ts';
import type { PlayerUIFramePayload } from './ui-signal-bus.ts';

function chart() {
  return parseBMS(`#BPM 120
#WAV01 note.wav
#TEXT00 "MISS"
#TEXT01 "first"
#TEXT02 "next"
#00099:00010000
#00199:02
#00011:0001
#00111:0001
#00299:03
`);
}
const snapshot = (frame: Readonly<PlayerUIFramePayload>) => ({
  seconds: frame.currentSeconds,
  generation: frame.generation ?? 0,
  paused: frame.clock?.paused ?? false,
  text: frame.chartText,
});
type Frame = ReturnType<typeof snapshot>;
const at = (frames: Frame[], seconds: number, generation = 0) =>
  frames.find((frame) => frame.seconds >= seconds && frame.generation === generation);

test('channel 99 selects text, missing references clear, and a late cue keeps playback open without audio', async () => {
  const frames: Frame[] = [];
  const result = await observePlay({
    driver: 'auto',
    chart: chart(),
    audio: false,
    onFrame: (frame) => frames.push(snapshot(frame)),
  });
  expect(result.outcome).toBe('completed');
  expect(at(frames, 0)?.text).toBe('');
  expect(at(frames, 0.51)?.text).toBe('first');
  expect(at(frames, 2.01)?.text).toBe('next');
  expect(at(frames, 4)?.text).toBe('');
});

test('TEXT00 reacts to actual misses and a successful judgment restores ordinary text', async () => {
  const frames: Frame[] = [];
  await observePlay({
    driver: 'manual',
    chart: chart(),
    script: tap(3000, '11'),
    onFrame: (frame) => frames.push(snapshot(frame)),
  });
  expect(frames.some((frame) => frame.text === 'MISS')).toBe(true);
  expect(at(frames, 2)?.text).toBe('next');
  expect(at(frames, 3.01)?.text).toBe('next');
});

test('pause holds miss text and manual seek clears live misses while restoring the selected cue', async () => {
  const frames: Frame[] = [];
  await observePlay({
    driver: 'manual',
    chart: chart(),
    script: [
      { atMs: 1300, command: { kind: 'toggle-pause' } },
      { atMs: 1500, command: { kind: 'toggle-pause' } },
      { atMs: 1600, command: { kind: 'seek', seconds: 1.3 } },
    ],
    onFrame: (frame) => frames.push(snapshot(frame)),
  });
  const paused = frames.filter((frame) => frame.paused && frame.generation === 0 && frame.seconds > 0);
  expect(paused.length).toBeGreaterThan(1);
  expect([...new Set(paused.map((frame) => frame.seconds))]).toEqual([1.3]);
  expect(paused.every((frame) => frame.text === 'MISS')).toBe(true);
  expect(at(frames, 1.3, 1)?.text).toBe('first');
});

test('replay seek reconstructs the missed judgment, and a fresh play starts without its history', async () => {
  const frames: Frame[] = [];
  await observePlay({
    driver: 'manual',
    chart: chart(),
    options: { replayInputs: [] },
    script: [{ atMs: 1500, command: { kind: 'seek', seconds: 1.3 } }],
    onFrame: (frame) => frames.push(snapshot(frame)),
  });
  expect(at(frames, 1.3, 1)?.text).toBe('MISS');
  const restarted: Frame[] = [];
  await observePlay({ driver: 'auto', chart: chart(), onFrame: (frame) => restarted.push(snapshot(frame)) });
  expect(at(restarted, 0)?.text).toBe('');
  expect(at(restarted, 1.3)?.text).toBe('first');
});

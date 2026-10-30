import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vite-plus/test';
import { parseChart } from '@be-music/chart-parser';
import { renderJSON, renderSingleSample } from './index.ts';
import { encodeWAV16 } from './core/file-codec.ts';

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'be-music-wav-effects-'));
  const left = Float32Array.from({ length: 4000 }, (_, index) => 0.5 * Math.sin((2 * Math.PI * 440 * index) / 16000));
  const right = Float32Array.from(left, (value) => value / 2);
  await writeFile(join(directory, 'stereo.wav'), encodeWAV16({ sampleRate: 16000, left, right }));
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

function cycles(samples: Float32Array): number {
  let count = 0;
  for (let index = 1; index < samples.length; index++) if (samples[index - 1]! <= 0 && samples[index]! > 0) count++;
  return count;
}

test.each([44100, 48000])(
  'native frequency, pitch, balance and duration produce exact sounding time at %s Hz',
  async (sampleRate) => {
    const chart = parseChart(
      '#BPM 120\n#EXWAV01 pf 10000 32000 stereo.wav\n#WAVCMD 00 01 72\n#WAVCMD 02 01 100\n#00011:01',
      'bms',
    );
    const result = await renderJSON(chart, {
      baseDir: directory,
      sampleRate,
      normalize: false,
      gain: 1,
      tailSeconds: 0,
    });
    expect(result.left.length).toBe(Math.round(sampleRate * 0.05));
    expect(result.left.every((value) => value === 0)).toBe(true);
    expect(cycles(result.right)).toBe(88);
    expect(result.peak).toBeGreaterThan(0.24);
    expect(result.peak).toBeLessThan(0.251);
  },
);

test('single-sample Node preparation has the same PCM as offline chart rendering', async () => {
  const chart = parseChart(
    '#BPM 120\n#EXWAV01 p -600 stereo.wav\n#WAVCMD 00 01 72\n#WAVCMD 02 01 100\n#00011:01',
    'bms',
  );
  const options = { baseDir: directory, sampleRate: 48000, gain: 1 };
  const single = await renderSingleSample('01', 'stereo.wav', {
    ...options,
    playbackModifiers: { semitones: 12, pan: -600, durationSeconds: 0.05 },
  });
  const offline = await renderJSON(chart, { ...options, normalize: false, tailSeconds: 0 });
  expect(single.left).toEqual(offline.left);
  expect(single.right).toEqual(offline.right);
});

test('duration zero restores the natural end and a long duration neither loops nor pads', async () => {
  const options = { baseDir: directory, sampleRate: 48000 };
  const natural = await renderSingleSample('01', 'stereo.wav', { ...options, playbackModifiers: { semitones: 12 } });
  const long = await renderSingleSample('01', 'stereo.wav', {
    ...options,
    playbackModifiers: { semitones: 12, durationSeconds: 3 },
  });
  expect(natural.durationSeconds).toBe(0.125);
  expect(long.left).toEqual(natural.left);
});

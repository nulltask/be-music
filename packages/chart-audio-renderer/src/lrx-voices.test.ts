import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vite-plus/test';
import { parseLRX } from '@be-music/chart-parser';
import { encodeWAV16 } from './core/file-codec.ts';
import { renderJSON } from './index.ts';

let baseDir: string;
beforeAll(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'lrx-voices-'));
  // 1 s at 8 kHz: 0.25 for the first half, 0.5 for the second.
  const left = Float32Array.from({ length: 8000 }, (_, i) => (i < 4000 ? 0.25 : 0.5));
  await writeFile(join(baseDir, 'tone.wav'), encodeWAV16({ sampleRate: 8000, left, right: left }));
});
afterAll(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

const options = () => ({ baseDir, sampleRate: 8000, gain: 1, normalize: false, tailSeconds: 0 });
const chart = (attributes: string) =>
  parseLRX({
    lrs: `<LRS><sound id="0" filename="tone.wav" /><n c="301" s="0" p="120" /><n c="100" s="0" p="0" ${attributes} /></LRS>`,
  });

test('an LRX note plays at its own volume and balance', async () => {
  const rendered = await renderJSON(chart('vol="64" pan="96"'), options());
  expect(rendered.left[1000]).toBeCloseTo((0.25 * 64) / 127 / 2, 3);
  expect(rendered.right[1000]).toBeCloseTo((0.25 * 64) / 127, 3);
});

test('an LRX note plays its window of the sample at its own rate', async () => {
  // From 0.25 s into the sample at half rate, `len` 500 ms doubled to 1 s of sounding time (plugout's 44100 / frq
  // factor): it plays 0.25–0.75 s of the sample over 1 s, crossing into the louder half halfway.
  const rendered = await renderJSON(chart('frq="22050" ost="250" len="500"'), options());
  expect(rendered.left[2000]).toBeCloseTo(0.25, 3);
  expect(rendered.left[6000]).toBeCloseTo(0.5, 3);
  expect(rendered.left.length).toBeLessThan(8100);
});

test('an LRX note fades in over its attack and out over its release', async () => {
  const rendered = await renderJSON(chart('atk="100" len="500" rls="100"'), options());
  expect(rendered.left[400]).toBeCloseTo(0.125, 3);
  expect(rendered.left[1000]).toBeCloseTo(0.25, 3);
  // The release rings on past the 500 ms length into the louder half and is gone by 600 ms.
  expect(rendered.left[4400]).toBeCloseTo(0.25, 3);
  expect(rendered.left[4790]).toBeCloseTo((0.5 * 10) / 800, 4);
  expect(rendered.left.length).toBeLessThanOrEqual(4800);
});

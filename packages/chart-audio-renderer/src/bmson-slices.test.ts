import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vite-plus/test';
import { createEmptyJSON } from '@be-music/chart-source';
import { encodeWAV16 } from './core/file-codec.ts';
import { renderJSON } from './index.ts';

let baseDir: string;
beforeAll(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'bmson-slices-'));
  const left = Float32Array.from({ length: 8000 }, (_, i) => (i < 4000 ? 0.125 : 0.25));
  await writeFile(join(baseDir, 'stem.wav'), encodeWAV16({ sampleRate: 8000, left, right: left }));
});
afterAll(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

const options = () => ({ baseDir, sampleRate: 8000, gain: 1, normalize: false, tailSeconds: 0 });

test('a continuation renders its own window without doubling the stem', async () => {
  const json = createEmptyJSON('bmson');
  json.metadata.bpm = 120;
  json.resources.wav['01'] = 'stem.wav';
  json.events = [
    { measure: 0, channel: '11', position: [0, 1], value: '01', bmson: { c: false } },
    { measure: 0, channel: '12', position: [1, 4], value: '01', bmson: { c: true } },
    { measure: 0, channel: '13', position: [1, 4], value: '01', bmson: { c: true } },
  ];
  const rendered = await renderJSON(json, options());
  expect(rendered.left[2000]).toBeCloseTo(0.125, 4);
  expect(rendered.left[6000]).toBeCloseTo(0.25, 4);
});

test('a first c=true note still plays from the beginning of its source', async () => {
  const json = createEmptyJSON('bmson');
  json.metadata.bpm = 120;
  json.resources.wav['01'] = 'stem.wav';
  json.events = [{ measure: 0, channel: '11', position: [1, 4], value: '01', bmson: { c: true } }];
  const rendered = await renderJSON(json, options());
  expect(rendered.left[2000]).toBe(0);
  expect(rendered.left[6000]).toBeCloseTo(0.125, 4);
  expect(rendered.left[10000]).toBeCloseTo(0.25, 4);
});

test('different sound channels naming the same file remain independently audible', async () => {
  const json = createEmptyJSON('bmson');
  json.metadata.bpm = 120;
  json.resources.wav = { '01': 'stem.wav', '02': 'stem.wav' };
  json.events = ['01', '02'].map((value) => ({ measure: 0, channel: '11', position: [0, 1], value }));
  const rendered = await renderJSON(json, options());
  expect(rendered.left[2000]).toBeCloseTo(0.25, 4);
  expect(rendered.left[6000]).toBeCloseTo(0.5, 4);
});

test('offline rendering plays a paired up slice but leaves an orphan up slice silent', async () => {
  const json = createEmptyJSON('bmson');
  json.metadata.bpm = 120;
  json.bmson.info.resolution = 240;
  json.resources.wav['01'] = 'stem.wav';
  json.events = [
    { measure: 0, channel: '11', position: [0, 1], value: '01', bmson: { l: 240 } },
    { measure: 0, channel: '11', position: [1, 4], value: '01', bmson: { up: true, c: true } },
    { measure: 0, channel: '12', position: [3, 8], value: '01', bmson: { up: true, c: true } },
    { measure: 0, channel: '01', position: [1, 2], value: '01', bmson: { c: false } },
  ];
  const rendered = await renderJSON(json, options());
  expect(rendered.left[2000]).toBeCloseTo(0.125, 4);
  expect(rendered.left[5000]).toBeCloseTo(0.25, 4);
  expect(rendered.left[7000]).toBe(0);
  expect(rendered.left[9000]).toBeCloseTo(0.125, 4);
});

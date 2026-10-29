import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import { parseBmson, parseChart, parseChartFile } from './index.ts';

const document = (version: unknown) => JSON.stringify({ version, info: { init_bpm: 120 }, sound_channels: [] });
const readers = [
  parseBmson,
  (text: string) => parseChart(text),
  (text: string) => parseChart(text, 'bmson'),
  (text: string) => parseChart(text, 'json'),
];

test.each(['1.0.0', '1.0.0+build.001', '1.0.0+ABC-xyz'])('accepts and preserves supported SemVer %s', (version) => {
  for (const read of readers) expect(read(document(version)).bmson.version).toBe(version);
});

test.each([
  null,
  1,
  false,
  {},
  [],
  '',
  '1',
  '1.0',
  'v1.0.0',
  '01.0.0',
  '1.00.0',
  '1.0.00',
  ' 1.0.0',
  '1.0.0\n',
  '1.0.0-',
  '1.0.0+',
  '1.0.0-a..b',
  '1.0.0-01',
  '1.0.0-a.01',
  '1.0.0+a..b',
])('rejects malformed version %j through every reader', (version) => {
  for (const read of readers) expect(() => read(document(version))).toThrow(/Invalid bmson version/);
});

test.each([
  '0.21.0',
  '1.0.1',
  '1.1.0',
  '2.0.0',
  '10.0.0',
  '999999999999999999999.0.0',
  '1.0.0-beta',
  '1.0.0-rc.1+build',
  '1.0.0-01a',
])('rejects unsupported valid SemVer %s', (version) => {
  for (const read of readers) expect(() => read(document(version))).toThrow(/Unsupported bmson version/);
});

test('rejects missing-version legacy fields instead of quietly reading an empty modern chart', () => {
  const legacy = JSON.stringify({
    info: { initBPM: 120 },
    soundChannel: [{ name: 'stem.wav', notes: [{ x: 1, y: 960 }] }],
  });
  for (const read of readers) expect(() => read(legacy)).toThrow(/legacy bmson v0.21.*format converter/);
  for (const read of readers) expect(() => read(document(undefined))).toThrow(/version is missing/);
});

test.each(['null', '[]', '1', '"1.0.0"'])('rejects non-object bmson input %s explicitly', (input) => {
  expect(() => parseBmson(input)).toThrow(/expected a JSON object/);
});

test('Node file loading propagates version diagnostics and accepts valid input', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bmson-version-'));
  try {
    for (const extension of ['bmson', 'json']) {
      const path = join(dir, `chart.${extension}`);
      for (const version of [null, undefined, 'broken', '2.0.0']) {
        await writeFile(path, document(version));
        await expect(parseChartFile(path)).rejects.toThrow(/bmson.*version|legacy bmson/);
      }
      await writeFile(path, document('1.0.0+local'));
      expect((await parseChartFile(path)).bmson.version).toBe('1.0.0+local');
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

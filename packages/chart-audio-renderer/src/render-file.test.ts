import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vite-plus/test';
import { renderChartFile } from './index.ts';

let fixture: string;
beforeEach(async () => {
  fixture = await mkdtemp(join(tmpdir(), 'be-music-render-'));
  // 8 kHz, 16-bit stereo, two frames: [+32767,-16384] and [-32768,+16384].
  const hit = Buffer.from(
    '524946462c00000057415645666d74201000000001000200401f0000007d0000040010006461746108000000ff7f00c000800040',
    'hex',
  );
  await Promise.all([
    writeFile(join(fixture, 'left-key.wav'), hit),
    writeFile(join(fixture, 'right-key.wav'), hit),
    writeFile(
      join(fixture, 'chord.bms'),
      '#BPM 120\n#WAV01 left-key.wav\n#WAV02 right-key.wav\n#00011:01\n#00012:02\n',
    ),
  ]);
});
afterEach(async () => {
  await rm(fixture, { recursive: true, force: true });
});

test.each([
  ['wav', 'RIFF', 'WAVE', 44, true],
  ['aiff', 'FORM', 'AIFF', 54, false],
] as const)(
  'renders overlapping adjacent keysounds from disk into a normalized %s file',
  async (format, container, kind, offset, littleEndian) => {
    const destination = join(fixture, `mix.${format}`);
    const result = await renderChartFile(join(fixture, 'chord.bms'), destination, {
      sampleRate: 8000,
      tailSeconds: 0,
      gain: 1,
      normalize: true,
    });
    expect(result.peak).toBe(1);
    expect(result.left[0]).toBeCloseTo(32767 / 32768, 7);
    expect(result.left[1]).toBe(-1);
    expect(result.right.slice(0, 2)).toEqual(Float32Array.of(-0.5, 0.5));

    const encoded = await readFile(destination);
    expect(encoded.toString('ascii', 0, 4)).toBe(container);
    expect(encoded.toString('ascii', 8, 12)).toBe(kind);
    const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
    expect([0, 2, 4, 6].map((sample) => view.getInt16(offset + sample, littleEndian))).toEqual([
      32766, -16384, -32768, 16384,
    ]);
  },
);

test('preserves a peak above full scale in the returned mix when normalization is off', async () => {
  const result = await renderChartFile(join(fixture, 'chord.bms'), join(fixture, 'raw.wav'), {
    sampleRate: 8000,
    tailSeconds: 0,
    gain: 1,
    normalize: false,
  });
  expect(result.peak).toBe(2);
  expect(result.left[1]).toBe(-2);
  expect(result.right.slice(0, 2)).toEqual(Float32Array.of(-1, 1));
});

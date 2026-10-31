import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseBMS } from '@be-music/chart-parser';
import { createEmptyJSON } from '@be-music/chart-source';
import { stitchNonstopCourse } from '@be-music/player-engine/course';
import { encode } from 'fast-png';
import { expect, test, vi } from 'vite-plus/test';
import { createBgaANSIRenderer, type BGAKittyImage } from './bga.ts';

test.each([
  ['04', '0'],
  ['07', '0'],
  ['0A', '0'],
  ['06', '0'],
  ['06', '1'],
  ['00', '0'],
])('terminal BGA crops original image coordinates for channel %s / POORBGA %s', async (channel, poorMode) => {
  const baseDir = await mkdtemp(join(tmpdir(), 'be-music-bga-crop-'));
  try {
    await writePNG(join(baseDir, 'sprites.png'), 512, 256, (x, y) =>
      x >= 256 && x < 384 && y < 128 ? [255, 0, 0] : [0, 255, 0],
    );
    await writePNG(join(baseDir, 'base.png'), 256, 256, () => [0, 0, 255]);
    const chart = parseBMS(
      [
        '#BPM 120',
        `#POORBGA ${poorMode}`,
        '#BMP01 sprites.png',
        '#BMP03 base.png',
        `#BGA${channel === '00' ? '00' : '02'} 01 256 0 384 128 64 64`,
        `#00004:${channel === '04' ? '02' : '03'}`,
        ...(channel !== '04' && channel !== '00' ? [`#000${channel}:02`] : []),
      ].join('\n'),
    );
    const original = structuredClone(chart);
    const progress: Array<{ detail: string; ratio: number }> = [];
    const renderer = await createBgaANSIRenderer(chart, {
      baseDir,
      width: 40,
      height: 20,
      imageResizeAlgorithm: 'nearest',
      onLoadProgress: (entry) => progress.push(entry),
    });
    expect(renderer).toBeDefined();
    if (channel === '06' || channel === '00') renderer!.triggerPoor(0);
    const image = renderer!.getKittyImage(0);
    expect(pixelAt(image, 100, 100)).toEqual([255, 0, 0]);
    const replacesBase = channel === '04' || channel === '00' || (channel === '06' && poorMode === '0');
    expect(pixelAt(image, 16, 16)).toEqual(replacesBase ? [0, 0, 0] : [0, 0, 255]);
    expect(renderer!.getANSILines(0)![8]).toContain('\u001b[48;2;255;0;0m');
    renderer!.setDisplaySize(80, 40);
    expect(pixelAt(renderer!.getKittyImage(0), 100, 100)).toEqual([255, 0, 0]);
    expect(progress.at(-1)!.ratio).toBe(1);
    expect(progress.map((entry) => entry.detail)).toContain('sprites.png');
    expect(chart).toEqual(original);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test('sub-region cues switch and rewind independently of source image cues', async () => {
  const baseDir = await mkdtemp(join(tmpdir(), 'be-music-bga-rewind-'));
  try {
    await writePNG(join(baseDir, 'sprites.png'), 512, 256, (x) => (x < 256 ? [255, 0, 0] : [0, 255, 0]));
    const chart = parseBMS(
      '#BPM 120\n#BMP01 sprites.png\n#BGA02 01 0 0 256 256 0 0\n#BGA03 01 256 0 512 256 0 0\n#00004:02\n#00104:03',
    );
    const renderer = (await createBgaANSIRenderer(chart, { baseDir, width: 40, height: 20 }))!;
    expect(pixelAt(renderer.getKittyImage(0), 100, 100)).toEqual([255, 0, 0]);
    expect(pixelAt(renderer.getKittyImage(2.5), 100, 100)).toEqual([0, 255, 0]);
    expect(pixelAt(renderer.getKittyImage(0.5), 100, 100)).toEqual([255, 0, 0]);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test.each([false, true])(
  'stitched EXBMP/sub-region chains retain stage-specific pixels and placement (mixed %s)',
  async (mixed) => {
    const baseDir = await mkdtemp(join(tmpdir(), 'be-music-nonstop-bga-crop-'));
    try {
      for (const stage of [0, 1]) {
        await mkdir(join(baseDir, `s${stage}`));
        await writePNG(join(baseDir, `s${stage}/source.png`), 512, 256, (x, y) =>
          stage === 0 ? (x >= 256 && x < 384 && y < 128 ? [255, 0, 0] : [0, 0, 255]) : [0, 255, 0],
        );
      }
      const a = parseBMS(
        '#BASE 62\n#BPM 120\n#EXBMPaa ,,,,source.png\n#BGAaA aa 256 0 384 128 64 64\n#BGAaB aA 64 64 192 192 32 32\n#00004:aB\n#00111:01\n#00411:01',
      );
      const b = parseBMS(
        '#BASE 62\n#BPM 120\n#EXBMPaa ,,,,source.png\n#BGAaB aa 0 0 128 128 96 96\n#00204:aB\n#00211:01\n#00411:01',
      );
      const stages = [{ chart: a }, { chart: b }];
      if (mixed) stages.push({ chart: createEmptyJSON('bmson') });
      const course = stitchNonstopCourse(stages, {
        connections: ['cut', 'blank2'],
        assetPath: (stage, _kind, path) => `s${stage}/${path}`,
      });
      if (!course.ok) throw new Error(course.reason);
      const renderer = (await createBgaANSIRenderer(course.chart, {
        baseDir,
        width: 40,
        height: 20,
        imageResizeAlgorithm: 'nearest',
      }))!;
      expect(pixelAt(renderer.getKittyImage(0), 64, 64)).toEqual([255, 0, 0]);
      expect(pixelAt(renderer.getKittyImage(0), 16, 16)).toEqual([0, 0, 0]);
      const boundary = course.map.stages[1]!.windowStart;
      expect(pixelAt(renderer.getKittyImage(boundary + 0.01), 128, 128)).toEqual([0, 255, 0]);
      expect(pixelAt(renderer.getKittyImage(boundary + 0.01), 64, 64)).toEqual([0, 0, 0]);
      expect(renderer.getANSILines(boundary + 0.01)!.join('')).toContain('\u001b[48;2;0;255;0m');
      expect(pixelAt(renderer.getKittyImage(0), 64, 64)).toEqual([255, 0, 0]);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  },
);

test('stitched EXBMP video sub-regions preserve native crop coordinates and later decoded frames', async () => {
  const a = parseBMS(
    '#BPM 120\n#EXBMP01 ,,,,bga-bordered.webm\n#BGA02 01 0 0 16 16 32 32\n#00004:02\n#00111:01\n#00411:01',
  );
  const course = stitchNonstopCourse([{ chart: a }, { chart: a }], { connections: ['cut'] });
  if (!course.ok) throw new Error(course.reason);
  const renderer = (await createBgaANSIRenderer(course.chart, {
    baseDir: resolve(import.meta.dirname, '../../../test/fixtures'),
    width: 256,
    height: 128,
    videoBGAStreaming: false,
    imageResizeAlgorithm: 'nearest',
  }))!;
  expect(pixelAt(renderer.getKittyImage(0), 33, 33)).toEqual([0, 0, 0]);
  expect(pixelAt(renderer.getKittyImage(0), 44, 44)[0]).toBeGreaterThan(240);
  expect(pixelAt(renderer.getKittyImage(0.75), 44, 44)[1]).toBeGreaterThan(240);
});

test.each(['#BGA02 03 0 0 256 256 0 0\n#BGA03 02 0 0 256 256 0 0', '#BGA02 missing', '#BGA02 03 0 0 256 256 0 0'])(
  'missing or cyclic BGA aliases produce the missing-resource frame without loading (%s)',
  async (definitions) => {
    const chart = parseBMS(`#BPM 120\n${definitions}\n#00004:02`);
    const progress = vi.fn();
    const renderer = (await createBgaANSIRenderer(chart, { baseDir: tmpdir(), onLoadProgress: progress }))!;
    expect(progress).not.toHaveBeenCalled();
    expect(renderer.getKittyImage(0).rgb.every((value) => value === 0)).toBe(true);
  },
);

test.each([false, true])('crops video using untrimmed coordinates in full/streaming mode (%s)', async (streaming) => {
  const chart = parseBMS('#BPM 120\n#BMP01 bga-bordered.webm\n#BGA02 01 0 0 16 16 64 64\n#00004:02');
  const renderer = (await createBgaANSIRenderer(chart, {
    baseDir: resolve(import.meta.dirname, '../../../test/fixtures'),
    width: 256,
    height: 128,
    imageResizeAlgorithm: 'nearest',
    videoBGAStreaming: streaming,
  }))!;
  expect(pixelAt(renderer.getKittyImage(0), 65, 65)).toEqual([0, 0, 0]);
  expect(pixelAt(renderer.getKittyImage(0), 76, 76)[0]).toBeGreaterThan(240);
  renderer.startStreaming();
  await vi.waitFor(() => {
    expect(pixelAt(renderer.getKittyImage(0.75), 65, 65)).toEqual([0, 0, 0]);
    expect(pixelAt(renderer.getKittyImage(0.75), 76, 76)[1]).toBeGreaterThan(240);
  });
});

function pixelAt(image: BGAKittyImage, x: number, y: number): number[] {
  const offset =
    (Math.floor((y * image.pixelHeight) / 256) * image.pixelWidth + Math.floor((x * image.pixelWidth) / 256)) * 3;
  return Array.from(image.rgb.subarray(offset, offset + 3));
}

async function writePNG(
  path: string,
  width: number,
  height: number,
  pixel: (x: number, y: number) => number[],
): Promise<void> {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data.set([...pixel(x, y), 255], (y * width + x) * 4);
  }
  await writeFile(path, encode({ width, height, channels: 4, depth: 8, data }));
}

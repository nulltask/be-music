import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encode } from 'fast-png';
import { parseBMS } from '@be-music/chart-parser';
import { stitchNonstopCourse } from '@be-music/player-engine/course';
import { expect, test } from 'vite-plus/test';
import { createBgaANSIRenderer, type BGAKittyImage } from './bga.ts';

test.each(['04', '07', '0A', '06', '00'])(
  'keys original RGB pixels on terminal channel %s before cropping/resizing',
  async (track) => {
    const baseDir = await mkdtemp(join(tmpdir(), 'be-music-exbmp-color-'));
    try {
      const data = new Uint8Array(512 * 256 * 3);
      for (let y = 0; y < 256; y++)
        for (let x = 0; x < 512; x++) {
          data.set(
            x < 128 ? [119, 135, 127] : x < 256 ? [118, 127, 127] : x < 384 ? [0, 0, 0] : [0, 255, 0],
            (y * 512 + x) * 3,
          );
        }
      await writeFile(join(baseDir, 'colors.png'), encode({ width: 512, height: 256, channels: 3, depth: 8, data }));
      await writeFile(
        join(baseDir, 'blue.png'),
        encode({
          width: 256,
          height: 256,
          channels: 3,
          depth: 8,
          data: Uint8Array.from({ length: 256 * 256 * 3 }, (_, i) => (i % 3 === 2 ? 255 : 0)),
        }),
      );
      const slot = track === '00' ? '00' : '02';
      const chart = parseBMS(
        [
          '#BPM 120',
          '#BMP03 blue.png',
          '#EXBMP01 0,127,127,127 colors.png',
          `#BGA${slot} 01 0 0 512 256 0 0`,
          '#BGA04 01 256 0 512 256 0 0',
          `#001${track === '00' ? '06' : track}:04`,
          `#00004:${track === '04' ? slot : '03'}`,
          ...(track !== '04' && track !== '00' ? [`#000${track}:${slot}`] : []),
        ].join('\n'),
      );
      const original = structuredClone(chart);
      const renderer = (await createBgaANSIRenderer(chart, {
        baseDir,
        width: 40,
        height: 20,
        imageResizeAlgorithm: 'nearest',
      }))!;
      if (track === '06' || track === '00') renderer.triggerPoor(0);
      const image = renderer.getKittyImage(0);
      const replacement = track === '04' || track === '06' || track === '00';
      expect(pixel(image, 64, 64)).toEqual(replacement ? [0, 0, 0] : [0, 0, 255]);
      expect(pixel(image, 192, 64)).toEqual([118, 127, 127]);
      // Source coordinates beyond the clipped alias canvas are intentionally absent.
      expect(renderer.getANSILines(0)).toBeDefined();
      renderer.setDisplaySize(80, 40);
      expect(pixel(renderer.getKittyImage(0), 64, 64)).toEqual(replacement ? [0, 0, 0] : [0, 0, 255]);
      if (track === '06' || track === '00') renderer.triggerPoor(2.5);
      expect(pixel(renderer.getKittyImage(2.5), 64, 64)).toEqual([0, 0, 0]);
      expect(pixel(renderer.getKittyImage(2.5), 192, 64)).toEqual([0, 255, 0]);
      expect(chart).toEqual(original);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  },
);

test('keeps cache entries separate for different keys of the same file, preserves black and alpha matching', async () => {
  const baseDir = await mkdtemp(join(tmpdir(), 'be-music-exbmp-alpha-'));
  try {
    const data = new Uint8Array(256 * 256 * 4);
    for (let y = 0; y < 256; y++)
      for (let x = 0; x < 256; x++)
        data.set(
          x < 64 ? [127, 127, 127, 128] : x < 128 ? [127, 127, 127, 129] : x < 192 ? [0, 0, 0, 255] : [0, 255, 0, 255],
          (y * 256 + x) * 4,
        );
    await writeFile(join(baseDir, 'alpha.png'), encode({ width: 256, height: 256, channels: 4, depth: 8, data }));
    const chart = parseBMS(
      '#BPM 120\n#EXBMP01 128,127,127,127 alpha.png\n#EXBMP02 0,0,0,0 alpha.png\n#00004:01\n#00104:02',
    );
    const renderer = (await createBgaANSIRenderer(chart, {
      baseDir,
      width: 40,
      height: 20,
      imageResizeAlgorithm: 'nearest',
    }))!;
    expect(pixel(renderer.getKittyImage(0), 32, 64)).toEqual([0, 0, 0]);
    // Alpha 129 survives the alpha-128 key and blends its gray RGB against black.
    expect(pixel(renderer.getKittyImage(0), 96, 64)).toEqual([64, 64, 64]);
    expect(pixel(renderer.getKittyImage(0), 160, 64)).toEqual([0, 0, 0]);
    expect(pixel(renderer.getKittyImage(0), 224, 64)).toEqual([0, 255, 0]);
    expect(pixel(renderer.getKittyImage(2.5), 32, 64)).toEqual([64, 64, 64]);
    expect(pixel(renderer.getKittyImage(0), 32, 64)).toEqual([0, 0, 0]);
    const stitched = stitchNonstopCourse(
      [
        { chart: parseBMS('#BPM 120\n#EXBMP01 128,127,127,127 alpha.png\n#00004:01\n#00111:01\n#00419:01') },
        { chart: parseBMS('#BPM 120\n#EXBMP01 129,127,127,127 alpha.png\n#00204:01\n#00211:01\n#00819:01') },
      ],
      { connections: ['fade'] },
    );
    expect(stitched.ok).toBe(true);
    if (!stitched.ok) throw new Error(stitched.reason);
    const course = (await createBgaANSIRenderer(stitched.chart, {
      baseDir,
      width: 40,
      height: 20,
      imageResizeAlgorithm: 'nearest',
    }))!;
    const boundary = stitched.map.stages[1]!.windowStart;
    expect(pixel(course.getKittyImage(0), 32, 64)).toEqual([0, 0, 0]);
    expect(pixel(course.getKittyImage(boundary + 0.1), 32, 64)).toEqual([64, 64, 64]);
    expect(pixel(course.getKittyImage(boundary + 0.1), 96, 64)).toEqual([0, 0, 0]);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

function pixel(image: BGAKittyImage, x: number, y: number): number[] {
  const at =
    (Math.floor((y * image.pixelHeight) / 256) * image.pixelWidth + Math.floor((x * image.pixelWidth) / 256)) * 3;
  return Array.from(image.rgb.subarray(at, at + 3));
}

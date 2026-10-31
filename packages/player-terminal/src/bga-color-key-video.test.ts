import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { encode } from 'fast-png';
import { parseBMS } from '@be-music/chart-parser';
import { expect, test } from 'vite-plus/test';
import { createBgaANSIRenderer, type BGAKittyImage } from './bga.ts';

function pixel(image: BGAKittyImage, x: number, y: number): number[] {
  const at =
    (Math.floor((y * image.pixelHeight) / 256) * image.pixelWidth + Math.floor((x * image.pixelWidth) / 256)) * 3;
  return [...image.rgb.subarray(at, at + 3)];
}

for (const streaming of [false, true])
  test.each(['04', '07', '0A', '06', '00'])(
    `keys each EXBMP video frame on plane %s (streaming=${streaming})`,
    async (track) => {
      const dir = await mkdtemp(join(tmpdir(), 'be-music-exbmp-video-'));
      const abort = new AbortController();
      try {
        await copyFile(resolve('test/fixtures/bga-bordered.webm'), join(dir, 'clip.webm'));
        await writeFile(
          join(dir, 'base.png'),
          encode({
            width: 256,
            height: 256,
            channels: 3,
            depth: 8,
            data: Uint8Array.from({ length: 256 * 256 * 3 }, (_, i) => [21, 79, 227][i % 3]!),
          }),
        );
        const poor = track === '06' || track === '00';
        const chart = parseBMS(
          [
            '#BPM 120',
            '#BMP05 base.png',
            ...(track === '04' ? [] : ['#00004:05']),
            `#POORBGA ${poor ? 1 : 2}`,
            `#EXBMP${track === '00' ? '00' : '01'} 0,255,0,0 clip.webm`,
            ...(track === '00' ? [] : [`#000${track}:01`]),
            '#00211:01',
          ].join('\n'),
        );
        const renderer = (await createBgaANSIRenderer(chart, {
          baseDir: dir,
          width: 64,
          height: 32,
          videoBGAStreaming: streaming,
          imageResizeAlgorithm: 'nearest',
          signal: abort.signal,
        }))!;
        if (poor) renderer.triggerPoor(0);
        expect(pixel(renderer.getKittyImage(0), 128, 128)).toEqual(track === '04' ? [0, 0, 0] : [21, 79, 227]);
        expect(pixel(renderer.getKittyImage(0), 8, 8)).toEqual([0, 0, 0]); // Unselected black is not keyed or trimmed.
        renderer.startStreaming();
        await expect
          .poll(
            () => {
              if (poor) renderer.triggerPoor(0.75);
              return pixel(renderer.getKittyImage(0.75), 128, 128)[1]!;
            },
            { timeout: 5000 },
          )
          .toBeGreaterThan(200);
        expect(pixel(renderer.getKittyImage(0.75), 8, 8)).toEqual([0, 0, 0]);
        expect(renderer.getANSILines(0.75)!.join('')).toContain('[48;2;');
        renderer.setDisplaySize(80, 40);
        if (poor) renderer.triggerPoor(0);
        expect(pixel(renderer.getKittyImage(0), 128, 128)).toEqual(track === '04' ? [0, 0, 0] : [21, 79, 227]);
      } finally {
        abort.abort();
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

test.each(['0,0,0,0', '255,255,0,0'])('keeps unkeyed opaque video colors for EXBMP %s', async (key) => {
  const dir = await mkdtemp(join(tmpdir(), 'be-music-exbmp-video-key-'));
  try {
    await copyFile(resolve('test/fixtures/bga-bordered.webm'), join(dir, 'clip.webm'));
    const chart = parseBMS(`#BPM 120\n#EXBMP01 ${key} clip.webm\n#00004:01`);
    const renderer = (await createBgaANSIRenderer(chart, {
      baseDir: dir,
      width: 64,
      height: 32,
      videoBGAStreaming: false,
    }))!;
    expect(pixel(renderer.getKittyImage(0), 128, 128)[0]).toBeGreaterThan(200);
    expect(pixel(renderer.getKittyImage(0), 8, 8)).toEqual([0, 0, 0]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

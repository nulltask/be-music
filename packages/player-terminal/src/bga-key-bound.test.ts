import { mkdtemp, rm, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseBMS } from '@be-music/chart-parser';
import { buildKeyBoundBGATimeline, resolveChart } from '@be-music/chart-model';
import { KeyBoundBGAController } from '@be-music/player-engine/display';
import { encode } from 'fast-png';
import { expect, test } from 'vite-plus/test';
import { createBgaANSIRenderer, type BGAKittyImage } from './bga.ts';

function pixel(image: BGAKittyImage, x: number, y: number): number[] {
  const at =
    (Math.floor((y * image.pixelHeight) / 256) * image.pixelWidth + Math.floor((x * image.pixelWidth) / 256)) * 3;
  return [...image.rgb.subarray(at, at + 3)];
}

test.each([3, 4] as const)(
  'renders held SWBGA BMP00 and keyed aliases without changing normal BGA resources (%s channels)',
  async (channels) => {
    const dir = await mkdtemp(join(tmpdir(), 'be-music-swbga-'));
    try {
      const image = new Uint8Array(256 * 256 * channels);
      const blue = new Uint8Array(256 * 256 * 3);
      for (let y = 0; y < 256; y++)
        for (let x = 0; x < 256; x++) {
          const color = x < 64 ? [255, 255, 255] : x < 128 ? [237, 23, 75] : x < 192 ? [0, 0, 0] : [22, 207, 99];
          image.set(channels === 4 ? [...color, 255] : color, (y * 256 + x) * channels);
          blue.set([21, 79, 227], (y * 256 + x) * 3);
        }
      await writeFile(join(dir, 'strip.png'), encode({ width: 256, height: 256, channels, depth: 8, data: image }));
      await writeFile(join(dir, 'blue.png'), encode({ width: 256, height: 256, channels: 3, depth: 8, data: blue }));
      const source = parseBMS(
        [
          '#BPM 120',
          '#POORBGA 2',
          '#BMP00 strip.png',
          '#BMP05 blue.png',
          '#00004:05',
          '#BGA02 00 0 0 256 256 0 0',
          `#EXBMP03 ${channels === 3 ? 0 : 255},237,23,75 strip.png`,
          '#SWBGA61 500:0:11:1:255,255,255,255 000203',
          '#000A5:61',
        ].join('\n'),
      );
      const resolved = resolveChart(source);
      const state = new KeyBoundBGAController(buildKeyBoundBGATimeline(source, resolved.timing));
      const renderer = (await createBgaANSIRenderer(source, { baseDir: dir, width: 128, height: 64 }))!;
      expect(pixel(renderer.getKittyImage(0), 96, 128)).toEqual([21, 79, 227]);
      state.addInput({ seconds: 0, action: 'down', channels: ['11'] });
      const first = renderer.getKittyImage(0, state.read(0));
      expect(pixel(first, 32, 128)).toEqual([21, 79, 227]);
      expect(pixel(first, 96, 128)).toEqual([237, 23, 75]);
      expect(pixel(first, 160, 128)).toEqual([0, 0, 0]);
      expect(pixel(first, 224, 128)).toEqual([22, 207, 99]);
      expect(renderer.getANSILines(0, state.read(0))![20]).toContain('\u001b[48;2;237;23;75m');
      expect(pixel(renderer.getKittyImage(0.6, state.read(0.6)), 96, 128)).toEqual([237, 23, 75]);
      const combined = renderer.getKittyImage(1.1, state.read(1.1));
      expect(pixel(combined, 96, 128)).toEqual([21, 79, 227]); // EXBMP and SWBGA keys compose without restoring alpha.
      expect(pixel(combined, 160, 128)).toEqual([0, 0, 0]);
      renderer.setDisplaySize(80, 40);
      expect(pixel(renderer.getKittyImage(0, state.read(0)), 96, 128)).toEqual([237, 23, 75]);
      state.addInput({ seconds: 1.2, action: 'up', channels: ['11'] });
      expect(pixel(renderer.getKittyImage(1.3, state.read(1.3)), 96, 128)).toEqual([21, 79, 227]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test('keys native video borders and later decoded frames in a held SWBGA resource', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'be-music-swbga-video-'));
  try {
    await writeFile(
      join(dir, 'blue.png'),
      encode({
        width: 256,
        height: 256,
        channels: 3,
        depth: 8,
        data: Uint8Array.from({ length: 256 * 256 * 3 }, (_, i) => [21, 79, 227][i % 3]!),
      }),
    );
    await copyFile(resolve('test/fixtures/bga-bordered.webm'), join(dir, 'clip.webm'));
    const path = 'clip.webm';
    const source = parseBMS(
      `#BPM 120\n#POORBGA 2\n#BMP01 ${path}\n#BMP05 blue.png\n#00004:05\n#SWBGA61 1000:0:11:0:255,0,0,0 01\n#000A5:61`,
    );
    const resolved = resolveChart(source);
    const state = new KeyBoundBGAController(buildKeyBoundBGATimeline(source, resolved.timing), {
      inputs: [{ seconds: 0, action: 'down', channels: ['11'] }],
    });
    const renderer = (await createBgaANSIRenderer(source, {
      baseDir: dir,
      width: 80,
      height: 40,
      videoBGAStreaming: false,
    }))!;
    expect(pixel(renderer.getKittyImage(0, state.read(0)), 128, 128)[0]).toBeGreaterThan(200);
    expect(pixel(renderer.getKittyImage(0.75, state.read(0.75)), 128, 128)[1]).toBeGreaterThan(200);
    expect(pixel(renderer.getKittyImage(0.75, state.read(0.75)), 8, 8)).toEqual([21, 79, 227]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encode } from 'fast-png';
import { parseBMS } from '@be-music/chart-parser';
import { buildKeyBoundBGATimeline, resolveChart } from '@be-music/chart-model';
import { KeyBoundBGAController } from '@be-music/player-engine/display';
import { expect, test } from 'vite-plus/test';
import { createBgaANSIRenderer, type BGAKittyImage } from './bga.ts';

function pixel(image: BGAKittyImage, x: number): number[] {
  const at = (Math.floor(image.pixelHeight / 2) * image.pixelWidth + Math.floor((x * image.pixelWidth) / 256)) * 3;
  return [...image.rgb.subarray(at, at + 3)];
}

async function withImages(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'be-music-source-alpha-'));
  try {
    const rgba = new Uint8Array(256 * 256 * 4);
    const blue = new Uint8Array(256 * 256 * 3);
    for (let pixel = 0; pixel < 256 * 256; pixel++) {
      const alpha = [0, 64, 128, 255][Math.floor((pixel % 256) / 64)]!;
      rgba.set([255, 0, 0, alpha], pixel * 4);
      blue.set([0, 0, 255], pixel * 3);
    }
    await writeFile(join(dir, 'alpha.png'), encode({ width: 256, height: 256, channels: 4, depth: 8, data: rgba }));
    await writeFile(join(dir, 'blue.png'), encode({ width: 256, height: 256, channels: 3, depth: 8, data: blue }));
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

for (const algorithm of ['nearest', 'lanczos'] as const)
  test.each(['layer', 'alias', 'base', 'poor-replace', 'poor-over', 'swbga'])(
    `blends source alpha in Kitty and ANSI on %s (${algorithm})`,
    async (mode) =>
      withImages(async (dir) => {
        const chart = parseBMS(
          [
            '#BPM 120',
            '#BMP01 blue.png',
            '#BMP02 alpha.png',
            `#POORBGA ${mode === 'poor-over' ? 1 : mode === 'poor-replace' ? 0 : 2}`,
            `#00004:${mode === 'base' ? '02' : '01'}`,
            ...(mode === 'layer' ? ['#00007:02'] : []),
            ...(mode === 'alias' ? ['#BGA03 02 64 0 192 256 64 0', '#00007:03'] : []),
            ...(mode.startsWith('poor-') ? ['#00006:02'] : []),
            ...(mode === 'swbga' ? ['#SWBGA61 1000:0:11:1:0,0,0,0 02', '#000A5:61'] : []),
          ].join('\n'),
        );
        const renderer = (await createBgaANSIRenderer(chart, {
          baseDir: dir,
          width: 64,
          height: 32,
          imageResizeAlgorithm: algorithm,
        }))!;
        if (mode.startsWith('poor-')) renderer.triggerPoor(0);
        const state = new KeyBoundBGAController(buildKeyBoundBGATimeline(chart, resolveChart(chart).timing), {
          inputs: [{ seconds: 0, action: 'down', channels: ['11'] }],
        });
        const againstBlack = mode === 'base' || mode === 'poor-replace';
        const expected = [0, 64, 128, mode === 'alias' ? 0 : 255].map((alpha) => [
          alpha,
          0,
          againstBlack ? 0 : 255 - alpha,
        ]);
        const actual = () => {
          const image = renderer.getKittyImage(0, state.read(0));
          return [32, 96, 160, 224].map((x) => pixel(image, x));
        };
        expect(actual()).toEqual(expected);
        const ansi = renderer.getANSILines(0, state.read(0))!.join('');
        for (const color of expected) expect(ansi).toContain(`[48;2;${color.join(';')}m`);
        renderer.setDisplaySize(80, 40);
        expect(actual()).toEqual(expected);
      }),
  );

test.each(['nearest', 'lanczos'] as const)(
  'combines source alpha with plane alpha/RGB and restores it on seek (%s)',
  async (algorithm) =>
    withImages(async (dir) => {
      const chart = parseBMS(
        '#BPM 120\n#POORBGA 2\n#BMP01 blue.png\n#BMP02 alpha.png\n#00004:01\n#00007:02\n#0010C:80\n#ARGB61 128,128,255,255\n#002A2:61',
      );
      const renderer = (await createBgaANSIRenderer(chart, {
        baseDir: dir,
        width: 64,
        height: 32,
        imageResizeAlgorithm: algorithm,
      }))!;
      expect(pixel(renderer.getKittyImage(0), 96)).toEqual([64, 0, 191]);
      expect(pixel(renderer.getKittyImage(2.1), 96)).toEqual([32, 0, 223]);
      expect(pixel(renderer.getKittyImage(4.1), 96)).toEqual([16, 0, 223]);
      expect(pixel(renderer.getKittyImage(4.1), 160)).toEqual([32, 0, 191]);
      expect(renderer.getANSILines(4.1)!.join('')).toContain('[48;2;16;0;223m');
      expect(pixel(renderer.getKittyImage(0), 96)).toEqual([64, 0, 191]);
    }),
);

test('applies the exact EXBMP alpha key before preserving the remaining fractional coverage', async () =>
  withImages(async (dir) => {
    const chart = parseBMS(
      '#BPM 120\n#POORBGA 2\n#BMP01 blue.png\n#EXBMP02 128,255,0,0 alpha.png\n#00004:01\n#00007:02',
    );
    const renderer = (await createBgaANSIRenderer(chart, {
      baseDir: dir,
      width: 64,
      height: 32,
      imageResizeAlgorithm: 'nearest',
    }))!;
    const image = renderer.getKittyImage(0);
    expect(pixel(image, 96)).toEqual([64, 0, 191]);
    expect(pixel(image, 160)).toEqual([0, 0, 255]);
    expect(pixel(image, 224)).toEqual([255, 0, 0]);
  }));

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseBMS } from '@be-music/chart-parser';
import { encode } from 'fast-png';
import { expect, test } from 'vite-plus/test';
import { createBgaANSIRenderer, type BGAKittyImage } from './bga.ts';

test.each([
  ['04', '0B', '0'],
  ['07', '0C', '0'],
  ['0A', '0D', '0'],
  ['06', '0E', '0'],
  ['06', '0E', '1'],
])('applies %s opacity through %s in ANSI and Kitty (POORBGA %s)', async (track, opacityChannel, poorMode) => {
  const baseDir = await mkdtemp(join(tmpdir(), 'be-music-opacity-'));
  try {
    await writeSolidPNG(join(baseDir, 'red.png'), [255, 0, 0]);
    await writeSolidPNG(join(baseDir, 'blue.png'), [0, 0, 255]);
    const chart = parseBMS(
      [
        '#BPM 120',
        `#POORBGA ${poorMode}`,
        '#BMP01 red.png',
        '#BMP02 blue.png',
        `#00004:${track === '04' ? '01' : '02'}`,
        ...(track === '04' ? [] : [`#000${track}:01`]),
        `#001${opacityChannel}:80`,
        `#002${opacityChannel}:FF`,
      ].join('\n'),
    );
    const renderer = (await createBgaANSIRenderer(chart, { baseDir, width: 40, height: 20 }))!;
    const get = (seconds: number) => {
      if (track === '06') {
        renderer.clearPoor();
        renderer.triggerPoor(seconds);
      }
      return renderer.getKittyImage(seconds);
    };
    const full = get(0);
    expect(center(full)).toEqual([255, 0, 0]);
    const half = get(2);
    const blendsOverBlue = track === '07' || track === '0A' || (track === '06' && poorMode === '1');
    const expected = blendsOverBlue ? [128, 0, 127] : [128, 0, 0];
    expect(center(half)).toEqual(expected);
    expect(half.token).not.toBe(full.token);
    expect(renderer.getANSILines(2)![10]).toContain(`\u001b[48;2;${expected.join(';')}m`);
    expect(center(get(4))).toEqual([255, 0, 0]);
    expect(center(get(2.1))).toEqual(expected);
    expect(center(get(0.5))).toEqual([255, 0, 0]);
    renderer.setDisplaySize(80, 40);
    expect(center(get(2.2))).toEqual(expected);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test('composes independent overlay opacity and ignores opacity cues after the reversal tick', async () => {
  const baseDir = await mkdtemp(join(tmpdir(), 'be-music-opacity-layers-'));
  try {
    await writeSolidPNG(join(baseDir, 'red.png'), [255, 0, 0]);
    await writeSolidPNG(join(baseDir, 'green.png'), [0, 255, 0]);
    await writeSolidPNG(join(baseDir, 'blue.png'), [0, 0, 255]);
    const chart = parseBMS(
      '#BPM 120\n#BMP01 red.png\n#BMP02 green.png\n#BMP03 blue.png\n#00004:03\n#00007:01\n#0000A:02\n#0000C:80\n#0000D:40\n#BPM01 -120\n#00108:01\n#0020C:FF\n#0020D:FF',
    );
    const renderer = (await createBgaANSIRenderer(chart, { baseDir, width: 40, height: 20 }))!;
    expect(center(renderer.getKittyImage(0))).toEqual([96, 64, 95]);
    expect(center(renderer.getKittyImage(10))).toEqual([96, 64, 95]);
    expect(renderer.getANSILines(10)![10]).toContain('\u001b[48;2;96;64;95m');
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

function center(image: BGAKittyImage): number[] {
  const offset = (Math.floor(image.pixelHeight / 2) * image.pixelWidth + Math.floor(image.pixelWidth / 2)) * 3;
  return Array.from(image.rgb.subarray(offset, offset + 3));
}

async function writeSolidPNG(path: string, color: number[]): Promise<void> {
  const data = new Uint8Array(256 * 256 * 4);
  for (let offset = 0; offset < data.length; offset += 4) data.set([...color, 255], offset);
  await writeFile(path, encode({ width: 256, height: 256, channels: 4, depth: 8, data }));
}

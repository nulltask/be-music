import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseBMS } from '@be-music/chart-parser';
import { encode } from 'fast-png';
import { describe, expect, test } from 'vite-plus/test';
import { createBgaANSIRenderer } from './bga.ts';

describe('terminal extended BGA resources', () => {
  test.each(['04', '07', '0A', '06'])('loads an EXBMP-only image for channel %s', async (channel) => {
    const baseDir = await mkdtemp(join(tmpdir(), 'be-music-exbmp-'));
    try {
      await writeRedPNG(join(baseDir, 'extended.png'));
      const chart = parseBMS(`#BPM 120\n#EXBMP01 ,,,,extended.png\n#000${channel}:01`);
      const original = structuredClone(chart);
      const progress: Array<{ detail: string; ratio: number }> = [];
      const renderer = await createBgaANSIRenderer(chart, {
        baseDir,
        width: 40,
        height: 20,
        onLoadProgress: (value) => progress.push(value),
      });
      expect(renderer).toBeDefined();
      if (channel === '06') renderer!.triggerPoor(0);
      expect(renderer!.getANSILines(0)!.join('')).toContain('\u001b[48;2;255;0;0m');
      const kitty = renderer!.getKittyImage(0);
      const center = (Math.floor(kitty.pixelHeight / 2) * kitty.pixelWidth + Math.floor(kitty.pixelWidth / 2)) * 3;
      expect(Array.from(kitty.rgb.subarray(center, center + 3))).toEqual([255, 0, 0]);
      expect(progress).toEqual([{ detail: 'extended.png', ratio: 1 }]);
      expect(chart).toEqual(original);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test.each(['0', '2'])('uses EXBMP00 as the implicit POOR image unless POORBGA is 2 (%s)', async (mode) => {
    const baseDir = await mkdtemp(join(tmpdir(), 'be-music-exbmp-poor-'));
    try {
      await writeRedPNG(join(baseDir, 'poor.png'));
      const chart = parseBMS(`#BPM 120\n#POORBGA ${mode}\n#EXBMP00 ,,,,poor.png`);
      const renderer = await createBgaANSIRenderer(chart, { baseDir });
      if (mode === '2') {
        expect(renderer).toBeUndefined();
      } else {
        expect(renderer).toBeDefined();
        renderer!.triggerPoor(0);
        expect(renderer!.getANSILines(0)!.join('')).toContain('\u001b[48;2;255;0;0m');
      }
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test('keeps an explicit BMP resource and ignores malformed EXBMP definitions', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'be-music-exbmp-precedence-'));
    try {
      await writeRedPNG(join(baseDir, 'ordinary.png'));
      const chart = parseBMS(
        '#BPM 120\n#BMP01 ordinary.png\n#EXBMP01 ,,,,missing.png\n#EXBMP02 malformed\n#EXBMP03 ,,,,\n#00004:01',
      );
      const progress: string[] = [];
      const renderer = await createBgaANSIRenderer(chart, {
        baseDir,
        onLoadProgress: ({ detail }) => progress.push(detail),
      });
      expect(renderer!.getANSILines(0)!.join('')).toContain('\u001b[48;2;255;0;0m');
      expect(progress).toEqual(['ordinary.png']);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test.each(['malformed', ',,,,'])('does not load a malformed referenced EXBMP value (%s)', async (definition) => {
    const chart = parseBMS(`#BPM 120\n#EXBMP01 ${definition}\n#00004:01`);
    const progress: string[] = [];
    const renderer = await createBgaANSIRenderer(chart, {
      baseDir: tmpdir(),
      onLoadProgress: ({ detail }) => progress.push(detail),
    });
    expect(renderer).toBeDefined();
    expect(progress).toEqual([]);
    expect(renderer!.getKittyImage(0).rgb.every((value) => value === 0)).toBe(true);
  });
});

async function writeRedPNG(path: string): Promise<void> {
  const data = new Uint8Array(256 * 256 * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = 255;
    data[offset + 3] = 255;
  }
  await writeFile(path, encode({ width: 256, height: 256, channels: 4, depth: 8, data }));
}

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEmptyJson } from '../../json/src/index.ts';
import { expect, test } from 'vitest';
import { PNG } from 'pngjs';
import { encode as encodeBmpTs } from 'bmp-ts';
import { createBgaAnsiRenderer } from './bga.ts';

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

type Pixel = RgbColor | undefined;

test('player bga: layer は黒透過で合成される', async () => {
  const baseDir = await mkdtemp(join(tmpdir(), 'be-music-bga-layer-'));
  try {
    await writePng(join(baseDir, 'base.png'), 256, 256, () => ({ r: 255, g: 0, b: 0, a: 255 }));
    await writeBmp(join(baseDir, 'layer.bmp'), 256, 256, (x) =>
      x < 128 ? { r: 0, g: 0, b: 0, a: 255 } : { r: 0, g: 255, b: 0, a: 255 },
    );

    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.resources.bmp['01'] = 'base.png';
    json.resources.bmp['02'] = 'layer.bmp';
    json.events = [
      { measure: 0, channel: '04', position: [0, 1], value: '01' },
      { measure: 0, channel: '07', position: [0, 1], value: '02' },
    ];

    const renderer = await createBgaAnsiRenderer(json, {
      baseDir,
      width: 40,
      height: 20,
    });
    expect(renderer).toBeDefined();

    const lines = renderer?.getAnsiLines(0);
    expect(lines).toBeDefined();
    const pixels = parseAnsiPixels(lines ?? []);

    expect(pixels[10]?.[5]).toEqual({ r: 255, g: 0, b: 0 });
    expect(pixels[10]?.[30]).toEqual({ r: 0, g: 255, b: 0 });
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test('player bga: 256x256 未満は X 中央 / Y 上詰めで表示される', async () => {
  const baseDir = await mkdtemp(join(tmpdir(), 'be-music-bga-small-'));
  try {
    await writePng(join(baseDir, 'small.png'), 128, 128, () => ({ r: 255, g: 255, b: 0, a: 255 }));

    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.resources.bmp['01'] = 'small.png';
    json.events = [{ measure: 0, channel: '04', position: [0, 1], value: '01' }];

    const renderer = await createBgaAnsiRenderer(json, {
      baseDir,
      width: 40,
      height: 20,
    });
    expect(renderer).toBeDefined();

    const lines = renderer?.getAnsiLines(0);
    expect(lines).toBeDefined();
    const bounds = findOpaqueBounds(parseAnsiPixels(lines ?? []));
    expect(bounds).toBeDefined();
    expect(bounds?.minY).toBe(0);
    expect(bounds?.maxY).toBeGreaterThanOrEqual(9);
    expect(bounds?.maxY).toBeLessThanOrEqual(10);
    expect(bounds?.minX).toBeGreaterThanOrEqual(9);
    expect(bounds?.minX).toBeLessThanOrEqual(10);
    expect(bounds?.maxX).toBeGreaterThanOrEqual(29);
    expect(bounds?.maxX).toBeLessThanOrEqual(30);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test('player bga: 未定義の base キーは STAGEFILE ではなく黒表示になる', async () => {
  const baseDir = await mkdtemp(join(tmpdir(), 'be-music-bga-undefined-base-'));
  try {
    await writePng(join(baseDir, 'stage.png'), 256, 256, () => ({ r: 0, g: 0, b: 255, a: 255 }));

    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.metadata.stageFile = 'stage.png';
    json.events = [{ measure: 0, channel: '04', position: [0, 1], value: '02' }];

    const renderer = await createBgaAnsiRenderer(json, {
      baseDir,
      width: 40,
      height: 20,
    });
    expect(renderer).toBeDefined();

    const lines = renderer?.getAnsiLines(0);
    expect(lines).toBeDefined();
    const pixels = parseAnsiPixels(lines ?? []);
    expect(pixels[10]?.[20]).toEqual({ r: 0, g: 0, b: 0 });
    expect(countColor(pixels, { r: 0, g: 0, b: 255 })).toBe(0);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

async function writePng(
  path: string,
  width: number,
  height: number,
  pixel: (x: number, y: number) => { r: number; g: number; b: number; a: number },
): Promise<void> {
  const pngModule = PNG as unknown as {
    new (options: { width: number; height: number }): { data: Uint8Array };
    sync: { write(value: unknown): Uint8Array };
  };
  const png = new pngModule({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = pixel(x, y);
      const offset = (y * width + x) * 4;
      png.data[offset] = value.r;
      png.data[offset + 1] = value.g;
      png.data[offset + 2] = value.b;
      png.data[offset + 3] = value.a;
    }
  }
  await writeFile(path, pngModule.sync.write(png));
}

async function writeBmp(
  path: string,
  width: number,
  height: number,
  pixel: (x: number, y: number) => { r: number; g: number; b: number; a: number },
): Promise<void> {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = pixel(x, y);
      const offset = (y * width + x) * 4;
      data[offset] = value.a;
      data[offset + 1] = value.b;
      data[offset + 2] = value.g;
      data[offset + 3] = value.r;
    }
  }
  await writeFile(path, encodeBmpTs({ data, width, height }).data);
}

function parseAnsiPixels(lines: string[]): Pixel[][] {
  return lines.map(parseAnsiPixelLine);
}

function parseAnsiPixelLine(line: string): Pixel[] {
  const pixels: Pixel[] = [];
  let currentColor: Pixel = undefined;
  let index = 0;
  while (index < line.length) {
    if (line.charCodeAt(index) === 0x1b && index + 1 < line.length && line[index + 1] === '[') {
      const sequenceEnd = line.indexOf('m', index + 2);
      if (sequenceEnd < 0) {
        index += 1;
        continue;
      }
      const sequence = line.slice(index + 2, sequenceEnd);
      currentColor = applySgr(currentColor, sequence);
      index = sequenceEnd + 1;
      continue;
    }
    pixels.push(currentColor ? { ...currentColor } : undefined);
    index += 1;
  }
  return pixels;
}

function applySgr(currentColor: Pixel, sequence: string): Pixel {
  if (sequence === '0') {
    return undefined;
  }
  const parts = sequence.split(';').map((part) => Number.parseInt(part, 10));
  if (parts.length >= 5 && parts[0] === 48 && parts[1] === 2) {
    const r = parts[2] ?? 0;
    const g = parts[3] ?? 0;
    const b = parts[4] ?? 0;
    return { r, g, b };
  }
  return currentColor;
}

function findOpaqueBounds(pixels: Pixel[][]): { minX: number; minY: number; maxX: number; maxY: number } | undefined {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < pixels.length; y += 1) {
    const row = pixels[y] ?? [];
    for (let x = 0; x < row.length; x += 1) {
      if (!row[x]) {
        continue;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < 0 || maxY < 0) {
    return undefined;
  }
  return { minX, minY, maxX, maxY };
}

function countColor(pixels: Pixel[][], color: RgbColor): number {
  let count = 0;
  for (const row of pixels) {
    for (const pixel of row) {
      if (!pixel) {
        continue;
      }
      if (pixel.r === color.r && pixel.g === color.g && pixel.b === color.b) {
        count += 1;
      }
    }
  }
  return count;
}

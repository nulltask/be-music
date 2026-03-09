import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { createEmptyJson } from '../../json/src/index.ts';

vi.mock('./bga-video.ts', () => ({
  decodeVideoFramesStream: vi.fn(async (videoPath: string, onFrame: (frame: unknown) => void) => {
    const isPortrait = videoPath.includes('portrait');
    const width = isPortrait ? 180 : 320;
    const height = isPortrait ? 320 : 240;
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        rgba[offset] = 255;
        rgba[offset + 1] = 0;
        rgba[offset + 2] = 0;
        rgba[offset + 3] = 255;
      }
    }
    onFrame({
      seconds: 0,
      width,
      height,
      rgba,
    });
    return {
      codecName: 'h264',
      frameCount: 1,
    };
  }),
}));

import { createBgaAnsiRenderer } from './bga.ts';

describe('player bga video sizing', () => {
  test('fits landscape video frames into the BGA region with contain sizing', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'be-music-bga-video-size-'));
    try {
      await writeFile(join(baseDir, 'movie.mp4'), '');

      const json = createEmptyJson('bms');
      json.metadata.bpm = 120;
      json.resources.bmp['01'] = 'movie.mp4';
      json.events = [{ measure: 0, channel: '04', position: [0, 1], value: '01' }];

      const renderer = await createBgaAnsiRenderer(json, {
        baseDir,
        width: 40,
        height: 20,
      });

      expect(renderer).toBeDefined();
      const pixels = parseAnsiPixels(renderer?.getAnsiLines(0) ?? []);
      const bounds = findOpaqueBounds(pixels);
      expect(bounds).toBeDefined();
      expect(bounds).toMatchObject({
        minX: 0,
        minY: 2,
        maxX: 39,
        maxY: 16,
      });
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test('fits portrait video frames into the BGA region with contain sizing', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'be-music-bga-video-size-'));
    try {
      await writeFile(join(baseDir, 'portrait.mp4'), '');

      const json = createEmptyJson('bms');
      json.metadata.bpm = 120;
      json.resources.bmp['01'] = 'portrait.mp4';
      json.events = [{ measure: 0, channel: '04', position: [0, 1], value: '01' }];

      const renderer = await createBgaAnsiRenderer(json, {
        baseDir,
        width: 40,
        height: 20,
      });

      expect(renderer).toBeDefined();
      const pixels = parseAnsiPixels(renderer?.getAnsiLines(0) ?? []);
      const bounds = findOpaqueBounds(pixels);
      expect(bounds).toBeDefined();
      expect(bounds).toMatchObject({
        minX: 9,
        minY: 0,
        maxX: 30,
        maxY: 19,
      });
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

type Pixel = RgbColor | undefined;

function parseAnsiPixels(lines: string[]): Pixel[][] {
  return lines.map((line) => {
    const row: Pixel[] = [];
    let index = 0;
    let activeBackground: RgbColor | undefined;

    while (index < line.length) {
      if (line.charCodeAt(index) === 0x1b && index + 1 < line.length && line[index + 1] === '[') {
        const sequenceEnd = findAnsiSgrSequenceEnd(line, index + 2);
        if (sequenceEnd < 0) {
          index += 1;
          continue;
        }
        const params = parseAnsiSgrParams(line, index + 2, sequenceEnd);
        activeBackground = resolveAnsiBackgroundColor(params, activeBackground);
        index = sequenceEnd + 1;
        continue;
      }

      const codePoint = line.codePointAt(index);
      if (codePoint === undefined) {
        break;
      }

      row.push(activeBackground ? { ...activeBackground } : undefined);
      index += codePoint > 0xffff ? 2 : 1;
    }

    return row;
  });
}

function findAnsiSgrSequenceEnd(value: string, start: number): number {
  for (let index = start; index < value.length; index += 1) {
    if (value[index] === 'm') {
      return index;
    }
  }
  return -1;
}

function parseAnsiSgrParams(value: string, start: number, end: number): number[] {
  const raw = value.slice(start, end);
  if (raw.length === 0) {
    return [0];
  }
  return raw
    .split(';')
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
}

function resolveAnsiBackgroundColor(params: number[], current: RgbColor | undefined): RgbColor | undefined {
  if (params.length === 0) {
    return current;
  }

  let next = current;
  for (let index = 0; index < params.length; index += 1) {
    const code = params[index];
    if (code === 0 || code === 49) {
      next = undefined;
      continue;
    }
    if (code === 48 && params[index + 1] === 2) {
      const r = params[index + 2] ?? 0;
      const g = params[index + 3] ?? 0;
      const b = params[index + 4] ?? 0;
      next = { r, g, b };
      index += 4;
    }
  }
  return next;
}

function findOpaqueBounds(pixels: Pixel[][]): { minX: number; minY: number; maxX: number; maxY: number } | undefined {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

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

  if (!Number.isFinite(minX)) {
    return undefined;
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
  };
}

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEmptyJson } from '../../json/src/index.ts';
import { describe, expect, test, vi } from 'vitest';
import { encode as encodeBmp } from 'fast-bmp';
import { encode as encodePng } from 'fast-png';
import { BgaAnsiRenderer, createBgaAnsiRenderer, loadStageFileAnsiImage, loadStageFileAnsiLines } from './bga.ts';

vi.mock('./bga-video.ts', () => ({
  decodeVideoFramesStream: vi.fn(async (videoPath: string, onFrame: (frame: unknown) => void) => {
    const hasBlackBorder = videoPath.includes('bordered');
    const isPortrait = videoPath.includes('portrait');
    const width = isPortrait ? 180 : 320;
    const height = isPortrait ? 320 : 240;
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        const insideBorder = !hasBlackBorder || (x >= 32 && x < width - 32 && y >= 24 && y < height - 24);
        rgba[offset] = insideBorder ? 255 : 0;
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
      durationSeconds: 2.5,
    };
  }),
}));

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

type Pixel = RgbColor | undefined;
describe('player bga', () => {
  test('player bga: reports loading progress details with target file names', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'be-music-bga-progress-'));
    try {
      await writePng(join(baseDir, 'base.png'), 256, 256, () => ({ r: 255, g: 0, b: 0, a: 255 }));
      await writePng(join(baseDir, 'stage.png'), 256, 256, () => ({ r: 0, g: 0, b: 255, a: 255 }));

      const json = createEmptyJson('bms');
      json.metadata.bpm = 120;
      json.metadata.stageFile = 'stage.png';
      json.resources.bmp['01'] = 'base.png';
      json.events = [{ measure: 0, channel: '04', position: [0, 1], value: '01' }];

      const progressDetails: string[] = [];
      const progressRatios: number[] = [];
      const renderer = await createBgaAnsiRenderer(json, {
        baseDir,
        width: 40,
        height: 20,
        onLoadProgress: (progress) => {
          progressRatios.push(progress.ratio);
          progressDetails.push(progress.detail);
        },
      });

      expect(renderer).toBeDefined();
      expect(progressDetails).toContain('base.png');
      expect(progressDetails).not.toContain('stage.png');
      expect(progressRatios.at(-1)).toBeCloseTo(1, 6);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test('player bga: loads STAGEFILE splash lines as a full-screen cover image', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'be-music-stagefile-splash-'));
    try {
      await writePng(join(baseDir, 'stage.png'), 64, 256, () => ({ r: 0, g: 0, b: 255, a: 255 }));

      const json = createEmptyJson('bms');
      json.metadata.bpm = 120;
      json.metadata.stageFile = 'stage.png';

      const lines = await loadStageFileAnsiLines(json, {
        baseDir,
        width: 40,
        height: 20,
      });

      expect(lines).toBeDefined();
      const pixels = parseAnsiPixels(lines ?? []);
      expect(pixels[10]?.[20]).toEqual({ r: 0, g: 0, b: 255 });
      expect(pixels[0]?.[0]).toEqual({ r: 0, g: 0, b: 255 });
      expect(pixels[19]?.[39]).toEqual({ r: 0, g: 0, b: 255 });
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test('player bga: prepares kitty graphics data for STAGEFILE splash images', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'be-music-stagefile-kitty-'));
    try {
      await writePng(join(baseDir, 'stage.png'), 64, 256, () => ({ r: 0, g: 0, b: 255, a: 255 }));

      const json = createEmptyJson('bms');
      json.metadata.bpm = 120;
      json.metadata.stageFile = 'stage.png';

      const image = await loadStageFileAnsiImage(json, {
        baseDir,
        width: 40,
        height: 20,
      });

      expect(image?.kittyImage).toEqual(
        expect.objectContaining({
          pixelWidth: 160,
          pixelHeight: 80,
          cellWidth: 40,
          cellHeight: 20,
        }),
      );
      expect(image?.kittyImage?.rgb.length).toBe(160 * 80 * 3);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test('player bga: does not create a gameplay renderer for STAGEFILE-only charts', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'be-music-stagefile-only-'));
    try {
      await writePng(join(baseDir, 'stage.png'), 64, 256, () => ({ r: 0, g: 0, b: 255, a: 255 }));

      const json = createEmptyJson('bms');
      json.metadata.bpm = 120;
      json.metadata.stageFile = 'stage.png';

      const renderer = await createBgaAnsiRenderer(json, {
        baseDir,
        width: 40,
        height: 20,
      });

      expect(renderer).toBeUndefined();
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test('player bga: composites layer with black treated as transparent', async () => {
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

  test('player bga: composites 4-bit indexed bmp layer with black treated as transparent', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'be-music-bga-layer-indexed-'));
    try {
      await writePng(join(baseDir, 'base.png'), 256, 256, () => ({ r: 255, g: 0, b: 0, a: 255 }));
      await writeIndexed4BitBmp(join(baseDir, 'layer4.bmp'), 256, 256, (x) => (x < 128 ? 0 : 1));

      const json = createEmptyJson('bms');
      json.metadata.bpm = 120;
      json.resources.bmp['01'] = 'base.png';
      json.resources.bmp['02'] = 'layer4.bmp';
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

  test('player bga: composites channel 0A above channel 07', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'be-music-bga-layer2-'));
    try {
      await writePng(join(baseDir, 'base.png'), 256, 256, () => ({ r: 255, g: 0, b: 0, a: 255 }));
      await writeBmp(join(baseDir, 'layer.bmp'), 256, 256, (x) =>
        x < 128 ? { r: 0, g: 0, b: 0, a: 255 } : { r: 0, g: 255, b: 0, a: 255 },
      );
      await writePng(join(baseDir, 'layer2.png'), 256, 256, (x) =>
        x < 128 ? { r: 0, g: 0, b: 255, a: 255 } : { r: 0, g: 0, b: 0, a: 0 },
      );

      const json = createEmptyJson('bms');
      json.metadata.bpm = 120;
      json.resources.bmp['01'] = 'base.png';
      json.resources.bmp['02'] = 'layer.bmp';
      json.resources.bmp['03'] = 'layer2.png';
      json.events = [
        { measure: 0, channel: '04', position: [0, 1], value: '01' },
        { measure: 0, channel: '07', position: [0, 1], value: '02' },
        { measure: 0, channel: '0A', position: [0, 1], value: '03' },
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

      expect(pixels[10]?.[5]).toEqual({ r: 0, g: 0, b: 255 });
      expect(pixels[10]?.[30]).toEqual({ r: 0, g: 255, b: 0 });
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test('player bga: renders images smaller than 256x256 centered on X and top-aligned on Y', async () => {
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

  test('player bga: scales down sources larger than 256x256 without clipping bottom area', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'be-music-bga-large-square-'));
    try {
      await writePng(join(baseDir, 'large-square.png'), 512, 512, (_x, y) =>
        y < 256 ? { r: 255, g: 0, b: 0, a: 255 } : { r: 0, g: 0, b: 255, a: 255 },
      );

      const json = createEmptyJson('bms');
      json.metadata.bpm = 120;
      json.resources.bmp['01'] = 'large-square.png';
      json.events = [{ measure: 0, channel: '04', position: [0, 1], value: '01' }];

      const renderer = await createBgaAnsiRenderer(json, {
        baseDir,
        width: 40,
        height: 20,
      });
      expect(renderer).toBeDefined();

      const lines = renderer?.getAnsiLines(0);
      expect(lines).toBeDefined();
      const pixels = parseAnsiPixels(lines ?? []);

      expect(pixels[4]?.[20]).toEqual({ r: 255, g: 0, b: 0 });
      expect(pixels[16]?.[20]).toEqual({ r: 0, g: 0, b: 255 });
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test('player bga: fits landscape video frames into the BGA region with contain sizing', async () => {
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

  test('player bga: fits portrait video frames into the BGA region with contain sizing', async () => {
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

  test('player bga: trims black video borders before fitting into the BGA region', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'be-music-bga-video-size-'));
    try {
      await writeFile(join(baseDir, 'bordered.mp4'), '');

      const json = createEmptyJson('bms');
      json.metadata.bpm = 120;
      json.resources.bmp['01'] = 'bordered.mp4';
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

  test('player bga: tracks gameplay playback end through the last BGA video cue duration', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'be-music-bga-video-size-'));
    try {
      await writeFile(join(baseDir, 'movie.mp4'), '');

      const json = createEmptyJson('bms');
      json.metadata.bpm = 120;
      json.resources.bmp['01'] = 'movie.mp4';
      json.events = [{ measure: 0, channel: '04', position: [1, 2], value: '01' }];

      const renderer = await createBgaAnsiRenderer(json, {
        baseDir,
        width: 40,
        height: 20,
      });

      expect(renderer?.playbackEndSeconds).toBeCloseTo(3.5, 6);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test('player bga: renders undefined base keys as black instead of STAGEFILE', async () => {
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

  test('player bga: uses black viewport background before first BGA cue', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'be-music-bga-black-viewport-'));
    try {
      await writePng(join(baseDir, 'base.png'), 256, 256, () => ({ r: 255, g: 0, b: 0, a: 255 }));
      await writePng(join(baseDir, 'stage.png'), 256, 256, () => ({ r: 0, g: 0, b: 255, a: 255 }));

      const json = createEmptyJson('bms');
      json.metadata.bpm = 120;
      json.metadata.stageFile = 'stage.png';
      json.resources.bmp['01'] = 'base.png';
      json.events = [{ measure: 1, channel: '04', position: [0, 1], value: '01' }];

      const renderer = await createBgaAnsiRenderer(json, {
        baseDir,
        width: 40,
        height: 20,
      });
      expect(renderer).toBeDefined();

      const beforeCue = parseAnsiPixels(renderer?.getAnsiLines(0) ?? []);
      expect(beforeCue[10]?.[20]).toEqual({ r: 0, g: 0, b: 0 });

      const afterCue = parseAnsiPixels(renderer?.getAnsiLines(2.1) ?? []);
      expect(afterCue[10]?.[20]).toEqual({ r: 255, g: 0, b: 0 });
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test('player bga: switches to channel 06 frame when POOR is triggered', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'be-music-bga-poor-'));
    try {
      await writePng(join(baseDir, 'base.png'), 256, 256, () => ({ r: 255, g: 0, b: 0, a: 255 }));
      await writePng(join(baseDir, 'poor.png'), 256, 256, () => ({ r: 0, g: 255, b: 0, a: 255 }));

      const json = createEmptyJson('bms');
      json.metadata.bpm = 120;
      json.resources.bmp['01'] = 'base.png';
      json.resources.bmp['02'] = 'poor.png';
      json.events = [
        { measure: 0, channel: '04', position: [0, 1], value: '01' },
        { measure: 0, channel: '06', position: [0, 1], value: '02' },
      ];

      const renderer = await createBgaAnsiRenderer(json, {
        baseDir,
        width: 40,
        height: 20,
      });
      expect(renderer).toBeDefined();

      const beforePoor = parseAnsiPixels(renderer?.getAnsiLines(0) ?? []);
      expect(beforePoor[10]?.[20]).toEqual({ r: 255, g: 0, b: 0 });

      renderer?.triggerPoor(0);
      const duringPoor = parseAnsiPixels(renderer?.getAnsiLines(0) ?? []);
      expect(duringPoor[10]?.[20]).toEqual({ r: 0, g: 255, b: 0 });

      const afterPoor = parseAnsiPixels(renderer?.getAnsiLines(2.1) ?? []);
      expect(afterPoor[10]?.[20]).toEqual({ r: 255, g: 0, b: 0 });
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test('player bga: clears POOR overlay and resumes normal BGA', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'be-music-bga-poor-clear-'));
    try {
      await writePng(join(baseDir, 'base.png'), 256, 256, () => ({ r: 255, g: 0, b: 0, a: 255 }));
      await writePng(join(baseDir, 'poor.png'), 256, 256, () => ({ r: 0, g: 255, b: 0, a: 255 }));

      const json = createEmptyJson('bms');
      json.metadata.bpm = 120;
      json.resources.bmp['01'] = 'base.png';
      json.resources.bmp['02'] = 'poor.png';
      json.events = [
        { measure: 0, channel: '04', position: [0, 1], value: '01' },
        { measure: 0, channel: '06', position: [0, 1], value: '02' },
      ];

      const renderer = await createBgaAnsiRenderer(json, {
        baseDir,
        width: 40,
        height: 20,
      });
      expect(renderer).toBeDefined();

      renderer?.triggerPoor(0);
      const duringPoor = parseAnsiPixels(renderer?.getAnsiLines(0.3) ?? []);
      expect(duringPoor[10]?.[20]).toEqual({ r: 0, g: 255, b: 0 });

      renderer?.clearPoor();
      const resumed = parseAnsiPixels(renderer?.getAnsiLines(0.3) ?? []);
      expect(resumed[10]?.[20]).toEqual({ r: 255, g: 0, b: 0 });
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test('player bga: prioritizes POOR over 04/07/0A while active', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'be-music-bga-poor-priority-'));
    try {
      await writePng(join(baseDir, 'base.png'), 256, 256, () => ({ r: 255, g: 0, b: 0, a: 255 }));
      await writePng(join(baseDir, 'layer.png'), 256, 256, () => ({ r: 0, g: 255, b: 0, a: 255 }));
      await writePng(join(baseDir, 'layer2.png'), 256, 256, () => ({ r: 0, g: 0, b: 255, a: 255 }));
      await writePng(join(baseDir, 'poor.png'), 256, 256, () => ({ r: 255, g: 255, b: 0, a: 255 }));

      const json = createEmptyJson('bms');
      json.metadata.bpm = 120;
      json.resources.bmp['01'] = 'base.png';
      json.resources.bmp['02'] = 'layer.png';
      json.resources.bmp['03'] = 'layer2.png';
      json.resources.bmp['04'] = 'poor.png';
      json.events = [
        { measure: 0, channel: '04', position: [0, 1], value: '01' },
        { measure: 0, channel: '07', position: [0, 1], value: '02' },
        { measure: 0, channel: '0A', position: [0, 1], value: '03' },
        { measure: 0, channel: '06', position: [0, 1], value: '04' },
      ];

      const renderer = await createBgaAnsiRenderer(json, {
        baseDir,
        width: 40,
        height: 20,
      });
      expect(renderer).toBeDefined();

      const beforePoor = parseAnsiPixels(renderer?.getAnsiLines(0) ?? []);
      expect(beforePoor[10]?.[20]).toEqual({ r: 0, g: 0, b: 255 });

      renderer?.triggerPoor(0);
      const duringPoor = parseAnsiPixels(renderer?.getAnsiLines(0.5) ?? []);
      expect(duringPoor[10]?.[20]).toEqual({ r: 255, g: 255, b: 0 });

      const afterPoor = parseAnsiPixels(renderer?.getAnsiLines(2.1) ?? []);
      expect(afterPoor[10]?.[20]).toEqual({ r: 0, g: 0, b: 255 });
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test('player bga: uses #BMP00 as default POOR image before first channel 06 cue when #POORBGA is unspecified', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'be-music-bga-poor-bmp00-'));
    try {
      await writePng(join(baseDir, 'base.png'), 256, 256, () => ({ r: 255, g: 0, b: 0, a: 255 }));
      await writePng(join(baseDir, 'fallback.png'), 256, 256, () => ({ r: 0, g: 0, b: 255, a: 255 }));
      await writePng(join(baseDir, 'poor.png'), 256, 256, () => ({ r: 0, g: 255, b: 0, a: 255 }));

      const json = createEmptyJson('bms');
      json.metadata.bpm = 120;
      json.resources.bmp['00'] = 'fallback.png';
      json.resources.bmp['01'] = 'base.png';
      json.resources.bmp['02'] = 'poor.png';
      json.events = [
        { measure: 0, channel: '04', position: [0, 1], value: '01' },
        { measure: 1, channel: '06', position: [0, 1], value: '02' },
      ];

      const renderer = await createBgaAnsiRenderer(json, {
        baseDir,
        width: 40,
        height: 20,
      });
      expect(renderer).toBeDefined();

      renderer?.triggerPoor(0);
      const beforeFirstPoorCue = parseAnsiPixels(renderer?.getAnsiLines(0) ?? []);
      expect(beforeFirstPoorCue[10]?.[20]).toEqual({ r: 0, g: 0, b: 255 });

      renderer?.triggerPoor(2.1);
      const afterFirstPoorCue = parseAnsiPixels(renderer?.getAnsiLines(2.1) ?? []);
      expect(afterFirstPoorCue[10]?.[20]).toEqual({ r: 0, g: 255, b: 0 });
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test('player bga: does not apply #BMP00 POOR fallback when #POORBGA is specified', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'be-music-bga-poor-no-fallback-'));
    try {
      await writePng(join(baseDir, 'base.png'), 256, 256, () => ({ r: 255, g: 0, b: 0, a: 255 }));
      await writePng(join(baseDir, 'fallback.png'), 256, 256, () => ({ r: 0, g: 0, b: 255, a: 255 }));
      await writePng(join(baseDir, 'poor.png'), 256, 256, () => ({ r: 0, g: 255, b: 0, a: 255 }));

      const json = createEmptyJson('bms');
      json.metadata.bpm = 120;
      json.bms.poorBga = '01';
      json.resources.bmp['00'] = 'fallback.png';
      json.resources.bmp['01'] = 'base.png';
      json.resources.bmp['02'] = 'poor.png';
      json.events = [
        { measure: 0, channel: '04', position: [0, 1], value: '01' },
        { measure: 1, channel: '06', position: [0, 1], value: '02' },
      ];

      const renderer = await createBgaAnsiRenderer(json, {
        baseDir,
        width: 40,
        height: 20,
      });
      expect(renderer).toBeDefined();

      renderer?.triggerPoor(0);
      const beforeFirstPoorCue = parseAnsiPixels(renderer?.getAnsiLines(0) ?? []);
      expect(beforeFirstPoorCue[10]?.[20]).toEqual({ r: 255, g: 0, b: 0 });
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test('player bga: updates output size when display size changes', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'be-music-bga-resize-'));
    try {
      await writePng(join(baseDir, 'base.png'), 256, 256, () => ({ r: 255, g: 0, b: 0, a: 255 }));

      const json = createEmptyJson('bms');
      json.metadata.bpm = 120;
      json.resources.bmp['01'] = 'base.png';
      json.events = [{ measure: 0, channel: '04', position: [0, 1], value: '01' }];

      const renderer = await createBgaAnsiRenderer(json, {
        baseDir,
        width: 40,
        height: 20,
      });
      expect(renderer).toBeDefined();

      const before = parseAnsiPixels(renderer?.getAnsiLines(0) ?? []);
      expect(before.length).toBe(20);
      expect(before[0]?.length).toBe(40);

      renderer?.setDisplaySize(60, 24);
      const after = parseAnsiPixels(renderer?.getAnsiLines(0) ?? []);
      expect(after.length).toBe(24);
      expect(after[0]?.length).toBe(60);
      expect(after[12]?.[30]).toEqual({ r: 255, g: 0, b: 0 });
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test('player bga: fits raw video frames with terminal aspect correction once', () => {
    const frame = createOpaqueAnsiFrame(40, 20, (_x, y) => (y < 10 ? { r: 255, g: 0, b: 0 } : { r: 0, g: 0, b: 255 }));
    const renderer = new BgaAnsiRenderer({
      baseTimeline: [{ seconds: 0, key: '01' }],
      poorTimeline: [],
      layerTimeline: [],
      layer2Timeline: [],
      baseSourceFramesByKey: new Map([
        [
          '01',
          {
            kind: 'video',
            frames: [{ seconds: 0, frame }],
          },
        ],
      ]) as any,
      poorSourceFramesByKey: new Map(),
      layerSourceFramesByKey: new Map(),
      layer2SourceFramesByKey: new Map(),
      missingBaseSourceFrame: createOpaqueAnsiFrame(256, 256, () => ({ r: 0, g: 0, b: 0 })),
      missingPoorSourceFrame: createOpaqueAnsiFrame(256, 256, () => ({ r: 0, g: 0, b: 0 })),
      missingLayerSourceFrame: createTransparentAnsiFrame(256, 256),
      poorFallbackKey: undefined,
      poorFallbackUntilSeconds: Number.POSITIVE_INFINITY,
      playbackEndSeconds: 0,
      width: 40,
      height: 20,
    });

    const pixels = parseAnsiPixels(renderer.getAnsiLines(0) ?? []);
    expect(pixels[7]?.[20]).toEqual({ r: 255, g: 0, b: 0 });
    expect(pixels[12]?.[20]).toEqual({ r: 0, g: 0, b: 255 });
    expect(pixels[4]?.[20]).toBeUndefined();
    expect(pixels[15]?.[20]).toBeUndefined();
  });

  async function writePng(
    path: string,
    width: number,
    height: number,
    pixel: (x: number, y: number) => { r: number; g: number; b: number; a: number },
  ): Promise<void> {
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const value = pixel(x, y);
        const offset = (y * width + x) * 4;
        data[offset] = value.r;
        data[offset + 1] = value.g;
        data[offset + 2] = value.b;
        data[offset + 3] = value.a;
      }
    }
    await writeFile(
      path,
      encodePng({
        width,
        height,
        data,
        depth: 8,
        channels: 4,
      }),
    );
  }

  async function writeBmp(
    path: string,
    width: number,
    height: number,
    pixel: (x: number, y: number) => { r: number; g: number; b: number; a: number },
  ): Promise<void> {
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const value = pixel(x, y);
        const offset = (y * width + x) * 4;
        data[offset] = value.r;
        data[offset + 1] = value.g;
        data[offset + 2] = value.b;
        data[offset + 3] = value.a;
      }
    }
    await writeFile(
      path,
      encodeBmp({
        width,
        height,
        data,
        channels: 4,
        components: 3,
        bitsPerPixel: 32,
      }),
    );
  }

  async function writeIndexed4BitBmp(
    path: string,
    width: number,
    height: number,
    pixel: (x: number, y: number) => number,
  ): Promise<void> {
    const rowStride = Math.floor((Math.max(1, width) * 4 + 31) / 32) * 4;
    const imageSize = rowStride * Math.max(1, height);
    const paletteEntryCount = 16;
    const paletteSize = paletteEntryCount * 4;
    const pixelDataOffset = 14 + 40 + paletteSize;
    const fileSize = pixelDataOffset + imageSize;
    const data = new Uint8Array(fileSize);
    const view = new DataView(data.buffer);

    data[0] = 0x42;
    data[1] = 0x4d;
    view.setUint32(2, fileSize, true);
    view.setUint32(10, pixelDataOffset, true);
    view.setUint32(14, 40, true);
    view.setInt32(18, width, true);
    view.setInt32(22, height, true);
    view.setUint16(26, 1, true);
    view.setUint16(28, 4, true);
    view.setUint32(30, 0, true);
    view.setUint32(34, imageSize, true);
    view.setInt32(38, 2835, true);
    view.setInt32(42, 2835, true);
    view.setUint32(46, paletteEntryCount, true);
    view.setUint32(50, paletteEntryCount, true);

    const paletteOffset = 14 + 40;
    // Palette index 0: black (transparent key for layer BMP)
    data[paletteOffset] = 0;
    data[paletteOffset + 1] = 0;
    data[paletteOffset + 2] = 0;
    data[paletteOffset + 3] = 0;
    // Palette index 1: green
    data[paletteOffset + 4] = 0;
    data[paletteOffset + 5] = 255;
    data[paletteOffset + 6] = 0;
    data[paletteOffset + 7] = 0;

    for (let row = 0; row < height; row += 1) {
      const sourceY = height - 1 - row;
      const rowOffset = pixelDataOffset + row * rowStride;
      let byteOffset = 0;
      for (let x = 0; x < width; x += 2) {
        const left = pixel(x, sourceY) & 0x0f;
        const right = x + 1 < width ? pixel(x + 1, sourceY) & 0x0f : 0;
        data[rowOffset + byteOffset] = (left << 4) | right;
        byteOffset += 1;
      }
    }

    await writeFile(path, data);
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

  function createOpaqueAnsiFrame(
    width: number,
    height: number,
    pixel: (x: number, y: number) => RgbColor,
  ): {
    width: number;
    height: number;
    rgb: Uint8Array;
    opaqueMask: Uint8Array;
  } {
    const rgb = new Uint8Array(width * height * 3);
    const opaqueMask = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const color = pixel(x, y);
        const pixelOffset = y * width + x;
        const rgbOffset = pixelOffset * 3;
        rgb[rgbOffset] = color.r;
        rgb[rgbOffset + 1] = color.g;
        rgb[rgbOffset + 2] = color.b;
        opaqueMask[pixelOffset] = 1;
      }
    }
    return { width, height, rgb, opaqueMask };
  }

  function createTransparentAnsiFrame(
    width: number,
    height: number,
  ): {
    width: number;
    height: number;
    rgb: Uint8Array;
    opaqueMask: Uint8Array;
  } {
    return {
      width,
      height,
      rgb: new Uint8Array(width * height * 3),
      opaqueMask: new Uint8Array(width * height),
    };
  }
});

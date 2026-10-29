import { mkdtemp, writeFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { encode } from 'fast-png';
import { expect, test } from 'vite-plus/test';
import { parseBmson } from '@be-music/chart-parser';
import { buildBGATimelines, buildBmsonBGAEventTimeline, createTimingResolver } from '@be-music/chart-model';
import { BmsonBGAController } from '@be-music/player-engine/display';
import { createBgaANSIRenderer, type BGAKittyImage } from './bga.ts';

const pixel = (image: BGAKittyImage) => [
  ...image.rgb.subarray(
    (Math.floor(image.pixelHeight / 2) * image.pixelWidth + Math.floor(image.pixelWidth / 2)) * 3,
    (Math.floor(image.pixelHeight / 2) * image.pixelWidth + Math.floor(image.pixelWidth / 2)) * 3 + 3,
  ),
];

function chart(condition: 'play' | 'miss' | 'always') {
  return parseBmson(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 120 },
      sound_channels: [],
      bga: {
        bga_header: [
          { id: 20, name: 'blue.png' },
          { id: 30, name: 'red.png' },
          { id: 40, name: 'green.png' },
        ],
        bga_sequence: [{ id: 10, sequence: [{ time: 0, id: 1 }, { time: 100, id: 2 }, { time: 1000 }] }],
        bga_events: [{ y: 0, id: 20 }],
        layer_events: [{ y: 0, id: 10, condition, interval: 0 }],
      },
    }),
  );
}

test.each(['play', 'miss', 'always'] as const)(
  'terminal draws %s sequences with native PNG alpha and chart-clock frame times',
  async (condition) => {
    const dir = await mkdtemp(join(tmpdir(), 'be-music-bmson-bga-'));
    try {
      for (const [name, color] of [
        ['blue', [0, 0, 255, 255]],
        ['red', [255, 0, 0, 128]],
        ['green', [0, 255, 0, 255]],
      ] as const) {
        const data = new Uint8Array(256 * 256 * 4);
        for (let index = 0; index < data.length; index += 4) data.set(color, index);
        await writeFile(join(dir, `${name}.png`), encode({ width: 256, height: 256, channels: 4, depth: 8, data }));
      }
      const json = chart(condition);
      const timing = createTimingResolver(json);
      const normal = buildBGATimelines(json, timing);
      expect(normal.layer).toEqual([{ seconds: 0, key: undefined }]);
      const state = new BmsonBGAController(buildBmsonBGAEventTimeline(json, timing));
      const renderer = (await createBgaANSIRenderer(json, { baseDir: dir, width: 128, height: 64 }))!;
      if (condition !== 'always') {
        expect(pixel(renderer.getKittyImage(0))).toEqual([0, 0, 255]);
        state.addInput({ seconds: 0.2, condition });
      }
      const start = condition === 'always' ? 0 : 0.2;
      expect(pixel(renderer.getKittyImage(start, undefined, state.read(start)))).toEqual(
        condition === 'miss' ? [128, 0, 0] : [128, 0, 127],
      );
      expect(pixel(renderer.getKittyImage(start + 0.15, undefined, state.read(start + 0.15)))).toEqual([0, 255, 0]);
      expect(renderer.getANSILines(start + 0.15, undefined, state.read(start + 0.15))![20]).toContain(
        '\u001b[48;2;0;255;0m',
      );
      // Authored sequence lifetime, independent of the old 500 ms POOR window.
      expect(pixel(renderer.getKittyImage(start + 0.8, undefined, state.read(start + 0.8)))).toEqual([0, 255, 0]);
      expect(pixel(renderer.getKittyImage(start + 1, undefined, state.read(start + 1)))).toEqual([0, 0, 255]);
      renderer.setDisplaySize(80, 40);
      expect(pixel(renderer.getKittyImage(start, undefined, state.read(start)))).toEqual(
        condition === 'miss' ? [128, 0, 0] : [128, 0, 127],
      );
      state.reset();
      if (condition !== 'always')
        expect(pixel(renderer.getKittyImage(0.5, undefined, state.read(0.5)))).toEqual([0, 0, 255]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test.each(['play', 'miss'] as const)(
  'terminal %s sequence movies advance from their trigger and restart on retrigger',
  async (condition) => {
    const dir = await mkdtemp(join(tmpdir(), 'be-music-bmson-bga-video-'));
    const abort = new AbortController();
    try {
      await copyFile(resolve('test/fixtures/bga-bordered.webm'), join(dir, 'clip.webm'));
      const json = parseBmson(
        JSON.stringify({
          version: '1.0.0',
          info: { init_bpm: 120 },
          sound_channels: [],
          bga: {
            bga_header: [{ id: 30, name: 'clip.webm' }],
            bga_sequence: [{ id: 10, sequence: [{ time: 0, id: 0 }, { time: 2000 }] }],
            layer_events: [{ y: 0, id: 10, condition }],
          },
        }),
      );
      const state = new BmsonBGAController(buildBmsonBGAEventTimeline(json, createTimingResolver(json)));
      const renderer = (await createBgaANSIRenderer(json, {
        baseDir: dir,
        width: 128,
        height: 64,
        videoBGAStreaming: false,
        signal: abort.signal,
      }))!;
      state.addInput({ seconds: 1, condition });
      expect(pixel(renderer.getKittyImage(1, undefined, state.read(1)))[0]).toBeGreaterThan(200);
      expect(pixel(renderer.getKittyImage(1.75, undefined, state.read(1.75)))[1]).toBeGreaterThan(100);
      state.addInput({ seconds: 2, condition });
      expect(pixel(renderer.getKittyImage(2, undefined, state.read(2)))[0]).toBeGreaterThan(200);
      expect(pixel(renderer.getKittyImage(2.75, undefined, state.read(2.75)))[1]).toBeGreaterThan(100);
      expect(pixel(renderer.getKittyImage(1, undefined, state.read(1)))[0]).toBeGreaterThan(200);
    } finally {
      abort.abort();
      await rm(dir, { recursive: true, force: true });
    }
  },
);

import { resolve } from 'node:path';
import { expect, test } from 'vite-plus/test';
import { decodeVideoFramesStreamDirect } from './bga-video.ts';

test.each([
  ['bga-hevc.mp4', 'hevc'],
  ['bga-vp9.webm', 'vp9'],
])('decodes %s using the bundled decoder instead of rejecting its codec name', async (file, codecName) => {
  const frames: Array<{ width: number; height: number; rgba: Uint8Array }> = [];
  const decoded = await decodeVideoFramesStreamDirect(
    resolve(import.meta.dirname, '../../../test/fixtures', file),
    (frame) => frames.push(frame),
    undefined,
    { stopAfterFirstFrame: true },
  );
  expect(decoded).toMatchObject({ codecName, frameCount: 1 });
  expect(frames[0]).toMatchObject({ width: 16, height: 16 });
  expect(frames[0]!.rgba[0]).toBeGreaterThan(240);
  expect(frames[0]!.rgba[1]).toBeLessThan(10);
  expect(frames[0]!.rgba[2]).toBeLessThan(10);
});

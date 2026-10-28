import { resolve } from 'node:path';
import { expect, test } from 'vite-plus/test';
import {
  decodeVideoFramesStreamDirect,
  decodeVideoFramesToSourceFramesInWorker,
  type DecodedSourceVideoFrame,
} from './bga-video.ts';

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

test.each([false, true])(
  'video worker preserves authored source geometry when requested (%s)',
  async (preserveVideoBorders) => {
    const frames: DecodedSourceVideoFrame[] = [];
    const decoded = await decodeVideoFramesToSourceFramesInWorker(
      resolve(import.meta.dirname, '../../../test/fixtures/bga-bordered.webm'),
      'base',
      (frame) => frames.push(frame),
      undefined,
      { preserveVideoBorders },
    );
    expect(decoded).toMatchObject({ codecName: 'vp9', frameCount: 2 });
    expect(frames).toHaveLength(2);
    for (const [index, frame] of frames.entries()) {
      expect([frame.width, frame.height]).toEqual(preserveVideoBorders ? [32, 32] : [16, 16]);
      if (preserveVideoBorders) expect(frame.rgb[0]).toBe(0);
      else expect(frame.rgb[index === 0 ? 0 : 1]).toBeGreaterThan(240);
    }
  },
);

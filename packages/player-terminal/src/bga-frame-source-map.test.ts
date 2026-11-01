import { expect, test, vi } from 'vite-plus/test';
import { createSolidANSIFrame } from './bga-frame.ts';
import {
  MAPPED_FRAME_CACHE_SIZE,
  mapFrameSource,
  selectFrameFromSource,
  type VideoFrameSource,
} from './bga-frame-source.ts';

test('a mapped video transforms a frame when it is shown and keeps only the recent ones', () => {
  const frames = Array.from({ length: 40 }, (_, index) => ({
    seconds: index / 10,
    frame: createSolidANSIFrame(1, 1, index, 0, 0, 1),
  }));
  const source: VideoFrameSource = { kind: 'video', frames };
  const transform = vi.fn((frame: ReturnType<typeof createSolidANSIFrame>) => ({ ...frame, width: 2 }));
  const mapped = mapFrameSource(source, transform);
  // Listing the frames (the clock, durations) transforms none of them.
  expect(mapped.kind === 'video' && mapped.frames).toHaveLength(40);
  expect(transform).not.toHaveBeenCalled();
  const shown = selectFrameFromSource(mapped, 1.25);
  expect(shown.index).toBe(12);
  expect(shown.frame?.width).toBe(2);
  expect(shown.frame?.rgb[0]).toBe(12);
  // The same frame shown again is not transformed again.
  selectFrameFromSource(mapped, 1.29);
  expect(transform).toHaveBeenCalledOnce();
  // Playing on past the cache drops the oldest; showing it again transforms it again.
  for (let index = 13; index < 13 + MAPPED_FRAME_CACHE_SIZE; index += 1) selectFrameFromSource(mapped, index / 10);
  selectFrameFromSource(mapped, 1.25);
  expect(transform).toHaveBeenCalledTimes(MAPPED_FRAME_CACHE_SIZE + 2);
});

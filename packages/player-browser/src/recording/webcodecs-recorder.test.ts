import { describe, expect, it } from 'vite-plus/test';
import { alignAudioChunk, resolveFrameTimestamp } from './webcodecs-recorder.ts';

describe('alignAudioChunk', () => {
  it('places a chunk after the origin at its context time', () => {
    expect(alignAudioChunk(48_000 + 4800, 4096, 48_000, 48_000)).toEqual({ skip: 0, timestamp: 0.1 });
  });

  it('cuts the part of a chunk that predates the origin', () => {
    expect(alignAudioChunk(47_000, 4096, 48_000, 48_000)).toEqual({ skip: 1000, timestamp: 0 });
  });

  it('drops a chunk that ends before the origin', () => {
    expect(alignAudioChunk(40_000, 4096, 48_000, 48_000)).toBeUndefined();
    expect(alignAudioChunk(43_904, 4096, 48_000, 48_000)).toBeUndefined();
  });
});

describe('resolveFrameTimestamp', () => {
  it('stamps a frame with the clock relative to the origin', () => {
    expect(resolveFrameTimestamp(12.5, 10, undefined)).toBe(2.5);
    expect(resolveFrameTimestamp(12.5, 10, 2.48)).toBe(2.5);
  });

  it('skips frames before the origin', () => {
    expect(resolveFrameTimestamp(9.99, 10, undefined)).toBeUndefined();
  });

  it('skips frames while the clock stands still (suspended context)', () => {
    expect(resolveFrameTimestamp(12.5, 10, 2.5)).toBeUndefined();
    expect(resolveFrameTimestamp(12.4, 10, 2.5)).toBeUndefined();
  });

  it('rejects a non-finite clock', () => {
    expect(resolveFrameTimestamp(Number.NaN, 10, undefined)).toBeUndefined();
  });
});

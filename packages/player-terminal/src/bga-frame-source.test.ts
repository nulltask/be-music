import { describe, expect, test, vi } from 'vite-plus/test';
import { type ANSIFrame, createSolidANSIFrame } from './bga-frame.ts';
import {
  createStaticFrameSource,
  type FrameSource,
  resizeFrameSource,
  resizeFrameSourceCover,
  resizeFrameSourceMap,
  resizeFrameSourceWithAspectMode,
  resolveFrameSelection,
  resolveTimelinePlaybackEndSeconds,
  selectFrameFromSource,
  startStreamingFrameSourceMap,
  type VideoFrameSource,
} from './bga-frame-source.ts';

const RED = [255, 0, 0];
const BLUE = [0, 0, 255];

function createRedBlueFrame(): ANSIFrame {
  const frame = createSolidANSIFrame(2, 1, 0, 0, 0, 1);
  frame.rgb.set([...RED, ...BLUE]);
  return frame;
}

function createVideo(seconds: number[], durationSeconds?: number): VideoFrameSource {
  return {
    kind: 'video',
    frames: seconds.map((second) => ({ seconds: second, frame: createSolidANSIFrame(1, 1, second, 0, 0, 1) })),
    durationSeconds,
  };
}

describe('selectFrameFromSource', () => {
  test('picks the static frame, or the last video frame shown by the time', () => {
    const frame = createRedBlueFrame();
    expect(selectFrameFromSource(createStaticFrameSource(frame), 9)).toEqual({ frame, index: 0 });
    const video = createVideo([0, 1, 2]);
    expect(selectFrameFromSource(video, 1.5)).toEqual({ frame: video.frames[1]!.frame, index: 1 });
    expect(selectFrameFromSource(video, -1).index).toBe(0);
    expect(selectFrameFromSource(video, 5).index).toBe(2);
  });

  test('has no frame without a source or before a video has decoded any', () => {
    expect(selectFrameFromSource(undefined, 0)).toEqual({ frame: undefined, index: -1 });
    expect(selectFrameFromSource(createVideo([]), 0)).toEqual({ frame: undefined, index: -1 });
  });
});

describe('resolveFrameSelection', () => {
  test('selects by key, falling back to the missing frame for an unknown key', () => {
    const frame = createRedBlueFrame();
    const missing = createSolidANSIFrame(1, 1, 0, 0, 0, 1);
    const sources = new Map<string, FrameSource>([['01', createStaticFrameSource(frame)]]);
    expect(resolveFrameSelection(sources, missing, '01', 0)).toEqual({ frame, index: 0 });
    expect(resolveFrameSelection(sources, missing, '02', 0)).toEqual({ frame: missing, index: 0 });
    expect(resolveFrameSelection(sources, missing, '', 0)).toEqual({ frame: undefined, index: -1 });
  });
});

describe('resolveTimelinePlaybackEndSeconds', () => {
  test('adds the length of the last cue’s video to its time', () => {
    const sources = new Map<string, FrameSource>([
      ['still', createStaticFrameSource(createRedBlueFrame())],
      ['clip', createVideo([0, 0.5, 1])],
      ['long', createVideo([0, 0.5, 1], 3)],
      ['single', createVideo([0.4])],
    ]);
    expect(resolveTimelinePlaybackEndSeconds([{ seconds: 2, key: 'still' }], sources)).toBe(2);
    expect(resolveTimelinePlaybackEndSeconds([{ seconds: 2, key: 'clip' }], sources)).toBe(3.5);
    expect(resolveTimelinePlaybackEndSeconds([{ seconds: 2, key: 'long' }], sources)).toBe(5);
    expect(resolveTimelinePlaybackEndSeconds([{ seconds: 2, key: 'single' }], sources)).toBe(2.4);
  });

  test('is the last cue’s time without a key, and 0 without cues', () => {
    expect(resolveTimelinePlaybackEndSeconds([{ seconds: 1 }, { seconds: 4 }], new Map())).toBe(4);
    expect(resolveTimelinePlaybackEndSeconds([], new Map())).toBe(0);
  });
});

describe('startStreamingFrameSourceMap', () => {
  test('starts each video once', () => {
    const video = { ...createVideo([0]), ensureStreaming: vi.fn() };
    const sources = new Map<string, FrameSource>([
      ['a', video],
      ['b', video],
      ['c', createStaticFrameSource(createRedBlueFrame())],
    ]);
    const seen = new Set<FrameSource>();
    startStreamingFrameSourceMap(sources, seen);
    startStreamingFrameSourceMap(sources, seen);
    expect(video.ensureStreaming).toHaveBeenCalledTimes(1);
  });
});

describe('resizing frame sources', () => {
  test('resizeFrameSource fits a still into the cells at the terminal pixel aspect', () => {
    const resized = resizeFrameSource(createStaticFrameSource(createRedBlueFrame()), 4, 2, 'nearest');
    expect(resized.kind).toBe('static');
    const frame = selectFrameFromSource(resized, 0).frame!;
    expect([frame.width, frame.height]).toEqual([4, 2]);
    expect([...frame.rgb.subarray(0, 12)]).toEqual([...RED, ...RED, ...BLUE, ...BLUE]);
  });

  test('resizeFrameSourceCover fills the cells, cropping the overflow', () => {
    const resized = resizeFrameSourceCover(createStaticFrameSource(createRedBlueFrame()), 2, 2, 'nearest');
    const frame = selectFrameFromSource(resized, 0).frame!;
    expect([...frame.opaqueMask]).toEqual([1, 1, 1, 1]);
    expect([...frame.rgb]).toEqual([...RED, ...BLUE, ...RED, ...BLUE]);
  });

  test('resizeFrameSourceWithAspectMode resizes video frames as they are decoded', () => {
    const video = { ...createVideo([0], 4), ensureStreaming: vi.fn() };
    const resized = resizeFrameSourceWithAspectMode(video, 3, 3, 1, 1, 'contain', 'nearest') as VideoFrameSource;
    expect(resized.frames).toHaveLength(1);
    expect(resized.frames[0]!.frame.width).toBe(3);
    video.frames.push({ seconds: 1, frame: createSolidANSIFrame(1, 1, 0, 0, 0, 1) });
    expect(resized.frames.map((entry) => entry.seconds)).toEqual([0, 1]);
    expect(resized.durationSeconds).toBe(4);
    resized.ensureStreaming?.();
    expect(video.ensureStreaming).toHaveBeenCalledTimes(1);
  });

  test('resizeFrameSourceMap resizes a source shared by several keys once', () => {
    const source = createStaticFrameSource(createRedBlueFrame());
    const resized = resizeFrameSourceMap(
      new Map([
        ['01', source],
        ['02', source],
      ]),
      4,
      2,
      'nearest',
    );
    expect(resized.get('01')).toBe(resized.get('02'));
    expect(resized.get('01')).not.toBe(source);
  });
});

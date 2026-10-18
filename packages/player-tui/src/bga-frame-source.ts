import type { BgaCue } from '@be-music/player/core/bga-timeline';
import { DEFAULT_IMAGE_RESIZE_ALGORITHM, type ImageResizeAlgorithm } from '@be-music/player/image-resize-algorithm';
import {
  TERMINAL_PIXEL_ASPECT_X,
  TERMINAL_PIXEL_ASPECT_Y,
  type AnsiFrame,
  resizeAnsiFrameWithAspectMode,
} from './bga-frame.ts';

export interface TimedAnsiFrame {
  seconds: number;
  frame: AnsiFrame;
}

interface StaticFrameSource {
  kind: 'static';
  frame: AnsiFrame;
}

export interface VideoFrameSource {
  kind: 'video';
  frames: TimedAnsiFrame[];
  durationSeconds?: number;
  ensureStreaming?: () => void;
}

export type FrameSource = StaticFrameSource | VideoFrameSource;

export interface FrameSelection {
  frame?: AnsiFrame;
  index: number;
}

export function resizeFrameSourceMap(
  sourceMap: Map<string, FrameSource>,
  width: number,
  height: number,
  resizeAlgorithm: ImageResizeAlgorithm = DEFAULT_IMAGE_RESIZE_ALGORITHM,
): Map<string, FrameSource> {
  const map = new Map<string, FrameSource>();
  const cache = new WeakMap<FrameSource, FrameSource>();
  for (const [key, source] of sourceMap) {
    let resized = cache.get(source);
    if (!resized) {
      resized = resizeFrameSource(source, width, height, resizeAlgorithm);
      cache.set(source, resized);
    }
    map.set(key, resized);
  }
  return map;
}

export function createStaticFrameSource(frame: AnsiFrame): FrameSource {
  return {
    kind: 'static',
    frame,
  };
}

export function resolveFrameSelection(
  sourceFramesByKey: ReadonlyMap<string, FrameSource>,
  missingFrame: AnsiFrame,
  key: string,
  seconds: number,
): FrameSelection {
  if (!key) {
    return {
      frame: undefined,
      index: -1,
    };
  }
  const source = sourceFramesByKey.get(key) ?? createStaticFrameSource(missingFrame);
  return selectFrameFromSource(source, seconds);
}

export function resizeFrameSource(
  source: FrameSource,
  width: number,
  height: number,
  resizeAlgorithm: ImageResizeAlgorithm = DEFAULT_IMAGE_RESIZE_ALGORITHM,
): FrameSource {
  return resizeFrameSourceWithAspectMode(
    source,
    width,
    height,
    TERMINAL_PIXEL_ASPECT_X,
    TERMINAL_PIXEL_ASPECT_Y,
    'contain',
    resizeAlgorithm,
  );
}

export function resizeFrameSourceCover(
  source: FrameSource,
  width: number,
  height: number,
  resizeAlgorithm: ImageResizeAlgorithm = DEFAULT_IMAGE_RESIZE_ALGORITHM,
): FrameSource {
  return resizeFrameSourceWithAspectMode(
    source,
    width,
    height,
    TERMINAL_PIXEL_ASPECT_X,
    TERMINAL_PIXEL_ASPECT_Y,
    'cover',
    resizeAlgorithm,
  );
}

export function resizeFrameSourceWithAspectMode(
  source: FrameSource,
  width: number,
  height: number,
  aspectX: number,
  aspectY: number,
  mode: 'contain' | 'cover',
  resizeAlgorithm: ImageResizeAlgorithm = DEFAULT_IMAGE_RESIZE_ALGORITHM,
): FrameSource {
  if (source.kind === 'static') {
    return {
      kind: 'static',
      frame: resizeAnsiFrameWithAspectMode(source.frame, width, height, aspectX, aspectY, mode, resizeAlgorithm),
    };
  }

  const resizedFrames: TimedAnsiFrame[] = [];
  return {
    kind: 'video',
    get durationSeconds() {
      return source.durationSeconds;
    },
    ensureStreaming: () => {
      source.ensureStreaming?.();
    },
    get frames() {
      for (let index = resizedFrames.length; index < source.frames.length; index += 1) {
        const entry = source.frames[index]!;
        resizedFrames.push({
          seconds: entry.seconds,
          frame: resizeAnsiFrameWithAspectMode(entry.frame, width, height, aspectX, aspectY, mode, resizeAlgorithm),
        });
      }
      return resizedFrames;
    },
  };
}

export function selectFrameFromSource(source: FrameSource | undefined, seconds: number): FrameSelection {
  if (!source) {
    return {
      frame: undefined,
      index: -1,
    };
  }

  if (source.kind === 'static') {
    return {
      frame: source.frame,
      index: 0,
    };
  }

  if (source.frames.length === 0) {
    return {
      frame: undefined,
      index: -1,
    };
  }

  let low = 0;
  let high = source.frames.length - 1;
  let answer = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (source.frames[mid].seconds <= seconds) {
      answer = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const bounded = Math.max(0, Math.min(source.frames.length - 1, answer));
  return {
    frame: source.frames[bounded].frame,
    index: bounded,
  };
}

export function resolveTimelinePlaybackEndSeconds(
  timeline: ReadonlyArray<BgaCue>,
  sourcesByKey: ReadonlyMap<string, FrameSource>,
): number {
  const lastCue = timeline.at(-1);
  if (!lastCue) {
    return 0;
  }
  if (!lastCue.key) {
    return lastCue.seconds;
  }
  return lastCue.seconds + resolveFrameSourceDurationSeconds(sourcesByKey.get(lastCue.key));
}

function resolveFrameSourceDurationSeconds(source: FrameSource | undefined): number {
  if (!source || source.kind === 'static') {
    return 0;
  }
  const streamDuration = source.durationSeconds ?? 0;
  const lastFrameSeconds = source.frames.at(-1)?.seconds ?? 0;
  if (source.frames.length < 2) {
    return Math.max(streamDuration, lastFrameSeconds);
  }
  const previousFrameSeconds = source.frames.at(-2)?.seconds ?? 0;
  const estimatedTailSeconds = Math.max(0, lastFrameSeconds - previousFrameSeconds);
  return Math.max(streamDuration, lastFrameSeconds + estimatedTailSeconds);
}

export function startStreamingFrameSourceMap(
  sourceMap: ReadonlyMap<string, FrameSource>,
  seen: Set<FrameSource>,
): void {
  for (const source of sourceMap.values()) {
    startStreamingFrameSource(source, seen);
  }
}

function startStreamingFrameSource(source: FrameSource | undefined, seen: Set<FrameSource>): void {
  if (!source || source.kind === 'static' || seen.has(source)) {
    return;
  }
  seen.add(source);
  source.ensureStreaming?.();
}

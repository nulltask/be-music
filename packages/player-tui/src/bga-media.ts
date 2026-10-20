import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { isAbortError, throwIfAborted } from '@be-music/utils/core';
import { resolveFirstExistingPath } from '@be-music/utils/path';
import { decodeVideoFramesStream, decodeVideoFramesToSourceFramesInWorker } from './bga-video.ts';
import { DEFAULT_IMAGE_RESIZE_ALGORITHM, type ImageResizeAlgorithm } from '@be-music/player/display';
import { decodeImageBuffer } from './bga-image.ts';
import {
  type FrameMode,
  type ANSIFrame,
  convertImageToSpecFrameOffThread,
  convertImageToSourceFrame,
} from './bga-frame.ts';
import {
  type TimedANSIFrame,
  type VideoFrameSource,
  type FrameSource,
  createStaticFrameSource,
} from './bga-frame-source.ts';

async function loadImageAsSpecFrame(
  imagePath: string,
  mode: FrameMode,
  resizeAlgorithm = DEFAULT_IMAGE_RESIZE_ALGORITHM,
  signal?: AbortSignal,
): Promise<ANSIFrame | undefined> {
  const extension = extname(imagePath).toLowerCase();
  if (extension !== '.bmp' && extension !== '.png' && extension !== '.jpg' && extension !== '.jpeg') {
    return undefined;
  }
  try {
    throwIfAborted(signal);
    const buffer = await readFile(imagePath, { signal });
    throwIfAborted(signal);
    const decoded = decodeImageBuffer(buffer, imagePath);
    throwIfAborted(signal);
    return await convertImageToSpecFrameOffThread(decoded, mode, resizeAlgorithm, signal);
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    return undefined;
  }
}

async function loadImageAsSourceFrame(
  imagePath: string,
  mode: FrameMode,
  signal?: AbortSignal,
): Promise<ANSIFrame | undefined> {
  const extension = extname(imagePath).toLowerCase();
  if (extension !== '.bmp' && extension !== '.png' && extension !== '.jpg' && extension !== '.jpeg') {
    return undefined;
  }
  try {
    throwIfAborted(signal);
    const buffer = await readFile(imagePath, { signal });
    throwIfAborted(signal);
    const decoded = decodeImageBuffer(buffer, imagePath);
    throwIfAborted(signal);
    return convertImageToSourceFrame(decoded, mode);
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    return undefined;
  }
}

export async function loadFrameSource(
  resourcePath: string,
  mode: FrameMode,
  _width: number,
  _height: number,
  imageResizeAlgorithm: ImageResizeAlgorithm = DEFAULT_IMAGE_RESIZE_ALGORITHM,
  videoBGAStreaming = true,
  signal?: AbortSignal,
): Promise<FrameSource | undefined> {
  throwIfAborted(signal);
  const imageFrame = await loadImageAsSpecFrame(resourcePath, mode, imageResizeAlgorithm, signal);
  if (imageFrame) {
    return createStaticFrameSource(imageFrame);
  }

  return loadVideoAsFrameSource(resourcePath, mode, videoBGAStreaming, signal);
}

async function loadVideoAsFrameSource(
  videoPath: string,
  mode: FrameMode,
  videoBGAStreaming = true,
  signal?: AbortSignal,
): Promise<FrameSource | undefined> {
  throwIfAborted(signal);
  const frames: TimedANSIFrame[] = [];
  const source: VideoFrameSource = {
    kind: 'video',
    frames,
    durationSeconds: undefined,
  };

  let settleFirstFrame: ((hasFrame: boolean) => void) | undefined;
  let rejectFirstFrame: ((error: unknown) => void) | undefined;
  let firstFrameSettled = false;
  const firstFramePromise = new Promise<boolean>((resolve, reject) => {
    settleFirstFrame = resolve;
    rejectFirstFrame = reject;
  });

  const settleHasFirstFrame = (hasFrame: boolean): void => {
    if (firstFrameSettled) {
      return;
    }
    firstFrameSettled = true;
    settleFirstFrame?.(hasFrame);
  };

  const appendFrame = (frame: { seconds: number; width: number; height: number; rgba: Uint8Array }): void => {
    throwIfAborted(signal);
    const sourceFrame = convertImageToSourceFrame(
      {
        width: frame.width,
        height: frame.height,
        data: frame.rgba,
        format: 'video',
      },
      mode,
    );
    frames.push({
      seconds: frame.seconds,
      frame: sourceFrame,
    });
  };

  if (!videoBGAStreaming) {
    const decoded = await decodeVideoFramesStream(
      videoPath,
      (frame) => {
        appendFrame(frame);
      },
      signal,
      {
        onReady: (info) => {
          source.durationSeconds = info.durationSeconds;
        },
      },
    );
    if (decoded) {
      source.durationSeconds = decoded.durationSeconds;
    }
    throwIfAborted(signal);
    return frames.length > 0 ? source : undefined;
  }

  void decodeVideoFramesStream(
    videoPath,
    (frame) => {
      appendFrame(frame);
      settleHasFirstFrame(true);
    },
    signal,
    {
      onReady: (info) => {
        source.durationSeconds = info.durationSeconds;
      },
      stopAfterFirstFrame: true,
    },
  )
    .then((decoded) => {
      if (decoded) {
        source.durationSeconds = decoded.durationSeconds;
      }
      settleHasFirstFrame(frames.length > 0);
    })
    .catch((error) => {
      if (isAbortError(error)) {
        if (!firstFrameSettled) {
          firstFrameSettled = true;
          rejectFirstFrame?.(error);
        }
        return;
      }
      settleHasFirstFrame(false);
    });

  const hasFirstFrame = await firstFramePromise;
  throwIfAborted(signal);
  if (!hasFirstFrame) {
    return undefined;
  }

  let streamingStarted = false;
  source.ensureStreaming = () => {
    if (streamingStarted) {
      return;
    }
    streamingStarted = true;
    void (async () => {
      let skipFrameCount = frames.length;
      try {
        throwIfAborted(signal);
        const decoded = await decodeVideoFramesToSourceFramesInWorker(
          videoPath,
          mode,
          (frame) => {
            if (skipFrameCount > 0) {
              skipFrameCount -= 1;
              return;
            }
            frames.push({
              seconds: frame.seconds,
              frame: {
                width: frame.width,
                height: frame.height,
                rgb: frame.rgb,
                opaqueMask: frame.opaqueMask,
              },
            });
          },
          signal,
          {
            onReady: (info) => {
              source.durationSeconds = info.durationSeconds;
            },
          },
        );
        if (decoded) {
          source.durationSeconds = decoded.durationSeconds;
        }
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
      }
    })();
  };

  return source;
}

export async function loadTerminalImageSourceFrame(
  baseDir: string,
  mediaPath: string,
  signal?: AbortSignal,
): Promise<FrameSource | undefined> {
  throwIfAborted(signal);
  const resolved = await resolveMediaPath(baseDir, mediaPath, signal);
  if (!resolved) {
    return undefined;
  }
  const imageFrame = await loadImageAsSourceFrame(resolved, 'base', signal);
  if (imageFrame) {
    return createStaticFrameSource(imageFrame);
  }
  return loadVideoAsFrameSource(resolved, 'base', true, signal);
}

export async function resolveMediaPath(
  baseDir: string,
  mediaPath: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  return resolveFirstExistingPath(baseDir, createMediaPathCandidates(mediaPath), signal);
}

function createMediaPathCandidates(mediaPath: string): string[] {
  const extCandidates = [
    '.bmp',
    '.BMP',
    '.png',
    '.PNG',
    '.jpg',
    '.JPG',
    '.jpeg',
    '.JPEG',
    '.mpg',
    '.MPG',
    '.mpeg',
    '.MPEG',
    '.mp4',
    '.MP4',
    '.m4v',
    '.M4V',
    '.avi',
    '.AVI',
    '.wmv',
    '.WMV',
    '.mov',
    '.MOV',
    '.webm',
    '.WEBM',
  ];
  const candidates: string[] = [];
  const seen = new Set<string>();
  const push = (value: string): void => {
    const normalized = value.trim();
    if (normalized.length === 0 || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    candidates.push(normalized);
  };

  const basePaths = [mediaPath];
  const slashNormalized = mediaPath.replaceAll('\\', '/');
  if (slashNormalized !== mediaPath) {
    basePaths.push(slashNormalized);
  }

  for (const basePath of basePaths) {
    push(basePath);
    const extension = extname(basePath);
    const withoutExtension = extension.length > 0 ? basePath.slice(0, -extension.length) : basePath;
    for (const candidateExtension of extCandidates) {
      push(`${withoutExtension}${candidateExtension}`);
    }
  }

  return candidates;
}

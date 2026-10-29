import { applyBMSColorKey, type BmsARGB } from '@be-music/chart-model';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { isAbortError, throwIfAborted } from '@be-music/shared-utils/core';
import { resolveFirstExistingPath } from '@be-music/shared-utils/path';
import { decodeVideoFramesStream, decodeVideoFramesToSourceFramesInWorker } from './bga-video.ts';
import { DEFAULT_IMAGE_RESIZE_ALGORITHM, type ImageResizeAlgorithm } from '@be-music/player-engine/display';
import { decodeImageBuffer, type DecodedImage } from './bga-image.ts';
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
  mapFrameSource,
} from './bga-frame-source.ts';

async function loadImageAsSpecFrame(
  imagePath: string,
  mode: FrameMode,
  resizeAlgorithm = DEFAULT_IMAGE_RESIZE_ALGORITHM,
  signal?: AbortSignal,
  colorKey?: BmsARGB,
  swBGAColorKey?: BmsARGB,
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
    if ((colorKey || swBGAColorKey) && !decoded.hasAlphaChannel) {
      for (let offset = 3; offset < decoded.data.length; offset += 4) decoded.data[offset] = 255;
    }
    if (colorKey) applyImageColorKey(decoded, colorKey);
    if (swBGAColorKey) applyBMSColorKey(decoded.data, swBGAColorKey, true);
    throwIfAborted(signal);
    return await convertImageToSpecFrameOffThread(
      decoded,
      colorKey || swBGAColorKey ? 'exbmp' : mode,
      resizeAlgorithm,
      signal,
    );
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
  colorKey?: BmsARGB,
  swBGAColorKey?: BmsARGB,
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
    if ((colorKey || swBGAColorKey) && !decoded.hasAlphaChannel) {
      for (let offset = 3; offset < decoded.data.length; offset += 4) decoded.data[offset] = 255;
    }
    if (colorKey) applyImageColorKey(decoded, colorKey);
    if (swBGAColorKey) applyBMSColorKey(decoded.data, swBGAColorKey, true);
    throwIfAborted(signal);
    return convertImageToSourceFrame(decoded, colorKey || swBGAColorKey ? 'exbmp' : mode);
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    return undefined;
  }
}

/** Key native pixels before scaling and before the terminal's binary alpha-mask conversion. */
function applyImageColorKey(image: DecodedImage, colorKey: BmsARGB): void {
  applyBMSColorKey(image.data, colorKey, image.hasAlphaChannel === true);
}

export async function loadFrameSource(
  resourcePath: string,
  mode: FrameMode,
  _width: number,
  _height: number,
  imageResizeAlgorithm: ImageResizeAlgorithm = DEFAULT_IMAGE_RESIZE_ALGORITHM,
  videoBGAStreaming = true,
  signal?: AbortSignal,
  preserveSourceGeometry = false,
  colorKey?: BmsARGB,
  swBGAColorKey?: BmsARGB,
): Promise<FrameSource | undefined> {
  throwIfAborted(signal);
  const imageFrame = preserveSourceGeometry
    ? await loadImageAsSourceFrame(resourcePath, mode, signal, colorKey, swBGAColorKey)
    : await loadImageAsSpecFrame(resourcePath, mode, imageResizeAlgorithm, signal, colorKey, swBGAColorKey);
  if (imageFrame) {
    return createStaticFrameSource(imageFrame);
  }

  const video = await loadVideoAsFrameSource(
    resourcePath,
    swBGAColorKey ? 'exbmp' : mode,
    videoBGAStreaming,
    signal,
    preserveSourceGeometry || swBGAColorKey !== undefined,
  );
  if (!video || !swBGAColorKey) return video;
  return mapFrameSource(video, (frame) => {
    const rgba = new Uint8Array(frame.width * frame.height * 4);
    for (let pixel = 0; pixel < frame.opaqueMask.length; pixel++) {
      rgba.set(frame.rgb.subarray(pixel * 3, pixel * 3 + 3), pixel * 4);
      rgba[pixel * 4 + 3] = frame.opaqueMask[pixel] ? 255 : 0;
    }
    if (colorKey) applyBMSColorKey(rgba, colorKey, false);
    applyBMSColorKey(rgba, swBGAColorKey, true);
    return { ...frame, opaqueMask: Uint8Array.from(frame.opaqueMask, (_, pixel) => (rgba[pixel * 4 + 3] ? 1 : 0)) };
  });
}

async function loadVideoAsFrameSource(
  videoPath: string,
  mode: FrameMode,
  videoBGAStreaming = true,
  signal?: AbortSignal,
  preserveVideoBorders = false,
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
      preserveVideoBorders,
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
            preserveVideoBorders,
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

import { parentPort, workerData } from 'node:worker_threads';
import { createAbortError, isAbortError } from '@be-music/utils';
import { decodeVideoFramesStreamDirect, type DecodedVideoFrame } from './bga-video.ts';

const TRANSPARENT_ALPHA_THRESHOLD = 16;
const VIDEO_BLACK_BORDER_THRESHOLD = 8;

type FrameMode = 'base' | 'layer';

interface VideoDecodeWorkerInitData {
  videoPath: string;
  mode: FrameMode;
  stopAfterFirstFrame: boolean;
}

interface AnsiFrame {
  width: number;
  height: number;
  rgb: Uint8Array;
  opaqueMask: Uint8Array;
}

const port = parentPort;
const initData = workerData as VideoDecodeWorkerInitData;

void bootstrap().catch((error) => {
  if (isAbortError(error)) {
    port?.close();
    process.exit(0);
    return;
  }
  postMessage({
    kind: 'error',
    name: error instanceof Error ? error.name : undefined,
    message: error instanceof Error ? error.message : String(error),
  });
  port?.close();
  throw error;
});

async function bootstrap(): Promise<void> {
  if (!port) {
    throw new Error('Video decode worker parent port is unavailable');
  }

  const abortController = new AbortController();
  port.on('message', (message: unknown) => {
    if (
      typeof message === 'object' &&
      message !== null &&
      'kind' in message &&
      message.kind === 'abort' &&
      !abortController.signal.aborted
    ) {
      abortController.abort(createAbortError());
    }
  });

  try {
    const result = await decodeVideoFramesStreamDirect(
      initData.videoPath,
      (frame) => {
        const sourceFrame = convertDecodedVideoFrameToSourceFrame(frame, initData.mode);
        postMessage(
          {
            kind: 'frame',
            frame: {
              seconds: frame.seconds,
              width: sourceFrame.width,
              height: sourceFrame.height,
              rgb: sourceFrame.rgb,
              opaqueMask: sourceFrame.opaqueMask,
            },
          },
          [sourceFrame.rgb.buffer as ArrayBuffer, sourceFrame.opaqueMask.buffer as ArrayBuffer],
        );
      },
      abortController.signal,
      {
        onReady: (info) => {
          postMessage({
            kind: 'ready',
            info,
          });
        },
        stopAfterFirstFrame: initData.stopAfterFirstFrame,
      },
    );

    postMessage({
      kind: 'done',
      result,
    });
    port.close();
  } catch (error) {
    postMessage({
      kind: 'error',
      name: error instanceof Error ? error.name : undefined,
      message: error instanceof Error ? error.message : String(error),
    });
    port.close();
  }
}

function postMessage(message: unknown, transferList?: ArrayBuffer[]): void {
  port?.postMessage(message, transferList ?? []);
}

function convertDecodedVideoFrameToSourceFrame(frame: DecodedVideoFrame, mode: FrameMode): AnsiFrame {
  const safeWidth = Math.max(1, Math.floor(frame.width));
  const safeHeight = Math.max(1, Math.floor(frame.height));
  const sourceFrame = createSolidAnsiFrame(safeWidth, safeHeight, 0, 0, 0, 0);

  for (let y = 0; y < safeHeight; y += 1) {
    for (let x = 0; x < safeWidth; x += 1) {
      const sourceOffset = (y * safeWidth + x) * 4;
      const r = frame.rgba[sourceOffset] ?? 0;
      const g = frame.rgba[sourceOffset + 1] ?? 0;
      const b = frame.rgba[sourceOffset + 2] ?? 0;
      const a = frame.rgba[sourceOffset + 3] ?? 255;
      if (!isOpaqueVideoPixel(r, g, b, a, mode)) {
        continue;
      }

      const targetPixelOffset = y * safeWidth + x;
      const targetRgbOffset = targetPixelOffset * 3;
      sourceFrame.rgb[targetRgbOffset] = r;
      sourceFrame.rgb[targetRgbOffset + 1] = g;
      sourceFrame.rgb[targetRgbOffset + 2] = b;
      sourceFrame.opaqueMask[targetPixelOffset] = 1;
    }
  }

  return trimBlackVideoFrameBorders(sourceFrame);
}

function createSolidAnsiFrame(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
  maskFill: 0 | 1,
): AnsiFrame {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const rgb = new Uint8Array(safeWidth * safeHeight * 3);
  const opaqueMask = new Uint8Array(safeWidth * safeHeight);
  if (maskFill === 0) {
    return {
      width: safeWidth,
      height: safeHeight,
      rgb,
      opaqueMask,
    };
  }

  for (let pixelOffset = 0; pixelOffset < safeWidth * safeHeight; pixelOffset += 1) {
    const rgbOffset = pixelOffset * 3;
    rgb[rgbOffset] = r;
    rgb[rgbOffset + 1] = g;
    rgb[rgbOffset + 2] = b;
    opaqueMask[pixelOffset] = 1;
  }

  return {
    width: safeWidth,
    height: safeHeight,
    rgb,
    opaqueMask,
  };
}

function isOpaqueVideoPixel(r: number, g: number, b: number, a: number, mode: FrameMode): boolean {
  if (mode !== 'layer') {
    return true;
  }
  if (a <= TRANSPARENT_ALPHA_THRESHOLD) {
    return false;
  }
  return !(r === 0 && g === 0 && b === 0);
}

function trimBlackVideoFrameBorders(source: AnsiFrame): AnsiFrame {
  let minX = source.width;
  let minY = source.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const pixelOffset = y * source.width + x;
      if (source.opaqueMask[pixelOffset] === 0) {
        continue;
      }
      const rgbOffset = pixelOffset * 3;
      const r = source.rgb[rgbOffset] ?? 0;
      const g = source.rgb[rgbOffset + 1] ?? 0;
      const b = source.rgb[rgbOffset + 2] ?? 0;
      if (r <= VIDEO_BLACK_BORDER_THRESHOLD && g <= VIDEO_BLACK_BORDER_THRESHOLD && b <= VIDEO_BLACK_BORDER_THRESHOLD) {
        continue;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < 0 || maxY < 0) {
    return source;
  }
  if (minX === 0 && minY === 0 && maxX === source.width - 1 && maxY === source.height - 1) {
    return source;
  }

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const trimmed = createSolidAnsiFrame(width, height, 0, 0, 0, 0);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = minX + x;
      const sourceY = minY + y;
      const sourcePixelOffset = sourceY * source.width + sourceX;
      if (source.opaqueMask[sourcePixelOffset] === 0) {
        continue;
      }
      const targetPixelOffset = y * width + x;
      const sourceRgbOffset = sourcePixelOffset * 3;
      const targetRgbOffset = targetPixelOffset * 3;
      trimmed.rgb[targetRgbOffset] = source.rgb[sourceRgbOffset] ?? 0;
      trimmed.rgb[targetRgbOffset + 1] = source.rgb[sourceRgbOffset + 1] ?? 0;
      trimmed.rgb[targetRgbOffset + 2] = source.rgb[sourceRgbOffset + 2] ?? 0;
      trimmed.opaqueMask[targetPixelOffset] = 1;
    }
  }

  return trimmed;
}

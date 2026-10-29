import { parentPort, workerData } from 'node:worker_threads';
import { createAbortError, isAbortError } from '@be-music/shared-utils/core';
import { decodeVideoFramesStreamDirect, type DecodedVideoFrame } from './bga-video.ts';
import { convertImageToSourceFrame, type ANSIFrame, type FrameMode } from './bga-frame.ts';

interface VideoDecodeWorkerInitData {
  videoPath: string;
  mode: FrameMode;
  stopAfterFirstFrame: boolean;
  preserveVideoBorders: boolean;
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
        const sourceFrame = convertDecodedVideoFrameToSourceFrame(frame, initData.mode, initData.preserveVideoBorders);
        postMessage(
          {
            kind: 'frame',
            frame: {
              seconds: frame.seconds,
              width: sourceFrame.width,
              height: sourceFrame.height,
              rgb: sourceFrame.rgb,
              opaqueMask: sourceFrame.opaqueMask,
              ...(sourceFrame.alpha ? { alpha: sourceFrame.alpha } : {}),
            },
          },
          [
            sourceFrame.rgb.buffer as ArrayBuffer,
            sourceFrame.opaqueMask.buffer as ArrayBuffer,
            ...(sourceFrame.alpha ? [sourceFrame.alpha.buffer as ArrayBuffer] : []),
          ],
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

function convertDecodedVideoFrameToSourceFrame(
  frame: DecodedVideoFrame,
  mode: FrameMode,
  preserveVideoBorders: boolean,
): ANSIFrame {
  return convertImageToSourceFrame(
    { width: frame.width, height: frame.height, data: frame.rgba, format: 'video' },
    mode,
    preserveVideoBorders,
  );
}

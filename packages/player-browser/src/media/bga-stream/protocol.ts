/**
 * Messages of the streaming BGA transcode. Two workers run it: the decode worker drives ffmpeg.wasm, whose `exec` blocks
 * its thread until the whole file is done, and the encode worker runs the WebCodecs encoder and the fMP4 muxer, whose
 * callbacks need an event loop. Raw frames go straight from one to the other over a `MessageChannel`; only the
 * compressed fMP4 bytes reach the main thread.
 */
import type { BGAStreamOutput } from './ffmpeg-args.ts';
import type { Y4MHeader } from './y4m.ts';

/** Main thread → decode worker: transcode `input` once, then the worker is terminated. */
export interface BGADecodeStartMessage {
  type: 'start';
  /** Blob URL of the ESM `ffmpeg-core.js`. */
  coreURL: string;
  /** The core's wasm, compiled once on the main thread and shared by every decode worker. */
  wasmModule: WebAssembly.Module;
  /** The source file's bytes; transferred. */
  input: ArrayBuffer;
  /** Name inside ffmpeg's file system; its extension picks the demuxer. */
  inputName: string;
  mode: BGAStreamOutput;
  maxLongEdge?: number;
  /** `raw` mode: where the frames go (the encode worker's end of the channel). */
  framePort?: MessagePort;
  /** `raw` mode: the frames the encoder has taken, to wait on (see `flow.ts`). */
  flow?: Int32Array<SharedArrayBuffer>;
}

/** Main thread → encode worker. */
export interface BGAEncodeStartMessage {
  type: 'start';
  framePort: MessagePort;
  /** Counts each frame taken, which lets the decoder go on (see `flow.ts`). */
  flow: Int32Array<SharedArrayBuffer>;
}

/** Decode worker → encode worker, over the frame port. */
export type BGAFrameMessage =
  | ({ type: 'header' } & Y4MHeader)
  /** One I420 frame; its buffer is transferred. */
  | { type: 'frame'; data: ArrayBuffer }
  /** No more frames. Sent once, also after a failure, so the encoder finalizes what it has. */
  | { type: 'end' };

/** Either worker → main thread. */
export type BGAStreamWorkerMessage =
  /** Next fMP4 bytes, in order; the buffer is transferred. Chunk boundaries need not fall on boxes. */
  | { type: 'chunk'; data: ArrayBuffer }
  /** The output is complete; `frames` counts the frames decoded or encoded. */
  | { type: 'done'; frames: number }
  /** The worker gave up. `log` holds ffmpeg's last stderr lines when there are any. */
  | { type: 'error'; message: string; log?: string[] };

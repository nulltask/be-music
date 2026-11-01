/**
 * Decode side of the streaming BGA transcode. Runs in a module worker the host bundles (see
 * {@link configureBGAVideoWorkers}); call {@link runBGAVideoDecodeWorker} from its entry.
 *
 * It boots ffmpeg.wasm's core directly rather than through `@ffmpeg/ffmpeg`, so it can register a character device
 * as ffmpeg's output: the device's `write` runs synchronously inside `exec`, which hands each piece of output over
 * while the decode is still going — the stock wrapper only reads files back once `exec` returns. The core's wasm is
 * the stock build, unchanged.
 */
import { buildBGAStreamArgs } from './ffmpeg-args.ts';
import { waitForEncoder } from './flow.ts';
import type { BGADecodeStartMessage, BGAFrameMessage, BGAStreamWorkerMessage } from './protocol.ts';
import { Y4MParser } from './y4m.ts';

/** The parts of the Emscripten module `createFFmpegCore` resolves to that this worker uses. */
interface FFmpegCore {
  FS: {
    makedev(major: number, minor: number): number;
    registerDevice(device: number, ops: Record<string, unknown>): void;
    mkdev(path: string, device: number): void;
    mkdir(path: string): void;
    mount(type: unknown, options: { blobs: Array<{ name: string; data: Blob }> }, mountPoint: string): void;
    filesystems: { WORKERFS: unknown };
    ErrnoError: new (errno: number) => Error;
  };
  setLogger(logger: (data: { type: string; message: string }) => void): void;
  exec(...args: string[]): number;
}

type CreateFFmpegCore = (options: Record<string, unknown>) => Promise<FFmpegCore>;

interface WorkerScope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const OUTPUT_DEVICE = '/dev/bga-stream';
/** Where the source file is mounted. */
const INPUT_DIRECTORY = '/bga-input';
/** ffmpeg's stderr lines kept for the error report. */
const LOG_TAIL_LINES = 12;
/** `ESPIPE`: the device can't seek, which tells ffmpeg the output is a pipe. */
const ESPIPE = 70;

export function runBGAVideoDecodeWorker(scope: WorkerScope = globalThis as unknown as WorkerScope): void {
  scope.onmessage = (event) => {
    scope.onmessage = null;
    const message = event.data as BGADecodeStartMessage;
    void decode(scope, message).catch((error: unknown) => {
      post(scope, { type: 'error', message: error instanceof Error ? error.message : String(error) });
    });
  };
}

async function decode(scope: WorkerScope, message: BGADecodeStartMessage): Promise<void> {
  const framePort = message.framePort;
  const sendFrame = (frame: BGAFrameMessage, transfer: Transferable[] = []): void => {
    framePort?.postMessage(frame, transfer);
  };
  try {
    const { default: createFFmpegCore } = (await import(/* @vite-ignore */ message.coreURL)) as {
      default: CreateFFmpegCore;
    };
    const core = await createFFmpegCore({
      // Instantiate the module the main thread compiled instead of fetching and compiling 30 MB per worker.
      instantiateWasm(
        imports: WebAssembly.Imports,
        receive: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
      ) {
        void WebAssembly.instantiate(message.wasmModule, imports).then((instance) =>
          receive(instance, message.wasmModule),
        );
        return {};
      },
    });
    const log: string[] = [];
    core.setLogger(({ type, message: line }) => {
      if (type !== 'stderr') return;
      log.push(line);
      if (log.length > LOG_TAIL_LINES) log.shift();
    });

    let frames = 0;
    const parser = new Y4MParser({
      header: (header) => sendFrame({ type: 'header', ...header }),
      frame: (data) => {
        frames++;
        sendFrame({ type: 'frame', data: data.buffer as ArrayBuffer }, [data.buffer]);
        // Holds ffmpeg here, mid-`exec`, while the encoder is behind.
        if (message.flow) waitForEncoder(message.flow, frames);
      },
    });
    let bytes = 0;
    const { FS } = core;
    const device = FS.makedev(64, 0);
    FS.registerDevice(device, {
      open() {},
      close() {},
      read() {
        return 0;
      },
      // `buffer` is a view of the wasm heap: copy out what is needed before returning.
      write(_stream: unknown, buffer: Int8Array, offset: number, length: number) {
        const view = new Uint8Array(buffer.buffer, buffer.byteOffset + offset, length);
        bytes += length;
        if (message.mode === 'raw') {
          parser.push(view);
        } else {
          const data = view.slice();
          post(scope, { type: 'chunk', data: data.buffer }, [data.buffer]);
        }
        return length;
      },
      llseek() {
        throw new FS.ErrnoError(ESPIPE);
      },
    });
    FS.mkdev(OUTPUT_DEVICE, device);
    // WORKERFS reads the blob in slices (`FileReaderSync`) as ffmpeg asks, instead of copying the file into the heap.
    FS.mkdir(INPUT_DIRECTORY);
    FS.mount(FS.filesystems.WORKERFS, { blobs: [{ name: message.inputName, data: message.input }] }, INPUT_DIRECTORY);

    const args = buildBGAStreamArgs({
      input: `${INPUT_DIRECTORY}/${message.inputName}`,
      output: OUTPUT_DEVICE,
      mode: message.mode,
      ...(message.maxLongEdge !== undefined ? { maxLongEdge: message.maxLongEdge } : {}),
    });
    const exitCode = core.exec(...args);
    // A truncated or damaged file often decodes most of the way and then fails: what came out still plays.
    const produced = message.mode === 'raw' ? frames > 0 : bytes > 0;
    if (exitCode !== 0 && !produced) {
      post(scope, { type: 'error', message: `ffmpeg exited with code ${exitCode}`, log });
      return;
    }
    post(scope, { type: 'done', frames });
  } finally {
    sendFrame({ type: 'end' });
    framePort?.close();
  }
}

function post(scope: WorkerScope, message: BGAStreamWorkerMessage, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}

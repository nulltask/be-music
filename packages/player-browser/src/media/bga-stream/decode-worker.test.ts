import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import { runBGAVideoDecodeWorker } from './decode-worker.ts';
import { readAVCCodecString } from './ffmpeg-args.ts';
import { createFlowCounter, MAX_FRAMES_IN_FLIGHT, signalFrameTaken } from './flow.ts';
import type { BGADecodeStartMessage, BGAFrameMessage, BGAStreamWorkerMessage } from './protocol.ts';
import { concatChunks } from './stream.ts';
import { i420FrameBytes } from './y4m.ts';

// Runs the stock ffmpeg.wasm core in Node: the ESM build only knows worker scopes, so it gets a `self.location`.
const coreDir = resolve(dirname(dirname(dirname(createRequire(import.meta.url).resolve('@ffmpeg/core')))), 'dist/esm');
const fixture = readFileSync(new URL('./__fixtures__/vfr-66x50.wmv', import.meta.url));
let wasmModule: WebAssembly.Module;
const scope = globalThis as { self?: unknown; location?: unknown; FileReaderSync?: unknown };
const saved = { self: scope.self, location: scope.location, FileReaderSync: scope.FileReaderSync };

/**
 * A blob whose bytes a test can read synchronously: WORKERFS reads its source through `FileReaderSync`, which only
 * workers have, so the test installs one that reads these.
 */
class TestBlob {
  private readonly bytes: Uint8Array;
  public constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }
  public get size(): number {
    return this.bytes.byteLength;
  }
  public slice(start = 0, end = this.size): TestBlob {
    return new TestBlob(this.bytes.subarray(start, end));
  }
  public read(): ArrayBuffer {
    return this.bytes.slice().buffer;
  }
}

function testBlob(bytes: Uint8Array): TestBlob & Blob {
  // A plain copy: a Node `Buffer`'s `slice` is a view, whose `buffer` is the whole pool.
  return new TestBlob(Uint8Array.from(bytes)) as TestBlob & Blob;
}

beforeAll(async () => {
  scope.self = globalThis;
  scope.location = { href: pathToFileURL(`${coreDir}/`).href };
  scope.FileReaderSync = class {
    public readAsArrayBuffer(blob: TestBlob): ArrayBuffer {
      return blob.read();
    }
  };
  wasmModule = await WebAssembly.compile(readFileSync(resolve(coreDir, 'ffmpeg-core.wasm')));
}, 60_000);

afterAll(() => {
  scope.self = saved.self;
  scope.location = saved.location;
  scope.FileReaderSync = saved.FileReaderSync;
});

async function runDecode(
  mode: BGADecodeStartMessage['mode'],
): Promise<{ posted: BGAStreamWorkerMessage[]; frames: BGAFrameMessage[]; maxInFlight: number }> {
  const posted: BGAStreamWorkerMessage[] = [];
  // The fake encoder stays the full allowance behind; the decoder runs on it without deadlocking or running further.
  const flow = createFlowCounter();
  let received = 0;
  let maxInFlight = 0;
  const frames: BGAFrameMessage[] = [];
  let finish: () => void = () => {};
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const workerScope = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage(message: unknown) {
      posted.push(message as BGAStreamWorkerMessage);
      if ((message as BGAStreamWorkerMessage).type !== 'chunk') finish();
    },
  };
  runBGAVideoDecodeWorker(workerScope);
  const input = testBlob(fixture);
  const start: BGADecodeStartMessage = {
    type: 'start',
    coreURL: pathToFileURL(resolve(coreDir, 'ffmpeg-core.js')).href,
    wasmModule,
    input,
    inputName: 'bga-input.wmv',
    mode,
    ...(mode === 'raw'
      ? {
          flow,
          framePort: {
            postMessage: (message: BGAFrameMessage) => {
              frames.push(message);
              if (message.type !== 'frame') return;
              received++;
              maxInFlight = Math.max(maxInFlight, received - Atomics.load(flow, 0));
              if (received > MAX_FRAMES_IN_FLIGHT) signalFrameTaken(flow);
            },
            close() {},
          } as unknown as MessagePort,
        }
      : {}),
  };
  workerScope.onmessage!({ data: start } as MessageEvent);
  await finished;
  return { posted, frames, maxInFlight };
}

describe('runBGAVideoDecodeWorker', () => {
  it('streams constant-rate y4m frames to the frame port, keeping a variable-rate source in time', async () => {
    const { posted, frames, maxInFlight } = await runDecode('raw');
    expect(maxInFlight).toBe(MAX_FRAMES_IN_FLIGHT + 1);
    expect(posted.at(-1)).toEqual({ type: 'done', frames: 14 });
    expect(frames[0]).toEqual({
      type: 'header',
      width: 66,
      height: 50,
      frameRateNumerator: 10,
      frameRateDenominator: 1,
    });
    const data = frames.filter((frame) => frame.type === 'frame');
    // 0.0–0.4 s and 1.0–1.4 s at 10 fps with the half-second gap held by repeats; the `fps` filter rounds the last
    // frame (which has no duration) away. Passed through as-is, it would be 10.
    expect(data).toHaveLength(14);
    for (const frame of data) expect(frame.data.byteLength).toBe(i420FrameBytes(66, 50));
    expect(frames.at(-1)).toEqual({ type: 'end' });
  }, 60_000);

  it('streams fragmented MP4 from libx264 to the main thread', async () => {
    const { posted } = await runDecode('h264');
    expect(posted.at(-1)).toEqual({ type: 'done', frames: 0 });
    const chunks = posted.flatMap((message) => (message.type === 'chunk' ? [new Uint8Array(message.data)] : []));
    expect(chunks.length).toBeGreaterThan(1);
    const bytes = concatChunks(chunks);
    expect(new TextDecoder().decode(bytes.subarray(4, 8))).toBe('ftyp');
    expect(readAVCCodecString(bytes)).toMatch(/^avc1\.42/u);
  }, 60_000);

  it('reports a file ffmpeg cannot read', async () => {
    const posted: BGAStreamWorkerMessage[] = [];
    let finish: () => void = () => {};
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const workerScope = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      postMessage(message: unknown) {
        posted.push(message as BGAStreamWorkerMessage);
        finish();
      },
    };
    runBGAVideoDecodeWorker(workerScope);
    workerScope.onmessage!({
      data: {
        type: 'start',
        coreURL: pathToFileURL(resolve(coreDir, 'ffmpeg-core.js')).href,
        wasmModule,
        input: testBlob(new Uint8Array(64)),
        inputName: 'bga-input.wmv',
        mode: 'h264',
      } satisfies BGADecodeStartMessage,
    } as MessageEvent);
    await finished;
    expect(posted).toEqual([expect.objectContaining({ type: 'error', message: expect.stringMatching(/exited/u) })]);
  }, 60_000);
});

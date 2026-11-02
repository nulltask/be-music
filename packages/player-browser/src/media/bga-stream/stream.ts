/**
 * Main-thread side of the streaming BGA transcode: starts the workers, collects the fMP4 bytes they post, and hands
 * them to every `<video>` playing the stream (see `media-source.ts`).
 *
 * A stream keeps all of its bytes, so a video attached late — the same BGA on another track — is fed from the start,
 * and a video that seeks back finds them again. Compressed, they are a few megabytes for a typical BGA.
 */
import { logger } from '../../logger.ts';
import { FFMPEG_CORE_URL, FFMPEG_WASM_URL, readAVCCodecString, type BGAStreamOutput } from './ffmpeg-args.ts';
import { canShareFlowControl, createFlowCounter } from './flow.ts';
import type { BGADecodeStartMessage, BGAEncodeStartMessage, BGAStreamWorkerMessage } from './protocol.ts';

const log = logger('bga-video');

/** What the host's worker factories return; a DOM `Worker` fits. */
export interface BGAVideoWorker {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

/**
 * Host-bundled workers for the streaming transcode. Their entries call `runBGAVideoDecodeWorker()` and
 * `runBGAVideoEncodeWorker()` from `@be-music/player-browser/compute`.
 */
export interface BGAVideoWorkerFactories {
  createDecodeWorker(): BGAVideoWorker;
  createEncodeWorker(): BGAVideoWorker;
}

let workerFactories: BGAVideoWorkerFactories | undefined;

/**
 * Installs the workers of the streaming BGA transcode. Without them, a BGA video the browser can't play is transcoded
 * whole before it plays.
 */
export function configureBGAVideoWorkers(factories: BGAVideoWorkerFactories | undefined): void {
  workerFactories = factories;
}

/** Transcodes that run at once; later ones wait for a slot. Each decodes on a core of its own. */
const MAX_RUNNING_STREAMS = 2;
/** How far into the stream to look for the init segment's `avcC` box. */
const CODEC_SCAN_BYTES = 256 * 1024;

export type BGAVideoStreamState = 'running' | 'done' | 'failed' | 'cancelled';

export interface BGAVideoStreamOptions {
  maxLongEdge?: number;
  /**
   * Encode with WebCodecs where it can — it needs a cross-origin isolated page for the flow control (`flow.ts`) —
   * otherwise (or when it fails) the core's libx264 encodes.
   */
  useWebCodecs: boolean;
}

/**
 * One transcode in progress or finished. Subscribers are called after every change; the transcode is cancelled once
 * the last one unsubscribes.
 */
export class BGAVideoStream {
  /** The fMP4 bytes so far, in order. */
  public readonly chunks: Uint8Array[] = [];
  public state: BGAVideoStreamState = 'running';
  /** `avc1.*` codec string from the init segment, once it has arrived. */
  public codec: string | undefined;
  /** Rejects if the stream fails or is cancelled before producing any bytes; never resolves. */
  public readonly failure: Promise<never>;

  private readonly listeners = new Set<() => void>();
  private rejectFailure: (error: Error) => void = () => {};
  private stopAttempt: (() => void) | undefined;
  private chunkBytes = 0;
  private readonly source: Blob;
  private readonly path: string;
  private readonly options: BGAVideoStreamOptions;

  public constructor(source: Blob, path: string, options: BGAVideoStreamOptions) {
    this.source = source;
    this.path = path;
    this.options = options;
    this.failure = new Promise<never>((_, reject) => {
      this.rejectFailure = reject;
    });
    // Nobody may be waiting on it.
    this.failure.catch(() => {});
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      if (!this.listeners.delete(listener)) return;
      if (this.listeners.size === 0) this.cancel();
    };
  }

  public get settled(): boolean {
    return this.state !== 'running';
  }

  /** Runs the transcode; settles when it ends, however it ends. */
  public async run(): Promise<void> {
    const release = await acquireSlot();
    try {
      if (this.settled) return;
      const startedAt = performance.now();
      const assets = await loadCoreAssets();
      const modes: BGAStreamOutput[] =
        this.options.useWebCodecs && 'VideoEncoder' in globalThis && canShareFlowControl() ? ['raw', 'h264'] : ['h264'];
      for (const mode of modes) {
        if (this.settled) return;
        const result = await this.attempt(mode, assets);
        if (this.settled) return;
        if (result.ok) {
          const elapsed = ((performance.now() - startedAt) / 1000).toFixed(2);
          log.info(
            `stream transcode ok (${mode === 'raw' ? 'WebCodecs' : 'libx264'}): ${this.path} → ${this.chunkBytes} bytes` +
              `${result.frames ? `, ${result.frames} frames` : ''} in ${elapsed}s`,
          );
          return this.finish('done');
        }
        log.warn(`stream transcode (${mode}) failed: ${this.path}: ${result.message}`, result.log ?? '');
        // A failure after some output can't restart: what arrived plays, and the video stops where it ends.
        if (this.chunks.length > 0) return this.finish('done');
      }
      this.finish('failed');
    } catch (error) {
      log.warn(`stream transcode threw: ${this.path}`, error);
      this.finish(this.chunks.length > 0 ? 'done' : 'failed');
    } finally {
      release();
    }
  }

  public cancel(): void {
    if (this.settled) return;
    this.finish('cancelled');
  }

  private attempt(
    mode: BGAStreamOutput,
    assets: CoreAssets,
  ): Promise<{ ok: true; frames: number } | { ok: false; message: string; log?: string[] }> {
    const factories = workerFactories;
    if (!factories) return Promise.resolve({ ok: false, message: 'no workers configured' });
    return new Promise((resolve) => {
      const workers: BGAVideoWorker[] = [];
      let settled = false;
      const settle = (result: Parameters<typeof resolve>[0]): void => {
        if (settled) return;
        settled = true;
        this.stopAttempt = undefined;
        for (const worker of workers) worker.terminate();
        resolve(result);
      };
      this.stopAttempt = () => settle({ ok: false, message: 'cancelled' });
      try {
        const decoder = factories.createDecodeWorker();
        workers.push(decoder);
        const start: BGADecodeStartMessage = {
          type: 'start',
          coreURL: assets.coreURL,
          wasmModule: assets.wasmModule,
          // A blob crosses to the worker as a handle: its data is neither copied nor read here.
          input: this.source,
          inputName: `bga-input${pickInputExtension(this.path)}`,
          mode,
          ...(this.options.maxLongEdge !== undefined ? { maxLongEdge: this.options.maxLongEdge } : {}),
        };
        let producer = decoder;
        if (mode === 'raw') {
          const encoder = factories.createEncodeWorker();
          workers.push(encoder);
          producer = encoder;
          const channel = new MessageChannel();
          const flow = createFlowCounter();
          start.framePort = channel.port1;
          start.flow = flow;
          const encodeStart: BGAEncodeStartMessage = { type: 'start', framePort: channel.port2, flow };
          encoder.postMessage(encodeStart, [channel.port2]);
          // The decoder reports only failures here: its frames went to the encoder, which reports the output.
          decoder.onmessage = (event) => {
            const message = event.data as BGAStreamWorkerMessage;
            if (message.type === 'error') settle({ ok: false, message: message.message, log: message.log });
          };
          decoder.onerror = (event) => {
            event.preventDefault();
            // Let the encoder finish what it has (the decoder can't send `end` any more).
            encoder.postMessage({ type: 'end' });
            log.warn(`decode worker crashed: ${this.path}`, event.message);
          };
        }
        producer.onmessage = (event) => {
          const message = event.data as BGAStreamWorkerMessage;
          if (message.type === 'chunk') this.append(new Uint8Array(message.data));
          else if (message.type === 'done') settle({ ok: true, frames: message.frames });
          else settle({ ok: false, message: message.message, log: message.log });
        };
        producer.onerror = (event) => {
          event.preventDefault();
          settle({ ok: false, message: event.message || 'worker error' });
        };
        decoder.postMessage(start, start.framePort ? [start.framePort] : []);
      } catch (error) {
        settle({ ok: false, message: error instanceof Error ? error.message : String(error) });
      }
    });
  }

  private append(chunk: Uint8Array): void {
    if (this.settled || chunk.byteLength === 0) return;
    this.chunks.push(chunk);
    this.chunkBytes += chunk.byteLength;
    if (this.codec === undefined && this.chunkBytes - chunk.byteLength < CODEC_SCAN_BYTES) {
      this.codec = readAVCCodecString(concatChunks(this.chunks));
    }
    this.notify();
  }

  private finish(state: Exclude<BGAVideoStreamState, 'running'>): void {
    if (this.settled) return;
    this.state = state;
    this.stopAttempt?.();
    if (state !== 'done') {
      forgetStream(this);
      if (this.chunks.length === 0) this.rejectFailure(new Error(`BGA stream ${state}: ${this.path}`));
    }
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

/** One stream per source file and transcode settings, so the same BGA on several tracks transcodes once. */
const streams = new WeakMap<Blob, Map<string, BGAVideoStream>>();

/** Whether {@link openBGAVideoStream} can run here: the host installed its workers and the browser has MSE. */
export function canStreamBGAVideo(): boolean {
  return workerFactories !== undefined && resolveMediaSourceClass() !== undefined;
}

/**
 * The stream transcoding `source`, started on first use. Subscribe to it before awaiting anything, or a stream nobody
 * holds may be cancelled by its last other subscriber leaving.
 */
export function openBGAVideoStream(source: Blob, path: string, options: BGAVideoStreamOptions): BGAVideoStream {
  const key = `${options.maxLongEdge ?? 0}:${options.useWebCodecs ? 'webcodecs' : 'libx264'}`;
  let byOptions = streams.get(source);
  if (!byOptions) {
    byOptions = new Map();
    streams.set(source, byOptions);
  }
  const existing = byOptions.get(key);
  if (existing) return existing;
  const stream = new BGAVideoStream(source, path, options);
  byOptions.set(key, stream);
  streamKeys.set(stream, { source, key });
  void stream.run();
  return stream;
}

const streamKeys = new WeakMap<BGAVideoStream, { source: Blob; key: string }>();

function forgetStream(stream: BGAVideoStream): void {
  const entry = streamKeys.get(stream);
  if (!entry) return;
  const byOptions = streams.get(entry.source);
  if (byOptions?.get(entry.key) === stream) byOptions.delete(entry.key);
}

/** `ManagedMediaSource` where the browser has it (iPhone Safari has nothing else), else `MediaSource`. */
export function resolveMediaSourceClass(): typeof MediaSource | undefined {
  const scope = globalThis as { ManagedMediaSource?: typeof MediaSource; MediaSource?: typeof MediaSource };
  return scope.ManagedMediaSource ?? scope.MediaSource;
}

let running = 0;
const waiting: (() => void)[] = [];

function acquireSlot(): Promise<() => void> {
  return new Promise((resolve) => {
    const grant = (): void => {
      running++;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        running--;
        waiting.shift()?.();
      });
    };
    if (running < MAX_RUNNING_STREAMS) grant();
    else waiting.push(grant);
  });
}

interface CoreAssets {
  coreURL: string;
  wasmModule: WebAssembly.Module;
}

let coreAssets: Promise<CoreAssets> | undefined;

/** The core script as a blob URL (module workers import it) and its wasm compiled once for every worker. */
function loadCoreAssets(): Promise<CoreAssets> {
  coreAssets ??= (async () => {
    const [script, wasmModule] = await Promise.all([fetchOK(FFMPEG_CORE_URL).then((res) => res.blob()), compileWasm()]);
    const coreURL = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
    return { coreURL, wasmModule };
  })().catch((error: unknown) => {
    // A network blip shouldn't disable streaming for the rest of the session.
    coreAssets = undefined;
    throw error;
  });
  return coreAssets;
}

async function compileWasm(): Promise<WebAssembly.Module> {
  try {
    return await WebAssembly.compileStreaming(fetchOK(FFMPEG_WASM_URL));
  } catch {
    // `compileStreaming` needs an `application/wasm` response; some hosts send another type.
    return WebAssembly.compile(await (await fetchOK(FFMPEG_WASM_URL)).arrayBuffer());
  }
}

async function fetchOK(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`failed to fetch ${url}: ${response.status}`);
  return response;
}

export function concatChunks(chunks: readonly Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0]!;
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Keeps the source's extension so ffmpeg picks the right demuxer (`.mpg` → mpegps, `.avi` → avi, `.wmv` → asf, …),
 * from a short allowlist so no user-controlled string reaches the virtual file system.
 */
export function pickInputExtension(path: string): string {
  const lower = path.toLowerCase();
  const dotIndex = lower.lastIndexOf('.');
  if (dotIndex < 0) return '.mpg';
  const ext = lower.slice(dotIndex);
  if (['.mpg', '.mpeg', '.avi', '.wmv', '.mov', '.mp4', '.webm', '.mkv', '.ogv', '.ogg'].includes(ext)) {
    return ext;
  }
  return '.mpg';
}

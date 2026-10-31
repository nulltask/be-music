/**
 * Encode side of the streaming BGA transcode. Runs in a module worker the host bundles (see
 * {@link configureBGAVideoWorkers}); call {@link runBGAVideoEncodeWorker} from its entry.
 *
 * Takes the decode worker's I420 frames, encodes them to H.264 with WebCodecs (hardware first where the platform has
 * an encoder) and muxes them into fragmented MP4 with Mediabunny, posting the bytes to the main thread as each
 * fragment closes.
 */
import type { Output, VideoSampleSource, VideoSample as VideoSampleClass } from 'mediabunny';
import { signalFrameTaken } from './flow.ts';
import type { BGAEncodeStartMessage, BGAFrameMessage, BGAStreamWorkerMessage } from './protocol.ts';
import type { Y4MHeader } from './y4m.ts';

interface WorkerScope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

/** Short fragments start playback sooner; MSE takes them as they come. */
const FRAGMENT_SECONDS = 0.5;

export function runBGAVideoEncodeWorker(scope: WorkerScope = globalThis as unknown as WorkerScope): void {
  scope.onmessage = (event) => {
    const message = event.data as BGAEncodeStartMessage | BGAFrameMessage;
    // The main thread sends `end` itself when the decode worker dies without saying so.
    if (message.type === 'end') {
      encoder?.end();
      return;
    }
    if (message.type !== 'start' || encoder) return;
    encoder = new FrameEncoder(scope, message.flow);
    message.framePort.onmessage = (frameEvent) => encoder!.receive(frameEvent.data as BGAFrameMessage);
  };
  let encoder: FrameEncoder | undefined;
}

class FrameEncoder {
  private readonly scope: WorkerScope;
  /** Settles once the output is ready; every later step chains on it, so frames are added in order. */
  private chain: Promise<void> = Promise.resolve();
  private header: Y4MHeader | undefined;
  private output: Output | undefined;
  private source: VideoSampleSource | undefined;
  private VideoSample: typeof VideoSampleClass | undefined;
  private frameIndex = 0;
  private encoded = 0;
  private ended = false;
  private failed = false;
  private readonly flow: Int32Array<SharedArrayBuffer>;

  public constructor(scope: WorkerScope, flow: Int32Array<SharedArrayBuffer>) {
    this.scope = scope;
    this.flow = flow;
  }

  public receive(message: BGAFrameMessage): void {
    if (this.failed) return;
    switch (message.type) {
      case 'header':
        this.header = message;
        this.chain = this.start(message).catch((error: unknown) => this.fail(error));
        return;
      case 'frame':
        this.addFrame(message.data);
        return;
      case 'end':
        this.end();
        return;
    }
  }

  public end(): void {
    if (this.ended || this.failed) return;
    this.ended = true;
    this.chain = this.chain
      .then(async () => {
        if (this.failed) return;
        if (!this.output || this.encoded === 0) throw new Error('no frames to encode');
        await this.output.finalize();
        this.post({ type: 'done', frames: this.encoded });
      })
      .catch((error: unknown) => this.fail(error));
  }

  private async start(header: Y4MHeader): Promise<void> {
    const mediabunny = await import('mediabunny');
    const { width, height } = header;
    const frameRate = header.frameRateNumerator / header.frameRateDenominator;
    const quality = new mediabunny.Quality({ bitrate: estimateBitrate(width, height, frameRate) });
    const encodable = await mediabunny.canEncodeVideo('avc', {
      width,
      height,
      quality,
      frameRate,
      hardwareAcceleration: 'prefer-hardware',
    });
    if (!encodable) throw new Error(`WebCodecs can't encode H.264 at ${width}x${height}`);
    const output = new mediabunny.Output({
      format: new mediabunny.Mp4OutputFormat({ fastStart: 'fragmented', minimumFragmentDuration: FRAGMENT_SECONDS }),
      target: new mediabunny.AppendOnlyStreamTarget(
        new WritableStream<Uint8Array>({
          write: (chunk) => {
            // The target may reuse its buffer: post a copy.
            const data = chunk.slice();
            this.post({ type: 'chunk', data: data.buffer }, [data.buffer]);
          },
        }),
      ),
    });
    const source = new mediabunny.VideoSampleSource({
      codec: 'avc',
      quality,
      // A key frame a second bounds how far back a seek has to decode.
      keyFrameInterval: 1,
      hardwareAcceleration: 'prefer-hardware',
    });
    output.addVideoTrack(source, { frameRate });
    await output.start();
    this.output = output;
    this.source = source;
    this.VideoSample = mediabunny.VideoSample;
  }

  private addFrame(data: ArrayBuffer): void {
    const header = this.header;
    if (!header || this.ended) return;
    const index = this.frameIndex++;
    const frameSeconds = header.frameRateDenominator / header.frameRateNumerator;
    this.chain = this.chain
      .then(async () => {
        if (this.failed || !this.source || !this.VideoSample) return;
        const sample = new this.VideoSample(new Uint8Array(data), {
          format: 'I420',
          codedWidth: header.width,
          codedHeight: header.height,
          timestamp: index * frameSeconds,
          duration: frameSeconds,
        });
        try {
          await this.source.add(sample);
          this.encoded++;
        } finally {
          sample.close();
        }
      })
      .catch((error: unknown) => this.fail(error))
      // Taken once the encoder has it (or has failed, when the main thread stops the decoder anyway).
      .finally(() => signalFrameTaken(this.flow));
  }

  private fail(error: unknown): void {
    if (this.failed) return;
    this.failed = true;
    this.post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    void this.output?.cancel().catch(() => {});
  }

  private post(message: BGAStreamWorkerMessage, transfer: Transferable[] = []): void {
    this.scope.postMessage(message, transfer);
  }
}

/**
 * Bitrate for the H.264 encoder: about what libx264 `-crf 30 -preset ultrafast` spends (0.08 bits per pixel, ~4 Mb/s
 * at 1080p30, ~1 Mb/s at 480p30), and at least 500 kb/s for the tiny 256-px BGA.
 */
export function estimateBitrate(width: number, height: number, frameRate: number): number {
  return Math.max(500_000, Math.round(width * height * frameRate * 0.08));
}

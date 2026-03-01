import { setTimeout as delay } from 'node:timers/promises';

export type AudioBackendName = 'auto' | 'speaker' | 'audify' | 'audio-io';
export type ResolvedAudioBackendName = Exclude<AudioBackendName, 'auto'>;

export interface AudioOutputBackend {
  backend: ResolvedAudioBackendName;
  write: (chunk: Uint8Array) => boolean;
  waitWritable: (shouldStop: () => boolean) => Promise<void>;
  end: () => Promise<void>;
  destroy: () => void;
  onError: (listener: () => void) => void;
}

export interface AudioBackendCreateOptions {
  sampleRate: number;
  channels: number;
  samplesPerFrame: number;
  mode: 'auto' | 'manual';
}

interface AudioOutputBackendCandidate {
  name: ResolvedAudioBackendName;
  create: (options: AudioBackendCreateOptions) => Promise<AudioOutputBackend | undefined>;
}

type SpeakerInstance = NodeJS.WritableStream & {
  write: (chunk: Uint8Array) => boolean;
  end: (callback?: () => void) => void;
  once: (event: string, listener: (...args: unknown[]) => void) => SpeakerInstance;
  off: (event: string, listener: (...args: unknown[]) => void) => SpeakerInstance;
  on: (event: string, listener: (...args: unknown[]) => void) => SpeakerInstance;
  destroy?: () => void;
};

type SpeakerConstructor = new (options: {
  channels: number;
  bitDepth: number;
  sampleRate: number;
  signed: boolean;
  float: boolean;
  samplesPerFrame: number;
}) => SpeakerInstance;

interface AudifyRtAudioStreamParameters {
  deviceId?: number;
  nChannels: number;
  firstChannel?: number;
}

interface AudifyRtAudio {
  openStream: (
    outputParameters: AudifyRtAudioStreamParameters | null,
    inputParameters: AudifyRtAudioStreamParameters | null,
    format: number,
    sampleRate: number,
    frameSize: number,
    streamName: string,
    inputCallback: ((inputData: Buffer) => void) | null,
    frameOutputCallback: (() => void) | null,
    flags?: number,
    errorCallback?: ((type: number, message: string) => void) | null,
  ) => number;
  closeStream: () => void;
  isStreamOpen: () => boolean;
  start: () => void;
  stop: () => void;
  isStreamRunning: () => boolean;
  write: (pcm: Buffer) => void;
  clearOutputQueue: () => void;
  getDefaultOutputDevice: () => number;
  setInputCallback?: (callback: ((inputData: Buffer) => void) | null) => void;
  setFrameOutputCallback?: (callback: (() => void) | null) => void;
}

interface AudifyModule {
  RtAudio: new () => AudifyRtAudio;
  RtAudioFormat: {
    RTAUDIO_SINT16: number;
  };
  RtAudioStreamFlags?: {
    RTAUDIO_MINIMIZE_LATENCY?: number;
  };
}

interface AudioIoOutput {
  dispose: () => Promise<void>;
}

interface AudioIoModule {
  createAudioOutput: (
    config: { sampleRate: number; channelCount: number; bufferDuration?: number },
    handler: (outputBuffer: Int16Array) => void,
  ) => Promise<AudioIoOutput>;
  isPlatformSupported?: () => boolean;
}

interface QueuedPcmChunk {
  samples: Int16Array;
  offset: number;
}

const AUTO_BACKEND_ORDER: ResolvedAudioBackendName[] = ['audio-io', 'speaker', 'audify'];
const AUDIO_IO_MANUAL_HIGH_WATER_MS = 48;
const AUDIO_IO_MANUAL_LOW_WATER_MS = 30;
const AUDIO_IO_AUTO_HIGH_WATER_MS = AUDIO_IO_MANUAL_HIGH_WATER_MS;
const AUDIO_IO_AUTO_LOW_WATER_MS = AUDIO_IO_MANUAL_LOW_WATER_MS;
const AUDIFY_HIGH_WATER_MS = 140;
const AUDIFY_LOW_WATER_MS = 70;

const BACKEND_CANDIDATES: AudioOutputBackendCandidate[] = [
  { name: 'audio-io', create: tryCreateAudioIoBackend },
  { name: 'audify', create: tryCreateAudifyBackend },
  { name: 'speaker', create: tryCreateSpeakerBackend },
];

export function isAudioBackendName(value: string): value is AudioBackendName {
  return value === 'auto' || value === 'speaker' || value === 'audify' || value === 'audio-io';
}

export function createAudioBackendResolutionOrder(requested: AudioBackendName): ResolvedAudioBackendName[] {
  if (requested === 'auto') {
    return [...AUTO_BACKEND_ORDER];
  }
  return [requested];
}

export async function createAudioOutputBackend(
  requested: AudioBackendName,
  options: AudioBackendCreateOptions,
): Promise<AudioOutputBackend | undefined> {
  const order = createAudioBackendResolutionOrder(requested);
  for (const name of order) {
    const candidate = BACKEND_CANDIDATES.find((entry) => entry.name === name);
    if (!candidate) {
      continue;
    }
    const backend = await candidate.create(options);
    if (backend) {
      return backend;
    }
  }
  return undefined;
}

async function tryCreateSpeakerBackend(options: AudioBackendCreateOptions): Promise<AudioOutputBackend | undefined> {
  const Speaker = await loadSpeakerConstructor();
  if (!Speaker) {
    return undefined;
  }

  let speaker: SpeakerInstance;
  try {
    speaker = new Speaker({
      channels: options.channels,
      bitDepth: 16,
      sampleRate: options.sampleRate,
      signed: true,
      float: false,
      samplesPerFrame: options.samplesPerFrame,
    });
  } catch {
    return undefined;
  }

  return {
    backend: 'speaker',
    write: (chunk: Uint8Array) => speaker.write(Buffer.from(chunk)),
    waitWritable: (shouldStop: () => boolean) => waitSpeakerWritable(speaker, shouldStop),
    end: () =>
      new Promise<void>((resolvePromise) => {
        speaker.end(() => resolvePromise());
      }),
    destroy: () => {
      try {
        speaker.destroy?.();
      } catch {
        // noop
      }
    },
    onError: (listener: () => void) => {
      speaker.on('error', listener);
    },
  };
}

async function tryCreateAudifyBackend(options: AudioBackendCreateOptions): Promise<AudioOutputBackend | undefined> {
  const module = await loadAudifyModule();
  if (!module) {
    return undefined;
  }

  let rtAudio: AudifyRtAudio;
  try {
    rtAudio = new module.RtAudio();
  } catch {
    return undefined;
  }

  const requestedFrameSize = Math.max(16, options.samplesPerFrame);
  let streamFrameSize = requestedFrameSize;
  const errorListeners = new Set<() => void>();

  try {
    const openedFrameSize = rtAudio.openStream(
      {
        deviceId: rtAudio.getDefaultOutputDevice(),
        nChannels: options.channels,
        firstChannel: 0,
      },
      null,
      module.RtAudioFormat.RTAUDIO_SINT16,
      options.sampleRate,
      requestedFrameSize,
      'be-music-player',
      null,
      null,
      0,
      () => {
        for (const listener of errorListeners) {
          listener();
        }
      },
    );
    if (Number.isFinite(openedFrameSize) && openedFrameSize > 0) {
      streamFrameSize = Math.round(openedFrameSize);
    }
    rtAudio.start();
  } catch {
    try {
      if (rtAudio.isStreamRunning()) {
        rtAudio.stop();
      }
    } catch {
      // noop
    }
    try {
      if (rtAudio.isStreamOpen()) {
        rtAudio.closeStream();
      }
    } catch {
      // noop
    }
    return undefined;
  }

  const highWaterTargetMs = AUDIFY_HIGH_WATER_MS;
  const lowWaterTargetMs = AUDIFY_LOW_WATER_MS;
  const highWaterFrames = Math.max(256, Math.ceil((options.sampleRate * highWaterTargetMs) / 1000));
  const lowWaterFrames = Math.max(
    128,
    Math.min(highWaterFrames - 1, Math.ceil((options.sampleRate * lowWaterTargetMs) / 1000)),
  );

  let closed = false;
  let pending = Buffer.alloc(0);
  const frameBytes = Math.max(1, streamFrameSize * options.channels * 2);

  // frameOutputCallback を使わず、経過時間から概算キュー長を更新する。
  let queuedFramesEstimate = 0;
  let lastQueueUpdateMs = performance.now();

  const updateQueuedFramesEstimate = (): void => {
    const nowMs = performance.now();
    const elapsedSeconds = Math.max(0, (nowMs - lastQueueUpdateMs) / 1000);
    lastQueueUpdateMs = nowMs;
    const consumedFrames = elapsedSeconds * options.sampleRate;
    queuedFramesEstimate = Math.max(0, queuedFramesEstimate - consumedFrames);
  };

  const closeStream = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    try {
      rtAudio.setFrameOutputCallback?.(null);
    } catch {
      // noop
    }
    try {
      rtAudio.setInputCallback?.(null);
    } catch {
      // noop
    }
    try {
      rtAudio.clearOutputQueue();
    } catch {
      // noop
    }
    try {
      if (rtAudio.isStreamRunning()) {
        rtAudio.stop();
      }
    } catch {
      // noop
    }
    try {
      if (rtAudio.isStreamOpen()) {
        rtAudio.closeStream();
      }
    } catch {
      // noop
    }
  };

  const flushPendingFrames = (): { writtenFrames: number; blocked: boolean } => {
    if (closed || pending.length < frameBytes) {
      return { writtenFrames: 0, blocked: false };
    }

    let writtenFrames = 0;
    while (!closed && pending.length >= frameBytes) {
      const frame = pending.subarray(0, frameBytes);
      try {
        rtAudio.write(frame);
      } catch {
        for (const listener of errorListeners) {
          listener();
        }
        return { writtenFrames, blocked: true };
      }
      pending = pending.subarray(frameBytes);
      writtenFrames += streamFrameSize;
    }

    return { writtenFrames, blocked: false };
  };

  return {
    backend: 'audify',
    write: (chunk: Uint8Array) => {
      if (closed || chunk.byteLength <= 0) {
        return true;
      }

      updateQueuedFramesEstimate();
      const incoming = Buffer.from(chunk);
      pending = pending.length === 0 ? incoming : Buffer.concat([pending, incoming]);
      const { writtenFrames, blocked } = flushPendingFrames();
      queuedFramesEstimate += writtenFrames;
      if (blocked) {
        return false;
      }
      return queuedFramesEstimate <= highWaterFrames;
    },
    waitWritable: async (shouldStop: () => boolean) => {
      while (!shouldStop() && !closed && (queuedFramesEstimate > lowWaterFrames || pending.length >= frameBytes * 24)) {
        updateQueuedFramesEstimate();
        const { writtenFrames } = flushPendingFrames();
        queuedFramesEstimate += writtenFrames;
        await delay(1);
      }
    },
    end: async () => {
      if (closed) {
        return;
      }

      const remainder = pending.length % frameBytes;
      if (remainder !== 0) {
        pending = Buffer.concat([pending, Buffer.alloc(frameBytes - remainder)]);
      }

      const timeoutAt = performance.now() + 5_000;
      while (!closed && (queuedFramesEstimate > 0 || pending.length >= frameBytes) && performance.now() < timeoutAt) {
        updateQueuedFramesEstimate();
        const { writtenFrames } = flushPendingFrames();
        queuedFramesEstimate += writtenFrames;
        await delay(1);
      }

      closeStream();
    },
    destroy: () => {
      if (closed) {
        return;
      }
      pending = Buffer.alloc(0);
      closeStream();
    },
    onError: (listener: () => void) => {
      errorListeners.add(listener);
    },
  };
}

async function tryCreateAudioIoBackend(options: AudioBackendCreateOptions): Promise<AudioOutputBackend | undefined> {
  const module = await loadAudioIoModule();
  if (!module) {
    return undefined;
  }
  if (typeof module.isPlatformSupported === 'function' && !module.isPlatformSupported()) {
    return undefined;
  }

  const { highWaterSamples, lowWaterSamples } = resolveAudioIoQueueThresholds(options);
  const queue: QueuedPcmChunk[] = [];
  const lastOutputSamples = new Int16Array(Math.max(1, options.channels));

  let queuedSamples = 0;
  let closing = false;
  let closed = false;
  let output: AudioIoOutput | undefined;
  let waitDisposeResolve: (() => void) | undefined;
  const waitDispose = new Promise<void>((resolve) => {
    waitDisposeResolve = resolve;
  });
  const minimumSilentCallbacksBeforeDispose = 2;
  let silentCallbacksAfterDrain = 0;

  const completeDispose = (): void => {
    waitDisposeResolve?.();
  };

  const requestDispose = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    const activeOutput = output;
    if (!activeOutput) {
      completeDispose();
      return;
    }
    void activeOutput
      .dispose()
      .catch(() => undefined)
      .finally(() => {
        completeDispose();
      });
  };

  const flushOrZeroFill = (outputBuffer: Int16Array): void => {
    let written = 0;
    while (written < outputBuffer.length && queue.length > 0) {
      const head = queue[0];
      const available = head.samples.length - head.offset;
      if (available <= 0) {
        queue.shift();
        continue;
      }
      const size = Math.min(outputBuffer.length - written, available);
      outputBuffer.set(head.samples.subarray(head.offset, head.offset + size), written);
      if (size >= options.channels) {
        const lastFrameOffset = head.offset + size - options.channels;
        for (let channel = 0; channel < options.channels; channel += 1) {
          lastOutputSamples[channel] = head.samples[lastFrameOffset + channel] ?? 0;
        }
      }
      head.offset += size;
      written += size;
      queuedSamples -= size;
      if (head.offset >= head.samples.length) {
        queue.shift();
      }
    }
    if (written < outputBuffer.length) {
      // Underflow can cause an abrupt step to 0 and produce a click.
      // Smoothly ramp the last output sample to silence within this callback block.
      const remaining = outputBuffer.length - written;
      const frameCount = Math.max(1, Math.floor(remaining / options.channels));
      for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
        const progress = (frameIndex + 1) / frameCount;
        const gain = Math.max(0, 1 - progress);
        const offset = written + frameIndex * options.channels;
        for (let channel = 0; channel < options.channels; channel += 1) {
          outputBuffer[offset + channel] = Math.round(lastOutputSamples[channel] * gain);
        }
      }

      const tailStart = written + frameCount * options.channels;
      if (tailStart < outputBuffer.length) {
        outputBuffer.fill(0, tailStart);
      }
      lastOutputSamples.fill(0);
    }

    if (!closing || queuedSamples > 0 || closed) {
      if (queuedSamples > 0) {
        silentCallbacksAfterDrain = 0;
      }
      return;
    }

    if (written > 0) {
      silentCallbacksAfterDrain = 0;
      return;
    }

    silentCallbacksAfterDrain += 1;
    if (silentCallbacksAfterDrain >= minimumSilentCallbacksBeforeDispose) {
      requestDispose();
    }
  };

  try {
    output = await module.createAudioOutput(
      {
        sampleRate: options.sampleRate,
        channelCount: options.channels,
        bufferDuration: 30,
      },
      (outputBuffer: Int16Array) => {
        flushOrZeroFill(outputBuffer);
      },
    );
  } catch {
    return undefined;
  }

  return {
    backend: 'audio-io',
    write: (chunk: Uint8Array) => {
      if (closed || closing) {
        return true;
      }

      const alignedLength = chunk.byteLength - (chunk.byteLength % 2);
      if (alignedLength <= 0) {
        return true;
      }

      const copied = new Uint8Array(alignedLength);
      copied.set(chunk.subarray(0, alignedLength));
      const samples = new Int16Array(copied.buffer);
      queue.push({
        samples,
        offset: 0,
      });
      queuedSamples += samples.length;
      return queuedSamples <= highWaterSamples;
    },
    waitWritable: async (shouldStop: () => boolean) => {
      while (!shouldStop() && !closed && queuedSamples > lowWaterSamples) {
        await delay(1);
      }
    },
    end: async () => {
      if (closed) {
        return;
      }
      closing = true;

      // バッファが空でもデバイス側に残っている可能性があるため、
      // コールバック側で数回のサイレントバッファを経てから dispose する。
      const forcedDisposeTask = delay(300).then(() => {
        if (!closed) {
          requestDispose();
        }
      });

      await Promise.race([waitDispose, forcedDisposeTask.then(() => waitDispose)]);
    },
    destroy: () => {
      if (closed) {
        return;
      }
      closing = true;
      queue.length = 0;
      queuedSamples = 0;
      requestDispose();
    },
    onError: (_listener: () => void) => {
      // audio-io はコールバックエラーを直接通知しないため現状は no-op。
    },
  };
}

function resolveAudioIoQueueThresholds(options: AudioBackendCreateOptions): {
  highWaterSamples: number;
  lowWaterSamples: number;
} {
  const chunkSampleCount = Math.max(1, options.samplesPerFrame * options.channels);
  const samplesPerSecond = Math.max(1, options.sampleRate * options.channels);
  const highWaterTargetMs = options.mode === 'manual' ? AUDIO_IO_MANUAL_HIGH_WATER_MS : AUDIO_IO_AUTO_HIGH_WATER_MS;
  const lowWaterTargetMs = options.mode === 'manual' ? AUDIO_IO_MANUAL_LOW_WATER_MS : AUDIO_IO_AUTO_LOW_WATER_MS;
  const highWaterByTime = Math.ceil((samplesPerSecond * highWaterTargetMs) / 1000);
  const lowWaterByTime = Math.ceil((samplesPerSecond * lowWaterTargetMs) / 1000);
  const highWaterSamples = Math.max(chunkSampleCount * 6, highWaterByTime);
  const lowWaterSamples = Math.max(chunkSampleCount * 2, Math.min(highWaterSamples - chunkSampleCount, lowWaterByTime));
  return { highWaterSamples, lowWaterSamples };
}

async function loadSpeakerConstructor(): Promise<SpeakerConstructor | undefined> {
  try {
    const imported = await import('speaker');
    const candidate = (imported as { default?: unknown }).default ?? imported;
    if (typeof candidate !== 'function') {
      return undefined;
    }
    return candidate as SpeakerConstructor;
  } catch {
    return undefined;
  }
}

async function loadAudifyModule(): Promise<AudifyModule | undefined> {
  try {
    const imported = await import('audify');
    const candidate = (imported as { default?: unknown }).default ?? imported;
    const module = candidate as AudifyModule;
    if (typeof module.RtAudio !== 'function') {
      return undefined;
    }
    if (typeof module.RtAudioFormat?.RTAUDIO_SINT16 !== 'number') {
      return undefined;
    }
    return module;
  } catch {
    return undefined;
  }
}

async function loadAudioIoModule(): Promise<AudioIoModule | undefined> {
  try {
    const imported = await import('@echogarden/audio-io');
    const module = imported as unknown as AudioIoModule;
    if (typeof module.createAudioOutput !== 'function') {
      return undefined;
    }
    return module;
  } catch {
    return undefined;
  }
}

async function waitSpeakerWritable(speaker: SpeakerInstance, shouldStop: () => boolean): Promise<void> {
  while (!shouldStop()) {
    const signaled = await new Promise<boolean>((resolvePromise) => {
      let settled = false;

      const cleanup = (): void => {
        speaker.off('drain', onSignal);
        speaker.off('close', onSignal);
        speaker.off('error', onSignal);
      };

      const settle = (value: boolean): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolvePromise(value);
      };

      const onSignal = (): void => {
        settle(true);
      };

      speaker.once('drain', onSignal);
      speaker.once('close', onSignal);
      speaker.once('error', onSignal);

      void delay(8).then(() => {
        settle(false);
      });
    });

    if (signaled) {
      return;
    }
  }
}

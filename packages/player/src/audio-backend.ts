import { setTimeout as delay } from 'node:timers/promises';

export type AudioBackendName = 'auto' | 'speaker' | 'audify' | 'webaudio';
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
  tuning?: AudioBackendTuning;
}

export interface AudioBackendTuning {
  audifyHighWaterMs?: number;
  audifyLowWaterMs?: number;
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

interface NodeWebAudioAudioBuffer {
  getChannelData: (channel: number) => Float32Array;
}

interface NodeWebAudioAudioBufferSourceNode {
  buffer: NodeWebAudioAudioBuffer | null;
  connect: (destination: unknown) => unknown;
  start: (when?: number) => void;
}

interface NodeWebAudioAudioContext {
  readonly currentTime: number;
  readonly destination: unknown;
  createBuffer: (numberOfChannels: number, length: number, sampleRate: number) => NodeWebAudioAudioBuffer;
  createBufferSource: () => NodeWebAudioAudioBufferSourceNode;
  close?: () => Promise<void>;
}

type NodeWebAudioAudioContextConstructor = new (options?: { sampleRate?: number }) => NodeWebAudioAudioContext;

const AUTO_BACKEND_ORDER: ResolvedAudioBackendName[] = ['webaudio', 'speaker', 'audify'];
const AUDIFY_HIGH_WATER_MS = 48;
const AUDIFY_LOW_WATER_MS = 24;
const WEBAUDIO_HIGH_WATER_MS = 64;
const WEBAUDIO_LOW_WATER_MS = 32;

const BACKEND_CANDIDATES: AudioOutputBackendCandidate[] = [
  { name: 'audify', create: tryCreateAudifyBackend },
  { name: 'webaudio', create: tryCreateWebAudioBackend },
  { name: 'speaker', create: tryCreateSpeakerBackend },
];

export function isAudioBackendName(value: string): value is AudioBackendName {
  return value === 'auto' || value === 'speaker' || value === 'audify' || value === 'webaudio';
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

async function tryCreateWebAudioBackend(options: AudioBackendCreateOptions): Promise<AudioOutputBackend | undefined> {
  const AudioContext = await loadNodeWebAudioContextConstructor();
  if (!AudioContext) {
    return undefined;
  }

  let context: NodeWebAudioAudioContext;
  try {
    context = new AudioContext({
      sampleRate: options.sampleRate,
    });
  } catch {
    try {
      context = new AudioContext();
    } catch {
      return undefined;
    }
  }

  const errorListeners = new Set<() => void>();
  const highWaterFrames = Math.max(256, Math.ceil((options.sampleRate * WEBAUDIO_HIGH_WATER_MS) / 1000));
  const lowWaterFrames = Math.max(
    128,
    Math.min(highWaterFrames - 1, Math.ceil((options.sampleRate * WEBAUDIO_LOW_WATER_MS) / 1000)),
  );

  let closed = false;
  let scheduledUntilSeconds = Math.max(0, context.currentTime);

  const emitError = (): void => {
    for (const listener of errorListeners) {
      listener();
    }
  };

  const queuedFrames = (): number => {
    if (closed) {
      return 0;
    }
    const now = Math.max(0, context.currentTime);
    return Math.max(0, Math.ceil((scheduledUntilSeconds - now) * options.sampleRate));
  };

  const closeContext = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    try {
      await context.close?.();
    } catch {
      // noop
    }
  };

  return {
    backend: 'webaudio',
    write: (chunk: Uint8Array) => {
      if (closed || chunk.byteLength <= 0) {
        return true;
      }

      const channels = Math.max(1, options.channels);
      const bytesPerFrame = channels * 2;
      if (chunk.byteLength < bytesPerFrame) {
        return true;
      }
      const frameCount = Math.floor(chunk.byteLength / bytesPerFrame);
      if (frameCount <= 0) {
        return true;
      }

      try {
        const pcm = new Int16Array(chunk.buffer, chunk.byteOffset, frameCount * channels);
        const buffer = context.createBuffer(channels, frameCount, options.sampleRate);
        for (let channel = 0; channel < channels; channel += 1) {
          const channelData = buffer.getChannelData(channel);
          let pcmIndex = channel;
          for (let frame = 0; frame < frameCount; frame += 1) {
            channelData[frame] = pcm[pcmIndex]! / 32768;
            pcmIndex += channels;
          }
        }

        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        const now = Math.max(0, context.currentTime);
        const startAt = Math.max(now, scheduledUntilSeconds);
        source.start(startAt);
        scheduledUntilSeconds = startAt + frameCount / options.sampleRate;
      } catch {
        emitError();
        return false;
      }

      return queuedFrames() <= highWaterFrames;
    },
    waitWritable: async (shouldStop: () => boolean) => {
      while (!shouldStop() && !closed && queuedFrames() > lowWaterFrames) {
        await delay(1);
      }
    },
    end: async () => {
      if (closed) {
        return;
      }
      const timeoutAt = performance.now() + 5_000;
      while (!closed && queuedFrames() > 0 && performance.now() < timeoutAt) {
        await delay(1);
      }
      await closeContext();
    },
    destroy: () => {
      void closeContext();
    },
    onError: (listener: () => void) => {
      errorListeners.add(listener);
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

  const highWaterTargetMs = resolvePositiveMs(options.tuning?.audifyHighWaterMs, AUDIFY_HIGH_WATER_MS);
  const lowWaterTargetMs = resolveLowWaterMs(options.tuning?.audifyLowWaterMs, highWaterTargetMs, AUDIFY_LOW_WATER_MS);
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

function resolvePositiveMs(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function resolveLowWaterMs(value: number | undefined, highWaterMs: number, fallback: number): number {
  const candidate = resolvePositiveMs(value, fallback);
  return Math.max(1, Math.min(highWaterMs, candidate));
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

async function loadNodeWebAudioContextConstructor(): Promise<NodeWebAudioAudioContextConstructor | undefined> {
  try {
    const imported = await import('node-web-audio-api');
    const candidate =
      (imported as { AudioContext?: unknown }).AudioContext ??
      (imported as { default?: { AudioContext?: unknown } }).default?.AudioContext ??
      (imported as { default?: unknown }).default;
    if (typeof candidate !== 'function') {
      return undefined;
    }
    return candidate as NodeWebAudioAudioContextConstructor;
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

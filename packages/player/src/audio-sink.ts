import { setTimeout as delay } from 'node:timers/promises';

export type AudioRuntime = 'node' | 'browser';
export type AudioEngine = 'webaudio';

export interface AudioSink {
  runtime: AudioRuntime;
  engine: AudioEngine;
  label: string;
  write: (chunk: Uint8Array) => boolean;
  waitWritable: (shouldStop: () => boolean) => Promise<void>;
  end: () => Promise<void>;
  destroy: () => void;
  onError: (listener: () => void) => void;
}

export interface AudioSinkCreateOptions {
  sampleRate: number;
  channels: number;
  samplesPerFrame: number;
  mode: 'auto' | 'manual';
}

export interface WebAudioBufferLike {
  getChannelData: (channel: number) => Float32Array;
}

export interface WebAudioBufferSourceLike {
  buffer: WebAudioBufferLike | null;
  connect: (destination: unknown) => unknown;
  start: (when?: number) => void;
}

export interface WebAudioContextLike {
  readonly currentTime: number;
  readonly destination: unknown;
  createBuffer: (numberOfChannels: number, length: number, sampleRate: number) => WebAudioBufferLike;
  createBufferSource: () => WebAudioBufferSourceLike;
  close?: () => Promise<void>;
}

interface NodeWebAudioModule {
  AudioContext?: unknown;
  default?: {
    AudioContext?: unknown;
  };
}

interface NodeWebAudioContextConstructor {
  new (options?: { sampleRate?: number }): WebAudioContextLike;
}

const WEBAUDIO_HIGH_WATER_MS = 64;
const WEBAUDIO_LOW_WATER_MS = 32;

export function createBrowserAudioSink(context: WebAudioContextLike, options: AudioSinkCreateOptions): AudioSink {
  return createWebAudioSink('browser', context, options);
}

export async function createNodeAudioSink(options: AudioSinkCreateOptions): Promise<AudioSink | undefined> {
  const AudioContext = await loadNodeWebAudioContextConstructor();
  if (!AudioContext) {
    return undefined;
  }

  let context: WebAudioContextLike;
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

  return createWebAudioSink('node', context, options);
}

function createWebAudioSink(
  runtime: AudioRuntime,
  context: WebAudioContextLike,
  options: AudioSinkCreateOptions,
): AudioSink {
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
    runtime,
    engine: 'webaudio',
    label: runtime === 'node' ? 'node-webaudio' : 'browser-webaudio',
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
      while (!closed && queuedFrames() > 0) {
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

async function loadNodeWebAudioContextConstructor(): Promise<NodeWebAudioContextConstructor | undefined> {
  try {
    const imported = (await import('node-web-audio-api')) as NodeWebAudioModule;
    const candidate = imported.AudioContext ?? imported.default?.AudioContext ?? imported.default;
    if (typeof candidate !== 'function') {
      return undefined;
    }
    return candidate as NodeWebAudioContextConstructor;
  } catch {
    return undefined;
  }
}

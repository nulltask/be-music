import { isAbortError, throwIfAborted } from '@be-music/utils/core';

// Browser-compatible cooperative-sleep helper. Mirrors what `node:timers/promises.setTimeout` returned (a Promise
// that resolves after `ms` ms) but uses the global `setTimeout` available in both runtimes. Hand-rolled so this
// module stays importable from a browser bundle even though the rest of the file is the Node sink (which only
// runs when the runtime actually invokes `createNodeAudioSink`; see `engine.ts:createAudioSessionIfEnabled`).
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
  getClockState: () => AudioSinkClockState;
  suspend: () => Promise<void>;
  resume: () => Promise<void>;
}

export interface AudioSinkCreateOptions {
  sampleRate: number;
  channels: number;
  samplesPerFrame: number;
  mode: 'auto' | 'manual';
  signal?: AbortSignal;
}

export interface WebAudioBufferLike {
  getChannelData: (channel: number) => Float32Array;
}

export interface WebAudioBufferSourceLike {
  buffer: WebAudioBufferLike | null;
  connect: (destination: unknown) => unknown;
  /**
   * Optional in the structural type because not every test fake bothers to model it, but every real Web Audio
   * implementation (browser + `node-web-audio-api`) provides it. Used by the sink to detach the source from the
   * destination once playback ends so the node becomes GC-eligible — without it, idle source nodes accumulate per
   * chunk written.
   */
  disconnect?: () => void;
  start: (when?: number) => void;
  /**
   * Spec-defined `ended` callback. Same optionality reasoning as {@link disconnect}.
   */
  onended?: (() => void) | null;
}

export interface WebAudioContextLike {
  readonly currentTime: number;
  readonly destination: unknown;
  createBuffer: (numberOfChannels: number, length: number, sampleRate: number) => WebAudioBufferLike;
  createBufferSource: () => WebAudioBufferSourceLike;
  close?: () => Promise<void>;
  suspend?: () => Promise<void>;
  resume?: () => Promise<void>;
}

export interface AudioSinkClockState {
  outputSeconds: number;
  scheduledSeconds: number;
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
  throwIfAborted(options.signal);
  const AudioContext = await loadNodeWebAudioContextConstructor(options.signal);
  throwIfAborted(options.signal);
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
  if (options.signal?.aborted) {
    await closeContextSafely(context);
    throwIfAborted(options.signal);
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
    // Drop the error-listener registry first so anything still holding the
    // sink alive (e.g. an upstream player loop) can't accidentally call into
    // a torn-down context. Listeners that already fired stay invoked; the
    // clear only affects re-entrant emits after the sink is closed.
    errorListeners.clear();
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
        // Per Web Audio spec, an `AudioBufferSourceNode` keeps its outgoing edge to `destination` alive after playback
        // ends until either explicit `disconnect()` or GC. The Node `node-web-audio-api` shim doesn't reliably collect
        // those edges between `write` calls — at 100+ chunks per second the renderer accumulates idle source nodes
        // backing every chunk we ever scheduled. Wiring `onended` to `disconnect()` lets each chunk's node detach the
        // moment its frames finish and then become eligible for GC.
        source.onended = () => {
          try {
            source.disconnect?.();
          } catch {
            // Already disconnected or context closed — both terminal states for this node.
          }
        };
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
    getClockState: () => {
      const outputSeconds = Math.max(0, context.currentTime);
      return {
        outputSeconds,
        scheduledSeconds: Math.max(outputSeconds, scheduledUntilSeconds),
      };
    },
    suspend: async () => {
      if (closed) {
        return;
      }
      try {
        await context.suspend?.();
      } catch {
        emitError();
      }
    },
    resume: async () => {
      if (closed) {
        return;
      }
      try {
        await context.resume?.();
      } catch {
        emitError();
      }
    },
  };
}

async function loadNodeWebAudioContextConstructor(
  signal?: AbortSignal,
): Promise<NodeWebAudioContextConstructor | undefined> {
  try {
    throwIfAborted(signal);
    const imported = (await import('node-web-audio-api')) as NodeWebAudioModule;
    throwIfAborted(signal);
    const candidate = imported.AudioContext ?? imported.default?.AudioContext ?? imported.default;
    if (typeof candidate !== 'function') {
      return undefined;
    }
    return candidate as NodeWebAudioContextConstructor;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    return undefined;
  }
}

async function closeContextSafely(context: WebAudioContextLike): Promise<void> {
  try {
    await context.close?.();
  } catch {
    // noop
  }
}

import { describe, expect, test } from 'vitest';
import { createBrowserAudioSink, type AudioSinkCreateOptions, type WebAudioContextLike } from './audio-sink.ts';

function createMockContext(): WebAudioContextLike {
  return {
    currentTime: 0,
    destination: {},
    createBuffer: (numberOfChannels: number, length: number) => {
      const channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
      return {
        getChannelData: (channel: number) => channels[channel] ?? new Float32Array(length),
      };
    },
    createBufferSource: () => ({
      buffer: null,
      connect: () => undefined,
      start: () => undefined,
    }),
    close: async () => undefined,
  };
}

const BASE_OPTIONS: AudioSinkCreateOptions = {
  sampleRate: 44_100,
  channels: 2,
  samplesPerFrame: 256,
  mode: 'auto',
};

describe('player audio-sink', () => {
  test('audio-sink: creates browser webaudio sink label', () => {
    const sink = createBrowserAudioSink(createMockContext(), BASE_OPTIONS);
    expect(sink.runtime).toBe('browser');
    expect(sink.engine).toBe('webaudio');
    expect(sink.label).toBe('browser-webaudio');
  });

  test('audio-sink: treats empty pcm chunk as writable', () => {
    const sink = createBrowserAudioSink(createMockContext(), BASE_OPTIONS);
    expect(sink.write(new Uint8Array(0))).toBe(true);
  });
});

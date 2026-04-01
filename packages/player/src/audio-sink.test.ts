import { describe, expect, test, vi } from 'vitest';
import { createBrowserAudioSink, type WebAudioContextLike } from './audio-sink.ts';

function createMockContext(currentTimeRef: { value: number }) {
  const starts: number[] = [];
  const suspend = vi.fn(async () => undefined);
  const resume = vi.fn(async () => undefined);

  const context: WebAudioContextLike = {
    get currentTime() {
      return currentTimeRef.value;
    },
    destination: {},
    createBuffer: (_channels: number, length: number) => ({
      getChannelData: () => new Float32Array(length),
    }),
    createBufferSource: () => ({
      buffer: null,
      connect: () => undefined,
      start: (when = 0) => {
        starts.push(when);
      },
    }),
    suspend,
    resume,
  };

  return {
    context,
    starts,
    suspend,
    resume,
  };
}

describe('audio-sink', () => {
  test('tracks output and scheduled clock state across buffered writes', () => {
    const currentTimeRef = { value: 1.25 };
    const { context, starts } = createMockContext(currentTimeRef);
    const sink = createBrowserAudioSink(context, {
      sampleRate: 1_000,
      channels: 2,
      samplesPerFrame: 256,
      mode: 'manual',
    });

    expect(sink.getClockState()).toEqual({
      outputSeconds: 1.25,
      scheduledSeconds: 1.25,
    });

    const chunk = new Uint8Array(new Int16Array(8).buffer);
    sink.write(chunk);

    expect(starts).toEqual([1.25]);
    expect(sink.getClockState()).toEqual({
      outputSeconds: 1.25,
      scheduledSeconds: 1.254,
    });

    currentTimeRef.value = 1.252;
    expect(sink.getClockState()).toEqual({
      outputSeconds: 1.252,
      scheduledSeconds: 1.254,
    });

    currentTimeRef.value = 1.3;
    expect(sink.getClockState()).toEqual({
      outputSeconds: 1.3,
      scheduledSeconds: 1.3,
    });
  });

  test('forwards suspend and resume to the audio context', async () => {
    const currentTimeRef = { value: 0 };
    const { context, suspend, resume } = createMockContext(currentTimeRef);
    const sink = createBrowserAudioSink(context, {
      sampleRate: 44_100,
      channels: 2,
      samplesPerFrame: 256,
      mode: 'auto',
    });

    await sink.suspend();
    await sink.resume();

    expect(suspend).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(1);
  });
});

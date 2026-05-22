import { afterEach, describe, expect, it, vi } from 'vitest';
import { BeatorajaSkinAudioPlayer } from './audio.ts';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('BeatorajaSkinAudioPlayer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not repopulate decoded buffers after dispose', async () => {
    const decoded = deferred<AudioBuffer>();
    const gain = {
      gain: { value: 1 },
      connect: vi.fn(() => gain),
      disconnect: vi.fn(),
    };
    const context = {
      destination: {},
      decodeAudioData: vi.fn(() => decoded.promise),
      createGain: vi.fn(() => gain),
      createBufferSource: vi.fn(),
      resume: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => Promise.resolve()),
    };
    const FakeAudioContext = vi.fn(function AudioContext() {
      return context;
    });
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const player = new BeatorajaSkinAudioPlayer({
      files: new Map([['sound/click.ogg', new Uint8Array([0, 1, 2, 3])]]),
    });

    expect(player.play('sound/click.ogg', 1)).toBe(true);
    expect(context.decodeAudioData).toHaveBeenCalledTimes(1);

    player.dispose();
    decoded.resolve({} as AudioBuffer);
    await decoded.promise;
    await Promise.resolve();

    const internals = player as unknown as {
      buffers: Map<string, AudioBuffer | null>;
      pending: Map<string, unknown>;
    };
    expect(internals.buffers.size).toBe(0);
    expect(internals.pending.size).toBe(0);
    expect(context.createBufferSource).not.toHaveBeenCalled();
  });
});

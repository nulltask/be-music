import { afterEach, describe, expect, it } from 'vite-plus/test';
import {
  MAX_MASTER_VOLUME,
  getMasterVolume,
  masterOutput,
  sanitizeMasterVolume,
  setMasterVolume,
} from './master-volume.ts';

/** Just enough of an `AudioContext` for the master output: gains that remember their value and wiring. */
function fakeContext(state: AudioContextState = 'running') {
  const destination = { kind: 'destination' };
  const gains: Array<{ gain: { value: number }; connectedTo: unknown }> = [];
  const listeners: Array<() => void> = [];
  const context = {
    state,
    destination,
    createGain() {
      const node = {
        gain: { value: 1 },
        connectedTo: undefined as unknown,
        connect(target: unknown) {
          node.connectedTo = target;
        },
      };
      gains.push(node);
      return node;
    },
    addEventListener(_type: string, listener: () => void) {
      listeners.push(listener);
    },
    close() {
      context.state = 'closed';
      for (const listener of listeners) listener();
    },
  };
  return { context: context as unknown as BaseAudioContext & { close(): void }, gains, destination };
}

afterEach(() => setMasterVolume(1));

describe('sanitizeMasterVolume', () => {
  it('clamps to 0..MAX_MASTER_VOLUME and treats non-finite values as unity', () => {
    expect(sanitizeMasterVolume(0.5)).toBe(0.5);
    expect(sanitizeMasterVolume(-1)).toBe(0);
    expect(sanitizeMasterVolume(9)).toBe(MAX_MASTER_VOLUME);
    expect(sanitizeMasterVolume(Number.NaN)).toBe(1);
  });
});

describe('masterOutput', () => {
  it('creates one gain per context, wired to its destination at the current volume', () => {
    setMasterVolume(0.4);
    const { context, gains, destination } = fakeContext();
    const output = masterOutput(context);
    expect(masterOutput(context)).toBe(output);
    expect(gains).toHaveLength(1);
    expect(gains[0]!.gain.value).toBe(0.4);
    expect(gains[0]!.connectedTo).toBe(destination);
  });

  it('follows master volume changes on every context', () => {
    const first = fakeContext();
    const second = fakeContext();
    masterOutput(first.context);
    masterOutput(second.context);
    setMasterVolume(0.25);
    expect(getMasterVolume()).toBe(0.25);
    expect(first.gains[0]!.gain.value).toBe(0.25);
    expect(second.gains[0]!.gain.value).toBe(0.25);
  });

  it('forgets a context once it is closed', () => {
    const { context, gains } = fakeContext();
    masterOutput(context);
    context.close();
    setMasterVolume(0.7);
    expect(gains[0]!.gain.value).toBe(1);
  });
});

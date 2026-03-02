import { describe, expect, test } from 'vitest';
import { createAudioBackendResolutionOrder, isAudioBackendName } from './audio-backend.ts';
describe('player audio-backend', () => {
  test('audio-backend: resolves auto backend in priority order', () => {
    expect(createAudioBackendResolutionOrder('auto')).toEqual(['webaudio', 'speaker', 'audify']);
  });

  test('audio-backend: returns a single candidate when backend is explicit', () => {
    expect(createAudioBackendResolutionOrder('speaker')).toEqual(['speaker']);
    expect(createAudioBackendResolutionOrder('webaudio')).toEqual(['webaudio']);
    expect(createAudioBackendResolutionOrder('audify')).toEqual(['audify']);
  });

  test('audio-backend: validates backend names', () => {
    expect(isAudioBackendName('auto')).toBe(true);
    expect(isAudioBackendName('speaker')).toBe(true);
    expect(isAudioBackendName('webaudio')).toBe(true);
    expect(isAudioBackendName('audify')).toBe(true);
    expect(isAudioBackendName('audio-io')).toBe(false);
    expect(isAudioBackendName('pipewire')).toBe(false);
  });
});

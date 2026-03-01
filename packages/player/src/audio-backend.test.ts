import { describe, expect, test } from 'vitest';
import { createAudioBackendResolutionOrder, isAudioBackendName } from './audio-backend.ts';
describe('player audio-backend', () => {


test('audio-backend: resolves auto backend in priority order', () => {
  expect(createAudioBackendResolutionOrder('auto')).toEqual(['audio-io', 'speaker', 'audify']);
});

test('audio-backend: returns a single candidate when backend is explicit', () => {
  expect(createAudioBackendResolutionOrder('speaker')).toEqual(['speaker']);
  expect(createAudioBackendResolutionOrder('audify')).toEqual(['audify']);
  expect(createAudioBackendResolutionOrder('audio-io')).toEqual(['audio-io']);
});

test('audio-backend: validates backend names', () => {
  expect(isAudioBackendName('auto')).toBe(true);
  expect(isAudioBackendName('speaker')).toBe(true);
  expect(isAudioBackendName('audify')).toBe(true);
  expect(isAudioBackendName('audio-io')).toBe(true);
  expect(isAudioBackendName('pipewire')).toBe(false);
});
});

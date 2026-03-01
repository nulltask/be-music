import { expect, test } from 'vitest';
import { createAudioBackendResolutionOrder, isAudioBackendName } from './audio-backend.ts';

test('audio-backend: auto は優先順で解決する', () => {
  expect(createAudioBackendResolutionOrder('auto')).toEqual(['audio-io', 'speaker', 'audify']);
});

test('audio-backend: 明示指定時は単一候補になる', () => {
  expect(createAudioBackendResolutionOrder('speaker')).toEqual(['speaker']);
  expect(createAudioBackendResolutionOrder('audify')).toEqual(['audify']);
  expect(createAudioBackendResolutionOrder('audio-io')).toEqual(['audio-io']);
});

test('audio-backend: 名前バリデーション', () => {
  expect(isAudioBackendName('auto')).toBe(true);
  expect(isAudioBackendName('speaker')).toBe(true);
  expect(isAudioBackendName('audify')).toBe(true);
  expect(isAudioBackendName('audio-io')).toBe(true);
  expect(isAudioBackendName('pipewire')).toBe(false);
});

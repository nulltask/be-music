import { describe, expect, test } from 'vite-plus/test';
import { resolveScratchChannels } from './scratch-channels.ts';

describe('resolveScratchChannels', () => {
  test('reads the scratch lanes of the layout a lane-mode label names', () => {
    expect([...resolveScratchChannels('7 KEY SP')]).toEqual(['16']);
    expect([...resolveScratchChannels('14 KEY DP')]).toEqual(['16', '26']);
    expect([...resolveScratchChannels('5 KEY DP')]).toEqual(['16', '26']);
    expect([...resolveScratchChannels('9 KEY (PMS-STD)')]).toEqual([]);
  });

  test('reads another spelling by its leading key count, and anything else as 7 KEY', () => {
    expect([...resolveScratchChannels('14KEY')]).toEqual(['16', '26']);
    expect([...resolveScratchChannels('9KEY')]).toEqual([]);
    expect([...resolveScratchChannels('unknown')]).toEqual(['16']);
  });

  test('answers alike on every call, also after many labels have been resolved', () => {
    const first = [...resolveScratchChannels('10KEY')];
    for (let index = 0; index < 200; index += 1) resolveScratchChannels(`${index} lanes`);
    expect([...resolveScratchChannels('10KEY')]).toEqual(first);
    expect([...resolveScratchChannels('48 KEY DP')]).toEqual([]);
  });
});

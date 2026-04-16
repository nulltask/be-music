import { describe, expect, test } from 'vitest';
import { findBestBrowserLaneFallbackCandidate } from './browser-lane-fallback.ts';

describe('browser lane fallback', () => {
  test('prefers nearest unjudged invisible note when visible note is already judged', () => {
    const candidate = findBestBrowserLaneFallbackCandidate(
      [
        {
          channel: '11',
          seconds: 1,
          judged: true,
          event: { channel: '11', value: '01' },
        },
      ],
      [
        {
          channel: '11',
          seconds: 1.02,
          judged: false,
          event: { channel: '31', value: '02' },
        },
      ],
      ['11'],
      1.01,
    );

    expect(candidate?.event.channel).toBe('31');
  });

  test('falls back to nearest judged note when all candidates are judged', () => {
    const candidate = findBestBrowserLaneFallbackCandidate(
      [
        {
          channel: '11',
          seconds: 0.98,
          judged: true,
          event: { channel: '11', value: '01' },
        },
      ],
      [
        {
          channel: '11',
          seconds: 1.2,
          judged: true,
          event: { channel: '31', value: '02' },
        },
      ],
      ['11'],
      1,
    );

    expect(candidate?.event.value).toBe('01');
  });
});

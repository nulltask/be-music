import { describe, expect, it } from 'vite-plus/test';
import { formatPlaybackTime, resolveSeekTarget } from './playback.ts';

describe('formatPlaybackTime', () => {
  it('shows minutes and seconds, and hours from an hour', () => {
    expect(formatPlaybackTime(0)).toBe('0:00');
    expect(formatPlaybackTime(65.9)).toBe('1:05');
    expect(formatPlaybackTime(3725)).toBe('1:02:05');
  });

  it('reads a negative or unknown time as the start', () => {
    expect(formatPlaybackTime(-3)).toBe('0:00');
    expect(formatPlaybackTime(Number.NaN)).toBe('0:00');
  });
});

describe('resolveSeekTarget', () => {
  it('moves by the step and stays inside the chart', () => {
    expect(resolveSeekTarget(10, 5, 120)).toBe(15);
    expect(resolveSeekTarget(2, -5, 120)).toBe(0);
    expect(resolveSeekTarget(118, 5, 120)).toBe(120);
  });
});

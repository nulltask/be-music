import { describe, expect, test } from 'vite-plus/test';
import type { PlaylogInputEvent } from '../playlog/format.ts';
import { isRecordedWithoutReleases } from './play-replay.ts';

const input = (seq: number, action: 'down' | 'up', ...channels: string[]): PlaylogInputEvent => ({
  seq,
  timeUs: seq * 100_000,
  action,
  channels,
});

describe('isRecordedWithoutReleases', () => {
  test('a log of presses only, with a lane pressed again, came from input without releases', () => {
    const inputs = [input(0, 'down', '11'), input(1, 'down', '12'), input(2, 'down', '11')];
    expect(isRecordedWithoutReleases(inputs)).toBe(true);
  });

  test('a log with any release reports its releases', () => {
    const inputs = [input(0, 'down', '11'), input(1, 'up', '11'), input(2, 'down', '11')];
    expect(isRecordedWithoutReleases(inputs)).toBe(false);
  });

  test('keys on different lanes held to the end read as key-state input', () => {
    expect(isRecordedWithoutReleases([input(0, 'down', '11'), input(1, 'down', '12', '13')])).toBe(false);
    expect(isRecordedWithoutReleases([])).toBe(false);
  });
});

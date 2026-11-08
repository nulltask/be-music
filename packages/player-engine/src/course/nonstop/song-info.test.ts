import { describe, expect, test } from 'vite-plus/test';
import { NONSTOP_SONG_INFO_FADE_SECONDS, resolveNonstopSongInfoState } from './song-info.ts';

describe('resolveNonstopSongInfoState', () => {
  const stages = [{ windowStart: 0 }, { windowStart: 20 }, { windowStart: 40 }];

  test('shows the first stage before and through its window', () => {
    expect(resolveNonstopSongInfoState(stages, -1)).toEqual({ stage: 0, progress: 1 });
    expect(resolveNonstopSongInfoState(stages, 19.99)).toEqual({ stage: 0, progress: 1 });
    expect(resolveNonstopSongInfoState([{ windowStart: 0 }], 100)).toEqual({ stage: 0, progress: 1 });
    expect(resolveNonstopSongInfoState([], 5)).toEqual({ stage: 0, progress: 1 });
  });

  test('crossfades from the previous stage as a window starts', () => {
    expect(resolveNonstopSongInfoState(stages, 20, 1)).toEqual({ stage: 1, previous: 0, progress: 0 });
    expect(resolveNonstopSongInfoState(stages, 20.25, 1)).toEqual({ stage: 1, previous: 0, progress: 0.25 });
    expect(resolveNonstopSongInfoState(stages, 21, 1)).toEqual({ stage: 1, progress: 1 });
    expect(resolveNonstopSongInfoState(stages, 40.5, 1)).toEqual({ stage: 2, previous: 1, progress: 0.5 });
    expect(resolveNonstopSongInfoState(stages, 99, 1)).toEqual({ stage: 2, progress: 1 });
  });

  test('fades over the default duration, and switches at once without one', () => {
    const halfway = 20 + NONSTOP_SONG_INFO_FADE_SECONDS / 2;
    expect(resolveNonstopSongInfoState(stages, halfway).progress).toBeCloseTo(0.5);
    expect(resolveNonstopSongInfoState(stages, 20, 0)).toEqual({ stage: 1, progress: 1 });
  });
});

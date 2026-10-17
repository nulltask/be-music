import { describe, expect, it } from 'vite-plus/test';
import {
  parseStoredReplayView,
  readStoredReplayView,
  REPLAY_VIEW_STORAGE_KEY,
  storeReplayView,
} from './replay-view-settings.ts';

const ALL_ON = { tempo: true, hiSpeed: true, covers: true, lift: true };

describe('parseStoredReplayView', () => {
  it('turns everything on when nothing readable is stored', () => {
    expect(parseStoredReplayView(null)).toEqual(ALL_ON);
    expect(parseStoredReplayView('not json')).toEqual(ALL_ON);
    expect(parseStoredReplayView('[]')).toEqual(ALL_ON);
  });

  it('reads each toggle on its own and ignores anything that is not a boolean', () => {
    expect(parseStoredReplayView(JSON.stringify({ tempo: false, hiSpeed: 'no', covers: false, extra: 1 }))).toEqual({
      tempo: false,
      hiSpeed: true,
      covers: false,
      lift: true,
    });
  });
});

describe('stored replay view settings', () => {
  it('round-trips through storage', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
    const settings = { tempo: true, hiSpeed: false, covers: true, lift: false };
    storeReplayView(settings, storage);
    expect(JSON.parse(values.get(REPLAY_VIEW_STORAGE_KEY)!)).toEqual(settings);
    expect(readStoredReplayView(storage)).toEqual(settings);
  });

  it('falls back to the defaults when storage throws', () => {
    const blocked = {
      getItem: (): string | null => {
        throw new Error('blocked');
      },
      setItem: (): void => {
        throw new Error('blocked');
      },
    };
    expect(readStoredReplayView(blocked)).toEqual(ALL_ON);
    expect(() => storeReplayView(ALL_ON, blocked)).not.toThrow();
  });
});

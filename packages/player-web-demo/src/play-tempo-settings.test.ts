import { describe, expect, test } from 'vite-plus/test';
import {
  clampTempoPercent,
  DEFAULT_PLAY_TEMPO_SETTINGS,
  describePlayingStatus,
  describeTempo,
  parseStoredPlayTempoSettings,
  PLAY_TEMPO_STORAGE_KEY,
  readStoredPlayTempoSettings,
  storePlayTempoSettings,
  tempoFromPercent,
} from './play-tempo-settings.ts';

describe('tempo percent', () => {
  test('clamps to -50..+50 whole percent, 0 for anything else', () => {
    expect([-80, -50, -20.4, 0, 12.6, 50, 99].map(clampTempoPercent)).toEqual([-50, -50, -20, 0, 13, 50, 50]);
    expect([Number.NaN, '10', undefined, null].map(clampTempoPercent)).toEqual([0, 0, 0, 0]);
  });

  test('turns a percent into the play tempo', () => {
    expect([-50, -20, 0, 5, 50, 80].map(tempoFromPercent)).toEqual([0.5, 0.8, 1, 1.05, 1.5, 1.5]);
  });
});

describe('status line', () => {
  test('names the tempo only when it is not the chart’s own', () => {
    expect(describeTempo(0)).toBeUndefined();
    expect(describeTempo(-20)).toBe('tempo -20%');
    expect(describeTempo(5)).toBe('tempo +5%');
  });

  test('adds the tempo and the skin family to the playing status', () => {
    expect(describePlayingStatus('Song')).toBe('Playing: Song');
    expect(describePlayingStatus('Song', { tempoPercent: -20 })).toBe('Playing (tempo -20%): Song');
    expect(describePlayingStatus('Song', { family: 'beatoraja' })).toBe('Playing (beatoraja): Song');
    expect(describePlayingStatus('Song', { family: 'beatoraja', tempoPercent: 10 })).toBe(
      'Playing (beatoraja, tempo +10%): Song',
    );
  });
});

describe('stored settings', () => {
  test('reads each field on its own and falls back to the defaults', () => {
    expect(parseStoredPlayTempoSettings(null)).toEqual(DEFAULT_PLAY_TEMPO_SETTINGS);
    expect(parseStoredPlayTempoSettings('{oops')).toEqual(DEFAULT_PLAY_TEMPO_SETTINGS);
    expect(
      parseStoredPlayTempoSettings(
        JSON.stringify({ tempoPercent: -120, tempoPitchMode: 'keep-pitch', tempoStretchAlgorithm: 'other' }),
      ),
    ).toEqual({ tempoPercent: -50, tempoPitchMode: 'keep-pitch', tempoStretchAlgorithm: 'signalsmith' });
  });

  test('round-trips through storage and survives blocked storage', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
    const settings = { tempoPercent: 15, tempoPitchMode: 'keep-pitch', tempoStretchAlgorithm: 'wsola' } as const;
    storePlayTempoSettings(settings, storage);
    expect(values.has(PLAY_TEMPO_STORAGE_KEY)).toBe(true);
    expect(readStoredPlayTempoSettings(storage)).toEqual(settings);
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readStoredPlayTempoSettings(blocked)).toEqual(DEFAULT_PLAY_TEMPO_SETTINGS);
    expect(() => storePlayTempoSettings(settings, blocked)).not.toThrow();
  });
});

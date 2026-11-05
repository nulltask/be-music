import { describe, expect, test } from 'vite-plus/test';
import { estimateDifficultyFromNames, estimateDifficultyFromNoteCount } from './difficulty-estimate.ts';

describe('estimateDifficultyFromNames', () => {
  test('reads a difficulty word in the subtitle', () => {
    expect(estimateDifficultyFromNames({ title: 'Song', subtitle: '[SP BEGINNER]' })).toBe(1);
    expect(estimateDifficultyFromNames({ title: 'Song', subtitle: '[7KEYS NORMAL]' })).toBe(2);
    expect(estimateDifficultyFromNames({ title: 'Song', subtitle: '[HYPER]' })).toBe(3);
    expect(estimateDifficultyFromNames({ title: 'Song', subtitle: '[DP ANOTHER]' })).toBe(4);
    expect(estimateDifficultyFromNames({ title: 'Song', subtitle: '[INSANE]' })).toBe(5);
    expect(estimateDifficultyFromNames({ title: 'Song', subtitle: '[SP LEGGENDARIA]' })).toBe(5);
  });

  test('reads the bracketed and trailing dashed parts of the title, not its bare words', () => {
    expect(estimateDifficultyFromNames({ title: 'Jade Star [Another]' })).toBe(4);
    expect(estimateDifficultyFromNames({ title: 'Orfevre -5NORMAL-' })).toBe(2);
    expect(estimateDifficultyFromNames({ title: '38th snow-easy-' })).toBe(1);
    expect(estimateDifficultyFromNames({ title: 'To Another Dream' })).toBeUndefined();
    expect(estimateDifficultyFromNames({ title: 'Hyper Diver', fileName: '3_kom_hyperdiver_dp.bms' })).toBeUndefined();
  });

  test('matches whole words only', () => {
    expect(estimateDifficultyFromNames({ title: 'Twilight [Lights]' })).toBeUndefined();
    expect(estimateDifficultyFromNames({ title: 'Song', subtitle: '[7key LIGHT]' })).toBe(2);
  });

  test('prefers a specific name over a generic one', () => {
    expect(estimateDifficultyFromNames({ title: 'Song', subtitle: '[HARD ANOTHER]' })).toBe(4);
    expect(estimateDifficultyFromNames({ title: 'Song', subtitle: '[BLACK ANOTHER]' })).toBe(5);
  });

  test('reads a bmson chart name like the subtitle', () => {
    expect(estimateDifficultyFromNames({ title: 'Song', chartName: 'HYPER' })).toBe(3);
  });

  test('reads difficulty words in the file name', () => {
    expect(estimateDifficultyFromNames({ title: 'Song', fileName: 'song_hyper.bms' })).toBe(3);
    expect(estimateDifficultyFromNames({ title: 'Song', fileName: 'song_EX.bms' })).toBe(4);
    expect(estimateDifficultyFromNames({ title: 'Song', fileName: '_arsnova_EX2.bms' })).toBe(5);
  });

  test('reads a difficulty word glued to a file name token', () => {
    expect(estimateDifficultyFromNames({ title: 'Silent Sky', fileName: 'silenteasy.bms' })).toBe(1);
    expect(estimateDifficultyFromNames({ title: 'Boy', fileName: 'boymganother2.bms' })).toBe(4);
  });

  test('reads abbreviations in the file name', () => {
    expect(estimateDifficultyFromNames({ title: 'Song', fileName: 'astro7a.bme' })).toBe(4);
    expect(estimateDifficultyFromNames({ title: 'Song', fileName: 'song_SPH.bms' })).toBe(3);
    expect(estimateDifficultyFromNames({ title: 'Song', fileName: 'song_14n.bme' })).toBe(2);
    expect(estimateDifficultyFromNames({ title: 'Song', fileName: 'song_b.bms' })).toBe(1);
    expect(estimateDifficultyFromNames({ title: 'Song', fileName: 'song_7ano.bms' })).toBe(4);
  });

  test('reads L only after SP / DP and E only after a key count or SP / DP', () => {
    expect(estimateDifficultyFromNames({ title: 'Song', fileName: 'song_SPL.bms' })).toBe(5);
    expect(estimateDifficultyFromNames({ title: 'Song', fileName: 'song_L.bms' })).toBeUndefined();
    expect(estimateDifficultyFromNames({ title: 'Song', fileName: 'song_5e.bms' })).toBe(1);
    expect(estimateDifficultyFromNames({ title: 'Song', fileName: 'song_E.bms' })).toBeUndefined();
  });

  test('reads a lone abbreviation tag in brackets last', () => {
    expect(estimateDifficultyFromNames({ title: 'Song [A]', fileName: 'song.bms' })).toBe(4);
    expect(estimateDifficultyFromNames({ title: 'Song [A]', fileName: 'song_h.bms' })).toBe(3);
  });

  test('gives none for names that only name a key mode', () => {
    expect(estimateDifficultyFromNames({ title: 'Song [7KEYS]', fileName: 'song_7.bme' })).toBeUndefined();
    expect(estimateDifficultyFromNames({ title: 'Song (DP)', fileName: 'song_14.bme' })).toBeUndefined();
    expect(estimateDifficultyFromNames({})).toBeUndefined();
  });
});

describe('estimateDifficultyFromNoteCount', () => {
  test("follows beatoraja's note-count bounds", () => {
    expect(estimateDifficultyFromNoteCount(1)).toBe(1);
    expect(estimateDifficultyFromNoteCount(249)).toBe(1);
    expect(estimateDifficultyFromNoteCount(250)).toBe(2);
    expect(estimateDifficultyFromNoteCount(599)).toBe(2);
    expect(estimateDifficultyFromNoteCount(600)).toBe(3);
    expect(estimateDifficultyFromNoteCount(1000)).toBe(4);
    expect(estimateDifficultyFromNoteCount(1999)).toBe(4);
    expect(estimateDifficultyFromNoteCount(2000)).toBe(5);
  });

  test('gives none for a chart without notes', () => {
    expect(estimateDifficultyFromNoteCount(0)).toBeUndefined();
    expect(estimateDifficultyFromNoteCount(Number.NaN)).toBeUndefined();
  });
});

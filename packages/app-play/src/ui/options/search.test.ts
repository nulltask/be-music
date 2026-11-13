import { describe, expect, test } from 'vite-plus/test';
import { searchOptions, type OptionSearchEntry } from './search.ts';

const entry = (label: string, path: string[], keywords = ''): OptionSearchEntry => ({ label, path, keywords });

const ENTRIES = [
  entry('Gauge auto-shift', ['Play', 'Judge & gauge'], 'NONE CONTINUE BEST CLEAR'),
  entry('Gauge', ['Play', 'Judge & gauge'], 'GROOVE HARD The gauge you play on.'),
  entry('Hi-speed', ['View', 'Hi-speed'], 'The scroll speed.'),
  entry('Tempo', ['Play', 'Replay / ghost'], 'A replay plays at the recorded tempo.'),
  entry('ゲージ', ['プレイ'], 'Gauge 2P'),
];

const labels = (query: string): string[] => searchOptions(ENTRIES, query).map((found) => found.label);

describe('searchOptions', () => {
  test('finds nothing for an empty query', () => {
    expect(labels('')).toEqual([]);
    expect(labels('   ')).toEqual([]);
  });

  test('puts a name that starts with the query first, then names holding it, then places and other text', () => {
    expect(labels('gauge')).toEqual(['Gauge auto-shift', 'Gauge', 'ゲージ']);
    expect(labels('speed')).toEqual(['Hi-speed']);
    expect(labels('tempo')).toEqual(['Tempo']);
    expect(labels('replay')).toEqual(['Tempo']);
    expect(labels('hard')).toEqual(['Gauge']);
  });

  test('needs every word, wherever each is found', () => {
    expect(labels('gauge shift')).toEqual(['Gauge auto-shift']);
    expect(labels('play gauge hard')).toEqual(['Gauge']);
    expect(labels('gauge speed')).toEqual([]);
  });

  test('reads case and character width alike', () => {
    expect(labels('ＨＩ-SPEED')).toEqual(['Hi-speed']);
    expect(labels('ゲージ')).toEqual(['ゲージ']);
  });

  test('stops at the limit', () => {
    expect(searchOptions(ENTRIES, 'e', 2)).toHaveLength(2);
  });
});

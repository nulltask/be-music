import { describe, expect, test } from 'vite-plus/test';
import {
  describeDatabase,
  describeLocalStorageKey,
  formatBytes,
  formatKey,
  listLocalStorage,
  sortDatabases,
  utf8Bytes,
  viewLocalStorageValue,
  viewStoredValue,
} from './local-data.ts';

function storage(entries: Record<string, string>): Pick<Storage, 'length' | 'key' | 'getItem'> {
  const keys = Object.keys(entries);
  return { length: keys.length, key: (index) => keys[index] ?? null, getItem: (key) => entries[key] ?? null };
}

describe('local data viewer', () => {
  test('formats byte counts in powers of 1024', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(12 * 1024 * 1024)).toBe('12.0 MB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB');
  });

  test('counts UTF-8 bytes', () => {
    expect(utf8Bytes('abc')).toBe(3);
    expect(utf8Bytes('»')).toBe(2);
    expect(utf8Bytes('譜面')).toBe(6);
  });

  test("lists localStorage with the player's own keys first, each group by key, with what they hold", () => {
    const entries = listLocalStorage(
      storage({
        'other.key': 'x',
        'be-music.hi-speed': '2.5',
        'be-music.debug-menu-settings': '{"a":1}',
        'be-music.unknown': '',
      }),
    );
    expect(entries.map((entry) => entry.key)).toEqual([
      'be-music.debug-menu-settings',
      'be-music.hi-speed',
      'be-music.unknown',
      'other.key',
    ]);
    expect(entries[0]).toEqual({
      key: 'be-music.debug-menu-settings',
      value: '{"a":1}',
      bytes: 28 + 7,
      description: 'Every Debug Menu setting',
    });
    expect(entries[2]).not.toHaveProperty('description');
    expect(describeLocalStorageKey('be-music.dan-ranks')).toBe('Dan rank per key mode, per judge ruleset');
    expect(describeLocalStorageKey('be-music.chart-best-records')).toBe(
      'Best records of each chart, per judge ruleset',
    );
  });

  test('shows a localStorage value as pretty JSON when it is an object, else as text', () => {
    expect(viewLocalStorageValue('{"a":[1,2]}')).toEqual({
      kind: 'json',
      bytes: 11,
      text: '{\n  "a": [\n    1,\n    2\n  ]\n}',
    });
    expect(viewLocalStorageValue('2.5')).toEqual({ kind: 'text', bytes: 3, text: '2.5' });
    expect(viewLocalStorageValue('not json')).toEqual({ kind: 'text', bytes: 8, text: 'not json' });
  });

  test('describes blobs and binary data instead of reading them', () => {
    expect(viewStoredValue(new Blob(['x'.repeat(2048)], { type: 'application/gzip' }))).toEqual({
      kind: 'blob',
      bytes: 2048,
      text: 'Blob, 2.0 KB, application/gzip',
    });
    expect(viewStoredValue(new Uint8Array(10))).toEqual({ kind: 'binary', bytes: 10, text: 'Binary data, 10 B' });
    expect(viewStoredValue({ version: 1 })).toEqual({ kind: 'json', bytes: 13, text: '{\n  "version": 1\n}' });
    expect(viewStoredValue('text')).toEqual({ kind: 'text', bytes: 4, text: 'text' });
  });

  test("names the player's databases and stores, and lists them first", () => {
    expect(describeDatabase('be-music-replays')).toBe('Replay slots');
    expect(describeDatabase('be-music-replays', 'replaySlotData')).toBe('Each slot’s replay, gzip-compressed');
    expect(describeDatabase('elsewhere')).toBeUndefined();
    expect(
      sortDatabases([{ name: 'zeta' }, { name: 'be-music-replays' }, { name: 'alpha' }, { name: 'be-music' }]).map(
        (database) => database.name,
      ),
    ).toEqual(['be-music', 'be-music-replays', 'alpha', 'zeta']);
  });

  test('prints IndexedDB keys', () => {
    expect(formatKey('chart:abc#0')).toBe('chart:abc#0');
    expect(formatKey(3)).toBe('3');
    expect(formatKey(new Date(Date.UTC(2026, 9, 26)))).toBe('2026-10-26T00:00:00.000Z');
    expect(formatKey(['a', 1])).toBe('[a, 1]');
    expect(formatKey(new Uint8Array(4).buffer)).toBe('Binary key, 4 B');
  });
});

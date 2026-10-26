import { describe, expect, test } from 'vite-plus/test';
import { migratePlayerStorage } from './debug-menu-storage.ts';

function storage(entries: Record<string, string>) {
  const values = new Map(Object.entries(entries));
  return {
    values,
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

describe('migratePlayerStorage', () => {
  test('moves settings, reset retries and best records, preserving current keys and other apps', () => {
    const source = storage({
      'be-music-demo.volumes': 'old',
      'be-music.volumes': 'new',
      'be-music-demo.chart-best-records': 'records',
      'be-music-demo.settings-reset-pending': 'reset',
      'another-app': 'keep',
    });
    migratePlayerStorage(source);
    expect(Object.fromEntries(source.values)).toEqual({
      'be-music.volumes': 'new',
      'be-music.chart-best-records': 'records',
      'be-music.settings-reset-pending': 'reset',
      'another-app': 'keep',
    });
    migratePlayerStorage(source);
    expect(source.values.size).toBe(4);
  });

  test('retains the source when copying fails and retries later', () => {
    const source = storage({ 'be-music-demo.chart-best-records': 'records' });
    migratePlayerStorage({
      ...source,
      setItem() {
        throw new Error('full');
      },
    });
    expect(source.getItem('be-music-demo.chart-best-records')).toBe('records');
    migratePlayerStorage(source);
    expect(source.getItem('be-music.chart-best-records')).toBe('records');
    expect(source.getItem('be-music-demo.chart-best-records')).toBeNull();
  });
});

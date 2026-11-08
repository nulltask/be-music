import { describe, expect, test } from 'vite-plus/test';
import { createIndexedDBParsedChartCache, parsedChartBuildStamp } from './parsed-chart-database.ts';

describe('parsedChartBuildStamp', () => {
  test('joins the source revision and the build time', () => {
    expect(parsedChartBuildStamp({ revision: '0123abcd', builtAt: '2026-11-08T00:00:00.000Z' })).toBe(
      '0123abcd@2026-11-08T00:00:00.000Z',
    );
  });

  test('keeps the build time when the revision is unknown', () => {
    expect(parsedChartBuildStamp({ revision: 'unknown', builtAt: '2026-11-08T00:00:00.000Z' })).toBe(
      '@2026-11-08T00:00:00.000Z',
    );
  });

  test('is empty without build info', () => {
    expect(parsedChartBuildStamp(undefined)).toBe('');
    expect(parsedChartBuildStamp({ revision: 'unknown', builtAt: '' })).toBe('');
  });
});

describe('createIndexedDBParsedChartCache', () => {
  test('caches nothing without IndexedDB or a build stamp', () => {
    expect(createIndexedDBParsedChartCache('stamp', undefined)).toBeUndefined();
    expect(createIndexedDBParsedChartCache('', {} as IDBFactory)).toBeUndefined();
  });

  test('misses every lookup and keeps nothing when the database cannot be opened', async () => {
    const factory = {
      open: () => {
        throw new Error('blocked by the browser');
      },
    } as unknown as IDBFactory;
    const cache = createIndexedDBParsedChartCache('stamp', factory)!;
    expect(await cache.get('abc:bms')).toBeUndefined();
    await expect(cache.set('abc:bms', {} as never)).resolves.toBeUndefined();
  });
});

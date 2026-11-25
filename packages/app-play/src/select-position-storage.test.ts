import { describe, expect, test } from 'vite-plus/test';
import {
  parseStoredSelectPosition,
  readStoredSelectPosition,
  SELECT_POSITION_STORAGE_KEY,
  selectPositionOf,
  storeSelectPosition,
} from './select-position-storage.ts';

function memoryStorage(initial: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> & {
  values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

const position = { folderPath: ['Insane BMS', '★12'], cursors: [3, 1, 7], focusKey: 'chart:abc' };

describe('select position storage', () => {
  test('keeps only the position: the folders, the cursors and the bar under the cursor', () => {
    expect(
      selectPositionOf({
        ...position,
        searchText: 'level:12',
        list: { sort: 'TITLE' },
        favorites: { music: ['m'], charts: ['c'] },
      }),
    ).toEqual(position);
  });

  test('keeps nothing when no bar is under the cursor', () => {
    expect(selectPositionOf(undefined)).toBeUndefined();
    expect(selectPositionOf({ folderPath: [], cursors: [0] })).toBeUndefined();
  });

  test('stores a position and reads it back', () => {
    const storage = memoryStorage();
    storeSelectPosition({ ...position, searchText: 'x' }, storage);
    expect(JSON.parse(storage.values.get(SELECT_POSITION_STORAGE_KEY)!)).toEqual(position);
    expect(readStoredSelectPosition(storage)).toEqual(position);
  });

  test('a snapshot with no bar under the cursor keeps the stored position', () => {
    const storage = memoryStorage({ [SELECT_POSITION_STORAGE_KEY]: JSON.stringify(position) });
    storeSelectPosition({ folderPath: [], cursors: [0] }, storage);
    storeSelectPosition(undefined, storage);
    expect(readStoredSelectPosition(storage)).toEqual(position);
  });

  test.each([
    ['missing', null],
    ['empty', ''],
    ['not JSON', '{'],
    ['not an object', '"x"'],
    ['labels not strings', JSON.stringify({ ...position, folderPath: [1] })],
    ['a cursor per depth missing', JSON.stringify({ ...position, cursors: [3, 1] })],
    ['a negative cursor', JSON.stringify({ ...position, cursors: [3, -1, 7] })],
    ['a fractional cursor', JSON.stringify({ ...position, cursors: [3, 1.5, 7] })],
    ['no bar key', JSON.stringify({ folderPath: [], cursors: [0] })],
  ])('reads nothing from a stored value that is %s', (_name, raw) => {
    expect(parseStoredSelectPosition(raw)).toBeUndefined();
  });

  test('reads nothing and writes nothing when storage is blocked', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readStoredSelectPosition(blocked)).toBeUndefined();
    expect(() => storeSelectPosition(position, blocked)).not.toThrow();
  });
});

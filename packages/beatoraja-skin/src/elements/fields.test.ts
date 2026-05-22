import { describe, expect, it } from 'vitest';
import type { BeatorajaLuaFunctionValue } from '../lua.ts';
import {
  boolField,
  integerPropertyField,
  numberArrayField,
  numberField,
  pickHex,
  positiveIntField,
  sourceIdField,
  sourceIdValueField,
  stringField,
} from './fields.ts';

const luaFunction: BeatorajaLuaFunctionValue = {
  kind: 'beatoraja-lua-function',
  evaluate: () => 1,
  dispose: () => undefined,
};

describe('beatoraja element field helpers', () => {
  it('reads finite number fields and falls back otherwise', () => {
    expect(numberField({ x: 4 }, 'x', 0)).toBe(4);
    expect(numberField({ x: Number.NaN }, 'x', 7)).toBe(7);
  });

  it('collects only finite numbers from arrays', () => {
    expect(numberArrayField({ offsets: [1, Number.NaN, '2', 3] }, 'offsets')).toEqual([1, 3]);
    expect(numberArrayField({ offsets: 'nope' }, 'offsets')).toEqual([]);
  });

  it('reads source ids from records or raw values', () => {
    expect(sourceIdField({ src: 1 }, 'src', -1)).toBe(1);
    expect(sourceIdField({ src: 'main' }, 'src', -1)).toBe('main');
    expect(sourceIdValueField('', -1)).toBe(-1);
  });

  it('coerces beatoraja boolean conventions', () => {
    expect(boolField({ enabled: true }, 'enabled', false)).toBe(true);
    expect(boolField({ enabled: 1 }, 'enabled', false)).toBe(true);
    expect(boolField({ enabled: 0 }, 'enabled', true)).toBe(false);
  });

  it('truncates positive integer fields and rejects non-positive values', () => {
    expect(positiveIntField({ divx: 4.8 }, 'divx', 1)).toBe(4);
    expect(positiveIntField({ divx: 0 }, 'divx', 1)).toBe(1);
  });

  it('reads string and first non-empty hex aliases', () => {
    expect(stringField({ color: 'ffffff' }, 'color', '')).toBe('ffffff');
    expect(pickHex({ PGColor: 'ffaa00', pgColor: '' }, ['pgColor', 'PGColor'])).toBe('ffaa00');
  });

  it('preserves numeric and Lua-backed property refs', () => {
    expect(integerPropertyField(10)).toBe(10);
    expect(integerPropertyField(luaFunction)).toBe(luaFunction);
    expect(integerPropertyField({ kind: 'beatoraja-lua-function' })).toBeUndefined();
  });
});

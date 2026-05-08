import { describe, expect, it } from 'vitest';
import {
  BEATORAJA_LUA_TIMER_OFF_VALUE,
  evaluateBeatorajaLuaBoolean,
  evaluateBeatorajaLuaNumber,
  evaluateBeatorajaLuaSkin,
  isBeatorajaLuaFunctionValue,
} from './beatoraja-skin-lua.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('evaluateBeatorajaLuaSkin', () => {
  it('returns the table value from a trivial entry script', () => {
    const result = evaluateBeatorajaLuaSkin({
      entry: enc('return { name = "demo", w = 1280, h = 720 }'),
      modules: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toEqual({ name: 'demo', w: 1280, h: 720 });
  });

  it('exposes table.insert/ipairs/pairs/string.format', () => {
    const result = evaluateBeatorajaLuaSkin({
      entry: enc(
        [
          'local t = {}',
          'for i = 1, 3 do table.insert(t, string.format("v%d", i)) end',
          'local s = {}',
          'for i, v in ipairs(t) do s[i] = v end',
          'return s',
        ].join('\n'),
      ),
      modules: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toEqual(['v1', 'v2', 'v3']);
  });

  it('runs the beatoraja 2-phase header / main contract via require', () => {
    const mainModule = enc(
      [
        'local M = {}',
        'M.header = { type = 16, name = "demo", w = 1280, h = 720, property = {{name = "X", item = {{name = "On", op = 1}}}} }',
        'function M.main()',
        '  local s = {}',
        '  for k, v in pairs(M.header) do s[k] = v end',
        '  s.option_x = skin_config.option["X"]',
        '  s.offset = skin_config.offset',
        '  return s',
        'end',
        'return M',
      ].join('\n'),
    );
    const entry = enc(
      ['local t = require("mainmod")', 'if skin_config then return t.main() else return t.header end'].join('\n'),
    );
    const modules = [{ name: 'mainmod', source: mainModule }];

    // Phase 1: header.
    const header = evaluateBeatorajaLuaSkin({ entry, modules });
    expect(header.ok).toBe(true);
    if (!header.ok) throw new Error(header.error.message);
    expect(header.value).toEqual({
      type: 16,
      name: 'demo',
      w: 1280,
      h: 720,
      property: [{ name: 'X', item: [{ name: 'On', op: 1 }] }],
    });

    // Phase 2: main with skin_config injected.
    const main = evaluateBeatorajaLuaSkin({
      entry,
      modules,
      skinConfig: { offset: 5, option: { X: 1 } },
    });
    expect(main.ok).toBe(true);
    if (!main.ok) throw new Error(main.error.message);
    expect((main.value as Record<string, unknown>).option_x).toBe(1);
    expect((main.value as Record<string, unknown>).offset).toBe(5);
  });

  it('treats empty Lua tables as empty arrays (so `filepath = {}` is iterable JS-side)', () => {
    // The reference theme writes `filepath = {}`, `property = {}`, etc. and expects the JS side
    // to consume them with `Array.isArray(...)` / `for..of`. Defaulting empty tables to `[]`
    // matches that contract — record-typed tables always have at least one entry, so this only
    // disambiguates the empty case.
    const result = evaluateBeatorajaLuaSkin({
      entry: enc('return { name = "demo", filepath = {}, property = {}, image = {} }'),
      modules: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const skin = result.value as Record<string, unknown>;
    expect(Array.isArray(skin.filepath)).toBe(true);
    expect(Array.isArray(skin.property)).toBe(true);
    expect(Array.isArray(skin.image)).toBe(true);
    expect(skin.filepath).toEqual([]);
  });

  it('reports syntax errors as a failure result', () => {
    const result = evaluateBeatorajaLuaSkin({
      entry: enc('return {'),
      modules: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected syntax error');
    expect(result.error.message).toMatch(/syntax|unexpected/i);
  });

  it('returns an empty stub table for unknown require modules', () => {
    const result = evaluateBeatorajaLuaSkin({
      entry: enc(
        ['local t = require("some_unknown_helper")', 'return { has_table = type(t) == "table", count = 0 }'].join('\n'),
      ),
      modules: [],
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toEqual({ has_table: true, count: 0 });
  });

  it('returns the SAME stub table on repeated require() calls', () => {
    const result = evaluateBeatorajaLuaSkin({
      entry: enc(
        [
          'local a = require("some_unknown_helper")',
          'local b = require("some_unknown_helper")',
          'return { same = a == b }',
        ].join('\n'),
      ),
      modules: [],
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toEqual({ same: true });
  });

  it('preserves runtime Lua functions and evaluates them with a main_state context', () => {
    const result = evaluateBeatorajaLuaSkin({
      entry: enc(
        [
          'local main_state = require("main_state")',
          'local count = 0',
          'return {',
          '  draw = function() return main_state.gauge() >= 80 end,',
          '  value = function() count = count + 1; return main_state.number(10) + count end,',
          '}',
        ].join('\n'),
      ),
      modules: [],
      skinConfig: {},
    });
    if (!result.ok) throw new Error(result.error.message);
    const value = result.value as Record<string, unknown>;
    expect(isBeatorajaLuaFunctionValue(value.draw)).toBe(true);
    expect(isBeatorajaLuaFunctionValue(value.value)).toBe(true);
    if (!isBeatorajaLuaFunctionValue(value.draw) || !isBeatorajaLuaFunctionValue(value.value)) {
      throw new Error('expected runtime Lua functions');
    }
    expect(evaluateBeatorajaLuaBoolean(value.draw, { gauge: () => 79 })).toBe(false);
    expect(evaluateBeatorajaLuaBoolean(value.draw, { gauge: () => 80 })).toBe(true);
    expect(evaluateBeatorajaLuaNumber(value.value, { number: (id) => (id === 10 ? 5 : 0) })).toBe(6);
    expect(evaluateBeatorajaLuaNumber(value.value, { number: (id) => (id === 10 ? 5 : 0) })).toBe(7);
    value.draw.dispose();
    value.value.dispose();
  });

  it('main_state is empty during the header pass', () => {
    const result = evaluateBeatorajaLuaSkin({
      entry: enc('local m = require("main_state"); return { has_gauge = m.gauge ~= nil }'),
      modules: [],
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toEqual({ has_gauge: false });
  });

  it('main_state built-in module exposes the MainStateAccessor surface as default-value stubs', () => {
    const result = evaluateBeatorajaLuaSkin({
      entry: enc(
        [
          'local m = require("main_state")',
          'return {',
          '  is_table = type(m) == "table",',
          '  exscore = m.exscore(),',
          '  rate = m.rate(),',
          '  text = m.text(10),',
          '  option = m.option(123),',
          '  offset_a = m.offset(3).a,',
          '  timer_is_off = m.timer(46) == m.timer_off_value,',
          '  off_value = m.timer_off_value,',
          '  volume_bg = m.volume_bg(),',
          '  set_timer = m.set_timer(10000, 0),',
          '  judge = m.judge(0),',
          '  gauge_type = m.gauge_type(),',
          '}',
        ].join('\n'),
      ),
      modules: [],
      skinConfig: {},
    });
    if (!result.ok) throw new Error(result.error.message);
    const value = result.value as Record<string, unknown>;
    expect(value.is_table).toBe(true);
    expect(value.exscore).toBe(0);
    expect(value.rate).toBe(0);
    expect(value.text).toBe('');
    expect(value.option).toBe(false);
    expect(value.offset_a).toBe(255);
    expect(value.timer_is_off).toBe(true);
    expect(value.off_value).toBe(BEATORAJA_LUA_TIMER_OFF_VALUE);
    expect(value.volume_bg).toBe(0);
    expect(value.set_timer).toBe(true);
    expect(value.judge).toBe(0);
    expect(value.gauge_type).toBe(0);
  });

  it('require accepts both `/` and `.` separators (so `result/util` and `result.util` both resolve)', () => {
    // Both forms must hit the same canonical key in the module table — the loader normalizes `.` → `/`
    // before lookup. We register the module under the slash form (matching how
    // `collectBeatorajaLuaModules` emits keys for nested files).
    const result = evaluateBeatorajaLuaSkin({
      entry: enc(
        [
          'local a = require("result/util")',
          'local b = require("result.util")',
          'return { same = a == b, value = a.x }',
        ].join('\n'),
      ),
      modules: [{ name: 'result/util', source: enc('return { x = 42 }') }],
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toEqual({ same: true, value: 42 });
  });

  it('disables os/io and similar dangerous globals', () => {
    const result = evaluateBeatorajaLuaSkin({
      entry: enc('return { has_os = os ~= nil, has_io = io ~= nil, has_dofile = dofile ~= nil }'),
      modules: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toEqual({ has_os: false, has_io: false, has_dofile: false });
  });
});

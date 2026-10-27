import {
  BEATORAJA_LUA_TIMER_OFF_VALUE,
  evaluateBeatorajaLuaBoolean,
  evaluateBeatorajaLuaSkin,
  isBeatorajaLuaFunctionValue,
} from '@be-music/skin-beatoraja';
import { describe, expect, test } from 'vite-plus/test';
import type { BeatorajaRenderContext } from '../../../skin/beatoraja/render.ts';
import { BeatorajaSkinLuaContext } from './lua-context.ts';

function setup() {
  let index = 2;
  const context = new BeatorajaSkinLuaContext({
    skin: { type: 0, w: 1280, h: 720 },
    textures: {} as never,
    resolveRefValue: (id) => (id === 308 ? index : 0),
    resolveNumberValue: () => 99,
  });
  const frame: BeatorajaRenderContext = {
    activeOps: new Set(),
    nowMs: 1234.5,
    getTimerStart: (id) => (id === 41 ? 1000 : undefined),
  };
  const lua = context.buildLuaRuntimeContext(frame);
  return {
    context,
    frame,
    lua,
    setIndex: (value: number) => {
      index = value;
    },
  };
}

describe('skin Lua option indices and custom timers', () => {
  test('reads image indices, independently of number properties and without caching across frames', () => {
    const { lua, setIndex } = setup();
    expect(lua.eventIndex?.(308)).toBe(2);
    expect(lua.number?.(308)).toBe(99);
    setIndex(1);
    expect(lua.eventIndex?.(308)).toBe(1);
    expect(lua.eventIndex?.(999999)).toBe(0);
  });

  test('starts, changes and stops both boundary custom timers in microseconds', () => {
    const { lua } = setup();
    for (const id of [10000, 19999]) {
      expect(lua.timer?.(id)).toBe(BEATORAJA_LUA_TIMER_OFF_VALUE);
      expect(lua.setTimer?.(id, 1234567)).toBe(true);
      expect(lua.timer?.(id)).toBe(1234567);
      expect(lua.setTimer?.(id, 7654321)).toBe(true);
      expect(lua.timer?.(id)).toBe(7654321);
      expect(lua.setTimer?.(id, BEATORAJA_LUA_TIMER_OFF_VALUE)).toBe(true);
      expect(lua.timer?.(id)).toBe(BEATORAJA_LUA_TIMER_OFF_VALUE);
    }
    expect(lua.setTimer?.(10000, 0)).toBe(true);
    expect(lua.timer?.(10000)).toBe(0);
    expect(lua.setTimer?.(10000, 1234567.9)).toBe(true);
    expect(lua.timer?.(10000)).toBe(1234567);
    expect(lua.time?.()).toBe(1234500);
    expect(lua.timer?.(41)).toBe(1000000);
  });

  test('rejects protected IDs, invalid IDs and non-finite starts without changing system timers', () => {
    const { lua } = setup();
    for (const id of [-1, 0, 41, 9999, 20000, 10000.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(lua.setTimer?.(id, 1000)).toBe(false);
    }
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e30, -1e30]) {
      expect(lua.setTimer?.(10000, value)).toBe(false);
    }
    expect(lua.timer?.(41)).toBe(1000000);
    expect(lua.timer?.(10000)).toBe(BEATORAJA_LUA_TIMER_OFF_VALUE);
  });

  test('retains custom animation state across frames but isolates skin instances', () => {
    const { context, frame, lua } = setup();
    expect(lua.setTimer?.(10000, 1234500)).toBe(true);
    const next = context.buildLuaRuntimeContext({ ...frame, nowMs: 2000 });
    expect(next).toBe(lua);
    expect(next.timer?.(10000)).toBe(1234500);
    expect(setup().lua.timer?.(10000)).toBe(BEATORAJA_LUA_TIMER_OFF_VALUE);
  });

  test('a real Lua closure sees a write immediately through timer and elapsed-time arithmetic', () => {
    const { lua } = setup();
    const parsed = evaluateBeatorajaLuaSkin({
      entry: new TextEncoder().encode(`local m = require('main_state'); return function()
        if m.event_index(308) ~= 2 then return false end
        m.set_timer(10000, m.time() - 500000)
        return m.timer(10000) == 734500 and m.time() - m.timer(10000) == 500000
      end`),
      modules: [],
      skinConfig: {},
    });
    if (!parsed.ok || !isBeatorajaLuaFunctionValue(parsed.value)) throw new Error('Expected Lua closure');
    expect(evaluateBeatorajaLuaBoolean(parsed.value, lua)).toBe(true);
  });
});

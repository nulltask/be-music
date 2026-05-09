import { describe, expect, it } from 'vitest';
import {
  evaluateBeatorajaCustomEvents,
  evaluateBeatorajaCustomTimers,
  normalizeBeatorajaCustomEvents,
  normalizeBeatorajaCustomTimers,
  type BeatorajaCustomEventState,
} from './beatoraja-skin-customevent.ts';
import { evaluateBeatorajaLuaSkin, isBeatorajaLuaFunctionValue } from './beatoraja-skin-lua.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

/**
 * Helper — evaluate a Lua snippet that returns a `{ condition, action }` table and yield
 * back the function refs as JS-shaped `BeatorajaLuaFunctionValue` objects. Used to mint
 * realistic event tables for tests.
 */
function makeEventTable(luaSrc: string): { condition?: unknown; action?: unknown; minInterval?: number; id?: number } {
  const result = evaluateBeatorajaLuaSkin({ entry: enc(luaSrc), modules: [] });
  if (!result.ok) throw new Error(result.error.message);
  return result.value as { condition?: unknown; action?: unknown; minInterval?: number; id?: number };
}

describe('normalizeBeatorajaCustomEvents', () => {
  it('keeps entries with at least a condition or action', () => {
    const table = makeEventTable(
      [
        'local fired = 0',
        'return {',
        '  id = 1,',
        '  condition = function() return true end,',
        '  action = function() fired = fired + 1 end,',
        '  minInterval = 50,',
        '}',
      ].join('\n'),
    );
    const out = normalizeBeatorajaCustomEvents([table]);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe(1);
    expect(out[0]?.minInterval).toBe(50);
    expect(isBeatorajaLuaFunctionValue(out[0]?.condition)).toBe(true);
    expect(isBeatorajaLuaFunctionValue(out[0]?.action)).toBe(true);
  });

  it('accepts numeric op-id conditions (gates on activeOps via runtime context)', () => {
    const table = makeEventTable(
      ['return { id = 1, condition = 920, action = function() end }'].join('\n'),
    );
    const out = normalizeBeatorajaCustomEvents([table]);
    expect(out[0]?.condition).toBe(920);
  });

  it('drops entries without any usable field', () => {
    expect(normalizeBeatorajaCustomEvents([{}, { id: 1 }, { minInterval: 50 }])).toEqual([]);
  });

  it('returns [] for non-array input', () => {
    expect(normalizeBeatorajaCustomEvents(undefined)).toEqual([]);
    expect(normalizeBeatorajaCustomEvents(null)).toEqual([]);
  });
});

describe('evaluateBeatorajaCustomEvents (edge detection + rate limit)', () => {
  it('fires action exactly once when condition flips false → true', () => {
    let fired = 0;
    const result = evaluateBeatorajaLuaSkin({
      entry: enc(
        [
          'local main_state = require("main_state")',
          'return {',
          '  condition = function() return main_state.option(1) end,',
          '  action = function() return "fired" end,',
          '}',
        ].join('\n'),
      ),
      modules: [],
      skinConfig: { offset: 0, option: {}, file: {} },
    });
    if (!result.ok) throw new Error(result.error.message);
    const events = normalizeBeatorajaCustomEvents([result.value]);
    const state: BeatorajaCustomEventState[] = [];

    // Spy the action by wrapping its evaluate.
    const original = events[0]!.action!.evaluate.bind(events[0]!.action);
    events[0]!.action!.evaluate = (ctx, args) => {
      fired += 1;
      return original(ctx, args);
    };

    let condition = false;
    const ctx = { option: () => condition };

    // Frame 1: condition false → no fire.
    expect(evaluateBeatorajaCustomEvents(events, state, ctx, 0)).toBe(0);
    expect(fired).toBe(0);

    // Frame 2: condition flips to true → fire once.
    condition = true;
    expect(evaluateBeatorajaCustomEvents(events, state, ctx, 100)).toBe(1);
    expect(fired).toBe(1);

    // Frame 3: condition stays true → no re-fire (edge detection).
    expect(evaluateBeatorajaCustomEvents(events, state, ctx, 200)).toBe(0);
    expect(fired).toBe(1);

    // Frame 4: condition flips back to false → no fire.
    condition = false;
    expect(evaluateBeatorajaCustomEvents(events, state, ctx, 300)).toBe(0);

    // Frame 5: condition flips back to true → fire again.
    condition = true;
    expect(evaluateBeatorajaCustomEvents(events, state, ctx, 400)).toBe(1);
    expect(fired).toBe(2);
  });

  it('respects minInterval rate limit between successive flips', () => {
    let fired = 0;
    const result = evaluateBeatorajaLuaSkin({
      entry: enc(
        [
          'local main_state = require("main_state")',
          'return {',
          '  condition = function() return main_state.option(1) end,',
          '  action = function() return nil end,',
          '  minInterval = 100,',
          '}',
        ].join('\n'),
      ),
      modules: [],
      skinConfig: { offset: 0, option: {}, file: {} },
    });
    if (!result.ok) throw new Error(result.error.message);
    const events = normalizeBeatorajaCustomEvents([result.value]);
    const state: BeatorajaCustomEventState[] = [];

    const original = events[0]!.action!.evaluate.bind(events[0]!.action);
    events[0]!.action!.evaluate = (c, a) => {
      fired += 1;
      return original(c, a);
    };

    let cond = false;
    const ctx = { option: () => cond };

    // Flip true at t=0 → fires.
    cond = true;
    evaluateBeatorajaCustomEvents(events, state, ctx, 0);
    expect(fired).toBe(1);

    // Flip false → true at t=50, but minInterval=100 → suppressed.
    cond = false;
    evaluateBeatorajaCustomEvents(events, state, ctx, 25);
    cond = true;
    evaluateBeatorajaCustomEvents(events, state, ctx, 50);
    expect(fired).toBe(1);

    // Flip false → true at t=150 (= 150ms since first fire) → fires again.
    cond = false;
    evaluateBeatorajaCustomEvents(events, state, ctx, 100);
    cond = true;
    evaluateBeatorajaCustomEvents(events, state, ctx, 150);
    expect(fired).toBe(2);
  });
});

describe('normalizeBeatorajaCustomTimers + evaluator', () => {
  it('stamps the engine timer when the Lua function returns a new value', () => {
    const result = evaluateBeatorajaLuaSkin({
      entry: enc(
        [
          'local v = 5000',
          'return { id = 100, timer = function() v = v + 1000; return v end }',
        ].join('\n'),
      ),
      modules: [],
    });
    if (!result.ok) throw new Error(result.error.message);
    const timers = normalizeBeatorajaCustomTimers([result.value]);
    expect(timers).toHaveLength(1);
    const stamps: Array<[number, number]> = [];
    const state: number[] = [];
    evaluateBeatorajaCustomTimers(timers, state, undefined, (id, v) => stamps.push([id, v]));
    evaluateBeatorajaCustomTimers(timers, state, undefined, (id, v) => stamps.push([id, v]));
    // Each call returns a different value (function increments) → each call stamps.
    expect(stamps).toEqual([
      [100, 6000],
      [100, 7000],
    ]);
  });
});

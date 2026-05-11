import { describe, expect, it } from 'vitest';
import { buildBaseOpSet, flattenBeatorajaElements, isElementVisible } from './base.ts';

describe('flattenBeatorajaElements', () => {
  it('passes through plain elements as-is', () => {
    const out = flattenBeatorajaElements([{ id: 1 }, { id: 2 }]);
    expect(out).toEqual([
      { fields: { id: 1 }, ifCodes: [] },
      { fields: { id: 2 }, ifCodes: [] },
    ]);
  });

  it('flattens conditional `values` blocks and attaches `if` codes', () => {
    const out = flattenBeatorajaElements([{ if: [920], values: [{ id: 'a' }, { id: 'b' }] }, { id: 'c' }]);
    expect(out).toEqual([
      { fields: { id: 'a' }, ifCodes: [920] },
      { fields: { id: 'b' }, ifCodes: [920] },
      { fields: { id: 'c' }, ifCodes: [] },
    ]);
  });

  it('flattens single-element `value` overrides', () => {
    const out = flattenBeatorajaElements([{ if: [922], value: { time: 0, x: 40 } }]);
    expect(out).toEqual([{ fields: { time: 0, x: 40 }, ifCodes: [922] }]);
  });

  it('AND-merges nested `if` blocks', () => {
    const out = flattenBeatorajaElements([
      {
        if: [920],
        values: [{ if: [901], values: [{ id: 'inner' }] }],
      },
    ]);
    expect(out).toEqual([{ fields: { id: 'inner' }, ifCodes: [920, 901] }]);
  });

  it('drops malformed entries silently', () => {
    const out = flattenBeatorajaElements([null, undefined, 42, 'x']);
    expect(out).toEqual([]);
  });
});

describe('isElementVisible', () => {
  it('shows an unconditional element', () => {
    expect(isElementVisible([], new Set())).toBe(true);
  });

  it('hides when a positive op is missing', () => {
    expect(isElementVisible([920], new Set())).toBe(false);
    expect(isElementVisible([920], new Set([920]))).toBe(true);
  });

  it('hides when a negated op is active', () => {
    expect(isElementVisible([-920], new Set([920]))).toBe(false);
    expect(isElementVisible([-920], new Set())).toBe(true);
  });

  it('requires every code to be satisfied', () => {
    expect(isElementVisible([920, 901], new Set([920]))).toBe(false);
    expect(isElementVisible([920, 901], new Set([920, 901]))).toBe(true);
  });
});

describe('buildBaseOpSet', () => {
  it('extracts positive op codes from a property->op map', () => {
    expect(buildBaseOpSet({ A: 920, B: 901 })).toEqual(new Set([920, 901]));
  });

  it('ignores zero/negative/non-finite values', () => {
    expect(buildBaseOpSet({ A: 0, B: -5, C: Number.NaN })).toEqual(new Set());
  });
});

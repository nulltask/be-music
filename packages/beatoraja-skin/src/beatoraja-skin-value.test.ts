import { describe, expect, it } from 'vitest';
import { composeBeatorajaValueCells, composeBeatorajaValueShift } from './beatoraja-skin-value.ts';

describe('composeBeatorajaValueShift', () => {
  it('returns 0 for align=0 (right / no-shift) regardless of value', () => {
    // align=0 is beatoraja's "natural-right" layout — leading blanks/zeros stay on the LEFT,
    // significant digits land on the right. No shift. Most authoring uses this default.
    expect(composeBeatorajaValueShift({ align: 0, digit: 4, space: 0 }, 5, 18)).toBe(0);
    expect(composeBeatorajaValueShift({ align: 0, digit: 4, space: 0 }, 0, 18)).toBe(0);
    expect(composeBeatorajaValueShift({ align: 0, digit: 4, space: 0 }, 9999, 18)).toBe(0);
  });

  it('shifts left by shiftbase * slotWidth for align=1 (left-flush)', () => {
    // align=1: digits flush against the rect's LEFT edge by sliding leading nulls off-screen.
    // shiftbase = digit - usedDigits - signCount.
    expect(composeBeatorajaValueShift({ align: 1, digit: 4, space: 0 }, 5, 18)).toBe(54); // 3 leading nulls * 18
    expect(composeBeatorajaValueShift({ align: 1, digit: 4, space: 0 }, 12, 18)).toBe(36); // 2 leading nulls * 18
    expect(composeBeatorajaValueShift({ align: 1, digit: 4, space: 0 }, 1234, 18)).toBe(0); // no leading nulls
    expect(composeBeatorajaValueShift({ align: 1, digit: 4, space: 0 }, -7, 18)).toBe(36); // sign + 1 digit = 2 used → 2 leading nulls
  });

  it('shifts left by half for align=2 (centered)', () => {
    expect(composeBeatorajaValueShift({ align: 2, digit: 4, space: 0 }, 5, 18)).toBe(27); // 3 * 18 / 2
    expect(composeBeatorajaValueShift({ align: 2, digit: 4, space: 0 }, 12, 18)).toBe(18); // 2 * 18 / 2
    expect(composeBeatorajaValueShift({ align: 2, digit: 4, space: 0 }, 1234, 18)).toBe(0);
  });

  it('handles overflow (more digits than slots) without negative shift', () => {
    // A value that doesn't fit gets truncated by the composer; shift never goes negative.
    expect(composeBeatorajaValueShift({ align: 1, digit: 2, space: 0 }, 12345, 18)).toBe(0);
    expect(composeBeatorajaValueShift({ align: 2, digit: 2, space: 0 }, 12345, 18)).toBe(0);
  });

  it('treats unknown align values as no-shift (defensive)', () => {
    // Java only honors 0/1/2; any other value is undefined behavior. We fall back to 0 (= no shift)
    // so a malformed skin doesn't visually shift everything off-screen.
    expect(composeBeatorajaValueShift({ align: 99, digit: 4, space: 0 }, 5, 18)).toBe(0);
    expect(composeBeatorajaValueShift({ align: -1, digit: 4, space: 0 }, 5, 18)).toBe(0);
  });

  it('coerces non-finite values to 0 before measuring digit count', () => {
    // Defensive against a Lua property returning NaN — treat as `value=0` (length 1) so we don't
    // produce NaN shifts that propagate into sprite.x and crash the renderer.
    expect(composeBeatorajaValueShift({ align: 1, digit: 4, space: 0 }, NaN, 18)).toBe(54);
    expect(composeBeatorajaValueShift({ align: 1, digit: 4, space: 0 }, Infinity, 18)).toBe(54);
  });

  it('honors element.space in the shift formula (slotWidth + space)', () => {
    // beatoraja's formula is `(slotW + space) * shiftbase`, so a non-zero space widens the
    // shift proportionally. Used by digit fonts that author small inter-digit gaps.
    expect(composeBeatorajaValueShift({ align: 1, digit: 4, space: 2 }, 5, 18)).toBe(60); // 3 * (18+2)
    expect(composeBeatorajaValueShift({ align: 2, digit: 4, space: 2 }, 5, 18)).toBe(30); // half
  });

  it('treats a non-finite space as 0 (defensive)', () => {
    expect(composeBeatorajaValueShift({ align: 1, digit: 4, space: NaN }, 5, 18)).toBe(54);
  });
});

describe('composeBeatorajaValueCells (24-cell signed dual-strip — audit 2.7)', () => {
  // Common dual-strip element: 24 cells (12 positive 0..11, 12 negative 12..23). Cells 0..9
  // are positive digits, 10 is positive blank, 11 is positive sign; 12..21 are negative
  // digits, 22 is negative blank, 23 is negative sign. The 5 dst-rect dimensions are
  // arbitrary — we just verify cell index selection.
  const dualStripElement = {
    id: 'diff',
    src: 4,
    x: 0,
    y: 0,
    w: 240,
    h: 24,
    divx: 24,
    divy: 1,
    digit: 4,
    padding: 0,
    zeropadding: 0,
    space: 0,
    ref: 0,
    align: 0,
    offsets: [],
    ifCodes: [],
  };

  it('positive value uses cells 0..11 (positive half)', () => {
    const cells = composeBeatorajaValueCells(dualStripElement, 12);
    // Last two slots = "1", "2" (cells 1 and 2); leading two = blank (cell 10).
    expect(cells.map((c) => c.cell)).toEqual([10, 10, 1, 2]);
  });

  it('negative value uses cells 12..23 (negative half) with sign baked into digits', () => {
    const cells = composeBeatorajaValueCells(dualStripElement, -12);
    // Last two slots = "1", "2" in the NEGATIVE half (cells 13, 14). Leading slots = the
    // negative-half blank (cell 22). No separate sign cell is emitted — the negative-coloured
    // glyphs encode the sign visually.
    expect(cells.map((c) => c.cell)).toEqual([22, 22, 13, 14]);
  });

  it('legacy single-strip (divx=12) keeps separate-sign behavior', () => {
    // Sanity: the existing 12-cell layout should still emit a sign slot at divx-1 for
    // negative values. Confirms the dual-strip branch only triggers for divx % 24 == 0.
    const single = { ...dualStripElement, divx: 12 };
    const cells = composeBeatorajaValueCells(single, -12);
    // Layout: blank, sign(cell 11), "1"(cell 1), "2"(cell 2).
    expect(cells.map((c) => c.cell)).toEqual([11, 11, 1, 2]);
  });

  it('positive zero on dual-strip uses positive blanks for leading slots', () => {
    const cells = composeBeatorajaValueCells(dualStripElement, 0);
    expect(cells.map((c) => c.cell)).toEqual([10, 10, 10, 0]);
  });
});

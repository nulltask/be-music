import { describe, expect, it } from 'vitest';
import {
  beatorajaFloatValueSlotCount,
  composeBeatorajaFloatValueCells,
  composeBeatorajaFloatValueShift,
  normalizeBeatorajaFloatValues,
  type BeatorajaFloatValueElement,
} from './beatoraja-skin-floatvalue.ts';

describe('normalizeBeatorajaFloatValues', () => {
  it('parses iketa / fketa / gain / isSignvisible from a representative authoring', () => {
    // Mirrors a typical Result-screen accuracy display: two integer digits + two fractional
    // digits, scaling the underlying op by 0.01, with sign visibility off (`+98.76 %` would
    // render as `98.76` here unless isSignvisible flips on).
    const out = normalizeBeatorajaFloatValues([
      {
        id: 'accuracy',
        src: 4,
        x: 0,
        y: 0,
        w: 240,
        h: 24,
        divx: 11,
        digit: 4,
        iketa: 2,
        fketa: 2,
        gain: 0.01,
        isSignvisible: true,
        ref: 100,
      },
    ]);
    expect(out[0]).toMatchObject({
      id: 'accuracy',
      src: 4,
      iketa: 2,
      fketa: 2,
      gain: 0.01,
      isSignvisible: true,
      ref: 100,
    });
  });

  it('falls back to gain=1 / isSignvisible=false when omitted', () => {
    const out = normalizeBeatorajaFloatValues([{ id: 'bpm', src: 4 }]);
    expect(out[0]).toMatchObject({ gain: 1, isSignvisible: false, iketa: 0, fketa: 0 });
  });

  it('drops entries without a usable id', () => {
    expect(normalizeBeatorajaFloatValues([{ src: 4 }, {}])).toEqual([]);
  });

  it('preserves zeropadding / padding / space / align fields shared with value[]', () => {
    const out = normalizeBeatorajaFloatValues([
      { id: 'x', src: 4, padding: 1, zeropadding: 1, space: 2, align: 1 },
    ]);
    expect(out[0]).toMatchObject({ padding: 1, zeropadding: 1, space: 2, align: 1 });
  });

  it('respects flat-vs-conditional flattening like other element parsers', () => {
    const out = normalizeBeatorajaFloatValues([
      { if: [920], values: [{ id: 'gated', src: 4 }] },
    ]);
    expect(out[0]).toMatchObject({ id: 'gated', ifCodes: [920] });
  });
});

describe('composeBeatorajaFloatValueCells', () => {
  // Sample 12-cell strip: cells 0..9 = digits, cell 10 = sign/blank, cell 11 = dot.
  // 12-cell width = 240px → cellW = 20px; height = 24px (single row, divy = 1).
  const baseElement = {
    id: 'bpm',
    src: 4,
    x: 0,
    y: 0,
    w: 240,
    h: 24,
    divx: 12,
    divy: 1,
    iketa: 3,
    fketa: 1,
    gain: 1,
    isSignvisible: false,
    space: 0,
    padding: 0,
    zeropadding: 0,
    align: 0,
    ref: 92,
    ifCodes: [],
  } as const;

  it('produces iketa + (fketa>0?1:0) + fketa slots', () => {
    expect(beatorajaFloatValueSlotCount(baseElement)).toBe(3 + 1 + 1); // 5
    expect(beatorajaFloatValueSlotCount({ ...baseElement, fketa: 0 })).toBe(3); // no dot
  });

  it('formats 123.4 as [1, 2, 3, dot, 4] cells against a 12-cell strip', () => {
    const cells = composeBeatorajaFloatValueCells(baseElement, 123.4);
    expect(cells).toHaveLength(5);
    // Integer digits 1, 2, 3 — natural-aligned (no leading blanks needed for 3-digit value)
    expect(cells[0]).toMatchObject({ cell: 1, hidden: false });
    expect(cells[1]).toMatchObject({ cell: 2, hidden: false });
    expect(cells[2]).toMatchObject({ cell: 3, hidden: false });
    // Dot at cell 11 (last cell of the 12-cell strip)
    expect(cells[3]).toMatchObject({ cell: 11, hidden: false });
    // Fractional digit 4
    expect(cells[4]).toMatchObject({ cell: 4, hidden: false });
  });

  it('applies gain before formatting (raw 9876 → 98.76 with gain=0.01)', () => {
    // gain=1 baseline: 9876 with iketa=2 fketa=2 truncates to last 2 integer digits → "76.00"
    // → cells [7, 6, dot, 0, 0]. Beatoraja's own renderer does the same low-bit truncation.
    const ungained = composeBeatorajaFloatValueCells(
      { ...baseElement, iketa: 2, fketa: 2 },
      9876,
    );
    expect(ungained.map((c) => c.cell)).toEqual([7, 6, 11, 0, 0]);
    // gain=0.01 scales the raw integer down to a percentage: 9876 → 98.76 → cells [9, 8, dot, 7, 6].
    const gained = composeBeatorajaFloatValueCells(
      { ...baseElement, iketa: 2, fketa: 2, gain: 0.01 },
      9876,
    );
    expect(gained.map((c) => c.cell)).toEqual([9, 8, 11, 7, 6]);
  });

  it('zero-pads the fractional half — 1 displayed as 1.0 with fketa=1', () => {
    const cells = composeBeatorajaFloatValueCells({ ...baseElement, iketa: 1, fketa: 1 }, 1);
    expect(cells.map((c) => c.cell)).toEqual([1, 11, 0]);
  });

  it('right-aligns the integer half with leading blanks (padding=0, divx>=11 has blank)', () => {
    // 5.0 with iketa=3 → leading 2 blanks + "5" + dot + "0"
    const cells = composeBeatorajaFloatValueCells(baseElement, 5);
    // blank cell index = divx - 1 - 1 = 10 (the "blank" cell before the dot)... actually for
    // single-strip with divx=12, our impl uses `halfDivx - 1 = 11` as blank. Let me check:
    // composeBeatorajaFloatValueCells single-strip path: `blankCellInHalf = halfDivx - 1` when
    // !isSignedDualStrip. For divx=12, halfDivx=12, blank = 11. So leading blanks paint cell 11.
    expect(cells[0]).toMatchObject({ cell: 11, hidden: false });
    expect(cells[1]).toMatchObject({ cell: 11, hidden: false });
    expect(cells[2]).toMatchObject({ cell: 5, hidden: false });
  });

  it('right-aligns with leading zeros when padding=1', () => {
    const cells = composeBeatorajaFloatValueCells({ ...baseElement, padding: 1 }, 5);
    // 005.0 → leading zeros at cell 0
    expect(cells[0]).toMatchObject({ cell: 0, hidden: false });
    expect(cells[1]).toMatchObject({ cell: 0, hidden: false });
    expect(cells[2]).toMatchObject({ cell: 5, hidden: false });
  });

  it('omits the dot slot when fketa=0', () => {
    const cells = composeBeatorajaFloatValueCells({ ...baseElement, fketa: 0 }, 123);
    expect(cells.map((c) => c.cell)).toEqual([1, 2, 3]);
  });

  it('hides the dot slot when divx < 12 (no dot glyph in strip)', () => {
    const cells = composeBeatorajaFloatValueCells({ ...baseElement, divx: 10, fketa: 1 }, 5);
    // Slot order [blank?, blank?, 5, dot-hidden, 0]
    expect(cells[3]).toMatchObject({ hidden: true });
  });
});

describe('composeBeatorajaFloatValueShift', () => {
  // 10-cell strip (digits-only, no blank cell available) — leading int slots are HIDDEN
  // when the value's int part has fewer digits than `iketa`. shiftbase is the leading-
  // hidden count.
  const digitOnlyElement: BeatorajaFloatValueElement = {
    id: 'fv',
    src: 4,
    x: 0,
    y: 0,
    w: 240,
    h: 24,
    divx: 10,
    divy: 1,
    iketa: 3,
    fketa: 0,
    gain: 1,
    isSignvisible: false,
    space: 0,
    padding: 0,
    zeropadding: 0,
    align: 0,
    ref: 0,
    ifCodes: [],
  };

  it('returns 0 when align=0 (right-flush, the upstream default)', () => {
    // No shift needed — the existing right-flush layout already lands the digits at the
    // right edge of the slot box. align=0 short-circuits before composing cells.
    expect(composeBeatorajaFloatValueShift({ ...digitOnlyElement, align: 0 }, 5, 40)).toBe(0);
  });

  it('returns 0 when the rendered value fills the slot box (no leading blanks)', () => {
    // value=123 in iketa=3 — every slot is significant, so shiftbase=0, no shift.
    expect(composeBeatorajaFloatValueShift({ ...digitOnlyElement, align: 1 }, 123, 40)).toBe(0);
    expect(composeBeatorajaFloatValueShift({ ...digitOnlyElement, align: 2 }, 123, 40)).toBe(0);
  });

  it('returns full shiftbase * (slotWidth + space) for align=1 (LEFT-flush)', () => {
    // value=5 in iketa=3 → 2 leading hidden slots → shift = 2 * 40 = 80. The renderer
    // SUBTRACTS this from each slot's x so the visible "5" flushes against the dst's
    // left edge.
    expect(composeBeatorajaFloatValueShift({ ...digitOnlyElement, align: 1 }, 5, 40)).toBe(80);
  });

  it('returns half shiftbase * slotWidth for align=2 (CENTER)', () => {
    // value=5, shiftbase=2, slotW=40 → shift = 2 * 40 * 0.5 = 40.
    expect(composeBeatorajaFloatValueShift({ ...digitOnlyElement, align: 2 }, 5, 40)).toBe(40);
  });

  it('honors `space` when non-zero', () => {
    // value=5, shiftbase=2, slotW=40, space=4 → shift = 2 * (40+4) = 88 for align=1.
    const withSpace = { ...digitOnlyElement, align: 1, space: 4 };
    expect(composeBeatorajaFloatValueShift(withSpace, 5, 40)).toBe(88);
  });

  it('floats with fketa>0 still shift only on leading int blanks (dot + frac always painted)', () => {
    // iketa=3, fketa=1, divx=10 (slots: [int-2, int-1, int-0, dot-hidden, frac-0]).
    // For divx=10 (digits-only, no blank cell glyph), leading int pads are HIDDEN per
    // the composer's "no blank cell → hide" branch. Frac slots are zero-padded (painted)
    // even when the source value's fractional part is shorter. value=5 → "5.0" with two
    // leading hidden int slots → shiftbase = 2.
    const withFrac = { ...digitOnlyElement, fketa: 1, align: 2 };
    expect(composeBeatorajaFloatValueShift(withFrac, 5, 40)).toBe(40); // = 2 * 40 / 2
  });

  it('treats blank-cell-painted leading slots as significant (divx>=12, no shift)', () => {
    // Divx=12 carries an explicit blank glyph cell — leading int pads use it (hidden=false,
    // cell=11) rather than being skipped. Beatoraja's `SkinNumber.prepare()` only counts
    // slots with `currentImages[i] == null` toward shiftbase, so painted-blank slots don't
    // contribute. Result: align=2 still leaves the row at the dst's authored x.
    const withBlankCell = { ...digitOnlyElement, divx: 12, align: 2 };
    expect(composeBeatorajaFloatValueShift(withBlankCell, 5, 40)).toBe(0);
  });
});

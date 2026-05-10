import { describe, expect, it } from 'vitest';
import {
  composeBeatorajaValueCells,
  composeBeatorajaValueShift,
  valueFrameAt,
  type BeatorajaValueElement,
} from './beatoraja-skin-value.ts';

// ─── Test fixtures ────────────────────────────────────────────────────────────────────────
// Single-strip 10-cell (digits-only — leading slots are HIDDEN per upstream's
// `mimage == null && zeropadding == 0` null branch).
function singleStrip10(overrides: Partial<BeatorajaValueElement> = {}): BeatorajaValueElement {
  return {
    id: 'v',
    src: 0,
    x: 0,
    y: 0,
    w: 180,
    h: 18,
    divx: 10,
    divy: 1,
    digit: 4,
    padding: 0,
    zeropadding: 0,
    space: 0,
    ref: 0,
    align: 0,
    offsets: [],
    cycle: 0,
    ifCodes: [],
    ...overrides,
  };
}

// 24-cell signed dual-strip: 12 positive cells (0..11) + 12 negative cells (12..23).
// Layout per half: cells 0..9 = digits, 10 = blank, 11 = sign.
function dualStrip(overrides: Partial<BeatorajaValueElement> = {}): BeatorajaValueElement {
  return {
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
    cycle: 0,
    ifCodes: [],
    ...overrides,
  };
}

describe('composeBeatorajaValueShift', () => {
  // Single-strip 10-cell with digit=4, padding=0 (the natural "leading nulls hidden" path —
  // upstream's `mimage == null && zeropadding == 0` branch produces null for leading slots,
  // and `shiftbase` counts those nulls).
  it('returns 0 for align=0 (right / no-shift) regardless of value', () => {
    expect(composeBeatorajaValueShift(singleStrip10({ align: 0 }), 5, 18)).toBe(0);
    expect(composeBeatorajaValueShift(singleStrip10({ align: 0 }), 0, 18)).toBe(0);
    expect(composeBeatorajaValueShift(singleStrip10({ align: 0 }), 9999, 18)).toBe(0);
  });

  it('shifts left by shiftbase * slotWidth for align=1 (left-flush)', () => {
    // shiftbase = number of HIDDEN cells per upstream `SkinNumber.java:178-181`.
    // value=5: 1 digit + 3 hidden leading = 3 * 18 = 54.
    expect(composeBeatorajaValueShift(singleStrip10({ align: 1 }), 5, 18)).toBe(54);
    // value=12: 2 digits + 2 hidden = 2 * 18 = 36.
    expect(composeBeatorajaValueShift(singleStrip10({ align: 1 }), 12, 18)).toBe(36);
    // value=1234: no leading nulls.
    expect(composeBeatorajaValueShift(singleStrip10({ align: 1 }), 1234, 18)).toBe(0);
    // Negative on single-strip with `mimage == null` is rendered via Math.abs (upstream
    // `SkinNumber.java:160`), so -7 → "7" with 3 hidden leading = 54. Previously our impl
    // emitted a separate sign cell, costing one slot — that was non-faithful (audit A-3).
    expect(composeBeatorajaValueShift(singleStrip10({ align: 1 }), -7, 18)).toBe(54);
  });

  it('shifts left by half for align=2 (centered)', () => {
    expect(composeBeatorajaValueShift(singleStrip10({ align: 2 }), 5, 18)).toBe(27); // 3 * 18 / 2
    expect(composeBeatorajaValueShift(singleStrip10({ align: 2 }), 12, 18)).toBe(18); // 2 * 18 / 2
    expect(composeBeatorajaValueShift(singleStrip10({ align: 2 }), 1234, 18)).toBe(0);
  });

  it('handles overflow (more digits than slots) without negative shift', () => {
    // A value that doesn't fit truncates to the lowest digits; no hidden slots → no shift.
    expect(composeBeatorajaValueShift(singleStrip10({ align: 1, digit: 2 }), 12345, 18)).toBe(0);
    expect(composeBeatorajaValueShift(singleStrip10({ align: 2, digit: 2 }), 12345, 18)).toBe(0);
  });

  it('treats unknown align values as no-shift (defensive)', () => {
    // Upstream only honors 0/1/2; any other value falls through. Our default (0) treatment
    // returns 0 here so malformed skins don't visually shift everything off-screen.
    expect(composeBeatorajaValueShift(singleStrip10({ align: 99 }), 5, 18)).toBe(0);
    expect(composeBeatorajaValueShift(singleStrip10({ align: -1 }), 5, 18)).toBe(0);
  });

  it('coerces non-finite values to 0 before measuring digit count', () => {
    // NaN / Infinity → treated as 0 (length 1), 3 hidden leading slots.
    expect(composeBeatorajaValueShift(singleStrip10({ align: 1 }), NaN, 18)).toBe(54);
    expect(composeBeatorajaValueShift(singleStrip10({ align: 1 }), Infinity, 18)).toBe(54);
  });

  it('honors element.space in the shift formula (slotWidth + space)', () => {
    // Upstream's formula is `(slotW + space) * shiftbase`, so a non-zero space widens the
    // shift proportionally. Used by digit fonts that author small inter-digit gaps.
    expect(composeBeatorajaValueShift(singleStrip10({ align: 1, space: 2 }), 5, 18)).toBe(60); // 3 * (18+2)
    expect(composeBeatorajaValueShift(singleStrip10({ align: 2, space: 2 }), 5, 18)).toBe(30); // half
  });

  it('treats a non-finite space as 0 (defensive)', () => {
    expect(composeBeatorajaValueShift(singleStrip10({ align: 1, space: NaN }), 5, 18)).toBe(54);
  });
});

describe('composeBeatorajaValueCells (audit A-3 — upstream-faithful 24-cell zeropadding)', () => {
  // Mirrors `SkinNumber.java:161-184`. Pad-mode dispatch:
  //   - 24-cell (`divx % 24 == 0`): SkinNumber's zeropadding param ← `value.zeropadding`.
  //   - 11-cell: forced to `2` (blank).
  //   - 10-cell: SkinNumber's zeropadding param ← `value.padding`.
  //
  // Per-slot logic (RTL walk j = keta-1 → 0):
  //   - 24-cell with zp > 0:  j==0 → sign; j==keta-1 || value>0 → digit; else → pad cell.
  //   - 24-cell with zp == 0: digit when value>0 || j==keta-1; sign cell to LEFT of leftmost
  //                            non-null; rest hidden.
  //   - single-strip (mimage == null): digit when value>0 || j==keta-1; pad/zero/HIDDEN
  //                                     based on zp.

  describe('24-cell with zeropadding=0 (default)', () => {
    it('positive value=12: digits at right, sign cell at j=1 (slot to LEFT of leftmost digit), j=0 hidden', () => {
      // Upstream walk for value=12, keta=4:
      //   j=3: digit '2'           → cell 2 (positive half).
      //   j=2: digit '1'           → cell 1.
      //   j=1: zp=0, slots[2]≠sign → sign cell of positive half (cell 11).
      //   j=0: slots[1]==sign       → null (hidden).
      const cells = composeBeatorajaValueCells(dualStrip(), 12);
      expect(cells.map((c) => c.cell)).toEqual([-1, 11, 1, 2]);
      expect(cells[0]?.hidden).toBe(true);
    });

    it('negative value=-12: digits in negative half, sign cell at j=1 in negative half (cell 23)', () => {
      // For negative, active half = mimage. Cells offset by halfDivx=12. Sign cell of
      // negative half = signCellInHalf(11) + 12 = 23.
      const cells = composeBeatorajaValueCells(dualStrip(), -12);
      expect(cells.map((c) => c.cell)).toEqual([-1, 23, 13, 14]);
      expect(cells[0]?.hidden).toBe(true);
    });

    it('positive zero=0: only j=keta-1 has cell 0, sign at j=keta-2, rest hidden', () => {
      // Walk: j=3 → cell 0 ('0'); j=2 → sign cell 11; j=1, j=0 → hidden.
      const cells = composeBeatorajaValueCells(dualStrip(), 0);
      expect(cells.map((c) => c.cell)).toEqual([-1, -1, 11, 0]);
      expect(cells[0]?.hidden).toBe(true);
      expect(cells[1]?.hidden).toBe(true);
    });
  });

  describe('24-cell with zeropadding=2 (blank pad)', () => {
    it('positive value=12: sign at j=0, leading blank, digits — full slot occupancy', () => {
      // Walk for value=12, keta=4, zp=2:
      //   j=3: digit '2' → cell 2.
      //   j=2: digit '1' → cell 1.
      //   j=1: zp=2 → blank cell 10.
      //   j=0: sign cell 11 (zp>0 always lands sign at j=0 in 24-cell mode).
      const cells = composeBeatorajaValueCells(dualStrip({ zeropadding: 2 }), 12);
      expect(cells.map((c) => c.cell)).toEqual([11, 10, 1, 2]);
      expect(cells.every((c) => !c.hidden)).toBe(true);
    });

    it('negative value=-12: negative-half sign at j=0, negative-half blank at j=1, digits', () => {
      // Cells: sign=11+12=23, blank=10+12=22, digits offset by 12.
      const cells = composeBeatorajaValueCells(dualStrip({ zeropadding: 2 }), -12);
      expect(cells.map((c) => c.cell)).toEqual([23, 22, 13, 14]);
    });
  });

  describe('24-cell with zeropadding=1 (zero pad)', () => {
    it('positive value=12: sign at j=0, leading "0", digits', () => {
      // Walk for value=12, keta=4, zp=1: j=3 → '2'; j=2 → '1'; j=1 → cell 0 ("0"); j=0 → sign cell 11.
      const cells = composeBeatorajaValueCells(dualStrip({ zeropadding: 1 }), 12);
      expect(cells.map((c) => c.cell)).toEqual([11, 0, 1, 2]);
    });
  });

  describe('legacy single-strip (divx=12)', () => {
    it('negative value=-12 with mimage==null is rendered as Math.abs (no separate sign cell)', () => {
      // Upstream `SkinNumber.java:160` runs `value = Math.abs(value)` and then `images = (value
      // >= 0 || mimage == null) ? this.image : mimage` — single-strip skins always use the
      // positive image set. Negative input renders identically to its absolute value, with
      // leading slots HIDDEN per the `mimage == null && zp == 0` null branch.
      // Walk for value=12 (after abs), keta=4, single 12-cell, zp=0:
      //   j=3: '2'; j=2: '1'; j=1: zp=0, mimage==null → null; j=0: same → null.
      const cells = composeBeatorajaValueCells(dualStrip({ divx: 12 }), -12);
      expect(cells.map((c) => c.cell)).toEqual([-1, -1, 1, 2]);
    });

    it('positive value=12 single-strip: leading slots hidden (no sign cell)', () => {
      const cells = composeBeatorajaValueCells(dualStrip({ divx: 12 }), 12);
      expect(cells.map((c) => c.cell)).toEqual([-1, -1, 1, 2]);
    });

    it('11-cell single-strip with zp forced to 2: leading slots are pad cell 10', () => {
      // `JsonSkinObjectLoader.java:151` forces zeropadding=2 for d=11. Our parser handles this
      // dispatch internally via `divx === 11 → zp=2`.
      const cells = composeBeatorajaValueCells(dualStrip({ divx: 11 }), 12);
      expect(cells.map((c) => c.cell)).toEqual([10, 10, 1, 2]);
    });
  });

  // ─── cycle / divy animation (mirrors `SkinSourceImageSet.getImageIndex`) ────────────────────
  // Upstream's `SkinNumber` constructs `SkinSourceImageSet(image, timer, cycle)`, which slices
  // the source rect into `divy` rows × `divx` cells and walks rows over `cycle` ms:
  //
  //   if (cycle == 0) return 0;
  //   return (int) ((time * length / cycle) % length);   // length = divy
  //
  // The composer's optional `frameIndex` arg lets the renderer plumb the active row through;
  // each digit cell's `y` becomes `element.y + frame * cellH` so the picked row is the source
  // for every digit slot in this frame. ModernChic's `judgen-gr` (cycle=80, divy=2) is what
  // exercises this — without it every digit cropped from row 0 only.
  describe('cycle / divy animation row selection', () => {
    function animatedStrip(overrides: Partial<BeatorajaValueElement> = {}): BeatorajaValueElement {
      // Mirrors ModernChic's `judgen-gr` shape: 10-cell digit strip with 2 vertically-stacked
      // animation frames, per-cell h=84 (h=168 / divy=2).
      return singleStrip10({ x: 227, y: 252, w: 550, h: 168, divx: 10, divy: 2, digit: 6, cycle: 80, ...overrides });
    }

    it('frame 0 keeps y at element.y (default behaviour, no frameIndex passed)', () => {
      const cells = composeBeatorajaValueCells(animatedStrip(), 123);
      // y = 252 (= element.y + 0 * 84) for every slot.
      for (const cell of cells) expect(cell.y).toBe(252);
    });

    it('frame 1 shifts y down by cellH (= h / divy)', () => {
      const cells = composeBeatorajaValueCells(animatedStrip(), 123, 1);
      // y = 336 (= 252 + 1 * 84) — picks row 1 (= the second-color frame in ModernChic's strip).
      for (const cell of cells) expect(cell.y).toBe(336);
    });

    it('clamps frameIndex out-of-range to [0, divy-1]', () => {
      // divy=2 → max valid frame = 1. frame=2 / NaN / -1 collapse to the boundary.
      expect(composeBeatorajaValueCells(animatedStrip(), 123, 2)[5]?.y).toBe(336);
      expect(composeBeatorajaValueCells(animatedStrip(), 123, -1)[5]?.y).toBe(252);
      expect(composeBeatorajaValueCells(animatedStrip(), 123, NaN)[5]?.y).toBe(252);
    });

    it('frame stays 0 for divy=1 strips regardless of frameIndex', () => {
      const cells = composeBeatorajaValueCells(animatedStrip({ divy: 1, h: 84 }), 123, 5);
      for (const cell of cells) expect(cell.y).toBe(252);
    });

    it('preserves x cell selection (frame only affects y)', () => {
      // value=123, digit=6, single-strip → 3 leading-blank slots + cells 1,2,3.
      const cellsF0 = composeBeatorajaValueCells(animatedStrip(), 123, 0);
      const cellsF1 = composeBeatorajaValueCells(animatedStrip(), 123, 1);
      // Same x for the same digit slot, only y changes.
      for (let i = 0; i < cellsF0.length; i += 1) {
        expect(cellsF1[i]!.x).toBe(cellsF0[i]!.x);
        expect(cellsF1[i]!.cell).toBe(cellsF0[i]!.cell);
        expect(cellsF1[i]!.hidden).toBe(cellsF0[i]!.hidden);
      }
    });

    it('24-cell signed dual-strip ignores frameIndex (single-frame layout)', () => {
      // Dual-strip's row layout is positive-half / negative-half (different x-cell semantics),
      // not animation frames; frame selection is intentionally pinned to 0.
      const cells = composeBeatorajaValueCells(dualStrip({ divy: 2, h: 48 }), 12, 1);
      for (const cell of cells) expect(cell.y).toBe(0); // element.y = 0 for dualStrip().
    });
  });

  describe('valueFrameAt (`SkinSourceImageSet.getImageIndex`)', () => {
    function strip(overrides: Partial<BeatorajaValueElement> = {}): BeatorajaValueElement {
      return singleStrip10({ divy: 2, cycle: 80, ...overrides });
    }

    it('returns 0 when cycle is 0 (animation disabled)', () => {
      expect(valueFrameAt(strip({ cycle: 0 }), 100)).toBe(0);
      expect(valueFrameAt(strip({ cycle: 0 }), 1234567)).toBe(0);
    });

    it('returns 0 when divy <= 1 (single-row strip)', () => {
      expect(valueFrameAt(strip({ divy: 1 }), 100)).toBe(0);
    });

    it('walks frames over the cycle period (length=divy)', () => {
      // cycle=80, divy=2 → frame switches every 40ms.
      expect(valueFrameAt(strip(), 0)).toBe(0);
      expect(valueFrameAt(strip(), 39)).toBe(0);
      expect(valueFrameAt(strip(), 40)).toBe(1);
      expect(valueFrameAt(strip(), 79)).toBe(1);
      expect(valueFrameAt(strip(), 80)).toBe(0); // cycles back
      expect(valueFrameAt(strip(), 120)).toBe(1);
    });

    it('matches upstream divy=3 cycle=120 walk (judgen-pg from ModernChic)', () => {
      const pg = strip({ divy: 3, cycle: 120 });
      // cycle=120, divy=3 → 40ms per frame.
      expect(valueFrameAt(pg, 0)).toBe(0);
      expect(valueFrameAt(pg, 40)).toBe(1);
      expect(valueFrameAt(pg, 80)).toBe(2);
      expect(valueFrameAt(pg, 120)).toBe(0);
      expect(valueFrameAt(pg, 360)).toBe(0);
    });

    it('clamps negative / non-finite elapsedMs to frame 0 (pre-roll guard)', () => {
      expect(valueFrameAt(strip(), -10)).toBe(0);
      expect(valueFrameAt(strip(), Number.NaN)).toBe(0);
      expect(valueFrameAt(strip(), Number.POSITIVE_INFINITY)).toBe(0);
    });
  });
});

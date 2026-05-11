import { describe, expect, it } from 'vitest';
import {
  beatorajaFloatValueSlotCount,
  composeBeatorajaFloatValueCells,
  composeBeatorajaFloatValueShift,
  floatValueFrameAt,
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

describe('composeBeatorajaFloatValueCells (audit A-1 / A-2 — upstream FloatFormatter walk)', () => {
  // 12-cell single-strip: cells 0..9 = digits, cell 10 = blank/reverse-zero, cell 11 = decimal point.
  // 240px width / 12 cells = 20px per cell.
  //
  // Slot order mirrors `SkinFloat.java:177-184`'s `currentImages[nowketa-1] = digits[nowketa]`
  // mapping over `FloatFormatter`'s digits[1..length] output. Visible content at LOW slot
  // indices, trailing nulls at HIGH slot indices when iketa exceeds the natural int width and
  // zeropadding=0 (the "base contracts" path in `FloatFormatter.java:85-88`).
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
    offsets: [],
    ref: 92,
    cycle: 0,
    ifCodes: [],
  } as const;

  it('produces sign + iketa + (fketa>0?1:0) + fketa slots', () => {
    expect(beatorajaFloatValueSlotCount(baseElement)).toBe(3 + 1 + 1); // iketa=3, fketa=1, dot
    expect(beatorajaFloatValueSlotCount({ ...baseElement, fketa: 0 })).toBe(3); // no dot
    expect(beatorajaFloatValueSlotCount({ ...baseElement, isSignvisible: true })).toBe(6); // +sign
  });

  it('formats 123.4 with iketa=3 fketa=1 → [1, 2, 3, dot, 4] (natural-width int)', () => {
    // FloatFormatter walk for value=123.4, iketa=3, fketa=1, sign=0, zp=0:
    //   length = 5. base = min(3, log10(123)+1=3) = 3. nowketa = 5. fval = 1234.
    //   nowketa=5: digits[5]=4. → digits[4]=DOT. fval=123. nowketa=3.
    //   nowketa=3: digits[3]=3. fval=12. nowketa=2.
    //   nowketa=2: digits[2]=2. fval=1. nowketa=1.
    //   nowketa=1: digits[1]=1. nowketa=0.
    // Final digits[1..5]: [1, 2, 3, DOT, 4] → cells [1, 2, 3, 11, 4].
    const cells = composeBeatorajaFloatValueCells(baseElement, 123.4);
    expect(cells.map((c) => c.cell)).toEqual([1, 2, 3, 11, 4]);
    expect(cells.every((c) => !c.hidden)).toBe(true);
  });

  it('applies gain before formatting (raw 9876 → 98.76 with gain=0.01)', () => {
    // gain=1 baseline: 9876 with iketa=2 fketa=2 → "76.00" (low-bit truncation, matches
    // `FloatFormatter.java`'s base-contraction loop).
    const ungained = composeBeatorajaFloatValueCells({ ...baseElement, iketa: 2, fketa: 2 }, 9876);
    expect(ungained.map((c) => c.cell)).toEqual([7, 6, 11, 0, 0]);
    // gain=0.01: 9876 → 98.76 → [9, 8, dot, 7, 6].
    const gained = composeBeatorajaFloatValueCells({ ...baseElement, iketa: 2, fketa: 2, gain: 0.01 }, 9876);
    expect(gained.map((c) => c.cell)).toEqual([9, 8, 11, 7, 6]);
  });

  it('zero-pads the fractional half — 1 displayed as 1.0 with iketa=1 fketa=1', () => {
    // length=3. base=1. nowketa=3. fval=10.
    //   digits[3]=0. → digits[2]=DOT. fval=1. nowketa=1. digits[1]=1.
    // → [1, DOT, 0]
    const cells = composeBeatorajaFloatValueCells({ ...baseElement, iketa: 1, fketa: 1 }, 1);
    expect(cells.map((c) => c.cell)).toEqual([1, 11, 0]);
  });

  it('zeropadding=0 contracts base, leaving TRAILING null slots (no leading blanks visible)', () => {
    // value=5 with iketa=3 fketa=1, zp=0: `FloatFormatter.java:85-88` contracts base from
    // `sign+iketa=3` to `min(iketa, log10(5)+1=1)+sign=1`. Walk:
    //   nowketa = 1+1+1 = 3. fval=50.
    //   digits[3]=0. → digits[2]=DOT. fval=5. nowketa=1. digits[1]=5.
    // digits[4], digits[5] never written → -1.
    // Final digits[1..5]: [5, DOT, 0, -1, -1] → cells [5, 11, 0, hidden, hidden].
    //
    // Trailing-null layout (NOT leading-blank like the previous TS impl) is what gives
    // upstream's `+ shift` formula its meaning: align=1 (RIGHT) shifts visible content
    // RIGHTWARD by `shiftbase * (cellW + space)` to flush against the dst rect's right edge.
    const cells = composeBeatorajaFloatValueCells(baseElement, 5);
    expect(cells.map((c) => c.cell)).toEqual([5, 11, 0, -1, -1]);
    expect(cells[3]?.hidden).toBe(true);
    expect(cells[4]?.hidden).toBe(true);
  });

  it('zeropadding=1 fills leading int slots with cell 0 ("0") instead of nulls', () => {
    // value=5 with iketa=3 fketa=1, zp=1: NO base contraction — walk fills every slot.
    //   length=5. base=sign+iketa=3. nowketa=5. fval=50.
    //   digits[5]=0. → digits[4]=DOT. fval=5. nowketa=3.
    //   digits[3]=5. fval=0. nowketa=2.
    //   digits[2] (fcnt=-2, fval=0, zp!=2) = 0%10 = 0. fval=0. nowketa=1.
    //   digits[1] = 0%10 = 0. nowketa=0.
    // → [0, 0, 5, DOT, 0]
    const cells = composeBeatorajaFloatValueCells({ ...baseElement, zeropadding: 1 }, 5);
    expect(cells.map((c) => c.cell)).toEqual([0, 0, 5, 11, 0]);
  });

  it('zeropadding=2 emits REVERSEZERO (cell 10) for fractional zero-padding', () => {
    // For value=5.0 with fketa=2 and zp=2: the SECOND fractional digit's `fval=0` case
    // hits `FloatFormatter.java:101-104`'s `fval == 0 && zeropadding == 2` branch and
    // writes REVERSEZERO (= cell 10).
    //
    // value=5, iketa=3, fketa=2, zp=2:
    //   length=6. base=sign+iketa=3. nowketa=3+2+1=6. fval=500.
    //   nowketa=6, fcnt=2: digits[6]=500%10=0 (= digit 0, not REVERSEZERO since fcnt > -1).
    //     fcnt=1. fval=50. nowketa=5.
    //   nowketa=5, fcnt=1: digits[5]=50%10=0. fcnt=0 → digits[4]=DOT. fval=5. nowketa=3.
    //   nowketa=3, fcnt=-1: fval=5≠0 → digits[3]=5%10=5. fval=0. nowketa=2.
    //   nowketa=2, fcnt=-2: fval=0, zp=2 → digits[2]=REVERSEZERO=10. nowketa=1.
    //   nowketa=1, fcnt=-3: fval=0, zp=2 → digits[1]=REVERSEZERO=10. nowketa=0.
    // → [10, 10, 5, DOT, 0, 0]
    const cells = composeBeatorajaFloatValueCells({ ...baseElement, fketa: 2, zeropadding: 2 }, 5);
    expect(cells.map((c) => c.cell)).toEqual([10, 10, 5, 11, 0, 0]);
  });

  it('omits the dot slot when fketa=0', () => {
    // length=3. nowketa=3. No fractional iteration. fval=123.
    //   digits[3]=3. fval=12. nowketa=2.
    //   digits[2]=2. fval=1. nowketa=1.
    //   digits[1]=1.
    // → [1, 2, 3]
    const cells = composeBeatorajaFloatValueCells({ ...baseElement, fketa: 0 }, 123);
    expect(cells.map((c) => c.cell)).toEqual([1, 2, 3]);
  });

  it('clamps DECIMALPOINT to halfDivx-1 when divx < 12 (no dedicated dot glyph)', () => {
    // For divx=10 strips (digits-only, no dot glyph), `image[11]` would be OOB upstream
    // (`SkinFloat.java:193` accesses `image[DECIMALPOINT=11]`). Our impl clamps the cell
    // index to `halfDivx-1 = 9`, which paints digit "9" in the dot slot — a visibly broken
    // result the author should avoid by choosing a 12+ cell strip when fketa > 0. Documented
    // upstream behavior: throws ArrayIndexOutOfBoundsException.
    const cells = composeBeatorajaFloatValueCells({ ...baseElement, divx: 10, fketa: 1 }, 5);
    // value=5, base contracted to 1, nowketa=3, fval=50:
    //   digits[3]=0. → digits[2]=DOT(=11, clamped to 9). fval=5. nowketa=1. digits[1]=5.
    // → [5, 9 (clamped DOT), 0, -1, -1]
    expect(cells[1]?.cell).toBe(9); // clamped from DECIMALPOINT.
  });
});

describe('composeBeatorajaFloatValueShift (audit A-1 — align=0=LEFT / 1=RIGHT / 2=CENTER)', () => {
  // 10-cell digits-only strip with iketa=3, fketa=0 — the TRAILING nulls when value's int
  // width is shorter than iketa drive shiftbase. Per `SkinFloat.java:60-62`:
  //   align=0 LEFT (default) → no shift.
  //   align=1 RIGHT          → shift = shiftbase * (slotW + space). Renderer ADDS shift to slot.x.
  //   align=2 CENTER         → shift = shiftbase * (slotW + space) * 0.5.
  //
  // These align meanings are the OPPOSITE of `SkinNumber.java`'s 0=RIGHT / 1=LEFT / 2=CENTER — the
  // two element types share the field name but author them with mirror-image conventions.
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
    offsets: [],
    ref: 0,
    cycle: 0,
    ifCodes: [],
  };

  it('returns 0 for align=0 (LEFT-flush, the upstream default)', () => {
    // align=0 is `0=LEFT` in `SkinFloat.java:60-62`. Visible content sits at LOW slot indices
    // naturally — no shift needed for left-flush.
    expect(composeBeatorajaFloatValueShift({ ...digitOnlyElement, align: 0 }, 5, 40)).toBe(0);
  });

  it('returns 0 when the value fills the slot box (no trailing nulls)', () => {
    // value=123 in iketa=3 — every slot is significant, shiftbase=0, no shift regardless of align.
    expect(composeBeatorajaFloatValueShift({ ...digitOnlyElement, align: 1 }, 123, 40)).toBe(0);
    expect(composeBeatorajaFloatValueShift({ ...digitOnlyElement, align: 2 }, 123, 40)).toBe(0);
  });

  it('returns shiftbase * (slotW + space) for align=1 (RIGHT-flush, upstream "1=RIGHT")', () => {
    // value=5 in iketa=3, fketa=0: digits walks [5, hidden, hidden] at slots 0/1/2.
    // shiftbase=2 (two trailing nulls). shift = 2 * (40 + 0) = 80.
    // Renderer ADDS this shift to slot.x so visible "5" lands at slot 0 + shift = 80px,
    // which is the position of slot 2 (the rightmost slot's natural position). RIGHT-flush. ✓
    expect(composeBeatorajaFloatValueShift({ ...digitOnlyElement, align: 1 }, 5, 40)).toBe(80);
  });

  it('returns half shiftbase * slotWidth for align=2 (CENTER, upstream "2=CENTER")', () => {
    // value=5, shiftbase=2, slotW=40 → shift = 2 * 40 * 0.5 = 40.
    expect(composeBeatorajaFloatValueShift({ ...digitOnlyElement, align: 2 }, 5, 40)).toBe(40);
  });

  it('honors `space` when non-zero', () => {
    // shiftbase=2, slotW=40, space=4 → shift = 2 * (40+4) = 88 for align=1.
    const withSpace = { ...digitOnlyElement, align: 1, space: 4 };
    expect(composeBeatorajaFloatValueShift(withSpace, 5, 40)).toBe(88);
  });

  it('floats with fketa>0 still shift only on trailing-null int slots (dot + frac always painted)', () => {
    // iketa=3, fketa=1, divx=10, value=5, zp=0:
    //   digits[1..5] = [5, DOT, 0, -1, -1] → cells [5, dot-clamped, 0, hidden, hidden].
    //   shiftbase = 2 (the trailing nulls; the visible 5/dot/0 fill slots 0..2).
    // align=2 CENTER → shift = 2 * 40 * 0.5 = 40.
    const withFrac = { ...digitOnlyElement, fketa: 1, align: 2 };
    expect(composeBeatorajaFloatValueShift(withFrac, 5, 40)).toBe(40);
  });

  it('treats blank-cell-painted leading slots as significant (zp != 0 fills every slot, no shift)', () => {
    // zp=1 zero-pads every leading slot, leaving NO trailing null. shiftbase=0.
    const withZp1 = { ...digitOnlyElement, zeropadding: 1, align: 2 };
    expect(composeBeatorajaFloatValueShift(withZp1, 5, 40)).toBe(0);
  });
});

// ─── cycle / divy animation (mirrors `SkinSourceImageSet.getImageIndex`) ──────────────────
// Same formula as the integer-value side — both `SkinNumber` and `SkinFloat` route through the
// same `SkinSourceImageSet`. ModernChic / GdbG don't currently animate `floatvalue[]` (the
// authored cycle is 0 throughout the result-screen BPM/accuracy/ms readouts), but the upstream
// schema accepts it and other community skins use it.
describe('composeBeatorajaFloatValueCells — cycle / divy animation', () => {
  function animatedFloatStrip(): BeatorajaFloatValueElement {
    return {
      id: 'fv-anim',
      src: 4,
      x: 0,
      y: 100, // non-zero base y to make the row offset visible.
      w: 240,
      h: 48, // divy=2 → cellH = 24.
      divx: 12,
      divy: 2,
      iketa: 3,
      fketa: 1,
      gain: 1,
      isSignvisible: false,
      space: 0,
      padding: 0,
      zeropadding: 0,
      align: 0,
      offsets: [],
      ref: 0,
      cycle: 80,
      ifCodes: [],
    };
  }

  it('frame 0 (default) keeps every slot at element.y', () => {
    const cells = composeBeatorajaFloatValueCells(animatedFloatStrip(), 1.5);
    for (const cell of cells) expect(cell.y).toBe(100);
  });

  it('frame 1 shifts every slot down by cellH (h / divy)', () => {
    const cells = composeBeatorajaFloatValueCells(animatedFloatStrip(), 1.5, 1);
    for (const cell of cells) expect(cell.y).toBe(124); // 100 + 1 * 24
  });

  it('hidden slots also shift y per the active animation frame', () => {
    // value=5, iketa=3, fketa=1, zp=0: produces leading hidden slots that should still be
    // re-anchored to the active row when the strip animates (matters for renderers that
    // recompute hidden geometry without re-cropping).
    const el = animatedFloatStrip();
    const cellsF1 = composeBeatorajaFloatValueCells(el, 5, 1);
    for (const cell of cellsF1) expect(cell.y).toBe(124);
    // At least one hidden slot expected for value=5 in iketa=3 + fketa=1.
    expect(cellsF1.some((c) => c.hidden)).toBe(true);
  });

  it('clamps frameIndex to [0, divy-1] (matches valueFrameAt clamp)', () => {
    expect(composeBeatorajaFloatValueCells(animatedFloatStrip(), 1, 5)[0]?.y).toBe(124);
    expect(composeBeatorajaFloatValueCells(animatedFloatStrip(), 1, -3)[0]?.y).toBe(100);
  });
});

describe('floatValueFrameAt', () => {
  function strip(overrides: Partial<BeatorajaFloatValueElement> = {}): BeatorajaFloatValueElement {
    return {
      id: 'fv',
      src: 0,
      x: 0,
      y: 0,
      w: 120,
      h: 48,
      divx: 12,
      divy: 2,
      iketa: 3,
      fketa: 1,
      gain: 1,
      isSignvisible: false,
      space: 0,
      padding: 0,
      zeropadding: 0,
      align: 0,
      offsets: [],
      ref: 0,
      cycle: 80,
      ifCodes: [],
      ...overrides,
    };
  }

  it('returns 0 when cycle is 0', () => {
    expect(floatValueFrameAt(strip({ cycle: 0 }), 100)).toBe(0);
  });

  it('returns 0 when divy <= 1', () => {
    expect(floatValueFrameAt(strip({ divy: 1 }), 50)).toBe(0);
  });

  it('walks frames over the cycle period', () => {
    expect(floatValueFrameAt(strip(), 0)).toBe(0);
    expect(floatValueFrameAt(strip(), 39)).toBe(0);
    expect(floatValueFrameAt(strip(), 40)).toBe(1);
    expect(floatValueFrameAt(strip(), 80)).toBe(0);
  });

  it('clamps non-finite / negative elapsed to frame 0', () => {
    expect(floatValueFrameAt(strip(), -1)).toBe(0);
    expect(floatValueFrameAt(strip(), Number.NaN)).toBe(0);
  });
});

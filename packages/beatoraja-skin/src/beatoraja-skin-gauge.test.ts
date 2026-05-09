import { describe, expect, it } from 'vitest';
import {
  beatorajaGaugeModeFromString,
  BEATORAJA_GAUGE_ANIMATION,
  BEATORAJA_GAUGE_MODE,
  computeBeatorajaGaugeAnimation,
  gaugeExBase,
  normalizeBeatorajaGauge,
  pickBeatorajaGaugeNode,
  type BeatorajaGaugeElement,
  type BeatorajaGaugeState,
} from './beatoraja-skin-gauge.ts';

function makeGauge(overrides: Partial<BeatorajaGaugeElement> & Pick<BeatorajaGaugeElement, 'nodes'>): BeatorajaGaugeElement {
  return {
    id: 'gauge',
    parts: 50,
    type: BEATORAJA_GAUGE_ANIMATION.RANDOM,
    range: 3,
    cycle: 33,
    starttime: 0,
    endtime: 500,
    ifCodes: [],
    ...overrides,
  };
}

function state(value: number, max = 100, border = 80, mode: number = BEATORAJA_GAUGE_MODE.NORMAL): BeatorajaGaugeState {
  return { value, max, border, mode };
}

describe('gaugeExBase', () => {
  it('returns mode * 6 for modes below CLASS', () => {
    expect(gaugeExBase(BEATORAJA_GAUGE_MODE.ASSISTEASY)).toBe(0);
    expect(gaugeExBase(BEATORAJA_GAUGE_MODE.NORMAL)).toBe(12);
    expect(gaugeExBase(BEATORAJA_GAUGE_MODE.HARD)).toBe(18);
    expect(gaugeExBase(BEATORAJA_GAUGE_MODE.HAZARD)).toBe(30);
  });
  it('CLASS / EXCLASS / EXHARDCLASS reuse HARD / EXHARD / HAZARD slabs', () => {
    expect(gaugeExBase(BEATORAJA_GAUGE_MODE.CLASS)).toBe(18); // == HARD
    expect(gaugeExBase(BEATORAJA_GAUGE_MODE.EXCLASS)).toBe(24); // == EXHARD
    expect(gaugeExBase(BEATORAJA_GAUGE_MODE.EXHARDCLASS)).toBe(30); // == HAZARD
  });
});

describe('beatorajaGaugeModeFromString', () => {
  it('maps the engine GrooveGaugeType strings to GrooveGauge ints', () => {
    expect(beatorajaGaugeModeFromString('GROOVE')).toBe(BEATORAJA_GAUGE_MODE.NORMAL);
    expect(beatorajaGaugeModeFromString('EASY')).toBe(BEATORAJA_GAUGE_MODE.EASY);
    expect(beatorajaGaugeModeFromString('HARD')).toBe(BEATORAJA_GAUGE_MODE.HARD);
    expect(beatorajaGaugeModeFromString('DEATH')).toBe(BEATORAJA_GAUGE_MODE.HAZARD);
  });
  it('defaults to NORMAL when undefined', () => {
    expect(beatorajaGaugeModeFromString(undefined)).toBe(BEATORAJA_GAUGE_MODE.NORMAL);
  });
});

describe('pickBeatorajaGaugeNode (non-FLICKERING)', () => {
  // 12-node strip ≥ NORMAL slab (exgauge=12). Layout per beatoraja's `SkinGauge.draw()`:
  //   [filled-above, filled-below, transition-above, transition-below, top-above, top-below]
  // We populate enough slots that NORMAL's exgauge=12 lands inside the array.
  const nodes = [
    // ASSISTEASY slab (exgauge 0)
    'a-fill-a', 'a-fill-b', 'a-tail-a', 'a-tail-b', 'a-top-a', 'a-top-b',
    // EASY slab (exgauge 6)
    'e-fill-a', 'e-fill-b', 'e-tail-a', 'e-tail-b', 'e-top-a', 'e-top-b',
    // NORMAL slab (exgauge 12)
    'n-fill-a', 'n-fill-b', 'n-tail-a', 'n-tail-b', 'n-top-a', 'n-top-b',
  ];
  const gauge = makeGauge({ nodes, parts: 10, type: BEATORAJA_GAUGE_ANIMATION.RANDOM });

  it('top cell (i == notes) picks frame slot 4 (top)', () => {
    // value=50 / max=100 / parts=10 → notes = floor(50*10/100) = 5. Cell index 4 (1-indexed
    // i=5) is the top.
    const pick = pickBeatorajaGaugeNode(gauge, 4, state(50), 0);
    // Cell border for i=5: 5*100/10 = 50. Gauge border = 80, so cellBorder < border → +1
    // (danger zone). Index = 12 + 4 + 1 = 17 → 'n-top-b'.
    expect(pick?.nodeId).toBe('n-top-b');
    expect(pick?.lit).toBe(true);
    expect(pick?.danger).toBe(true);
  });

  it('above-clear-border cells get the no-danger variant (offset+0)', () => {
    // Cell index 7 (i=8): cellBorder = 80 = border → NOT danger (cellBorder < border is false).
    // value=100 → notes=10. i=8 < notes=10 → offset=0 (filled). animation=0 → notes-animation=10
    // → 10 > 8 ✓ → offset 0. Index = 12 + 0 + 0 = 12 → 'n-fill-a'.
    const pick = pickBeatorajaGaugeNode(gauge, 7, state(100), 0);
    expect(pick?.nodeId).toBe('n-fill-a');
    expect(pick?.danger).toBe(false);
  });

  it('cells in the transition tail (notes - animation <= i < notes) pick offset 2', () => {
    // value=100 → notes=10. animation=2. i=9 (1-indexed): notes - animation = 8, i >= 8, i <
    // notes (10), and i != notes → frameOffset = 2 (transition).
    const pick = pickBeatorajaGaugeNode(gauge, 8, state(100), 2);
    // Cell border = 9*100/10 = 90 ≥ 80 → not danger. Index = 12 + 2 + 0 = 14 → 'n-tail-a'.
    expect(pick?.nodeId).toBe('n-tail-a');
  });

  it('cells above the top (i > notes) pick offset 2 (= the empty transition slab)', () => {
    // value=10 → notes=1. Cell i=5 (index 4): i > notes AND `notes - animation` (= 1) is NOT
    // greater than i (5), so the picker falls through to frameOffset=2 — the "empty slab"
    // beatoraja paints above the current top.
    const pick = pickBeatorajaGaugeNode(gauge, 4, state(10), 0);
    expect(pick?.lit).toBe(false);
    // Cell border 50 < 80 → danger. Index = 12 + 2 + 1 = 15 → 'n-tail-b'.
    expect(pick?.nodeId).toBe('n-tail-b');
  });

  it('uses ASSISTEASY slab when state.mode = ASSISTEASY', () => {
    const pick = pickBeatorajaGaugeNode(
      gauge,
      4,
      state(50, 100, 80, BEATORAJA_GAUGE_MODE.ASSISTEASY),
      0,
    );
    // exgauge = 0. Top cell (i=5=notes) → offset 4. cellBorder 50 < 80 → +1. Index = 0+4+1 = 5
    // → 'a-top-b'.
    expect(pick?.nodeId).toBe('a-top-b');
  });
});

describe('pickBeatorajaGaugeNode (FLICKERING)', () => {
  const nodes = [
    'n-fill-a', 'n-fill-b', 'n-tail-a', 'n-tail-b', 'n-top-a', 'n-top-b',
  ];
  const gauge = makeGauge({
    nodes,
    parts: 10,
    type: BEATORAJA_GAUGE_ANIMATION.FLICKERING,
    cycle: 1500,
  });

  it('lit cells use offset 0 (filled), off cells use offset 2 (empty)', () => {
    // value=100 → notes=10. Cell i=5 (index 4): i ≤ notes → offset 0. cellBorder 50 < 80
    // → +1. Index = 0 + 0 + 1 = 1 → 'n-fill-b'. (mode=ASSISTEASY since exgauge=0 default)
    const pick = pickBeatorajaGaugeNode(
      gauge,
      4,
      state(100, 100, 80, BEATORAJA_GAUGE_MODE.ASSISTEASY),
      0,
    );
    expect(pick?.nodeId).toBe('n-fill-b');
    // Cell i=8 (index 7) with value=20 → notes=2 → i > notes → offset 2. cellBorder 80 ≥ 80
    // → not danger. Index = 0 + 2 + 0 = 2 → 'n-tail-a'.
    const empty = pickBeatorajaGaugeNode(
      gauge,
      7,
      state(20, 100, 80, BEATORAJA_GAUGE_MODE.ASSISTEASY),
      0,
    );
    expect(empty?.nodeId).toBe('n-tail-a');
  });

  it('emits a flickerOverlayId at the topmost lit cell (i == notes)', () => {
    // value=50 → notes=5. Cell i=5 (index 4) gets the overlay. Overlay index = 0 + 4 + 1 = 5
    // → 'n-top-b'.
    const pick = pickBeatorajaGaugeNode(
      gauge,
      4,
      state(50, 100, 80, BEATORAJA_GAUGE_MODE.ASSISTEASY),
      0,
    );
    expect(pick?.flickerOverlayId).toBe('n-top-b');
    // Other cells don't get the overlay.
    const tail = pickBeatorajaGaugeNode(
      gauge,
      3,
      state(50, 100, 80, BEATORAJA_GAUGE_MODE.ASSISTEASY),
      0,
    );
    expect(tail?.flickerOverlayId).toBeUndefined();
  });
});

describe('computeBeatorajaGaugeAnimation', () => {
  it('returns 0 when range is 0', () => {
    const g = makeGauge({ nodes: ['x'], range: 0, cycle: 100 });
    expect(computeBeatorajaGaugeAnimation(g, 500)).toBe(0);
  });

  it('INCLEASE climbs by `range` per cycle, modulo (range+1)', () => {
    // range=3, cycle=100. period = 4. Per-cycle increment = 3.
    // cycle 0 → 0, cycle 1 → 3, cycle 2 → 6 % 4 = 2, cycle 3 → 9 % 4 = 1.
    const g = makeGauge({ nodes: ['x'], range: 3, cycle: 100, type: BEATORAJA_GAUGE_ANIMATION.INCLEASE });
    expect(computeBeatorajaGaugeAnimation(g, 0)).toBe(0);
    expect(computeBeatorajaGaugeAnimation(g, 100)).toBe(3);
    expect(computeBeatorajaGaugeAnimation(g, 200)).toBe(2);
    expect(computeBeatorajaGaugeAnimation(g, 300)).toBe(1);
  });

  it('DECLEASE increments by 1 per cycle, modulo (range+1)', () => {
    const g = makeGauge({ nodes: ['x'], range: 3, cycle: 100, type: BEATORAJA_GAUGE_ANIMATION.DECLEASE });
    expect(computeBeatorajaGaugeAnimation(g, 0)).toBe(0);
    expect(computeBeatorajaGaugeAnimation(g, 100)).toBe(1);
    expect(computeBeatorajaGaugeAnimation(g, 400)).toBe(0); // wrap
  });

  it('RANDOM produces a deterministic but cycle-stable value (deterministic seed)', () => {
    const g = makeGauge({ nodes: ['x'], range: 3, cycle: 100, type: BEATORAJA_GAUGE_ANIMATION.RANDOM });
    // Same `nowMs` → same animation value (no per-frame instability).
    const a = computeBeatorajaGaugeAnimation(g, 250);
    const b = computeBeatorajaGaugeAnimation(g, 250);
    expect(a).toBe(b);
    // Different cycle → different value (probabilistically).
    expect(computeBeatorajaGaugeAnimation(g, 250)).not.toBe(computeBeatorajaGaugeAnimation(g, 350));
  });
});

describe('normalizeBeatorajaGauge', () => {
  it('reads `type` and `cycle` so the renderer can pick the right animation style', () => {
    const out = normalizeBeatorajaGauge({
      id: 'g',
      nodes: ['n1', 'e1'],
      type: BEATORAJA_GAUGE_ANIMATION.FLICKERING,
      cycle: 1500,
      parts: 24,
    });
    expect(out).toMatchObject({
      id: 'g',
      type: BEATORAJA_GAUGE_ANIMATION.FLICKERING,
      cycle: 1500,
      parts: 24,
    });
  });
});

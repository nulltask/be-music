import { describe, expect, test } from 'vite-plus/test';
import {
  computeGaugeBucketOp,
  computeGaugeTypeOps,
  LR2_GROOVE_GAUGE_CLEAR_ZONE_PERCENT,
  LR2_GROOVE_GAUGE_UNITS,
  resolveGrooveGaugeBeads,
} from './gameplay-hud.ts';

// Cell offsets within the LR2 4-cell frame (order: 表赤/表緑/裏赤/裏緑).
const LIT_RED = 0;
const LIT_GREEN = 1;
const UNLIT_RED = 2;
const UNLIT_GREEN = 3;

describe('resolveGrooveGaugeBeads', () => {
  test('emits exactly 50 beads', () => {
    expect(resolveGrooveGaugeBeads(50)).toHaveLength(LR2_GROOVE_GAUGE_UNITS);
  });

  test('GROOVE: red below the 80% clear border, green at/above it, lit up to the fill', () => {
    // 90% → 45 lit beads. Clear border at 80% → unit 40.
    const beads = resolveGrooveGaugeBeads(90);
    const at = (i: number) => beads[i]!.cellOffset;
    expect(at(0)).toBe(LIT_RED); // lit, below 80%
    expect(at(39)).toBe(LIT_RED); // lit, last bead below the clear border
    expect(at(40)).toBe(LIT_GREEN); // lit, clear zone
    expect(at(44)).toBe(LIT_GREEN); // lit, clear zone (fill = 45)
    expect(at(45)).toBe(UNLIT_GREEN); // unlit track, clear zone
    expect(at(49)).toBe(UNLIT_GREEN); // unlit track, clear zone
  });

  test('GROOVE: a sub-80% gauge lights only red beads; the clear-zone track stays green', () => {
    const beads = resolveGrooveGaugeBeads(50); // 25 lit, all below the 80% border
    // No LIT green bead — the fill never reached the clear zone.
    expect(beads.some((b) => b.cellOffset === LIT_GREEN)).toBe(false);
    expect(beads[0]!.cellOffset).toBe(LIT_RED);
    expect(beads[24]!.cellOffset).toBe(LIT_RED);
    expect(beads[25]!.cellOffset).toBe(UNLIT_RED); // unlit track, still below 80%
    // The clear-zone track (>= 80%) renders green even when unlit, so the 80% border stays visible.
    expect(beads[40]!.cellOffset).toBe(UNLIT_GREEN);
    expect(beads[49]!.cellOffset).toBe(UNLIT_GREEN);
  });

  test('survival gauges (HARD / DEATH) render the whole bar red — no green clear zone', () => {
    const beads = resolveGrooveGaugeBeads(100, { survivalGauge: true });
    expect(beads.every((b) => b.cellOffset === LIT_RED)).toBe(true);

    const partial = resolveGrooveGaugeBeads(90, { survivalGauge: true });
    expect(partial.some((b) => b.cellOffset === LIT_GREEN || b.cellOffset === UNLIT_GREEN)).toBe(false);
    expect(partial[44]!.cellOffset).toBe(LIT_RED); // lit, would be green on GROOVE
    expect(partial[45]!.cellOffset).toBe(UNLIT_RED); // unlit, would be green on GROOVE
  });

  test('does not paint a peak-hold bead — beads above the live fill are always the unlit track', () => {
    // LR2 has no peak/afterimage indicator: every bead past `activeUnits` is unlit, regardless of any prior peak.
    const beads = resolveGrooveGaugeBeads(40); // 20 lit
    for (let i = 20; i < LR2_GROOVE_GAUGE_UNITS; i += 1) {
      expect(beads[i]!.cellOffset === UNLIT_RED || beads[i]!.cellOffset === UNLIT_GREEN).toBe(true);
    }
  });

  test('clamps out-of-range / non-finite input', () => {
    expect(resolveGrooveGaugeBeads(200).every((b) => b.cellOffset === LIT_RED || b.cellOffset === LIT_GREEN)).toBe(
      true,
    );
    expect(resolveGrooveGaugeBeads(-10).every((b) => b.cellOffset === UNLIT_RED || b.cellOffset === UNLIT_GREEN)).toBe(
      true,
    );
    expect(resolveGrooveGaugeBeads(Number.NaN)[0]!.cellOffset).toBe(UNLIT_RED);
  });

  test('exposes the LR2 constants', () => {
    expect(LR2_GROOVE_GAUGE_UNITS).toBe(50);
    expect(LR2_GROOVE_GAUGE_CLEAR_ZONE_PERCENT).toBe(80);
  });
});

describe('computeGaugeTypeOps', () => {
  test('HARD / DEATH light the red gauge ops (43 / 45), not the normal ones', () => {
    for (const gauge of ['HARD', 'DEATH'] as const) {
      const ops = computeGaugeTypeOps(gauge);
      expect(ops).toEqual([43, 45]);
      expect(ops).not.toContain(42);
      expect(ops).not.toContain(44);
    }
  });

  test('GROOVE / EASY light the normal gauge ops (42 / 44), not the red ones', () => {
    for (const gauge of ['GROOVE', 'EASY'] as const) {
      const ops = computeGaugeTypeOps(gauge);
      expect(ops).toEqual([42, 44]);
      expect(ops).not.toContain(43);
      expect(ops).not.toContain(45);
    }
  });
});

describe('computeGaugeBucketOp', () => {
  test('maps each 10 % band to 230–240', () => {
    expect(computeGaugeBucketOp(0)).toBe(230);
    expect(computeGaugeBucketOp(9.9)).toBe(230);
    expect(computeGaugeBucketOp(10)).toBe(231);
    expect(computeGaugeBucketOp(79.9)).toBe(237);
    expect(computeGaugeBucketOp(80)).toBe(238);
    expect(computeGaugeBucketOp(99.9)).toBe(239);
    expect(computeGaugeBucketOp(100)).toBe(240);
  });

  test('clamps out-of-range input to the end buckets', () => {
    expect(computeGaugeBucketOp(-5)).toBe(230);
    expect(computeGaugeBucketOp(150)).toBe(240);
  });
});

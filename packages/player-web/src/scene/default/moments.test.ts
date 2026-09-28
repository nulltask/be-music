import { describe, expect, it } from 'vite-plus/test';
import { comboTier, createMomentState, momentProgress, updateMoments, type MomentInput } from './moments.ts';

const base: MomentInput = {
  nowMs: 0,
  combo: 0,
  gauge: 20,
  clearThreshold: 80,
  survival: false,
  judged: 0,
  totalNotes: 300,
  bad: 0,
  poor: 0,
};

describe('updateMoments', () => {
  it('stamps each combo milestone once, on the frame it is reached', () => {
    let state = updateMoments(createMomentState(), { ...base, combo: 99, nowMs: 10 });
    expect(state.milestone).toBeUndefined();
    state = updateMoments(state, { ...base, combo: 100, nowMs: 20 });
    expect(state.milestone).toEqual({ value: 100, atMs: 20 });
    state = updateMoments(state, { ...base, combo: 101, nowMs: 30 });
    expect(state.milestone).toEqual({ value: 100, atMs: 20 });
    state = updateMoments(state, { ...base, combo: 203, nowMs: 40 });
    expect(state.milestone).toEqual({ value: 200, atMs: 40 });
  });

  it('re-fires a milestone after the combo breaks and rebuilds', () => {
    let state = updateMoments(createMomentState(), { ...base, combo: 100, nowMs: 5 });
    state = updateMoments(state, { ...base, combo: 0, nowMs: 6 });
    state = updateMoments(state, { ...base, combo: 100, nowMs: 7 });
    expect(state.milestone).toEqual({ value: 100, atMs: 7 });
  });

  it('stamps the clear line only when the gauge rises across it', () => {
    let state = updateMoments(createMomentState(), { ...base, gauge: 78, nowMs: 1 });
    expect(state.clearAtMs).toBeUndefined();
    state = updateMoments(state, { ...base, gauge: 80, nowMs: 2 });
    expect(state.clearAtMs).toBe(2);
    state = updateMoments(state, { ...base, gauge: 90, nowMs: 3 });
    expect(state.clearAtMs).toBe(2);
  });

  it('ignores the clear line for survival gauges', () => {
    const state = updateMoments(createMomentState(), { ...base, gauge: 100, survival: true, nowMs: 1 });
    expect(state.clearAtMs).toBeUndefined();
  });

  it('stamps a full combo once every note is judged without BAD / POOR', () => {
    let state = updateMoments(createMomentState(), { ...base, judged: 299, nowMs: 1 });
    expect(state.fullComboAtMs).toBeUndefined();
    state = updateMoments(state, { ...base, judged: 300, nowMs: 2 });
    expect(state.fullComboAtMs).toBe(2);
    state = updateMoments(state, { ...base, judged: 300, nowMs: 9 });
    expect(state.fullComboAtMs).toBe(2);
  });

  it('does not call a run with a POOR a full combo', () => {
    const state = updateMoments(createMomentState(), { ...base, judged: 300, poor: 1, nowMs: 2 });
    expect(state.fullComboAtMs).toBeUndefined();
  });
});

describe('comboTier', () => {
  it('steps up at 25 / 50 / 100 / 200', () => {
    expect([0, 24, 25, 49, 50, 99, 100, 199, 200, 999].map(comboTier)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });
});

describe('momentProgress', () => {
  it('reports 0..1 while running and undefined otherwise', () => {
    expect(momentProgress(undefined, 10, 100)).toBeUndefined();
    expect(momentProgress(100, 150, 100)).toBe(0.5);
    expect(momentProgress(100, 90, 100)).toBeUndefined();
    expect(momentProgress(100, 200, 100)).toBeUndefined();
  });
});

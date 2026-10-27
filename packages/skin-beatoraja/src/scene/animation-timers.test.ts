import { describe, expect, test } from 'vite-plus/test';
import { hcnActiveTimerId, hcnDamageTimerId } from '../runtime-ids.ts';
import {
  resolveBeatorajaCharacterTimers,
  resolveBeatorajaHCNTimers,
  resolveBeatorajaScoreTimers,
  type BeatorajaCharacterTimerState,
} from './animation-timers.ts';

const unchanged = { start: [], startOnce: [], stop: [] };

describe('HCN timer banks', () => {
  test('maps both sides, scratch, key 9 and every extended boundary', () => {
    for (const side of [1, 2] as const) {
      for (const lane of [0, 1, 9, 10, 24, 25, 26, 99]) {
        expect(hcnActiveTimerId(side, lane)).toBe((lane < 10 ? 250 + (side - 1) * 10 : 1800 + (side - 1) * 100) + lane);
        expect(hcnDamageTimerId(side, lane)).toBe((lane < 10 ? 270 + (side - 1) * 10 : 2000 + (side - 1) * 100) + lane);
      }
    }
    for (const lane of [-1, 0.5, 100, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(hcnActiveTimerId(1, lane)).toBeUndefined();
      expect(hcnDamageTimerId(2, lane)).toBeUndefined();
    }
  });
  test('switches active to damage and back without restarting unchanged lanes', () => {
    expect(
      resolveBeatorajaHCNTimers({ lanes: [{ side: 1, plate: 1, lane: 1, gaining: false }], started: [251, 262, 1411] }),
    ).toEqual({ start: [271], startOnce: [], stop: [251, 262] });
    expect(
      resolveBeatorajaHCNTimers({ lanes: [{ side: 1, plate: 1, lane: 1, gaining: false }], started: [271] }),
    ).toEqual(unchanged);
    expect(
      resolveBeatorajaHCNTimers({ lanes: [{ side: 1, plate: 1, lane: 1, gaining: true }], started: [271] }),
    ).toEqual({ start: [251], startOnce: [], stop: [271] });
  });
  test('ends extended and ordinary HCN timers while leaving other timer categories intact', () => {
    expect(resolveBeatorajaHCNTimers({ lanes: [], started: [250, 289, 1810, 1999, 2010, 2199, 900, 10000] })).toEqual({
      start: [],
      startOnce: [],
      stop: [250, 289, 1810, 1999, 2010, 2199],
    });
    expect(
      resolveBeatorajaHCNTimers({ lanes: [{ side: 2, plate: 2, lane: 26, gaining: true }], started: [] }).start,
    ).toEqual([1926]);
  });
});

describe('score timers', () => {
  const input = {
    exScore: 0,
    totalNotes: 27,
    hasJudgment: true,
    started: new Set<number>(),
    bestEXScore: 100,
    targetEXScore: 100,
  };
  test('uses full-chart A/AA/AAA thresholds 18/21/24 of 27, including exact equality', () => {
    for (const [threshold, id] of [
      [36, 348],
      [42, 349],
      [48, 350],
    ]) {
      expect(resolveBeatorajaScoreTimers({ ...input, exScore: threshold - 1 }).start).not.toContain(id);
      expect(resolveBeatorajaScoreTimers({ ...input, exScore: threshold }).start).toContain(id);
    }
  });
  test('waits for a judgment, compares best/target inclusively and preserves an active timer start', () => {
    expect(resolveBeatorajaScoreTimers({ ...input, hasJudgment: false, bestEXScore: 0, targetEXScore: 0 })).toEqual(
      unchanged,
    );
    expect(resolveBeatorajaScoreTimers({ ...input, exScore: 10, bestEXScore: 10, targetEXScore: 11 }).start).toEqual([
      351,
    ]);
    expect(
      resolveBeatorajaScoreTimers({
        ...input,
        exScore: 11,
        bestEXScore: 10,
        targetEXScore: 11,
        started: new Set([351]),
      }).start,
    ).toEqual([352]);
    expect(
      resolveBeatorajaScoreTimers({
        ...input,
        exScore: 11,
        bestEXScore: 10,
        targetEXScore: 11,
        started: new Set([351, 352]),
      }),
    ).toEqual(unchanged);
  });
  test('turns off stale timers after a seek and does not award a rank to an empty chart', () => {
    expect(
      resolveBeatorajaScoreTimers({ ...input, hasJudgment: false, started: new Set([348, 349, 350, 351, 352]) }).stop,
    ).toEqual([348, 349, 350, 351, 352]);
    expect(resolveBeatorajaScoreTimers({ ...input, totalNotes: 0 }).start).toEqual([]);
  });
  test('defaults missing or invalid comparison targets to zero', () => {
    expect(resolveBeatorajaScoreTimers({ ...input, bestEXScore: undefined, targetEXScore: undefined }).start).toEqual([
      351, 352,
    ]);
    expect(resolveBeatorajaScoreTimers({ ...input, bestEXScore: Number.NaN, targetEXScore: -1 }).start).toEqual([
      351, 352,
    ]);
  });
});

function character() {
  const timers = new Map<number, number>();
  let state: BeatorajaCharacterTimerState = { lastNotes: [0, 0] };
  const frame = (nowMs: number, options: Partial<Parameters<typeof resolveBeatorajaCharacterTimers>[0]> = {}) => {
    const result = resolveBeatorajaCharacterTimers({
      nowMs,
      timers,
      state,
      stage: 'playing',
      pastNotes: 0,
      gaugeMax: false,
      motionDurationsMs: Array(8).fill(100),
      ...options,
    });
    for (const id of result.changes.start) timers.set(id, nowMs);
    for (const id of result.changes.stop) timers.delete(id);
    state = result.state;
    return result;
  };
  return { timers, frame, state: () => state };
}

describe('POMYU character timers', () => {
  test('starts neutral during loading, dance only during play, and preserves unchanged start times', () => {
    const { frame, timers } = character();
    frame(0, { stage: 'loading' });
    expect([...timers]).toEqual([
      [900, 0],
      [905, 0],
    ]);
    frame(50);
    expect(timers.get(909)).toBe(50);
    expect(frame(60).changes).toEqual(unchanged);
    expect(timers.get(900)).toBe(0);
    expect(timers.get(909)).toBe(50);
  });
  test('starts GREAT and opponent BAD on a neutral-cycle boundary, then returns to neutral', () => {
    const { frame, timers, state } = character();
    frame(0);
    frame(50, { pastNotes: 1, latestJudge: 'GREAT' });
    expect(timers.has(902)).toBe(false);
    frame(100, { pastNotes: 1, latestJudge: 'GREAT' });
    expect(timers.get(902)).toBe(100);
    expect(timers.get(907)).toBe(100);
    expect(timers.has(900)).toBe(false);
    expect(timers.has(905)).toBe(false);
    frame(200, { pastNotes: 1, latestJudge: 'GREAT' });
    expect(timers.get(900)).toBe(200);
    expect(timers.get(905)).toBe(200);
    expect(state().lastNotes).toEqual([1, 1]);
    frame(300, { pastNotes: 1, latestJudge: 'GREAT' });
    expect(timers.has(902)).toBe(false);
    expect(timers.get(900)).toBe(200);
  });
  test('selects FEVER at gauge max, GOOD, BAD, and the opposite character reactions', () => {
    for (const [latestJudge, gaugeMax, reaction, opponent] of [
      ['PGREAT', true, 901, 907],
      ['GOOD', false, 903, 907],
      ['BAD', false, 904, 906],
      ['POOR', false, 904, 906],
    ] as const) {
      const { frame, timers } = character();
      frame(0);
      frame(100, { latestJudge, gaugeMax, pastNotes: 1 });
      expect(timers.has(reaction)).toBe(true);
      expect(timers.has(opponent)).toBe(true);
    }
  });
  test('observes the upstream 17ms cycle-boundary window and supplied motion durations', () => {
    const { frame, timers } = character();
    frame(0);
    frame(117, { pastNotes: 1, latestJudge: 'GREAT' });
    expect(timers.has(902)).toBe(false);
    frame(200, { pastNotes: 1, latestJudge: 'GREAT' });
    expect(timers.get(902)).toBe(200);
  });
  test('uses upstream 1ms defaults without a character pack and freezes stopped stages', () => {
    const { frame, timers } = character();
    frame(0, { motionDurationsMs: undefined });
    frame(1, { motionDurationsMs: undefined, pastNotes: 1, latestJudge: 'GOOD' });
    expect(timers.get(903)).toBe(1);
    expect(frame(500, { stage: 'stopped' }).changes).toEqual(unchanged);
    expect(timers.get(903)).toBe(1);
  });
  test('music completion stops character/dance timers, starts MUSIC_END once, and a new scene resets', () => {
    const { frame, timers } = character();
    frame(0);
    frame(500, { stage: 'finished' });
    expect([...timers]).toEqual([[908, 500]]);
    expect(frame(600, { stage: 'finished' }).changes).toEqual(unchanged);
    expect(character().frame(0).changes.start).toEqual([900, 905, 909]);
  });
});

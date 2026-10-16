import { describe, expect, it } from 'vite-plus/test';
import {
  BEATORAJA_OP,
  bombTimerId,
  keyOffTimerId,
  keyOnTimerId,
  lnHoldTimerId,
  TIMER_COMBO_1P,
  TIMER_COMBO_2P,
  TIMER_COMBO_3P,
  TIMER_ENDOFNOTE_1P,
  TIMER_ENDOFNOTE_2P,
  TIMER_FAILED,
  TIMER_FULLCOMBO_1P,
  TIMER_FULLCOMBO_2P,
  TIMER_GAUGE_INCREASE_1P,
  TIMER_GAUGE_INCREASE_2P,
  TIMER_GAUGE_MAX_1P,
  TIMER_JUDGE_1P,
  TIMER_JUDGE_2P,
  TIMER_JUDGE_3P,
  TIMER_RHYTHM,
} from '../runtime-ids.ts';
import {
  beatorajaJudgeIndex,
  isBeatorajaCleanHit,
  isBeatorajaComboJudge,
  resolveBeatorajaFrameTimers,
  resolveBeatorajaJudgeEffect,
  resolveBeatorajaLanePlacement,
  resolveBeatorajaLaneTimers,
} from './play-timers.ts';

describe('resolveBeatorajaLanePlacement', () => {
  it("places a lane on its player's side and plate", () => {
    expect(resolveBeatorajaLanePlacement('13', '7', 3)).toEqual({ side: 1, plate: 1, lane: 3 });
    expect(resolveBeatorajaLanePlacement('26', '14', 0)).toEqual({ side: 2, plate: 2, lane: 0 });
    // A channel the variant has no lane for keeps its side and plate.
    expect(resolveBeatorajaLanePlacement('28', '10', -1)).toEqual({ side: 2, plate: 2 });
  });

  it('puts every POPN 9 KEY lane on the 1P side and its judgments on the plate of its three-lane group', () => {
    expect(resolveBeatorajaLanePlacement('11', '9', 1)).toEqual({ side: 1, plate: 1, lane: 1 });
    expect(resolveBeatorajaLanePlacement('15', '9', 5)).toEqual({ side: 1, plate: 2, lane: 5 });
    expect(resolveBeatorajaLanePlacement('25', '9', 9)).toEqual({ side: 1, plate: 3, lane: 9 });
    expect(resolveBeatorajaLanePlacement('29', '9', -1)).toEqual({ side: 1, plate: 1 });
  });
});

describe('resolveBeatorajaLaneTimers', () => {
  const key3 = { side: 1, plate: 1, lane: 3 } as const;

  it('starts the key-on timer on a press or flash and the key-off one on a release or the flash end', () => {
    expect(resolveBeatorajaLaneTimers('press', key3)).toEqual({
      start: [keyOnTimerId(1, 3)],
      startOnce: [],
      stop: [keyOffTimerId(1, 3)],
    });
    expect(resolveBeatorajaLaneTimers('flash', key3)).toEqual(resolveBeatorajaLaneTimers('press', key3));
    expect(resolveBeatorajaLaneTimers('release', key3)).toEqual({
      start: [keyOffTimerId(1, 3)],
      startOnce: [],
      stop: [keyOnTimerId(1, 3), lnHoldTimerId(1, 3)],
    });
    expect(resolveBeatorajaLaneTimers('flash-end', key3)).toEqual({
      start: [keyOffTimerId(1, 3)],
      startOnce: [],
      stop: [keyOnTimerId(1, 3)],
    });
  });

  it('starts and stops the long-note hold timer', () => {
    const scratch2P = { side: 2, plate: 2, lane: 0 } as const;
    expect(resolveBeatorajaLaneTimers('hold', scratch2P)).toEqual({
      start: [lnHoldTimerId(2, 0)],
      startOnce: [],
      stop: [],
    });
    expect(resolveBeatorajaLaneTimers('hold-end', scratch2P)).toEqual({
      start: [],
      startOnce: [],
      stop: [lnHoldTimerId(2, 0)],
    });
  });

  it('changes nothing for a channel without a lane', () => {
    expect(resolveBeatorajaLaneTimers('press', { side: 1, plate: 1 })).toEqual({ start: [], startOnce: [], stop: [] });
  });
});

describe('resolveBeatorajaJudgeEffect', () => {
  const key2 = { side: 1, plate: 1, lane: 2 } as const;

  it('lights the judgment and FAST op and starts the judge, combo, bomb and gauge timers on a clean hit', () => {
    expect(resolveBeatorajaJudgeEffect({ judge: 'PERFECT', combo: 10, deltaMs: -4 }, key2, 100)).toEqual({
      judgeOp: BEATORAJA_OP.P1_JUDGE_PERFECT,
      timing: { fastSlowOp: BEATORAJA_OP.P1_JUDGE_EARLY },
      timers: {
        start: [TIMER_JUDGE_1P, TIMER_COMBO_1P, bombTimerId(1, 2), TIMER_GAUGE_INCREASE_1P],
        startOnce: [],
        stop: [],
      },
      laneJudge: 0,
    });
  });

  it('keeps the combo timer for GOOD but no bomb or sparkle, and starts only the judge timer on a break', () => {
    expect(resolveBeatorajaJudgeEffect({ judge: 'GOOD', combo: 11, deltaMs: 30 }, key2, 100).timers.start).toEqual([
      TIMER_JUDGE_1P,
      TIMER_COMBO_1P,
    ]);
    const bad = resolveBeatorajaJudgeEffect({ judge: 'BAD', combo: 0, deltaMs: 90 }, key2, 100);
    expect(bad.timers.start).toEqual([TIMER_JUDGE_1P]);
    expect(bad.judgeOp).toBe(BEATORAJA_OP.P1_JUDGE_BAD);
    expect(bad.timing).toEqual({ fastSlowOp: BEATORAJA_OP.P1_JUDGE_LATE });
    expect(bad.laneJudge).toBe(3);
  });

  it('leaves the FAST / SLOW op alone without a timing and clears it on time', () => {
    expect(resolveBeatorajaJudgeEffect({ judge: 'POOR', combo: 0 }, key2, 100).timing).toBeUndefined();
    expect(resolveBeatorajaJudgeEffect({ judge: 'GREAT', combo: 1, deltaMs: 0 }, key2, 100).timing).toEqual({});
  });

  it('starts the full-combo timer once the combo reaches every note, on the side of the lane', () => {
    const side2 = { side: 2, plate: 2, lane: 1 } as const;
    expect(resolveBeatorajaJudgeEffect({ judge: 'GREAT', combo: 100, deltaMs: 2 }, side2, 100).timers).toEqual({
      start: [TIMER_JUDGE_2P, TIMER_COMBO_2P, bombTimerId(2, 1), TIMER_GAUGE_INCREASE_2P],
      startOnce: [TIMER_FULLCOMBO_2P],
      stop: [],
    });
    expect(resolveBeatorajaJudgeEffect({ judge: 'GOOD', combo: 100 }, key2, 100).timers.startOnce).toEqual([
      TIMER_FULLCOMBO_1P,
    ]);
    expect(resolveBeatorajaJudgeEffect({ judge: 'GREAT', combo: 99 }, key2, 100).timers.startOnce).toEqual([]);
    expect(resolveBeatorajaJudgeEffect({ judge: 'GREAT', combo: 0 }, key2, 0).timers.startOnce).toEqual([]);
  });

  it("uses POPN 9 KEY's third plate and the 1P side for its lanes", () => {
    const effect = resolveBeatorajaJudgeEffect(
      { judge: 'PERFECT', combo: 5, deltaMs: 1 },
      { side: 1, plate: 3, lane: 8 },
      50,
    );
    expect(effect.judgeOp).toBe(BEATORAJA_OP.P3_JUDGE_PERFECT);
    expect(effect.timing).toEqual({ fastSlowOp: BEATORAJA_OP.P3_JUDGE_LATE });
    expect(effect.timers.start).toEqual([TIMER_JUDGE_3P, TIMER_COMBO_3P, bombTimerId(1, 8), TIMER_GAUGE_INCREASE_1P]);
    // The third plate has no BAD op.
    expect(resolveBeatorajaJudgeEffect({ judge: 'BAD', combo: 0 }, { side: 1, plate: 3, lane: 8 }, 50).judgeOp).toBe(
      undefined,
    );
  });

  it('judges on the 1P plate without a lane and keeps no lane judgment', () => {
    const effect = resolveBeatorajaJudgeEffect({ judge: 'PERFECT', combo: 1 }, undefined, 10);
    expect(effect.timers.start).toEqual([TIMER_JUDGE_1P, TIMER_COMBO_1P, TIMER_GAUGE_INCREASE_1P]);
    expect(effect.laneJudge).toBeUndefined();
    expect(resolveBeatorajaJudgeEffect({ judge: 'READY', combo: 0 }, key2, 10)).toEqual({
      timers: { start: [TIMER_JUDGE_1P], startOnce: [], stop: [] },
    });
  });
});

describe('judgment helpers', () => {
  it('orders the judgments as beatoraja does and tells combo keepers and clean hits', () => {
    expect(['PERFECT', 'great', 'GOOD', 'BAD', 'POOR', 'MISS', 'READY'].map(beatorajaJudgeIndex)).toEqual([
      0, 1, 2, 3, 4, 5, -1,
    ]);
    expect(['PERFECT', 'GREAT', 'GOOD', 'BAD'].map(isBeatorajaComboJudge)).toEqual([true, true, true, false]);
    expect(['PERFECT', 'GREAT', 'GOOD', 'POOR'].map(isBeatorajaCleanHit)).toEqual([true, true, false, false]);
  });
});

describe('resolveBeatorajaFrameTimers', () => {
  it('starts the rhythm timer on the first frame and on every whole beat crossed, either way', () => {
    expect(resolveBeatorajaFrameTimers({ beat: 0.2 }).start).toEqual([TIMER_RHYTHM]);
    expect(resolveBeatorajaFrameTimers({ beat: 0.9, previousBeat: 0.2 }).start).toEqual([]);
    expect(resolveBeatorajaFrameTimers({ beat: 1.05, previousBeat: 0.9 }).start).toEqual([TIMER_RHYTHM]);
    expect(resolveBeatorajaFrameTimers({ beat: 0.5, previousBeat: 1.05 }).start).toEqual([TIMER_RHYTHM]);
    expect(resolveBeatorajaFrameTimers({ beat: Number.NaN, previousBeat: 1 }).start).toEqual([]);
  });

  it("starts each side's end-of-notes timer once the beat passes its last note", () => {
    const lastNoteBeats = { 1: 16, 2: 20 };
    expect(resolveBeatorajaFrameTimers({ beat: 15.9, previousBeat: 15.8, lastNoteBeats }).startOnce).toEqual([]);
    expect(resolveBeatorajaFrameTimers({ beat: 17, previousBeat: 16.9, lastNoteBeats }).startOnce).toEqual([
      TIMER_ENDOFNOTE_1P,
    ]);
    expect(resolveBeatorajaFrameTimers({ beat: 20, previousBeat: 19.9, lastNoteBeats }).startOnce).toEqual([
      TIMER_ENDOFNOTE_1P,
      TIMER_ENDOFNOTE_2P,
    ]);
  });

  it('starts the failure timer when the gauge drops to 0 from above, not on a frame that starts at 0', () => {
    const gauge = { current: 0, max: 100 };
    expect(resolveBeatorajaFrameTimers({ beat: 3, previousBeat: 3, gauge, previousGauge: 2 }).startOnce).toEqual([
      TIMER_FAILED,
    ]);
    expect(resolveBeatorajaFrameTimers({ beat: 3, previousBeat: 3, gauge }).startOnce).toEqual([]);
    expect(resolveBeatorajaFrameTimers({ beat: 3, previousBeat: 3, gauge, previousGauge: 0 }).startOnce).toEqual([]);
  });

  it('starts the full-gauge timer at the maximum', () => {
    expect(
      resolveBeatorajaFrameTimers({ beat: 3, previousBeat: 3, gauge: { current: 100, max: 100 } }).startOnce,
    ).toEqual([TIMER_GAUGE_MAX_1P]);
    expect(resolveBeatorajaFrameTimers({ beat: 3, previousBeat: 3, gauge: { current: 0, max: 0 } })).toEqual({
      start: [],
      startOnce: [],
      stop: [],
    });
  });
});

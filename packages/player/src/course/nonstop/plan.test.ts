import { describe, expect, test } from 'vite-plus/test';
import { planNonstopCourse, resolveNonstopLastMeasure, type NonstopStageTiming } from './plan.ts';

/** A stage at a constant BPM; `firstMeasureLength` shortens measure 0 only. */
function stage(
  bpm: number,
  firstNote: number,
  lastNote: number,
  extra: Partial<NonstopStageTiming> & { firstMeasureLength?: number } = {},
): NonstopStageTiming {
  const measureSeconds = 240 / bpm;
  const first = extra.firstMeasureLength ?? 1;
  return {
    secondsAt: (position) =>
      position <= 1 ? position * first * measureSeconds : (first + (position - 1)) * measureSeconds,
    firstNote,
    lastNote,
    headerBpm: bpm,
    finalBpm: bpm,
    firstMeasureLength: first,
    ...extra,
  };
}

describe('resolveNonstopLastMeasure', () => {
  test('takes the bar line nearest the last note, the earlier one on a tie', () => {
    expect(resolveNonstopLastMeasure(7.25)).toBe(7);
    expect(resolveNonstopLastMeasure(7.75)).toBe(8);
    expect(resolveNonstopLastMeasure(7.5)).toBe(7);
    expect(resolveNonstopLastMeasure(7)).toBe(7);
  });
});

describe('planNonstopCourse', () => {
  test('cuts the next stage so its first note lands on the previous last-measure line', () => {
    // 120 BPM: 2 s a measure. Stage 1 hands over at measure 7 (14 s); stage 2's first note (local 2) lands there.
    const [first, second] = planNonstopCourse([stage(120, 0, 7.25), stage(120, 2, 6.5)], ['fade']);
    expect(first).toEqual({
      measureOffset: 0,
      offsetSeconds: 0,
      rate: 1,
      cut: 0,
      boundaryMeasure: 7,
      boundarySeconds: 14,
    });
    expect(second).toEqual({
      measureOffset: 5,
      offsetSeconds: 10,
      rate: 1,
      cut: 2,
      boundaryMeasure: 11,
      boundarySeconds: 22,
    });
  });

  test('keeps cutting while the gap is 0.5 measure or more, as the binary compares', () => {
    // First note at local 2.5: a gap of exactly 0.5 after cutting 2 is cut once more.
    const [, second] = planNonstopCourse([stage(120, 0, 7), stage(120, 2.5, 6)], ['cut']);
    expect(second?.cut).toBe(3);
    expect(second!.offsetSeconds + 2.5 * 2).toBeCloseTo(13);
  });

  test('leaves up to 1.5 measures after BLANK1, and cuts nothing after BLANK2', () => {
    const [, blank1] = planNonstopCourse([stage(120, 0, 7), stage(120, 4, 6)], ['blank1']);
    // The cut starts at 3 (first note at measure 11, start 7): a gap of 1 measure is within 1.5, so it stays.
    expect(blank1?.cut).toBe(3);
    const [first, blank2] = planNonstopCourse([stage(120, 0, 7), stage(120, 4, 6)], ['blank2']);
    // BLANK2 hands stage 1 over at the first bar line more than 5 s after measure 7 (14 s): measure 10 (20 s).
    expect(first).toMatchObject({ boundaryMeasure: 10, boundarySeconds: 20 });
    expect(blank2).toMatchObject({ cut: 0, measureOffset: 10, offsetSeconds: 20 });
  });

  test('time-stretches a stage after a FIT connection to the previous final BPM', () => {
    const [, fitted] = planNonstopCourse([stage(150, 0, 7, { finalBpm: 150 }), stage(100, 2, 6)], ['fade-fit']);
    expect(fitted?.rate).toBe(1.5);
    // Stage 1 hands over at 7 × 1.6 s = 11.2 s; the stretched stage's measures last 2.4 / 1.5 = 1.6 s.
    expect(fitted!.offsetSeconds + (2 * 2.4) / 1.5).toBeCloseTo(11.2);
    const [, plain] = planNonstopCourse([stage(150, 0, 7), stage(100, 2, 6)], ['fade']);
    expect(plain?.rate).toBe(1);
  });

  test('agrees with the LR2 placement while the tempo and measure lengths stay the same', () => {
    const stages = [stage(120, 0, 7.25), stage(120, 2, 6.5), stage(240, 3, 9)];
    expect(planNonstopCourse(stages, ['fade', 'fade'], { placement: 'lr2' })).toEqual(
      planNonstopCourse(stages, ['fade', 'fade']),
    );
  });

  test('reproduces LR2 starting a third stage at the line before the second was cut', () => {
    // Stage 3's measure 0 is half a measure long. LR2 runs its origin on by stage 2's cut (2 measures) at stage 3's
    // measure-0 length, then cuts those measures again at its full length: the stage lands 2 × (0.5 − 1) s = 1 s early.
    const stages = [stage(120, 0, 7.25), stage(120, 2, 6.5), stage(240, 3, 9, { firstMeasureLength: 0.5 })];
    const intended = planNonstopCourse(stages, ['fade', 'fade']);
    const lr2 = planNonstopCourse(stages, ['fade', 'fade'], { placement: 'lr2' });
    // Intended: the first note (local 3 = 2.5 s in) lands on stage 2's line at 22 s.
    expect(intended[2]).toMatchObject({ measureOffset: 8, cut: 3, offsetSeconds: 19.5 });
    expect(lr2[2]).toMatchObject({ measureOffset: 8, cut: 3, offsetSeconds: 18.5 });
  });

  test("uses LR2's file-order first note only for the LR2 placement", () => {
    // The file-order rule lowers stage 2's first note to 1 (an object on a later line): one more measure is kept.
    const stages = [stage(120, 0, 7), stage(120, 3, 6, { lr2FirstNote: 1 })];
    expect(planNonstopCourse(stages, ['fade'])[1]?.cut).toBe(3);
    expect(planNonstopCourse(stages, ['fade'], { placement: 'lr2' })[1]?.cut).toBe(1);
  });

  test('never cuts below zero', () => {
    const [, second] = planNonstopCourse([stage(120, 0, 7), stage(120, 0, 6)], ['blank1']);
    expect(second?.cut).toBe(0);
  });
});

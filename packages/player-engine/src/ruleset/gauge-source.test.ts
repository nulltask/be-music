import { describe, expect, test } from 'vite-plus/test';
import { resolveRuleset, RULESET_IDS, type RulesetId } from './definitions.ts';
import type { RulesetChartFacts } from './facts.ts';
import { gaugePickType, isGaugePick, qualifyGaugePick, resolveGaugePickSource, splitGaugePick } from './gauge-type.ts';

const facts: RulesetChartFacts = {
  sourceFormat: 'bms',
  laneMode: '7K',
  lnMode: 1,
  judgeRank: { percent: 75, sourceRank: 2 },
  total: 300,
  notes: { normal: 500, long: { 1: 0, 2: 0, 3: 0 } },
};

describe('gauge picks', () => {
  test('a bare gauge type has no source, a qualified one names it', () => {
    expect(splitGaugePick('HARD')).toEqual({ source: undefined, type: 'HARD' });
    expect(splitGaugePick('lr2:HARD')).toEqual({ source: 'lr2', type: 'HARD' });
    expect(splitGaugePick('____:ASSIST-EASY')).toEqual({ source: '____', type: 'ASSIST-EASY' });
    expect(gaugePickType('beatoraja:EX-HARD')).toBe('EX-HARD');
    expect(gaugePickType('GROOVE')).toBe('GROOVE');
    expect(qualifyGaugePick('lr2', 'DEATH')).toBe('lr2:DEATH');
  });

  test('a qualified pick names a gauge its own source offers, never a lookalike', () => {
    expect(isGaugePick('lr2:P-ATTACK')).toBe(true);
    expect(isGaugePick('beatoraja:DEATH')).toBe(true);
    expect(isGaugePick('lr2:EX-HARD')).toBe(false);
    expect(isGaugePick('beatoraja:P-ATTACK')).toBe(false);
    expect(isGaugePick('____:DEATH')).toBe(false);
    expect(isGaugePick('nanasi:HARD')).toBe(false);
    expect(isGaugePick('lr2:')).toBe(false);
    expect(isGaugePick('NOPE')).toBe(false);
    expect(isGaugePick(undefined)).toBe(false);
  });

  test('a bare pick is the judge ruleset’s own; a qualified one keeps its source', () => {
    expect(resolveGaugePickSource('HARD', 'beatoraja')).toBe('beatoraja');
    expect(resolveGaugePickSource('lr2:HARD', 'beatoraja')).toBe('lr2');
    expect(resolveGaugePickSource('____:EASY', 'lr2')).toBe('____');
  });
});

describe('resolveRuleset with a source-qualified gauge', () => {
  test.each(RULESET_IDS)('a gauge qualified with the judge ruleset %s is that ruleset’s bare gauge', (ruleset) => {
    const bare = resolveRuleset(facts, ruleset, { selectedGauge: 'HARD' });
    const qualified = resolveRuleset(facts, ruleset, { selectedGauge: `${ruleset}:HARD` });
    expect(qualified.gaugeSource).toBe(ruleset);
    expect(qualified.gauge).toEqual(bare.gauge);
    expect(qualified.effectiveTotal).toBe(bare.effectiveTotal);
  });

  test.each([
    ['lr2', 'beatoraja'],
    ['lr2', '____'],
    ['beatoraja', 'lr2'],
    ['beatoraja', '____'],
    ['____', 'lr2'],
    ['____', 'beatoraja'],
  ] as const)('%s:HARD under %s judging keeps the gauge and leaves the judging alone', (source, judge) => {
    const own = resolveRuleset(facts, source, { selectedGauge: 'HARD' });
    const native = resolveRuleset(facts, judge, { selectedGauge: 'HARD' });
    const crossed = resolveRuleset(facts, judge, { selectedGauge: `${source}:HARD` });
    expect(crossed.gaugeSource).toBe(source);
    // A chart without long notes has the same judgment count under every ruleset, so the gauge is the source's own.
    expect(crossed.gauge).toEqual(own.gauge);
    expect(crossed.effectiveTotal).toBe(own.effectiveTotal);
    // Everything that judges stays the judge ruleset's.
    expect(crossed.rulesetId).toBe(judge);
    expect(crossed.id).toBe(native.id);
    expect(crossed.windows).toEqual(native.windows);
    expect(crossed.mineTrigger).toBe(native.mineTrigger);
    expect(crossed.longNoteStyle).toBe(native.longNoteStyle);
    expect(crossed.noteCount).toBe(native.noteCount);
  });

  test('the gauge scales over the judgments the judge ruleset issues, so PGREATs still recover the source’s TOTAL', () => {
    // 100 taps and 100 charge notes: 200 judgments under LR2, 300 under That-Which-Must-Not-Be-Named.
    const charge: RulesetChartFacts = { ...facts, lnMode: 2, notes: { normal: 100, long: { 1: 0, 2: 100, 3: 0 } } };
    const own = resolveRuleset(charge, 'lr2', { selectedGauge: 'GROOVE' });
    const crossed = resolveRuleset(charge, '____', { selectedGauge: 'lr2:GROOVE' });
    expect(own.noteCount).toBe(200);
    expect(crossed.noteCount).toBe(300);
    expect(own.gauge.values[0] * own.noteCount).toBeCloseTo(300);
    expect(crossed.gauge.values[0] * crossed.noteCount).toBeCloseTo(300);
  });

  test('a source keeps its own limits: LR2 has no EX-HARD, and only LR2 has the attack gauges', () => {
    expect(() => resolveRuleset(facts, 'beatoraja', { selectedGauge: 'lr2:EX-HARD' })).toThrow(/no EX-HARD/);
    expect(() => resolveRuleset(facts, 'lr2', { selectedGauge: 'beatoraja:P-ATTACK' })).toThrow(/only for LR2/);
    expect(resolveRuleset(facts, 'beatoraja', { selectedGauge: 'lr2:P-ATTACK' }).gauge.id).toBe('P-ATTACK');
    expect(resolveRuleset(facts, 'lr2', { selectedGauge: 'beatoraja:EX-HARD' }).gauge.id).toBe('EX-HARD');
    expect(resolveRuleset(facts, 'lr2', { selectedGauge: '____:ASSIST-EASY' }).gauge.id).toBe('ASSISTED-EASY');
  });

  test('LR2’s mine floor follows the LR2 gauge under another ruleset’s judging', () => {
    const own = resolveRuleset(facts, 'lr2', { selectedGauge: 'GROOVE', course: { kind: 'expert' } });
    const crossed = resolveRuleset(facts, 'beatoraja', { selectedGauge: 'lr2:GROOVE', course: { kind: 'expert' } });
    expect(own.gauge.mineFloor).toBe(2);
    expect(crossed.gauge.mineFloor).toBe(2);
    expect(
      resolveRuleset(facts, 'lr2', { selectedGauge: 'beatoraja:GROOVE', course: { kind: 'expert' } }).gauge.mineFloor,
    ).toBeUndefined();
  });

  describe('gauge auto-shift', () => {
    const ladder = (judge: RulesetId, selectedGauge: string): string[] | undefined =>
      resolveRuleset(facts, judge, { selectedGauge, gaugeAutoShift: 'BEST_CLEAR' }).gaugeBank?.specs.map(
        (spec) => spec.id,
      );

    test('shifts along the gauge’s own source’s ladder', () => {
      expect(ladder('____', 'lr2:HARD')).toEqual(['EASY', 'GROOVE', 'HARD', 'DEATH']);
      expect(ladder('lr2', 'beatoraja:HARD')).toEqual(['ASSIST-EASY', 'EASY', 'NORMAL', 'HARD', 'EX-HARD', 'HAZARD']);
      expect(ladder('beatoraja', '____:HARD')).toEqual(['ASSISTED-EASY', 'EASY', 'NORMAL', 'HARD', 'EX-HARD']);
      // A bare pick still shifts along the judge ruleset's own.
      expect(ladder('____', 'HARD')).toEqual(['ASSISTED-EASY', 'EASY', 'NORMAL', 'HARD', 'EX-HARD']);
    });

    test('reads the lowest gauge on that source’s ladder', () => {
      const bottom = (judge: RulesetId, selectedGauge: string) =>
        resolveRuleset(facts, judge, {
          selectedGauge,
          gaugeAutoShift: 'SELECT_TO_UNDER',
          bottomShiftableGauge: 'GROOVE',
        }).gaugeBank;
      // LR2's ladder has GROOVE second; beatoraja's has NORMAL third.
      expect(bottom('beatoraja', 'lr2:HARD')).toMatchObject({ bottomIndex: 1, upperExclusive: 3 });
      expect(bottom('lr2', 'beatoraja:HARD')).toMatchObject({ bottomIndex: 2, upperExclusive: 4 });
    });

    test('SURVIVAL TO GROOVE falls back to that source’s recovery gauge', () => {
      const fallback = (judge: RulesetId, selectedGauge: string) =>
        resolveRuleset(facts, judge, { selectedGauge, gaugeAutoShift: 'SURVIVAL_TO_GROOVE' }).gaugeFallback;
      expect(fallback('beatoraja', 'lr2:HARD')).toEqual(resolveRuleset(facts, 'lr2').gauge);
      expect(fallback('lr2', 'beatoraja:HARD')).toEqual(resolveRuleset(facts, 'beatoraja').gauge);
    });
  });

  describe('course gauges', () => {
    test('a course stage runs on the gauge’s own source’s course gauge, from the value carried in', () => {
      const course = { kind: 'expert', initialGauge: 64 } as const;
      const crossed = resolveRuleset(facts, 'beatoraja', { selectedGauge: 'lr2:HARD', course });
      expect(crossed.gauge).toEqual(resolveRuleset(facts, 'lr2', { selectedGauge: 'HARD', course }).gauge);
      expect(crossed.gauge).toMatchObject({ id: 'COURSE-HARD', initial: 64 });
      const classGauge = resolveRuleset(facts, 'lr2', { selectedGauge: 'beatoraja:HARD', course });
      expect(classGauge.gauge).toEqual(resolveRuleset(facts, 'beatoraja', { selectedGauge: 'HARD', course }).gauge);
      expect(classGauge.gauge).toMatchObject({ id: 'EXCLASS', initial: 64 });
    });

    test('auto-shift carries every course gauge of that source', () => {
      const course = { kind: 'grade', initialGauges: { GRADE: 40, 'GRADE-HARD': 12, 'GRADE-DEATH': 0 } } as const;
      const bank = resolveRuleset(facts, '____', {
        selectedGauge: 'lr2:HARD',
        gaugeAutoShift: 'BEST_CLEAR',
        course,
      }).gaugeBank!;
      expect(bank.specs.map((spec) => [spec.id, spec.initial])).toEqual([
        ['GRADE', 40],
        ['GRADE-HARD', 12],
        ['GRADE-DEATH', 0],
      ]);
    });
  });

  test('PRACTICE keeps the judge ruleset’s own gauge list', () => {
    const practice = { gauge: 'HARD', startGauge: 50, sourceNotes: facts.notes } as const;
    const config = resolveRuleset(facts, 'beatoraja', { selectedGauge: 'lr2:HARD', practice });
    expect(config.gaugeSource).toBe('beatoraja');
    expect(config.gauge).toEqual(resolveRuleset(facts, 'beatoraja', { practice }).gauge);
  });
});

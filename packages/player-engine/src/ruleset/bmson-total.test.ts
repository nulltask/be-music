import { describe, expect, test } from 'vite-plus/test';
import { isBmsonRecoveryDisabled } from './bmson-total.ts';
import { resolveRuleset, type GaugeSpec, type ResolveRulesetOptions, type RulesetId } from './definitions.ts';
import { RulesetGauge } from './gauge.ts';
import type { RulesetChartFacts } from './facts.ts';

const facts: RulesetChartFacts = {
  sourceFormat: 'bmson',
  laneMode: '7keys',
  lnMode: 3,
  total: 0,
  judgeRank: { percent: 100 },
  notes: { normal: 1000, long: { 1: 0, 2: 0, 3: 1 } },
};

function specs(config: ReturnType<typeof resolveRuleset>): GaugeSpec[] {
  return [config.gauge, ...(config.gaugeFallback ? [config.gaugeFallback] : []), ...(config.gaugeBank?.specs ?? [])];
}

describe('bmson zero-total policy', () => {
  test('only explicit percentage zero opts into no recovery', () => {
    expect(isBmsonRecoveryDisabled(facts, 'spec')).toBe(true);
    for (const mode of [undefined, 'beatoraja'] as const) expect(isBmsonRecoveryDisabled(facts, mode)).toBe(false);
    for (const total of [undefined, 100, NaN, Infinity]) {
      expect(isBmsonRecoveryDisabled({ ...facts, total }, 'spec')).toBe(false);
      expect(resolveRuleset({ ...facts, total }, 'beatoraja', { bmsonTotalMode: 'spec' }).gauge).toEqual(
        resolveRuleset({ ...facts, total }, 'beatoraja').gauge,
      );
    }
    expect(() => resolveRuleset({ ...facts, total: -100 }, 'beatoraja', { bmsonTotalMode: 'spec' })).toThrow(
      /normalized/,
    );
    expect(isBmsonRecoveryDisabled({ ...facts, totalUnit: 'absolute' }, 'spec')).toBe(false);
    expect(isBmsonRecoveryDisabled({ ...facts, sourceFormat: 'bms' }, 'spec')).toBe(false);
    expect(isBmsonRecoveryDisabled({ ...facts, sourceFormat: 'bms', totalUnit: 'percent' }, 'spec')).toBe(true);
  });

  test.each([
    ['lr2', {}],
    ['lr2', { selectedGauge: 'HARD' }],
    ['lr2', { selectedGauge: 'DEATH' }],
    ['lr2', { selectedGauge: 'P-ATTACK' }],
    ['lr2', { course: { kind: 'grade', initialGauge: 63 } }],
    ['beatoraja', {}],
    ['beatoraja', { gaugeAutoShift: 'SURVIVAL_TO_GROOVE', selectedGauge: 'HARD' }],
    ['beatoraja', { gaugeAutoShift: 'BEST_CLEAR' }],
    ['beatoraja', { gaugeAutoShift: 'SELECT_TO_UNDER' }],
    [
      'beatoraja',
      {
        course: { kind: 'grade', initialGauge: 63, initialGauges: { CLASS: 54, EXCLASS: 43 } },
        gaugeAutoShift: 'BEST_CLEAR',
      },
    ],
    ['____', {}],
    ['____', { course: { kind: 'grade', initialGauge: 63 } }],
  ] satisfies [RulesetId, ResolveRulesetOptions][])(
    '%s suppresses recovery after constructing %j, retaining damage and carry',
    (id, options) => {
      const before = resolveRuleset(facts, id, options);
      const after = resolveRuleset(facts, id, { ...options, bmsonTotalMode: 'spec' });
      expect(after.effectiveTotal).toBe(before.effectiveTotal);
      specs(after).forEach((spec, index) => {
        const original = specs(before)[index]!;
        expect(spec).toEqual({
          ...original,
          recoveryDisabled: true,
          values: original.values.map((delta) => Math.min(0, delta)),
        });
        const gauge = new RulesetGauge(spec);
        const initial = gauge.value;
        for (const judge of [0, 1, 2] as const) {
          if (spec.values[judge] === 0) gauge.applyJudge(judge, 0.5);
        }
        gauge.applyRawDelta(12);
        expect(gauge.value).toBe(initial);
        gauge.applyRawDelta(-3);
        expect(gauge.value).toBeLessThanOrEqual(initial);
      });
    },
  );

  test('HCN release damage, mines and negative rates still lower a gauge', () => {
    const config = resolveRuleset(facts, 'beatoraja', {
      bmsonTotalMode: 'spec',
      selectedGauge: 'HARD',
      gaugeAutoShift: 'SURVIVAL_TO_GROOVE',
    });
    const gauge = new RulesetGauge(config.gauge, config.gaugeFallback);
    gauge.applyJudge(1, 0.5);
    expect(gauge.value).toBe(100);
    gauge.applyJudge(3, 0.5);
    expect(gauge.value).toBeLessThan(100);
    gauge.applyRawDelta(-1000);
    expect(gauge.spec.id).toBe('NORMAL');
    const fallback = gauge.value;
    gauge.applyJudge(0);
    gauge.applyRawDelta(10);
    expect(gauge.value).toBe(fallback);
  });

  test('parallel gauges retain their own carry and never recover after selection changes', () => {
    const config = resolveRuleset(facts, 'beatoraja', {
      bmsonTotalMode: 'spec',
      gaugeAutoShift: 'BEST_CLEAR',
      course: { kind: 'grade', initialGauges: { CLASS: 60, EXCLASS: 40, EXHARDCLASS: 20 } },
    });
    const gauge = new RulesetGauge(config.gauge, config.gaugeFallback, config.gaugeBank);
    expect(gauge.values).toEqual({ CLASS: 60, EXCLASS: 40, EXHARDCLASS: 20 });
    gauge.applyJudge(0);
    gauge.applyRawDelta(50);
    expect(gauge.values).toEqual({ CLASS: 60, EXCLASS: 40, EXHARDCLASS: 20 });
    gauge.applyRawDelta(-30);
    expect(gauge.values).toEqual({ CLASS: 30, EXCLASS: 10, EXHARDCLASS: 0 });
    expect(gauge.spec.id).toBe('EXCLASS');
  });

  test('PRACTICE explicit TOTAL takes precedence, while its start gauge is independent', () => {
    const practice = { sourceNotes: facts.notes, gauge: 'HARD' as const, startGauge: 30 };
    const strict = resolveRuleset(facts, 'beatoraja', { bmsonTotalMode: 'spec', practice });
    expect(strict.gauge.initial).toBe(30);
    expect(strict.gauge.values[0]).toBe(0);
    for (const total of [0, 300]) {
      const changed = resolveRuleset(facts, 'beatoraja', { bmsonTotalMode: 'spec', practice: { ...practice, total } });
      expect(changed.gauge.recoveryDisabled).toBeUndefined();
      expect(changed.gauge).toEqual(resolveRuleset(facts, 'beatoraja', { practice: { ...practice, total } }).gauge);
    }
  });

  test.each(['lr2', 'beatoraja', '____'] as const)('%s zero-note gauges remain finite', (id) => {
    const empty = { ...facts, notes: { normal: 0, long: { 1: 0, 2: 0, 3: 0 } } };
    const config = resolveRuleset(empty, id, { bmsonTotalMode: 'spec' });
    expect(Number.isFinite(config.effectiveTotal)).toBe(true);
    expect(config.gauge.values.every(Number.isFinite)).toBe(true);
    const gauge = new RulesetGauge(config.gauge);
    gauge.applyJudge(0);
    gauge.applyRawDelta(20);
    expect(gauge.value).toBe(config.gauge.initial);
  });
});

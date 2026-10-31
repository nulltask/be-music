import { describe, expect, test } from 'vite-plus/test';
import { resolveRuleset, type GaugeSpec } from './definitions.ts';
import type { RulesetChartFacts } from './facts.ts';

function facts(laneMode: string, total?: number): RulesetChartFacts {
  return {
    sourceFormat: 'bms',
    laneMode,
    lnMode: 1,
    judgeRank: { percent: 75 },
    notes: { normal: 1000, long: { 1: 0, 2: 0, 3: 0 } },
    ...(total !== undefined ? { total } : {}),
  };
}
function gauge(laneMode: string, id: string, total = 300): GaugeSpec {
  return resolveRuleset(facts(laneMode, total), 'beatoraja', { gauge: id }).gauge;
}

describe('beatoraja per-mode single gauges', () => {
  test.each([
    [
      '5K',
      100,
      20,
      [50, 75, 75],
      [
        [-1.5, -3, -0.5],
        [-1.5, -4.5, -1],
        [-3, -6, -2],
      ],
    ],
    [
      '10K',
      100,
      20,
      [50, 75, 75],
      [
        [-1.5, -3, -0.5],
        [-1.5, -4.5, -1],
        [-3, -6, -2],
      ],
    ],
    [
      '7K',
      100,
      20,
      [60, 80, 80],
      [
        [-1.5, -3, -0.5],
        [-1.5, -4.5, -1],
        [-3, -6, -2],
      ],
    ],
    [
      '14K',
      100,
      20,
      [60, 80, 80],
      [
        [-1.5, -3, -0.5],
        [-1.5, -4.5, -1],
        [-3, -6, -2],
      ],
    ],
    [
      '9K',
      120,
      30,
      [65, 85, 85],
      [
        [-1, -2, -2],
        [-1, -3, -3],
        [-2, -6, -6],
      ],
    ],
    [
      '24K',
      100,
      20,
      [50, 70, 70],
      [
        [-1, -2, -1],
        [-1, -3, -1],
        [-2, -4, -2],
      ],
    ],
    [
      '48K',
      100,
      20,
      [50, 70, 70],
      [
        [-1, -2, -1],
        [-1, -3, -1],
        [-2, -4, -2],
      ],
    ],
  ] as const)('%s uses its bounds, borders, recovery and damage', (mode, max, initial, borders, losses) => {
    ['ASSIST-EASY', 'EASY', 'NORMAL'].forEach((id, index) => {
      const spec = gauge(mode, id);
      expect(spec).toMatchObject({
        min: 2,
        max,
        initial: (mode === '24K' || mode === '48K') && id === 'ASSIST-EASY' ? 30 : initial,
        border: borders[index],
        survival: false,
        guts: [],
      });
      expect(spec.values).toEqual([0.3, 0.3, 0.15, ...losses[index]!]);
    });
  });

  test.each([
    ['5K', 'HARD', [0, 0, 0, -5, -10, -5], false],
    ['5K', 'EX-HARD', [0, 0, 0, -10, -20, -10], false],
    ['5K', 'HAZARD', [0, 0, 0, -100, -100, -100], false],
    ['7K', 'HARD', [0.15, 0.12, 0.03, -5, -10, -5], true],
    ['7K', 'EX-HARD', [0.15, 0.06, 0, -8, -16, -8], false],
    ['7K', 'HAZARD', [0.15, 0.06, 0, -100, -100, -10], false],
    ['9K', 'HARD', [0.15, 0.12, 0.03, -5, -10, -10], true],
    ['9K', 'EX-HARD', [0.15, 0.06, 0, -10, -15, -15], false],
    ['9K', 'HAZARD', [0.15, 0.06, 0, -100, -100, -100], false],
    ['24K', 'HARD', [0.2, 0.2, 0.1, -4, -8, -4], true],
    ['24K', 'EX-HARD', [0.2, 0.1, 0, -6, -12, -6], false],
    ['24K', 'HAZARD', [0.2, 0.1, 0, -100, -100, -100], false],
  ] as const)('%s %s uses its survival table', (mode, id, values, guts) => {
    const spec = gauge(mode, id);
    expect(spec).toMatchObject({ min: 0, max: 100, initial: 100, border: 0, survival: true });
    expect(spec.values).toEqual(values);
    expect(spec.guts.length > 0).toBe(guts);
  });

  test('applies five-key EX-HARD MODIFY_DAMAGE rather than seven-key recovery limits', () => {
    expect(gauge('5K', 'EX-HARD', 230).values[3]).toBeCloseTo(-11.1, 9);
    expect(gauge('5K', 'EX-HARD', 100).values[4]).toBeCloseTo(-200, 9);
  });

  test.each(['24K', '48K', '5 KEY GENERIC', '9 KEY GENERIC', '70 KEY GENERIC'])(
    '%s uses the keyboard default TOTAL for BMS and bmson',
    (mode) => {
      const expected = (7.605 * 1100) / 16.5;
      expect(resolveRuleset(facts(mode, undefined), 'beatoraja').effectiveTotal).toBeCloseTo(expected, 9);
      expect(resolveRuleset({ ...facts(mode, 150), sourceFormat: 'bmson' }, 'beatoraja').effectiveTotal).toBeCloseTo(
        expected * 1.5,
        9,
      );
    },
  );
});

test.each(['5K', '7K', '9K', '24K', '14K'])('SURVIVAL TO GROOVE uses %s NORMAL TOTAL, floor and border', (mode) => {
  const config = resolveRuleset(facts(mode, 300), 'beatoraja', {
    selectedGauge: 'HARD',
    gaugeAutoShift: 'SURVIVAL_TO_GROOVE',
  });
  expect(config.gauge.id).toBe('HARD');
  expect(config.gaugeFallback).toEqual(gauge(mode, 'NORMAL'));
});

test('SURVIVAL TO GROOVE excludes course class gauges and other rulesets', () => {
  const config = resolveRuleset(facts('7K'), 'beatoraja', {
    selectedGauge: 'HARD',
    gaugeAutoShift: 'SURVIVAL_TO_GROOVE',
    course: { kind: 'grade', initialGauge: 40 },
  });
  expect(config.gauge.id).toBe('EXCLASS');
  expect(config.gaugeFallback).toBeUndefined();
  expect(resolveRuleset(facts('7K'), 'lr2', { gaugeAutoShift: 'SURVIVAL_TO_GROOVE' }).gaugeFallback).toBeUndefined();
});

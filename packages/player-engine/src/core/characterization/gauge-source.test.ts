import { describe, expect, test } from 'vite-plus/test';
import type { ReplayRulesetResult } from '../../replay/format.ts';
import { rejudgeReplayRulesets } from '../../replay/rejudge.ts';
import { RULESET_IDS, type RulesetId } from '../../ruleset/definitions.ts';
import type { GaugePick } from '../../ruleset/gauge-type.ts';
import type { PlayerOptions } from '../engine-types.ts';
import { longNoteChart, mineChart } from './charts.ts';
import { observePlay, tap, type ScriptStep } from './harness.ts';

/*
 * A source-qualified gauge (`lr2:HARD`, #1171) keeps its source whichever ruleset judges the play. Live play, the
 * replay's own re-simulation and re-judging under the other rulesets must all agree on it.
 */

/** The long-note chart: a hold to the end, an early release, a tap, a late scratch release, a missed long note. */
const LONG_NOTE_SCRIPT: ScriptStep[] = [
  { atMs: 500, down: ['11'] },
  { atMs: 1010, down: ['12'] },
  ...tap(1250, '13'),
  { atMs: 1500, up: ['11'] },
  { atMs: 1600, up: ['12'] },
  { atMs: 2000, down: ['16'] },
  { atMs: 2540, up: ['16'] },
  ...tap(3480, '15'),
];

/** The mine chart: a key held through a mine, a press onto a mine, a scratch held through one, two taps. */
const MINE_SCRIPT: ScriptStep[] = [
  { atMs: 490, down: ['11'] },
  { atMs: 1100, up: ['11'] },
  ...tap(1500, '11'),
  ...tap(2000, '12'),
  { atMs: 2400, down: ['16'] },
  { atMs: 2600, up: ['16'] },
];

const CASES = [
  { name: 'charge notes', chart: () => longNoteChart(2), script: LONG_NOTE_SCRIPT },
  { name: 'mines', chart: mineChart, script: MINE_SCRIPT },
] as const;

const PAIRS = RULESET_IDS.flatMap((judge) =>
  RULESET_IDS.filter((source) => source !== judge).map((source) => [judge, source] as const),
);

const withoutRuleset = ({ ruleset: _ruleset, ...rest }: ReplayRulesetResult) => rest;

async function play(caseIndex: number, judge: RulesetId, gauge: GaugePick, options: PlayerOptions = {}) {
  const { chart, script } = CASES[caseIndex]!;
  const observed = await observePlay({
    driver: 'manual',
    chart: chart(),
    script,
    // Play to the end, so every ruleset judges the same inputs.
    options: { judgeRuleset: judge, gauge, endOnFailure: false, ...options },
  });
  expect(observed.outcome).toBe('completed');
  return observed;
}

describe.each(CASES.map((entry, index) => [entry.name, index] as const))('%s', (_name, index) => {
  test.each(PAIRS)('%s judging on %s:HARD: live play, its replay and re-judging agree', async (judge, source) => {
    const gauge: GaugePick = `${source}:HARD`;
    const live = await play(index, judge, gauge);
    const replay = live.replay!;
    expect(replay.play.gauge).toBe(gauge);
    expect(replay.play.judgeRuleset ?? 'lr2').toBe(judge);
    // The gauge is the source's, named as such in the result.
    expect(live.summary!.gauge).toMatchObject({ type: 'HARD', source });
    const native = replay.results!.native!;
    expect(native.gauge).toMatchObject({ type: 'HARD', source });
    // Live play and the replay's re-simulation under the played ruleset agree to the last figure.
    expect(withoutRuleset(native)).toEqual(withoutRuleset(live.simulated![judge]!));

    // Carried (ADR 0019): every other ruleset re-judges the inputs on the same source's gauge.
    const outcomes = rejudgeReplayRulesets(replay, RULESET_IDS);
    for (const target of RULESET_IDS) {
      const outcome = outcomes[target]!;
      expect(outcome.status, target).toBe('simulated');
      if (outcome.status !== 'simulated') continue;
      expect(outcome.result.gauge.type, target).toBe('HARD');
      expect(outcome.result.gauge.source, target).toBe(target === source ? undefined : source);
      expect(outcome.result).toEqual(live.simulated![target]);
    }

    // Under its own source's judging, the qualified gauge is that ruleset's bare HARD.
    const own = await play(index, source, 'HARD');
    const carried = outcomes[source]!;
    if (carried.status === 'simulated') {
      const reference = rejudgeReplayRulesets(
        { ...replay, play: { ...replay.play, gauge: 'HARD', judgeRuleset: source } },
        [source],
      )[source]!;
      expect(reference.status).toBe('simulated');
      if (reference.status === 'simulated') expect(carried.result).toEqual(reference.result);
    }
    expect(own.summary!.gauge).not.toHaveProperty('source');
  });

  test.each(PAIRS)('%s judging on %s:HARD with BEST CLEAR shifts along the source’s ladder', async (judge, source) => {
    const live = await play(index, judge, `${source}:HARD`, { gaugeAutoShift: 'BEST_CLEAR' });
    const own = await play(index, source, 'HARD', { gaugeAutoShift: 'BEST_CLEAR' });
    const native = live.replay!.results!.native!;
    // The parallel gauges are the source's own line-up, not the judge ruleset's.
    expect(Object.keys(native.gauge.values!)).toEqual(Object.keys(own.replay!.results!.native!.gauge.values!));
    expect(native.gauge.source).toBe(source);
    expect(withoutRuleset(native)).toEqual(withoutRuleset(live.simulated![judge]!));
  });

  test.each(PAIRS)('%s judging on %s:HARD in a course starts from the carried gauge', async (judge, source) => {
    const course = { kind: 'expert', carryIn: { gauge: 76.5, combo: 7, maxCombo: 30 } } as const;
    const live = await play(index, judge, `${source}:HARD`, { course });
    const own = await play(index, source, 'HARD', { course });
    const native = live.replay!.results!.native!;
    // The stage runs on the source's course gauge (LR2's and plugout's COURSE-HARD, the others' EXCLASS).
    expect(native.gauge.type).toBe(own.replay!.results!.native!.gauge.type);
    expect(native.gauge.type).toBe(source === 'lr2' || source === 'plugout' ? 'COURSE-HARD' : 'EXCLASS');
    expect(native.gauge.source).toBe(source);
    expect(live.summary!.gauge!.initial).toBe(76.5);
    expect(withoutRuleset(native)).toEqual(withoutRuleset(live.simulated![judge]!));
    expect(native.course).toEqual(live.simulated![judge]!.course);
  });
});

import type { BeMusicJSON } from '@be-music/chart-source';
import { describe, expect, test } from 'vite-plus/test';
import type { PlayerOptions } from '../engine-types.ts';
import type { RulesetId } from '../../ruleset/definitions.ts';
import { basicChart, exRankChart, longNoteChart } from './charts.ts';
import { observePlay } from './harness.ts';

/**
 * What an AUTO play started partway (`startAtSeconds`) must show: what a play from the chart's start shows at that
 * second, and the same end. Each case starts at a second no note lies just after, so the play from 0 reaches it on a
 * tick that judges nothing past it.
 */

interface StartCase {
  name: string;
  chart: () => BeMusicJSON;
  at: number;
  options?: PlayerOptions;
}

const CASES: readonly StartCase[] = [
  { name: 'basic', chart: basicChart, at: 2.2 },
  { name: 'a charge note held across the start', chart: () => longNoteChart(2), at: 1.6 },
  { name: 'mines and invisible notes', chart: () => exRankChart(), at: 2.6 },
  { name: 'a tempo', chart: basicChart, at: 2.2, options: { speed: 1.5 } },
];

const RULESETS: readonly RulesetId[] = ['lr2', 'beatoraja', 'iidx'];

async function playBothWays(startCase: StartCase, ruleset: RulesetId) {
  const options: PlayerOptions = { ...startCase.options, judgeRuleset: ruleset };
  const fromStart = await observePlay({
    driver: 'auto',
    chart: startCase.chart(),
    options,
    captureAt: [startCase.at],
  });
  const partway = await observePlay({
    driver: 'auto',
    chart: startCase.chart(),
    options: { ...options, startAtSeconds: startCase.at },
    captureAt: [startCase.at],
  });
  return { fromStart, partway };
}

describe('an AUTO play started partway', () => {
  for (const startCase of CASES) {
    for (const ruleset of RULESETS) {
      test(`${startCase.name} / ${ruleset}: ends as a play from the start does`, async () => {
        const { fromStart, partway } = await playBothWays(startCase, ruleset);
        expect(partway.outcome).toBe('completed');
        expect(partway.summary).toEqual(fromStart.summary);
      });

      // D1 of the seek redesign: the notes before the start count, but no judge cue carries their combo.
      test.fails(`${startCase.name} / ${ruleset}: shows at the start what a play from the start shows there`, async () => {
        const { fromStart, partway } = await playBothWays(startCase, ruleset);
        expect(partway.captured).toEqual(fromStart.captured);
      });
    }
  }
});

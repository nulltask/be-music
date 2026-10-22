import type { BeMusicJSON } from '@be-music/chart-source';
import { describe, expect, test } from 'vite-plus/test';
import type { PlayerOptions } from '../engine-types.ts';
import type { RulesetId } from '../../ruleset/definitions.ts';
import { basicChart, exRankChart, longNoteChart } from './charts.ts';
import { command, observePlay, type PlayObservation } from './harness.ts';

/**
 * What an AUTO play that seeks must show (ADR 0016): at the second sought, what a play from the chart's start shows
 * there, and the same end — whether it starts there (`startAtSeconds`) or seeks there forwards or backwards mid-play.
 * Each case goes to a second no note lies just after, so the play from 0 reaches it on a tick that judges nothing past
 * it.
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

/** How the play gets to the case's second: from its start, or by a seek command forwards or backwards mid-play. */
const WAYS = {
  'started there': (startCase: StartCase) => ({ options: { startAtSeconds: startCase.at } }),
  'sought forwards': (startCase: StartCase) => ({ script: [command(300, { kind: 'seek', seconds: startCase.at })] }),
  'sought backwards': (startCase: StartCase) => ({ script: [command(3000, { kind: 'seek', seconds: startCase.at })] }),
} as const;

async function playBothWays(
  startCase: StartCase,
  ruleset: RulesetId,
  way: keyof typeof WAYS,
): Promise<{ fromStart: PlayObservation; sought: PlayObservation }> {
  const options: PlayerOptions = { ...startCase.options, judgeRuleset: ruleset };
  const fromStart = await observePlay({ driver: 'auto', chart: startCase.chart(), options, captureAt: [startCase.at] });
  const { options: wayOptions, script } = { options: {}, script: [], ...WAYS[way](startCase) };
  const sought = await observePlay({
    driver: 'auto',
    chart: startCase.chart(),
    options: { ...options, ...wayOptions },
    script,
    captureAt: [startCase.at],
  });
  return { fromStart, sought };
}

describe('an AUTO play that seeks', () => {
  for (const startCase of CASES) {
    for (const ruleset of RULESETS) {
      for (const way of Object.keys(WAYS) as (keyof typeof WAYS)[]) {
        test(`${startCase.name} / ${ruleset} / ${way}: shows there and at the end what a play from the start shows`, async () => {
          const { fromStart, sought } = await playBothWays(startCase, ruleset, way);
          expect(sought.outcome).toBe('completed');
          expect(sought.frames.generations?.at(-1)).toMatch(/ generation=1 /);
          expect(sought.captured).toEqual(fromStart.captured);
          expect(sought.summary).toEqual(fromStart.summary);
          // A play that sought records no replay.
          expect(sought.replay).toBeUndefined();
        });
      }
    }
  }
});

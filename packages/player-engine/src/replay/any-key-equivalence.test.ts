import { createEmptyJSON, type BeMusicJSON } from '@be-music/chart-source';
import { describe, expect, test } from 'vite-plus/test';
import { runRecordedPlay } from '../test-support/recorded-play.ts';
import { simulateReplay } from './simulate.ts';
import type { ReplayInputEvent, ReplayRulesetResult } from './format.ts';
import type { PlayerSummary } from '../core/engine.ts';
import type { RulesetId } from '../ruleset/index.ts';

/**
 * ANY KEY (#751): the engine routes each recorded press to the nearest note on any lane, and the replay simulator
 * must route it the same way from the same log, which keeps the keys' own lanes.
 */

function key(seq: number, timeUs: number, action: 'down' | 'up', channel: string, token?: string): ReplayInputEvent {
  return { seq, timeUs, action, channels: [channel], ...(token !== undefined ? { tokens: [token] } : {}) };
}

/** BPM 240 → one measure per second, so `measure` + `position` read directly as seconds. */
function chart(events: BeMusicJSON['events'], lnObj?: string): BeMusicJSON {
  const json = createEmptyJSON('bms');
  json.metadata.bpm = 240;
  json.metadata.rank = 2;
  if (lnObj !== undefined) json.bms.lnObjs = [lnObj];
  json.events = events;
  return json;
}

function judgments(summary: PlayerSummary): Record<string, number> {
  return {
    pgreat: summary.perfect,
    great: summary.great,
    good: summary.good,
    bad: summary.bad,
    poor: summary.poor,
    emptyPoor: summary.emptyPoor,
  };
}

function simulatedJudgments(result: ReplayRulesetResult): Record<string, number> {
  return { ...result.judge };
}

const RULESETS: readonly RulesetId[] = ['lr2', 'beatoraja', '____'];

async function playAndSimulate(json: BeMusicJSON, inputs: readonly ReplayInputEvent[], ruleset: RulesetId) {
  const { summary, replay } = await runRecordedPlay(json, inputs, ruleset, { anyKey: true });
  const simulated = simulateReplay(replay, { ruleset });
  expect(judgments(summary)).toEqual(simulatedJudgments(simulated));
  expect(summary.exScore).toBe(simulated.exScore);
  expect(summary.maxCombo).toBe(simulated.maxCombo);
  expect(summary.fast).toBe(simulated.fast);
  expect(summary.slow).toBe(simulated.slow);
  return { summary, replay, simulated };
}

describe.concurrent('ANY KEY engine / simulator equivalence', () => {
  test.each(RULESETS)('%s: one key takes the notes of every lane, the scratch included', async (ruleset) => {
    const json = chart([
      { measure: 1, channel: '11', position: [0, 1], value: '01' }, // 1.000
      { measure: 1, channel: '13', position: [1, 4], value: '01' }, // 1.250
      { measure: 1, channel: '16', position: [1, 2], value: '01' }, // 1.500 scratch
      { measure: 1, channel: '18', position: [3, 4], value: '01' }, // 1.750
    ]);
    const inputs = [
      key(0, 1_000_000, 'down', '11', 'z'),
      key(1, 1_050_000, 'up', '11', 'z'),
      key(2, 1_260_000, 'down', '11', 'z'),
      key(3, 1_300_000, 'up', '11', 'z'),
      key(4, 1_500_000, 'down', '11', 'z'),
      key(5, 1_550_000, 'up', '11', 'z'),
      key(6, 1_700_000, 'down', '11', 'z'),
      key(7, 1_720_000, 'up', '11', 'z'),
    ];
    const { summary, replay } = await playAndSimulate(json, inputs, ruleset);
    expect(summary.poor).toBe(0);
    expect(summary.perfect + summary.great + summary.good).toBe(4);
    // The log keeps the key's own lane and the switch, so a simulation routes the presses again.
    expect(replay.play.anyKey).toBe(true);
    expect(new Set(replay.inputs.flatMap((input) => input.channels))).toEqual(new Set(['11']));
  });

  test.each(RULESETS)('%s: a chord is taken by as many presses as it has notes', async (ruleset) => {
    const json = chart([
      { measure: 1, channel: '12', position: [0, 1], value: '01' },
      { measure: 1, channel: '15', position: [0, 1], value: '01' },
      { measure: 1, channel: '18', position: [0, 1], value: '01' },
    ]);
    const inputs = [
      key(0, 1_000_000, 'down', '11', 'z'),
      key(1, 1_000_000, 'down', '13', 'x'),
      key(2, 1_080_000, 'up', '11', 'z'),
      key(3, 1_080_000, 'up', '13', 'x'),
    ];
    const { summary } = await playAndSimulate(json, inputs, ruleset);
    // Two presses take two of the three notes; the third is missed.
    expect(summary.perfect).toBe(2);
    expect(summary.poor).toBe(1);
  });

  test.each(RULESETS)('%s: a long note stays held by the key that took its head', async (ruleset) => {
    const json = chart(
      [
        { measure: 1, channel: '13', position: [0, 1], value: '01' }, // LN 1.0 → 2.0
        { measure: 2, channel: '13', position: [0, 1], value: 'ZZ' },
        { measure: 1, channel: '14', position: [1, 2], value: '01' }, // tap 1.5
        { measure: 1, channel: '15', position: [3, 4], value: '01' }, // tap 1.75
      ],
      'ZZ',
    );
    const inputs = [
      key(0, 1_000_000, 'down', '11', 'z'), // takes the LN head on 13
      key(1, 1_500_000, 'down', '12', 's'), // the LN lane is held: takes the tap on 14
      key(2, 1_550_000, 'up', '12', 's'), // lets go of 14 only
      key(3, 1_750_000, 'down', '12', 's'), // takes the tap on 15
      key(4, 1_800_000, 'up', '12', 's'),
      key(5, 2_000_000, 'up', '11', 'z'), // releases the LN at its tail
    ];
    const { summary } = await playAndSimulate(json, inputs, ruleset);
    expect(summary.poor).toBe(0);
    expect(summary.bad).toBe(0);
    expect(summary.maxCombo).toBeGreaterThanOrEqual(3);
  });

  test.each(RULESETS)('%s: a log without tokens routes by the keys’ own lanes', async (ruleset) => {
    const json = chart([
      { measure: 1, channel: '14', position: [0, 1], value: '01' },
      { measure: 1, channel: '16', position: [1, 2], value: '01' },
    ]);
    const inputs = [
      key(0, 1_010_000, 'down', '11'),
      key(1, 1_060_000, 'up', '11'),
      key(2, 1_490_000, 'down', '11'),
      key(3, 1_540_000, 'up', '11'),
    ];
    const { summary } = await playAndSimulate(json, inputs, ruleset);
    expect(summary.poor).toBe(0);
  });

  test.each(RULESETS)('%s: a press with no note in reach stays on its own lane', async (ruleset) => {
    const json = chart([
      { measure: 1, channel: '13', position: [0, 1], value: '01' },
      { measure: 3, channel: '13', position: [0, 1], value: '01' },
    ]);
    const inputs = [
      key(0, 1_000_000, 'down', '11', 'z'),
      key(1, 1_050_000, 'up', '11', 'z'),
      // Far from any note: harmless, or an empty POOR where the ruleset's miss window reaches a note on 11 (none).
      key(2, 2_000_000, 'down', '11', 'z'),
      key(3, 2_050_000, 'up', '11', 'z'),
      key(4, 3_000_000, 'down', '12', 'x'),
      key(5, 3_050_000, 'up', '12', 'x'),
    ];
    const { summary } = await playAndSimulate(json, inputs, ruleset);
    expect(summary.perfect).toBe(2);
    expect(summary.emptyPoor).toBe(0);
  });
});

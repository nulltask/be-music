import { createEmptyJSON, type BeMusicJSON } from '@be-music/chart-source';
import { describe, expect, test } from 'vite-plus/test';
import type { ScratchSpin } from '../core/scratch-spin.ts';
import type { RulesetId } from '../ruleset/index.ts';
import { runRecordedPlay } from '../test-support/recorded-play.ts';
import type { ReplayInputEvent } from './format.ts';
import { simulateReplay } from './simulate.ts';

/**
 * Back-spin scratch (#940): a charge long note on a scratch lane has its tail judged on a press spinning the other way,
 * under beatoraja (CN / HCN) and That-Which-Must-Not-Be-Named; LR2 plays it as an LN. The live engine (re-driven by the inputs) and the
 * replay simulator must agree judge for judge, and the recorded replay must carry each press's spin.
 */

/** BPM 240: a scratch long note on `16` from 1.0 s to 2.0 s via `#LNOBJ`, and a tap on `19` at 4.0 s never pressed. */
function scratchLongNoteChart(lnMode: 1 | 2 | 3): BeMusicJSON {
  const json = createEmptyJSON('bms');
  json.metadata.bpm = 240;
  json.metadata.rank = 2;
  json.bms.lnObjs = ['AA'];
  json.bms.lnMode = lnMode;
  json.events = [
    { measure: 1, channel: '16', position: [0, 1], value: '01' },
    { measure: 2, channel: '16', position: [0, 1], value: 'AA' },
    { measure: 4, channel: '19', position: [0, 1], value: '01' },
  ];
  return json;
}

type Step = readonly [timeUs: number, action: 'down' | 'up', spin?: ScratchSpin];

function toInputs(steps: readonly Step[]): ReplayInputEvent[] {
  return steps.map(([timeUs, action, spin], seq) => ({
    seq,
    timeUs,
    action,
    channels: ['16'],
    tokens: [spin === 'ccw' ? 'ctrl-left' : 'shift-left'],
    ...(spin !== undefined ? { spin } : {}),
  }));
}

async function judge(ruleset: RulesetId, lnMode: 1 | 2 | 3, steps: readonly Step[]) {
  const { summary, replay } = await runRecordedPlay(scratchLongNoteChart(lnMode), toInputs(steps), ruleset);
  const simulated = simulateReplay(replay, { ruleset });
  const engine = [summary.perfect, summary.great, summary.good, summary.bad, summary.poor];
  expect(engine).toEqual([
    simulated.judge.pgreat,
    simulated.judge.great,
    simulated.judge.good,
    simulated.judge.bad,
    simulated.judge.poor,
  ]);
  expect(summary.exScore).toBe(simulated.exScore);
  expect(summary.gauge?.current).toBeCloseTo(simulated.gauge.final, 6);
  return { judges: engine, replay };
}

// `[pgreat, great, good, bad, poor]`, the never-pressed tap on `19` included.
describe.concurrent('back-spin scratch: engine / simulator equivalence', () => {
  test.each(['beatoraja', '____'] as const)('%s: a reverse spin on the tail judges it', async (ruleset) => {
    const { judges, replay } = await judge(ruleset, 2, [
      [1_000_000, 'down', 'cw'],
      [1_300_000, 'up'],
      [2_000_000, 'down', 'ccw'],
      [2_050_000, 'up'],
    ]);
    // Letting go mid-way settles nothing: the head and the spun-back tail both PGREAT.
    expect(judges).toEqual([2, 0, 0, 0, 1]);
    expect(replay.inputs.map((input) => input.spin)).toEqual(['cw', undefined, 'ccw', undefined]);
  });

  test.each(['beatoraja', '____'] as const)('%s: a tail released without a reverse spin is missed', async (ruleset) => {
    const { judges } = await judge(ruleset, 2, [
      [1_000_000, 'down', 'cw'],
      [2_000_000, 'up'],
    ]);
    expect(judges).toEqual([1, 0, 0, 0, 2]);
  });

  test.each(['beatoraja', '____'] as const)('%s: spinning the same way again is no reverse spin', async (ruleset) => {
    const { judges } = await judge(ruleset, 2, [
      [1_000_000, 'down', 'cw'],
      [1_500_000, 'up'],
      [2_000_000, 'down', 'cw'],
      [2_050_000, 'up'],
    ]);
    expect(judges).toEqual([1, 0, 0, 0, 2]);
  });

  test.each(['beatoraja', '____'] as const)('%s: a reverse spin while still held judges the tail', async (ruleset) => {
    const { judges } = await judge(ruleset, 2, [
      [1_000_000, 'down', 'cw'],
      [2_030_000, 'down', 'ccw'],
      [2_100_000, 'up'],
    ]);
    // Head and tail both scored; only the never-pressed tap is missed.
    expect(judges[0] + judges[1] + judges[2] + judges[3]).toBe(2);
    expect(judges[4]).toBe(1);
  });

  test.each(['beatoraja', '____'] as const)(
    '%s: a Hell Charge back-spin scratch agrees on the gauge',
    async (ruleset) => {
      const { judges } = await judge(ruleset, 3, [
        [1_000_000, 'down', 'cw'],
        [1_500_000, 'up'],
        [2_000_000, 'down', 'ccw'],
        [2_050_000, 'up'],
      ]);
      expect(judges).toEqual([2, 0, 0, 0, 1]);
    },
  );

  // Touch lanes (and ANY KEY presses from a non-scratch key) report no spin: a fresh press while the BSS is held turns
  // it back, and a head hit without a spin lets any later press do so.
  test.each(['beatoraja', '____'] as const)('%s: touch presses with no spin finish a BSS', async (ruleset) => {
    const { judges, replay } = await judge(ruleset, 2, [
      [1_000_000, 'down'],
      [1_300_000, 'up'],
      [2_000_000, 'down'],
      [2_050_000, 'up'],
    ]);
    expect(judges).toEqual([2, 0, 0, 0, 1]);
    expect(replay.inputs.every((input) => input.spin === undefined)).toBe(true);
  });

  test.each(['beatoraja', '____'] as const)(
    '%s: a second touch while the first is held finishes a BSS',
    async (ruleset) => {
      const { judges } = await judge(ruleset, 3, [
        [1_000_000, 'down'],
        [2_000_000, 'down'],
        [2_050_000, 'up'],
      ]);
      expect(judges).toEqual([2, 0, 0, 0, 1]);
    },
  );

  test.each([
    ['beatoraja', 'cw', undefined],
    ['beatoraja', undefined, 'cw'],
    ['____', 'cw', undefined],
    ['____', undefined, 'ccw'],
  ] as const)('%s: a %s head and a %s tail press count as a reverse spin', async (ruleset, head, tail) => {
    const { judges } = await judge(ruleset, 2, [
      [1_000_000, 'down', head],
      [1_300_000, 'up'],
      [2_000_000, 'down', tail],
      [2_050_000, 'up'],
    ]);
    expect(judges).toEqual([2, 0, 0, 0, 1]);
  });

  test('lr2: a scratch long note is an LN, settled by its release', async () => {
    const { judges } = await judge('lr2', 2, [
      [1_000_000, 'down', 'cw'],
      [2_000_000, 'up'],
    ]);
    expect(judges).toEqual([1, 0, 0, 0, 1]);
  });

  test('beatoraja: a scratch LN (`#LNMODE 1`) is no back-spin scratch', async () => {
    const { judges } = await judge('beatoraja', 1, [
      [1_000_000, 'down', 'cw'],
      [2_000_000, 'up'],
    ]);
    expect(judges).toEqual([1, 0, 0, 0, 1]);
  });
});

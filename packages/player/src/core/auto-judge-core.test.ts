import { resolveChart } from '@be-music/chart';
import { createEmptyJSON, type BeMusicJSON } from '@be-music/json';
import { describe, expect, test } from 'vite-plus/test';
import { resolveRuleset, rulesetChartFactsFromChart, type RulesetId } from '../ruleset/index.ts';
import {
  createAutoJudgeState,
  isAutoJudgeSettled,
  resolveNoteKeyLabel,
  runAutoJudgeStep,
  stepAutoJudge,
  type AutoJudgeState,
} from './auto-judge-core.ts';
import { createInitialPlayerSummary, preparePlaybackChart } from './bootstrap.ts';
import type { JudgeCoreEffect } from './judge-core.ts';
import { createScoreTracker } from './scoring.ts';

/** BPM 240 → one measure per second. A tap on `11` at 1 s, a CN-capable long note on `12` from 1.5 s to 2.5 s. */
const CHART: BeMusicJSON = (() => {
  const json = createEmptyJSON('bms');
  json.metadata.bpm = 240;
  json.bms.lnObjs = ['AA'];
  json.events = [
    { measure: 1, channel: '11', position: [0, 1], value: '01' },
    { measure: 1, channel: '12', position: [1, 2], value: '01' },
    { measure: 2, channel: '12', position: [1, 2], value: 'AA' },
    { measure: 3, channel: 'D1', position: [0, 1], value: '01' },
  ];
  return json;
})();

function createAuto(ruleset: RulesetId, chart: BeMusicJSON = CHART): AutoJudgeState {
  const source = structuredClone(chart);
  const resolved = resolveChart(source);
  const prepared = preparePlaybackChart(resolved);
  const config = resolveRuleset(rulesetChartFactsFromChart(source, prepared), ruleset);
  return createAutoJudgeState(
    {
      ruleset: config,
      scorableNotes: prepared.scorableNotes,
      landmineNotes: prepared.landmineNotes,
      invisibleNotes: prepared.invisibleNotes,
      keyLabels: new Map([
        ['11', 'z'],
        ['12', 's'],
        ['16', 'shift'],
      ]),
      reversalSeconds: resolved.reversal?.seconds,
    },
    {
      ...createInitialPlayerSummary(config, config.noteCount),
      scoreTracker: createScoreTracker({ moneyScore: config.moneyScore }),
    },
  );
}

function run(ruleset: RulesetId, ticks: readonly number[]): { state: AutoJudgeState; effects: JudgeCoreEffect[] } {
  const state = createAuto(ruleset);
  const effects: JudgeCoreEffect[] = [];
  for (const tick of ticks) {
    runAutoJudgeStep(state, { kind: 'advance', nowSec: tick }, (effect) => effects.push(effect));
  }
  runAutoJudgeStep(state, { kind: 'finish', totalSeconds: 4 }, (effect) => effects.push(effect));
  return { state, effects };
}

describe('auto judge core', () => {
  test('every note resolves PGREAT once chart time reaches it, and only then', () => {
    const state = createAuto('lr2');
    expect(stepAutoJudge(state, { kind: 'advance', nowSec: 0.99 })).toEqual([]);

    const effects = stepAutoJudge(state, { kind: 'advance', nowSec: 1 });
    expect(state.summary.perfect).toBe(1);
    expect(state.combo).toBe(1);
    expect(effects.find((effect) => effect.kind === 'trace')).toEqual({
      kind: 'trace',
      name: 'auto-judge',
      seconds: 1,
      fields: [
        ['result', 'PERFECT'],
        ['channel', '11'],
        ['key', 'z'],
      ],
    });
  });

  test('a long note scores once under an LN style, twice (head and tail) under a charge style', () => {
    const lr2 = run('lr2', [1.6, 2.4, 2.6]).state;
    const iidx = run('iidx', [1.6, 2.4, 2.6]).state;
    expect(lr2.summary.perfect).toBe(2);
    expect(iidx.summary.perfect).toBe(3);
    expect(isAutoJudgeSettled(lr2)).toBe(true);
  });

  test("an LN's one judgment lands at the tail; a charge note's head at the head and its tail at the tail", () => {
    // LR2 plays the long note as an LN, IIDX as a CN.
    const perfectsAfter = (ruleset: RulesetId, ticks: readonly number[]): number[] => {
      const state = createAuto(ruleset);
      return ticks.map((nowSec) => {
        stepAutoJudge(state, { kind: 'advance', nowSec });
        return state.summary.perfect;
      });
    };
    // The tap at 1 s, the head at 1.5 s, the tail at 2.5 s.
    expect(perfectsAfter('lr2', [1, 1.5, 2.4, 2.5])).toEqual([1, 1, 1, 2]);
    expect(perfectsAfter('iidx', [1, 1.5, 2.4, 2.5])).toEqual([1, 2, 2, 3]);
  });

  test("a charge note's head takes its combo at the head time and its tail at the tail time", () => {
    const { effects } = run('iidx', [1, 1.5, 2.5]);
    const combos = effects.flatMap((effect) =>
      effect.kind === 'combo' ? [[effect.seconds, effect.value, effect.channel]] : [],
    );
    expect(combos).toEqual([
      [1, 1, '11'],
      [1.5, 2, '12'],
      [2.5, 3, '12'],
    ]);
    // One frame per judgment instant: the head's comes with the long-note start, the tail's with its PGREAT.
    const frames = effects.flatMap((effect) => (effect.kind === 'frame' ? [effect.seconds] : []));
    expect(frames).toEqual([1, 1.5, 2.5]);
  });

  test("'reach' judges due heads without resolving tails", () => {
    const state = createAuto('lr2');
    stepAutoJudge(state, { kind: 'reach', nowSec: 3 });
    expect(state.summary.perfect).toBe(1);
    expect(state.pendingLongNotes).toHaveLength(1);
    expect(isAutoJudgeSettled(state)).toBe(false);
  });

  test('finish retires the mines and settles every tail', () => {
    const { state } = run('beatoraja', [1.5]);
    expect(state.config.landmineNotes.every((mine) => mine.judged)).toBe(true);
    expect(isAutoJudgeSettled(state)).toBe(true);
    expect(state.summary.poor).toBe(0);
  });

  test('the judged result does not depend on how the advances are spaced', () => {
    const fine = run(
      'beatoraja',
      Array.from({ length: 240 }, (_, index) => (index + 1) / 60),
    ).state;
    const coarse = run('beatoraja', [4]).state;
    expect(coarse.summary).toEqual(fine.summary);
    expect(coarse.scoreTracker.maxCombo).toBe(fine.scoreTracker.maxCombo);
  });

  test('an LR2 negative-BPM reversal freezes AUTO judging, and a run that leaves notes behind ends with the gauge at 0', () => {
    // `#BPM02 -240` at 1.25 s: the tap at 1 s plays, the long note from 1.5 s never starts.
    const chart = structuredClone(CHART);
    chart.resources.bpm['02'] = -240;
    chart.events.push({ measure: 1, channel: '08', position: [1, 4], value: '02' });
    const state = createAuto('lr2', chart);
    const effects: JudgeCoreEffect[] = [];
    for (const nowSec of [1, 1.6, 3, 10]) {
      runAutoJudgeStep(state, { kind: 'advance', nowSec }, (effect) => effects.push(effect));
    }
    expect(state.summary.perfect).toBe(1);
    expect(isAutoJudgeSettled(state)).toBe(false);

    runAutoJudgeStep(state, { kind: 'finish', totalSeconds: 4 }, (effect) => effects.push(effect));
    expect(state.summary.gauge!.current).toBe(0);
    expect(state.summary.gauge!.cleared).toBe(false);
    expect(effects.at(-1)).toMatchObject({ kind: 'trace', name: 'gauge', seconds: 4 });
  });

  test('resolveNoteKeyLabel reads the scratch label for the scratch sub-channels', () => {
    const keys = new Map([
      ['16', 'shift'],
      ['11', 'z'],
    ]);
    expect(resolveNoteKeyLabel('11', keys)).toBe('z');
    expect(resolveNoteKeyLabel('17', keys)).toBe('shift');
    expect(resolveNoteKeyLabel('27', keys)).toBe('?');
    expect(resolveNoteKeyLabel('19', keys)).toBe('?');
  });
});

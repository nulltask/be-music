import { resolveChart } from '@be-music/chart';
import { createEmptyJson, type BeMusicJson } from '@be-music/json';
import { describe, expect, test } from 'vite-plus/test';
import { resolveRuleset, rulesetChartFactsFromChart, type PlaylogRulesetId } from '../ruleset/index.ts';
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
const CHART: BeMusicJson = (() => {
  const json = createEmptyJson('bms');
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

function createAuto(ruleset: PlaylogRulesetId): AutoJudgeState {
  const source = structuredClone(CHART);
  const prepared = preparePlaybackChart(resolveChart(source));
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
    },
    {
      ...createInitialPlayerSummary(config, config.noteCount),
      scoreTracker: createScoreTracker({ moneyScore: config.moneyScore }),
    },
  );
}

function run(
  ruleset: PlaylogRulesetId,
  ticks: readonly number[],
): { state: AutoJudgeState; effects: JudgeCoreEffect[] } {
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

  test('a long note scores at its tail — twice when the ruleset judges head and tail', () => {
    const lr2 = run('lr2', [1.6, 2.4, 2.6]).state;
    const iidx = run('iidx', [1.6, 2.4, 2.6]).state;
    expect(lr2.summary.perfect).toBe(2);
    expect(iidx.summary.perfect).toBe(3);
    expect(isAutoJudgeSettled(lr2)).toBe(true);
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

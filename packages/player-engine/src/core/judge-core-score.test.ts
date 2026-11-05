import { createEmptyJSON } from '@be-music/chart-source';
import { resolveChart } from '@be-music/chart-model';
import { describe, expect, test } from 'vite-plus/test';
import { judgeWindowEarlyReachUs, judgeWindowLateReachUs } from '../ruleset/judge.ts';
import { resolveRuleset, rulesetChartFactsFromChart, type RulesetId } from '../ruleset/index.ts';
import { preparePlaybackChart } from './bootstrap.ts';
import { maxJudgeEarlyReachSeconds, maxJudgeReachSeconds } from './judge-core-score.ts';
import type { JudgeCoreConfig } from './judge-core-types.ts';

function rulesetFor(id: RulesetId) {
  const json = createEmptyJSON('bms');
  json.metadata.bpm = 120;
  json.events = [{ measure: 1, channel: '11', position: [0, 1], value: '01' }];
  const prepared = preparePlaybackChart(resolveChart(json));
  return resolveRuleset(rulesetChartFactsFromChart(json, prepared), id);
}

describe('judge reach bounds', () => {
  test.each(['lr2', 'beatoraja'] as const)('%s: the widest leg over every window set, in seconds', (id) => {
    const ruleset = rulesetFor(id);
    const tables = ruleset.windowsAt(0);
    const sets = [tables.note, tables.scratch, tables.longNoteEnd, tables.longScratchEnd];
    const widest = Math.max(...sets.flatMap((set) => [judgeWindowLateReachUs(set), judgeWindowEarlyReachUs(set)]));
    expect(maxJudgeReachSeconds({ ruleset }, 0)).toBe(widest / 1e6);
    const early = Math.max(judgeWindowEarlyReachUs(tables.note), judgeWindowEarlyReachUs(tables.scratch));
    expect(maxJudgeEarlyReachSeconds({ ruleset } as JudgeCoreConfig, 0)).toBe(early / 1e6);
    expect(widest).toBeGreaterThan(0);
  });
});

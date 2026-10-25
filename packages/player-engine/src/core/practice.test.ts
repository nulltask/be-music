import { expect, test } from 'vite-plus/test';
import { parseBMS } from '@be-music/chart-parser';
import { resolveChart } from '@be-music/chart-model';
import { preparePlaybackChart } from './bootstrap.ts';
import { resolvePracticeRange } from './practice.ts';
import { resolveRuleset } from '../ruleset/definitions.ts';
import type { RulesetChartFacts } from '../ruleset/facts.ts';

// 120 BPM: measure n starts at 2n seconds.
const SOURCE =
  '#BPM 120\n#WAV01 a.wav\n#WAV02 b.wav\n#LNOBJ ZZ\n#00111:01\n#00211:02\n#00212:01\n#00312:ZZ\n#00213:01\n#003D4:05\n#00411:01';

test('PracticeModifier moves every object outside the range to the background', () => {
  const source = resolveChart(parseBMS(SOURCE), { playVariant: '7' });
  const prepared = preparePlaybackChart(source, {
    practice: { startMs: 3000, endMs: 6000, gauge: 'NORMAL', startGauge: 20 },
  });
  // The 4 s notes stay; the 2 s note, the 8 s note and the LN ending at 6 s (an end outside) leave.
  expect(prepared.notes.map((note) => [note.channel, note.seconds])).toEqual([
    ['11', 4],
    ['13', 4],
  ]);
  expect(prepared.landmineNotes).toEqual([]);
  expect(prepared).toMatchObject({
    practiceStartSeconds: 3,
    practiceEndSeconds: 6,
    practiceChangedObjectCount: 4,
    practiceSourceNotes: { normal: 4, long: { 1: 1, 2: 0, 3: 0 } },
    totalSeconds: 7,
  });
  const background = prepared.resolvedChart.sampleTriggers.filter((trigger) => trigger.channel === '01');
  expect(background.map((trigger) => [trigger.sampleKey, trigger.seconds])).toEqual([
    ['01', 2],
    ['01', 4],
    ['01', 8],
  ]);
});

test('the source limits keep the end at least 1000 ms after the start', () => {
  expect(resolvePracticeRange({ startMs: -5, gauge: 'NORMAL', startGauge: 20 }, 9000)).toEqual({
    startMs: 0,
    endMs: 10000,
  });
  expect(resolvePracticeRange({ startMs: 4000, endMs: 4500, gauge: 'NORMAL', startGauge: 20 }, 9000)).toEqual({
    startMs: 4000,
    endMs: 5000,
  });
});

const FACTS: RulesetChartFacts = {
  sourceFormat: 'bms',
  laneMode: '7',
  lnMode: 1,
  judgeRank: { percent: 75, sourceRank: 2 },
  notes: { normal: 50, long: { 1: 0, 2: 0, 3: 0 } },
  total: 300,
};

test('PRACTICE scales TOTAL by the remaining notes up to NORMAL and sets the gauge and judgerank', () => {
  const sourceNotes = { normal: 200, long: { 1: 0, 2: 0, 3: 0 } };
  const normal = resolveRuleset(FACTS, 'beatoraja', {
    practice: { sourceNotes, gauge: 'NORMAL', startGauge: 50 },
  });
  expect(normal.effectiveTotal).toBe(75);
  expect(normal.gauge).toMatchObject({ id: 'NORMAL', initial: 50 });
  const hard = resolveRuleset(FACTS, 'beatoraja', {
    practice: { sourceNotes, gauge: 'HARD', startGauge: 20, total: 400, judgeRank: 100 },
  });
  expect(hard.effectiveTotal).toBe(400);
  expect(hard.gauge).toMatchObject({ id: 'HARD', initial: 20 });
  expect(hard.windows.note.judges[0]).toEqual([-20000, 20000]);
  const classGauge = resolveRuleset(FACTS, 'beatoraja', {
    practice: { sourceNotes, gauge: 'EXCLASS', gaugeCategory: 'LR2', startGauge: 150 },
  });
  expect(classGauge.gauge).toMatchObject({ id: 'EXCLASS', initial: 100 });
  const lr2Normal = resolveRuleset(FACTS, 'beatoraja', {
    practice: { sourceNotes, gauge: 'HARD', gaugeCategory: 'LR2', startGauge: 100 },
  });
  expect(lr2Normal.gauge.guts).toEqual([{ threshold: 30, multiplier: 0.6 }]);
  expect(() => resolveRuleset(FACTS, 'lr2', { practice: { sourceNotes, gauge: 'NORMAL', startGauge: 20 } })).toThrow(
    RangeError,
  );
});

import { describe, expect, test } from 'vite-plus/test';
import { parseBMS } from '@be-music/chart-parser';
import { resolveChart } from '@be-music/chart-model';
import { preparePlaybackChart } from './bootstrap.ts';
import { resolvePracticePlayWindow, resolvePracticeRange } from './practice.ts';
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
    // 3 s lies in bar 1 and 6 s in bar 3: the play runs from the head of bar 0 to the head of bar 4 (#954).
    practicePlayStartSeconds: 0,
    totalSeconds: 8,
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
  // A gauge of another ruleset is refused: PRACTICE lists the judge ruleset's own.
  expect(() => resolveRuleset(FACTS, 'lr2', { practice: { sourceNotes, gauge: 'NORMAL', startGauge: 20 } })).toThrow(
    RangeError,
  );
});

test('PRACTICE under LR2 rules plays LR2’s gauges, reads JUDGERANK on LR2’s #RANK table and TOTAL as is (#933)', () => {
  const sourceNotes = { normal: 200, long: { 1: 0, 2: 0, 3: 0 } };
  const groove = resolveRuleset(FACTS, 'lr2', { practice: { sourceNotes, gauge: 'GROOVE', startGauge: 1 } });
  // No note-count scaling: the chart's #TOTAL as is, and the gauge starts at GAUGE VALUE clamped to its floor.
  expect(groove.effectiveTotal).toBe(300);
  expect(groove.gauge).toEqual({ ...resolveRuleset(FACTS, 'lr2').gauge, initial: 2 });
  // Without a #TOTAL, the whole chart's default TOTAL (its notes before the cut).
  const untotalled: RulesetChartFacts = { ...FACTS, total: undefined };
  expect(
    resolveRuleset(untotalled, 'lr2', { practice: { sourceNotes, gauge: 'GROOVE', startGauge: 20 } }).effectiveTotal,
  ).toBe(resolveRuleset({ ...untotalled, notes: sourceNotes }, 'lr2').effectiveTotal);
  const hard = resolveRuleset(FACTS, 'lr2', {
    practice: { sourceNotes, gauge: 'HARD', startGauge: 60, total: 200, judgeRank: 25 },
  });
  expect(hard.effectiveTotal).toBe(200);
  expect(hard.gauge).toMatchObject({ id: 'HARD', initial: 60 });
  // JUDGERANK 25 is #RANK 0 (VERY HARD), for the whole play.
  const veryHard = resolveRuleset({ ...FACTS, judgeRank: { percent: 25, sourceRank: 0 } }, 'lr2');
  expect(hard.windows).toEqual(veryHard.windows);
  expect(hard.windowsAt(5_000_000)).toEqual(veryHard.windows);
  expect(resolveRuleset(FACTS, 'lr2', { practice: { sourceNotes, gauge: 'P-ATTACK', startGauge: 20 } }).gauge.id).toBe(
    'P-ATTACK',
  );
});

test('PRACTICE under AC rules sets only the gauge: its windows are fixed and its gauges do not use TOTAL (#933)', () => {
  const sourceNotes = { normal: 200, long: { 1: 0, 2: 0, 3: 0 } };
  const plain = resolveRuleset(FACTS, '____');
  const practised = resolveRuleset(FACTS, '____', {
    practice: { sourceNotes, gauge: 'EX-HARD', startGauge: 50, total: 1000, judgeRank: 25 },
  });
  expect(practised.gauge).toMatchObject({ id: 'EX-HARD', initial: 50 });
  expect(practised.windows).toEqual(plain.windows);
  expect(practised.effectiveTotal).toBe(plain.effectiveTotal);
  expect(
    resolveRuleset(FACTS, '____', { practice: { sourceNotes, gauge: 'ASSISTED-EASY', startGauge: 20 } }).gauge.id,
  ).toBe('ASSISTED-EASY');
  expect(() => resolveRuleset(FACTS, '____', { practice: { sourceNotes, gauge: 'HAZARD', startGauge: 20 } })).toThrow(
    RangeError,
  );
});

test('PRACTICE plays a single chart under every ruleset', () => {
  const sourceNotes = { normal: 200, long: { 1: 0, 2: 0, 3: 0 } };
  for (const [ruleset, gauge] of [
    ['lr2', 'GROOVE'],
    ['beatoraja', 'NORMAL'],
    ['____', 'NORMAL'],
  ] as const)
    expect(() =>
      resolveRuleset(FACTS, ruleset, { practice: { sourceNotes, gauge, startGauge: 20 }, course: { kind: 'grade' } }),
    ).toThrow(/single chart/);
});

describe('resolvePracticePlayWindow (#954)', () => {
  const windowOf = (lines: string[], range: { startMs: number; endMs?: number }) => {
    const chart = resolveChart(parseBMS(['#BPM 120', ...lines, '#00911:01', ''].join('\n')), { playVariant: '7' });
    const resolved = resolvePracticeRange({ ...range, gauge: 'NORMAL', startGauge: 20 }, 20_000);
    return resolvePracticePlayWindow(chart, range, resolved);
  };

  test('starts a bar before the range’s bar and ends a bar after the bar its end lies in', () => {
    // 120 BPM 4/4: bar n starts at 2n s.
    expect(windowOf([], { startMs: 4500, endMs: 6500 })).toEqual({ startSeconds: 2, endSeconds: 8 });
    // A range snapped to bar lines plays one whole bar on either side.
    expect(windowOf([], { startMs: 4000, endMs: 8000 })).toEqual({ startSeconds: 2, endSeconds: 10 });
    // A range in the first bar starts at the chart's start; one in the second starts there too.
    expect(windowOf([], { startMs: 500, endMs: 1500 })).toEqual({ startSeconds: 0, endSeconds: 2 });
    expect(windowOf([], { startMs: 2000, endMs: 3000 })).toEqual({ startSeconds: 0, endSeconds: 4 });
  });

  test('reads odd measure lengths', () => {
    // Bar 1 is 3/4 (1.5 s) and bar 3 is 5/4 (2.5 s): heads at 0, 2, 3.5, 5.5, 8, 10.
    const lines = ['#00102:0.75', '#00302:1.25'];
    expect(windowOf(lines, { startMs: 4000, endMs: 6000 })).toEqual({ startSeconds: 2, endSeconds: 8 });
    expect(windowOf(lines, { startMs: 3500, endMs: 5500 })).toEqual({ startSeconds: 2, endSeconds: 8 });
  });

  test('follows BPM changes and stops', () => {
    // 240 BPM from bar 2: heads at 0, 2, 4, 5, 6, 7.
    expect(windowOf(['#00203:F0'], { startMs: 5200, endMs: 6200 })).toEqual({ startSeconds: 4, endSeconds: 7 });
    // A 1 s stop (96 / 192 of a measure) in the middle of bar 1 delays the later bars: heads at 0, 2, 5, 7, 9.
    expect(windowOf(['#STOP01 96', '#00109:0001'], { startMs: 7500, endMs: 8500 })).toEqual({
      startSeconds: 5,
      endSeconds: 9,
    });
  });

  test('without an END TIME, ends 1000 ms past the range’s end as before', () => {
    expect(windowOf([], { startMs: 4500 })).toEqual({ startSeconds: 2, endSeconds: 22 });
  });
});

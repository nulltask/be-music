import { describe, expect, test } from 'vite-plus/test';
import { parseBMS } from '@be-music/chart-parser';
import { resolveChart } from '@be-music/chart-model';
import { preparePlaybackChart } from './bootstrap.ts';
import {
  createPracticeLoopPreviewNotes,
  resolvePracticeLoopShift,
  resolvePracticePlayWindow,
  resolvePracticeRange,
} from './practice.ts';
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

test('a long note held into the range from before it stays with carriedLongNotes, played from its head', () => {
  const source = () => resolveChart(parseBMS(SOURCE), { playVariant: '7' });
  // [5.0, 8.0): the LN on 12 from 4 s to 6 s starts before the range and ends in it.
  const practice = { startMs: 5000, endMs: 8000, gauge: 'NORMAL', startGauge: 20 } as const;
  const dropped = preparePlaybackChart(source(), { practice });
  expect(dropped.notes).toEqual([]);
  // The range starts in bar 2 (4 s): the play starts a bar before it.
  expect(dropped.practicePlayStartSeconds).toBe(2);
  const carried = preparePlaybackChart(source(), { practice: { ...practice, carriedLongNotes: true } });
  expect(carried.notes.map((note) => [note.channel, note.seconds, note.endSeconds])).toEqual([['12', 4, 6]]);
  expect(carried.practiceChangedObjectCount).toBe(dropped.practiceChangedObjectCount! - 1);
  // The LN's head lies in bar 2 too: the rest bar before it is the same.
  expect(carried.practicePlayStartSeconds).toBe(2);
  // A long note that also ends past the range still leaves, and so does one wholly before it.
  const past = preparePlaybackChart(source(), {
    practice: { startMs: 5000, endMs: 5500, gauge: 'NORMAL', startGauge: 20, carriedLongNotes: true },
  });
  expect(past.notes).toEqual([]);
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

test('PRACTICE plays on its own gauge whatever the play’s gauge pick is', () => {
  const sourceNotes = { normal: 200, long: { 1: 0, 2: 0, 3: 0 } };
  // A pick of another source's gauge, one the judge ruleset lacks, used to stop the practice play with a RangeError.
  for (const [ruleset, selectedGauge, gauge] of [
    ['lr2', 'beatoraja:ASSIST-EASY', 'GROOVE'],
    ['lr2', 'beatoraja:EX-HARD', 'HARD'],
    ['beatoraja', 'lr2:P-ATTACK', 'NORMAL'],
    ['____', 'lr2:G-ATTACK', 'EASY'],
  ] as const)
    expect(
      resolveRuleset(FACTS, ruleset, { selectedGauge, practice: { sourceNotes, gauge, startGauge: 20 } }).gauge,
    ).toMatchObject({ id: gauge, initial: 20 });
  // Without PRACTICE the pick still names its source's gauge.
  expect(() => resolveRuleset(FACTS, 'lr2', { selectedGauge: 'ASSIST-EASY' })).toThrow(/no ASSIST-EASY/);
});

test('PRACTICE plays on another source’s gauge when its GAUGE TYPE names one (ADR 0019)', () => {
  const sourceNotes = { normal: 200, long: { 1: 0, 2: 0, 3: 0 } };
  // beatoraja's ASSIST EASY under LR2 judging: beatoraja's gauge and TOTAL reading, LR2's windows.
  const lr2 = resolveRuleset(FACTS, 'lr2', { practice: { sourceNotes, gauge: 'GROOVE', startGauge: 20 } });
  const borrowed = resolveRuleset(FACTS, 'lr2', {
    practice: { sourceNotes, gauge: 'beatoraja:ASSIST-EASY', startGauge: 30 },
  });
  const beatoraja = resolveRuleset(FACTS, 'beatoraja', {
    practice: { sourceNotes, gauge: 'ASSIST-EASY', startGauge: 30 },
  });
  expect(borrowed.gaugeSource).toBe('beatoraja');
  expect(borrowed.gauge).toMatchObject({ id: 'ASSIST-EASY', initial: 30, border: beatoraja.gauge.border });
  expect(borrowed.windows).toEqual(lr2.windows);
  expect(borrowed.rulesetId).toBe('lr2');
  // LR2's P.ATTACK under beatoraja judging, and AC's ASSISTED EASY under LR2.
  expect(
    resolveRuleset(FACTS, 'beatoraja', { practice: { sourceNotes, gauge: 'lr2:P-ATTACK', startGauge: 20 } }).gauge.id,
  ).toBe('P-ATTACK');
  expect(
    resolveRuleset(FACTS, 'lr2', { practice: { sourceNotes, gauge: '____:ASSISTED-EASY', startGauge: 20 } }).gauge.id,
  ).toBe('ASSISTED-EASY');
  // A pick qualified with the judge ruleset is its own gauge.
  expect(resolveRuleset(FACTS, 'lr2', { practice: { sourceNotes, gauge: 'lr2:HARD', startGauge: 60 } })).toMatchObject({
    gaugeSource: 'lr2',
    gauge: { id: 'HARD', initial: 60 },
  });
  // A source's pick names a gauge on that source's own PRACTICE list; a bare one the judge ruleset's.
  for (const [ruleset, gauge] of [
    ['lr2', 'lr2:ASSIST-EASY'],
    ['lr2', 'ASSIST-EASY'],
    ['beatoraja', 'beatoraja:GROOVE'],
    ['beatoraja', 'unknown:HARD'],
  ] as const)
    expect(() =>
      resolveRuleset(FACTS, ruleset, { practice: { sourceNotes, gauge: gauge as 'GROOVE', startGauge: 20 } }),
    ).toThrow(RangeError);
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
  const playWindowOf = (
    lines: string[],
    range: { startMs: number; endMs?: number },
    rest: { restBarsBefore?: number; restBarsAfter?: number } = {},
  ) => {
    const chart = resolveChart(parseBMS(['#BPM 120', ...lines, '#00911:01', ''].join('\n')), { playVariant: '7' });
    const resolved = resolvePracticeRange({ ...range, gauge: 'NORMAL', startGauge: 20 }, 20_000);
    return resolvePracticePlayWindow(chart, { ...range, ...rest }, resolved);
  };
  const windowOf = (...args: Parameters<typeof playWindowOf>) => {
    const { startSeconds, endSeconds } = playWindowOf(...args);
    return { startSeconds, endSeconds };
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

  test('rests the bars asked for on either side, none at 0', () => {
    const range = { startMs: 4000, endMs: 8000 };
    expect(windowOf([], range, { restBarsBefore: 0, restBarsAfter: 0 })).toEqual({ startSeconds: 4, endSeconds: 8 });
    expect(windowOf([], range, { restBarsBefore: 1, restBarsAfter: 1 })).toEqual({ startSeconds: 2, endSeconds: 10 });
    expect(windowOf([], range, { restBarsBefore: 2, restBarsAfter: 2 })).toEqual({ startSeconds: 0, endSeconds: 12 });
    // A rest reaching past the first bar starts at the chart's start.
    expect(windowOf([], range, { restBarsBefore: 8 }).startSeconds).toBe(0);
    // Each side is its own: no rest before, three bars after.
    expect(windowOf([], range, { restBarsBefore: 0, restBarsAfter: 3 })).toEqual({ startSeconds: 4, endSeconds: 14 });
  });

  test('starts the first round a bar before the range at least, so its notes come down the lane', () => {
    const range = { startMs: 4000, endMs: 8000 };
    // No rest before: the loop starts at the range, the first round a bar before it.
    expect(playWindowOf([], range, { restBarsBefore: 0 })).toMatchObject({ startSeconds: 4, firstStartSeconds: 2 });
    // A rest before: the first round starts with the loop.
    expect(playWindowOf([], range, { restBarsBefore: 2 })).toMatchObject({ startSeconds: 0, firstStartSeconds: 0 });
    expect(playWindowOf([], range)).toMatchObject({ startSeconds: 2, firstStartSeconds: 2 });
    // A range in the first bar has no bar before it: the chart's start.
    expect(playWindowOf([], { startMs: 0, endMs: 2000 }, { restBarsBefore: 0 })).toMatchObject({
      startSeconds: 0,
      firstStartSeconds: 0,
    });
  });

  test('rests without an END TIME: none ends at the range’s end, more bars end further out', () => {
    expect(windowOf([], { startMs: 4000 }, { restBarsAfter: 0 }).endSeconds).toBe(21);
    expect(windowOf([], { startMs: 4000 }, { restBarsAfter: 3 }).endSeconds).toBe(26);
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

  test('leads from the bar a long note kept from before the range starts in', () => {
    const chart = resolveChart(parseBMS(['#BPM 120', '#00911:01', ''].join('\n')), { playVariant: '7' });
    const range = { startMs: 8000, endMs: 10000 };
    // The kept long note starts at 3.0, in bar 1: one bar of rest before it starts at the chart's start, none at bar 1.
    expect(resolvePracticePlayWindow(chart, { ...range }, range, 3000)).toMatchObject({
      startSeconds: 0,
      endSeconds: 12,
    });
    expect(resolvePracticePlayWindow(chart, { ...range, restBarsBefore: 0 }, range, 3000)).toMatchObject({
      startSeconds: 2,
      firstStartSeconds: 0,
    });
    // One that starts in the range's own bar or later changes nothing.
    expect(resolvePracticePlayWindow(chart, { ...range }, range, 9000)).toMatchObject({ startSeconds: 6 });
  });

  test('without an END TIME, ends 1000 ms past the range’s end as before', () => {
    expect(windowOf([], { startMs: 4500 })).toEqual({ startSeconds: 2, endSeconds: 22 });
  });
});

describe('the seamless PRACTICE loop', () => {
  const chartOf = (lines: string[] = []) =>
    resolveChart(parseBMS(['#BPM 120', ...lines, '#00911:01', ''].join('\n')), { playVariant: '7' });

  test('moves back from the range’s end to the loop’s start, in seconds and beats', () => {
    // 120 BPM: two seconds and four beats a bar; the loop from 4.0 to 8.0 is two bars.
    const window = { startSeconds: 4, endSeconds: 8 };
    const practice = { loop: true, endMs: 8000, restBarsAfter: 0 } as const;
    expect(resolvePracticeLoopShift(chartOf(), practice, window)).toEqual({ seconds: 4, beats: 8 });
    // At 240 BPM from bar 2 (4.0): the same four seconds are sixteen beats.
    expect(resolvePracticeLoopShift(chartOf(['#00203:F0']), practice, window)).toEqual({ seconds: 4, beats: 16 });
    // A rest after the range loops seamlessly too: the window's end is the rest's.
    expect(resolvePracticeLoopShift(chartOf(), { ...practice, restBarsAfter: 1 }, window)).toEqual({
      seconds: 4,
      beats: 8,
    });
    // Not seamless: no loop, or the whole chart.
    expect(resolvePracticeLoopShift(chartOf(), { ...practice, loop: false }, window)).toBeUndefined();
    expect(resolvePracticeLoopShift(chartOf(), { ...practice, endMs: undefined }, window)).toBeUndefined();
  });

  test('draws the next round’s notes, shifted, standing for their notes but judged on their own', () => {
    const tap = {
      event: { measure: 2, channel: '11', position: [0, 1], value: '01' },
      channel: '11',
      beat: 8,
      seconds: 4,
      judged: true,
    } as const;
    const long = { ...tap, channel: '12', beat: 10, seconds: 5, endBeat: 11, endSeconds: 5.5, judged: false };
    const [tapPreview, longPreview] = createPracticeLoopPreviewNotes([{ ...tap }, long], { seconds: 4, beats: 8 });
    expect(tapPreview).toMatchObject({ channel: '11', beat: 16, seconds: 8, judged: false });
    expect(longPreview).toMatchObject({ beat: 18, seconds: 9, endBeat: 19, endSeconds: 9.5 });
    // A later change to the note's lane (a lane option applied after) moves its preview too.
    long.channel = '14';
    expect(longPreview!.channel).toBe('14');
    // Judging the preview leaves the note alone.
    longPreview!.judged = true;
    expect(long.judged).toBe(false);
  });
});

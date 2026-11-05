import { resolveChart } from '@be-music/chart-model';
import { parseChart } from '@be-music/chart-parser';
import { describe, expect, it } from 'vite-plus/test';
import {
  chartScoreRangeTimes,
  layoutChartScore,
  packChartScoreColumns,
  selectChartScoreBars,
  type ChartScoreLayout,
} from './layout.ts';

function layout(lines: readonly string[]): ChartScoreLayout {
  return layoutChartScore(resolveChart(parseChart(['#WAV01 a.wav', '#WAV02 b.wav', ...lines].join('\n'), 'bms')));
}

describe('layoutChartScore', () => {
  it('cuts a 7 KEY chart into bars at 120 BPM, scratch on the left', () => {
    const score = layout(['#BPM 120', '#PLAYER 1', '#00111:0101', '#00116:01', '#00213:00000001', '#00219:00000001']);
    expect(score.layoutId).toBe('7');
    expect(score.lanes.map((lane) => lane.channel)).toEqual(['16', '11', '12', '13', '14', '15', '18', '19']);
    expect(score.lanes[0]!.kind).toBe('scratch');
    expect(score.initialBPM).toBe(120);
    // Measure 0 is empty but laid out; the bar holding the last note closes the score.
    expect(score.bars.map((bar) => [bar.measure, bar.startMs, bar.endMs])).toEqual([
      [0, 0, 2000],
      [1, 2000, 4000],
      [2, 4000, 6000],
    ]);
    expect(score.bars[1]!.notes).toEqual([
      { lane: 0, position: 0 },
      { lane: 1, position: 0 },
      { lane: 1, position: 0.5 },
    ]);
    expect(score.bars[2]!.notes).toEqual([
      { lane: 3, position: 0.75 },
      { lane: 7, position: 0.75 },
    ]);
    expect(score.bars.map((bar) => bar.noteCount)).toEqual([0, 3, 2]);
    expect(score.noteCount).toBe(5);
  });

  it('reads #xxx02 measure lengths, tempo changes and stops through the bar times', () => {
    const score = layout([
      '#BPM 120',
      '#BPM01 240',
      '#STOP01 96',
      '#00102:0.75',
      '#00111:01',
      // BPM 240 halfway through measure 2, a STOP at its start.
      '#00208:0001',
      '#00209:01',
      '#00211:01',
      '#00311:01',
    ]);
    expect(score.bars.map((bar) => bar.beats)).toEqual([4, 3, 4, 4]);
    // Measure 1 is 3 beats at 120 BPM (1500 ms); measure 2 has a STOP of 96/192 of a whole note (2 beats, 1000 ms at
    // 120 BPM) at its start, then 1000 ms at 120 and 500 ms at 240.
    expect(score.bars.map((bar) => [bar.startMs, bar.endMs])).toEqual([
      [0, 2000],
      [2000, 3500],
      [3500, 6000],
      [6000, 7000],
    ]);
    expect(score.bars[2]!.tempos).toEqual([{ position: 0.5, bpm: 240 }]);
    expect(score.bars[2]!.stops).toEqual([{ position: 0, durationMs: 1000 }]);
    expect(score.bars[1]!.tempos).toEqual([]);
  });

  it('splits a long note across the bar lines it crosses', () => {
    // #LNTYPE 1: halfway through measure 1 opens a long note that closes at 1/4 of measure 3.
    const score = layout(['#BPM 120', '#LNTYPE 1', '#00151:00000100', '#00351:00010000', '#00311:00000001']);
    expect(score.bars.map((bar) => bar.longNotes)).toEqual([
      [],
      [{ lane: 1, from: 0.5, to: 1, head: true, tail: false, mode: 1 }],
      [{ lane: 1, from: 0, to: 1, head: false, tail: false, mode: 1 }],
      [{ lane: 1, from: 0, to: 0.25, head: false, tail: true, mode: 1 }],
    ]);
    // The head counts in its own bar only.
    expect(score.bars.map((bar) => bar.noteCount)).toEqual([0, 1, 0, 1]);
  });

  it('ends a long note at the bar line closing its last bar', () => {
    const score = layout(['#BPM 120', '#LNTYPE 1', '#00151:01', '#00251:01']);
    expect(score.bars).toHaveLength(2);
    expect(score.bars[1]!.longNotes).toEqual([{ lane: 1, from: 0, to: 1, head: true, tail: true, mode: 1 }]);
  });

  it('lays out a 14 KEY chart with each side scratch on the outer edge and mines on their lanes', () => {
    const score = layout(['#BPM 150', '#PLAYER 3', '#00111:01', '#00128:01', '#00226:01', '#001D1:02']);
    expect(score.layoutId).toBe('14');
    expect(score.lanes.map((lane) => lane.channel)).toEqual([
      '16',
      '11',
      '12',
      '13',
      '14',
      '15',
      '18',
      '19',
      '21',
      '22',
      '23',
      '24',
      '25',
      '28',
      '29',
      '26',
    ]);
    expect(score.bars[1]!.notes).toEqual([
      { lane: 1, position: 0 },
      { lane: 13, position: 0 },
    ]);
    expect(score.bars[2]!.notes).toEqual([{ lane: 15, position: 0 }]);
    expect(score.bars[1]!.mines).toEqual([{ lane: 1, position: 0 }]);
  });

  it('lays out a 5 KEY and a 10 KEY chart on their own lanes', () => {
    const five = layout(['#BPM 150', '#00111:01', '#00115:01']);
    expect(five.layoutId).toBe('5');
    expect(five.lanes.map((lane) => lane.channel)).toEqual(['16', '11', '12', '13', '14', '15']);
    const ten = layout(['#BPM 150', '#PLAYER 3', '#00111:01', '#00125:01', '#00126:01']);
    expect(ten.layoutId).toBe('10');
    expect(ten.lanes).toHaveLength(12);
  });

  it('picks the 9 KEY layout the notes are on', () => {
    const pms = layoutChartScore(
      resolveChart(parseChart(['#WAV01 a.wav', '#BPM 150', '#00111:01', '#00125:01'].join('\n'), 'pms')),
    );
    expect(pms.layoutId).toBe('9-pms');
    expect(pms.lanes.map((lane) => lane.channel)).toEqual(['11', '12', '13', '14', '15', '22', '23', '24', '25']);
    expect(pms.bars[1]!.notes).toEqual([
      { lane: 0, position: 0 },
      { lane: 8, position: 0 },
    ]);
  });

  it('keeps the bars a BGM sound lasts into', () => {
    const score = layout(['#BPM 120', '#00111:01', '#00401:02']);
    expect(score.bars.map((bar) => bar.measure)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('packChartScoreColumns', () => {
  it('fills each column up to its beats, bottom to top', () => {
    expect(packChartScoreColumns([{ beats: 4 }, { beats: 4 }, { beats: 3 }, { beats: 4 }, { beats: 4 }], 8)).toEqual([
      [0, 1],
      [2, 3],
      [4],
    ]);
  });

  it('gives a bar longer than a column a column of its own', () => {
    expect(packChartScoreColumns([{ beats: 4 }, { beats: 12 }, { beats: 4 }], 8)).toEqual([[0], [1], [2]]);
  });

  it('packs nothing for no bars', () => {
    expect(packChartScoreColumns([], 16)).toEqual([]);
  });
});

describe('selectChartScoreBars', () => {
  it('selects the bar pressed, or the run from the anchor when extending', () => {
    expect(selectChartScoreBars(undefined, 4, true)).toEqual({ first: 4, last: 4 });
    expect(selectChartScoreBars(2, 4, false)).toEqual({ first: 4, last: 4 });
    expect(selectChartScoreBars(6, 4, true)).toEqual({ first: 4, last: 6 });
    expect(selectChartScoreBars(2, 4, true)).toEqual({ first: 2, last: 4 });
  });
});

describe('chartScoreRangeTimes', () => {
  const score = layout(['#BPM 120', '#00102:0.5', '#00111:01', '#00311:01']);

  it('turns a run of bars into the chart times from its first bar line to the one closing it', () => {
    expect(chartScoreRangeTimes(score, { first: 1, last: 1 })).toEqual({ startMs: 2000, endMs: 3000 });
    expect(chartScoreRangeTimes(score, { first: 1, last: 3 })).toEqual({ startMs: 2000, endMs: 7000 });
  });

  it('reads nothing outside the score', () => {
    expect(chartScoreRangeTimes(score, { first: 2, last: 9 })).toBeUndefined();
  });
});

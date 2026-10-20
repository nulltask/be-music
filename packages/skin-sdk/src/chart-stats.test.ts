import { describe, expect, it } from 'vite-plus/test';
import { parseChart } from '@be-music/parser';
import {
  formatBPMRange,
  formatPlayVariantLabel,
  formatChartLength,
  resolveChartRowFacts,
  resolveChartStats,
  resolveChartTags,
} from './chart-stats.ts';

function chartEntry(source: string) {
  return { chart: parseChart(source, 'bms'), bpm: undefined };
}

const PLAIN = ['#BPM 120', '#WAV01 a.wav', '#00111:01010101', '#00211:01000000'].join('\n');

describe('resolveChartStats', () => {
  it('measures a steady chart up to its last note', () => {
    const stats = resolveChartStats(chartEntry(PLAIN));
    // Two 4/4 measures at 120 BPM: the last note sits on measure 2's downbeat, 4 seconds in.
    expect(stats.lengthSeconds).toBeCloseTo(4, 3);
    expect(stats.minBPM).toBe(120);
    expect(stats.maxBPM).toBe(120);
    expect(stats.longNotes).toBe(0);
    expect(stats.mines).toBe(0);
    expect(stats.stops).toBe(false);
    expect(resolveChartTags(stats)).toEqual([]);
  });

  it('collects the tempo range, long notes, mines and stops', () => {
    const stats = resolveChartStats(
      chartEntry(
        [
          '#BPM 120',
          '#LNTYPE 1',
          '#WAV01 a.wav',
          '#STOP01 96',
          '#00111:01010101',
          '#00103:00F0',
          '#00109:0001',
          '#00151:01000100',
          '#001D2:00000001',
          '#00211:01000000',
        ].join('\n'),
      ),
    );
    expect(stats.minBPM).toBe(120);
    expect(stats.maxBPM).toBe(240);
    expect(stats.longNotes).toBe(1);
    expect(stats.mines).toBe(1);
    expect(stats.stops).toBe(true);
    expect(resolveChartTags(stats)).toEqual(['LN', 'SOFLAN', 'STOP', 'MINE']);
  });

  it('caches per chart', () => {
    const entry = chartEntry(PLAIN);
    expect(resolveChartStats(entry)).toBe(resolveChartStats(entry));
  });
});

describe('resolveChartStats judgeRank', () => {
  it('names #RANK 0-4 and defaults to NORMAL', () => {
    expect(resolveChartStats(chartEntry(PLAIN)).judgeRank).toBe('NORMAL');
    expect(resolveChartStats(chartEntry(`#RANK 0\n${PLAIN}`)).judgeRank).toBe('VERY HARD');
    expect(resolveChartStats(chartEntry(`#RANK 1\n${PLAIN}`)).judgeRank).toBe('HARD');
    expect(resolveChartStats(chartEntry(`#RANK 3\n${PLAIN}`)).judgeRank).toBe('EASY');
    expect(resolveChartStats(chartEntry(`#RANK 4\n${PLAIN}`)).judgeRank).toBe('VERY EASY');
  });

  it('prefers #DEFEXRANK, printed as its value', () => {
    expect(resolveChartStats(chartEntry(`#RANK 1\n#DEFEXRANK 120\n${PLAIN}`)).judgeRank).toBe('120');
    expect(resolveChartStats(chartEntry(`#DEFEXRANK 99.50\n${PLAIN}`)).judgeRank).toBe('99.5');
  });

  it('falls back to NORMAL for a #RANK outside 0-4', () => {
    expect(resolveChartStats(chartEntry(`#RANK 7\n${PLAIN}`)).judgeRank).toBe('NORMAL');
  });
});

describe('formatChartLength', () => {
  it('prints m:ss', () => {
    expect(formatChartLength(125.4)).toBe('2:05');
    expect(formatChartLength(0)).toBe('0:00');
    expect(formatChartLength(Number.NaN)).toBe('0:00');
  });
});

describe('formatBPMRange', () => {
  it('prints one tempo or a range', () => {
    expect(formatBPMRange(150, 150)).toBe('150');
    expect(formatBPMRange(119.6, 240.2)).toBe('120-240');
    expect(formatBPMRange(0, 0)).toBe('-');
  });
});

describe('resolveChartRowFacts', () => {
  it('formats the notes, length, tempo and tags of a row', () => {
    const facts = resolveChartRowFacts({ ...chartEntry(PLAIN), totalNotes: 5 });
    expect(facts).toEqual({ notes: '5', length: '0:04', bpm: '120', tags: [] });
  });
});

describe('formatPlayVariantLabel', () => {
  it("names the chart's play variant", () => {
    expect(formatPlayVariantLabel({ chartPath: 'a.bms', chart: parseChart(PLAIN, 'bms') })).toBe('5 KEYS');
    const sevenKeys = [PLAIN, '#00118:01000000'].join('\n');
    expect(formatPlayVariantLabel({ chartPath: 'a.bms', chart: parseChart(sevenKeys, 'bms') })).toBe('7 KEYS');
  });
});

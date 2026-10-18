import type { BeMusicJson } from '@be-music/json';
import { parseChart } from '@be-music/parser';
import { describe, expect, test } from 'vite-plus/test';
import { resolveShownChartMainBpm } from './main-bpm.ts';

function bms(lines: string[]) {
  return parseChart(lines.join('\n'), 'song.bms');
}

describe('resolveShownChartMainBpm', () => {
  test('is the BPM the most judged notes sit at, not the header BPM', () => {
    // One note at the header's 120, three after the change to 180.
    const chart = bms(['#BPM 120', '#00011:01', '#00103:B4', '#00211:010101']);
    expect(resolveShownChartMainBpm(chart)).toBe(180);
  });

  test('resolves long notes as the play does: a chart without #LNTYPE may read as #LNTYPE 2', () => {
    // A run of four same-value 5x objects reads as one #LNTYPE 2 long note at 120 (as #LNTYPE 1 it would be two, and
    // tie with the two taps at 180).
    const chart = bms(['#BPM 120', '#00051:01010101', '#00103:B4', '#00211:0101']);
    expect(resolveShownChartMainBpm(chart)).toBe(180);
  });

  test('is undefined for a chart without notes, and for one that does not resolve', () => {
    expect(resolveShownChartMainBpm(bms(['#BPM 150']))).toBeUndefined();
    expect(resolveShownChartMainBpm({ metadata: {} } as unknown as BeMusicJson)).toBeUndefined();
  });
});

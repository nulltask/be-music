import { parseChart } from '@be-music/parser';
import { describe, expect, test } from 'vite-plus/test';
import { resolveChartBPMRange } from './bpm-range.ts';

function bms(lines: string[]) {
  return parseChart(lines.join('\n'), 'song.bms');
}

describe('resolveChartBPMRange', () => {
  test('a constant-tempo chart has its header BPM as both ends', () => {
    expect(resolveChartBPMRange(bms(['#BPM 150', '#00111:01']))).toEqual({ min: 150, max: 150 });
  });

  test('spans the header BPM, channel 03 and #BPMxx changes', () => {
    const chart = bms(['#BPM 150', '#BPMAA 222.5', '#00103:3C', '#00208:AA', '#00311:01']);
    expect(resolveChartBPMRange(chart)).toEqual({ min: 60, max: 222.5 });
  });

  test('keeps the header BPM even when a change replaces it at the start, as beatoraja does', () => {
    expect(resolveChartBPMRange(bms(['#BPM 150', '#00103:B4', '#00111:01']))).toEqual({ min: 150, max: 180 });
  });

  test('leaves out a channel 03 value that #BPMxx overrides at the same position', () => {
    const chart = bms(['#BPM 150', '#BPM01 160', '#00103:FF', '#00108:01', '#00211:01']);
    expect(resolveChartBPMRange(chart)).toEqual({ min: 150, max: 160 });
  });

  test('ignores zero BPM changes', () => {
    const chart = bms(['#BPM 150', '#BPM02 0', '#00108:02', '#00211:01']);
    expect(resolveChartBPMRange(chart)).toEqual({ min: 150, max: 150 });
  });

  test('reads a negative #BPMxx at its magnitude, the tempo LR2 integrates its reverse scroll at', () => {
    const chart = bms(['#BPM 150', '#BPM01 -30', '#BPM02 0', '#00108:0102', '#00211:01']);
    expect(resolveChartBPMRange(chart)).toEqual({ min: 30, max: 150 });
  });

  test('reads bmson bpm_events', () => {
    const chart = parseChart(
      JSON.stringify({
        version: '1.0.0',
        info: { init_bpm: 120, resolution: 240 },
        bpm_events: [{ y: 960, bpm: 200 }],
        sound_channels: [],
      }),
      'song.bmson',
    );
    expect(resolveChartBPMRange(chart)).toEqual({ min: 120, max: 200 });
  });
});

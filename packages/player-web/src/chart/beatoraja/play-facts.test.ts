import { parseChart } from '@be-music/parser';
import type { BeMusicJson } from '@be-music/json';
import { describe, expect, it } from 'vite-plus/test';
import { beatorajaPlayChartFacts, beatorajaPlayChartTraits, computeBeatorajaLastNoteBeats } from './play-facts.ts';

function chartOf(...lines: string[]): BeMusicJson {
  return parseChart(['#BPM 120', ...lines].join('\n'), 'bms');
}

describe('beatorajaPlayChartTraits', () => {
  it('reads the traits off the channels and the header', () => {
    expect(
      beatorajaPlayChartTraits(
        chartOf('#STAGEFILE s.png', '#BMP01 a.bmp', '#00151:0101', '#00103:7F00', '#00109:0100', '#00199:0100'),
      ),
    ).toEqual({
      longNote: true,
      bpmChange: true,
      stop: true,
      text: true,
      bga: true,
      stageFile: true,
      banner: false,
      backBmp: false,
    });
    expect(beatorajaPlayChartTraits(chartOf('#00111:01'))).toEqual({
      longNote: false,
      bpmChange: false,
      stop: false,
      text: false,
      bga: false,
      stageFile: false,
      banner: false,
      backBmp: false,
    });
  });
});

describe('computeBeatorajaLastNoteBeats', () => {
  it("finds each side's last note, long notes included and BGM, mines and empty slots left out", () => {
    expect(computeBeatorajaLastNoteBeats(chartOf('#00111:0100', '#00226:0001', '#00351:0100', '#00501:01'))).toEqual({
      1: 12,
      2: 10,
    });
    expect(computeBeatorajaLastNoteBeats(chartOf('#00101:01', '#002D1:01'))).toEqual({});
  });
});

describe('beatorajaPlayChartFacts', () => {
  it('reads the header and the distribution, and the BPM range when asked', () => {
    const chart = chartOf('#PLAYLEVEL 11', '#00103:F0', '#00203:3C');
    const facts = beatorajaPlayChartFacts(chart, { mainBpm: 240, bpmSegments: [{ timeMs: 0, bpm: 120 }] });
    expect(facts.bpm).toBe(120);
    expect(facts.mainBpm).toBe(240);
    expect(facts.bpmSegments).toEqual([{ timeMs: 0, bpm: 120 }]);
    expect(facts.playLevel).toBe(11);
    expect(facts.minBpm).toBe(60);
    expect(facts.maxBpm).toBe(240);
    expect(beatorajaPlayChartFacts(undefined, undefined)).toEqual({ bpm: 0, minBpm: 0, maxBpm: 0 });
  });
});

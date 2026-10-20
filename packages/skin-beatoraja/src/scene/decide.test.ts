import { createEmptyJSON } from '@be-music/chart-source';
import { describe, expect, it } from 'vite-plus/test';
import { BEATORAJA_NUM, BEATORAJA_OP } from '../runtime-ids.ts';
import {
  resolveBeatorajaDecideGraphValue,
  resolveBeatorajaDecideNumber,
  resolveBeatorajaDecideOps,
  type BeatorajaDecideInput,
} from './decide.ts';

function decide(
  chart: { playLevel?: number | string; bpm?: number; difficulty?: number } = {},
  progress = 0,
): BeatorajaDecideInput {
  const json = createEmptyJSON('bms');
  if (chart.difficulty !== undefined) json.metadata.difficulty = chart.difficulty;
  return {
    chart: {
      ...(chart.playLevel !== undefined ? { playLevel: chart.playLevel } : {}),
      ...(chart.bpm !== undefined ? { bpm: chart.bpm } : {}),
      chart: json,
    },
    progress,
  };
}

describe('resolveBeatorajaDecideOps', () => {
  it("lights the chart's difficulty ops and NOW_LOADING while the play loads", () => {
    expect(resolveBeatorajaDecideOps(decide({ difficulty: 4 }, 0.5))).toEqual([
      BEATORAJA_OP.LEVEL_ANOTHER,
      BEATORAJA_OP.DIFFICULTY_ANOTHER,
      BEATORAJA_OP.NOW_LOADING,
    ]);
  });

  it('lights LOADED once the play has loaded, and DIFFICULTY_UNDEFINED for a chart without a difficulty', () => {
    expect(resolveBeatorajaDecideOps(decide({}, 1))).toEqual([BEATORAJA_OP.DIFFICULTY_UNDEFINED, BEATORAJA_OP.LOADED]);
    expect(resolveBeatorajaDecideOps(decide({}, 3))).toContain(BEATORAJA_OP.LOADED);
  });
});

describe('resolveBeatorajaDecideNumber', () => {
  it("reads the chart's #PLAYLEVEL as a whole number, 0 without a readable one", () => {
    expect(resolveBeatorajaDecideNumber(BEATORAJA_NUM.PLAYLEVEL, decide({ playLevel: 12.7 }))).toBe(12);
    expect(resolveBeatorajaDecideNumber(BEATORAJA_NUM.PLAYLEVEL, decide({ playLevel: '11+' }))).toBe(11);
    expect(resolveBeatorajaDecideNumber(BEATORAJA_NUM.PLAYLEVEL, decide({ playLevel: '?' }))).toBe(0);
    expect(resolveBeatorajaDecideNumber(BEATORAJA_NUM.PLAYLEVEL, decide())).toBe(0);
  });

  it('reads the listed BPM, rounded, on every BPM number without a main BPM', () => {
    const input = decide({ bpm: 149.6 });
    for (const id of [BEATORAJA_NUM.MAINBPM, BEATORAJA_NUM.MAXBPM, BEATORAJA_NUM.MINBPM, BEATORAJA_NUM.NOWBPM]) {
      expect(resolveBeatorajaDecideNumber(id, input)).toBe(150);
    }
    expect(resolveBeatorajaDecideNumber(BEATORAJA_NUM.MAINBPM, decide())).toBe(0);
  });

  it('reads the main BPM the play shows on 92, the listed BPM without one', () => {
    const input = { ...decide({ bpm: 149.6 }), mainBPM: 179.6 };
    expect(resolveBeatorajaDecideNumber(BEATORAJA_NUM.MAINBPM, input)).toBe(180);
    for (const id of [BEATORAJA_NUM.MAXBPM, BEATORAJA_NUM.MINBPM, BEATORAJA_NUM.NOWBPM]) {
      expect(resolveBeatorajaDecideNumber(id, input)).toBe(150);
    }
    expect(resolveBeatorajaDecideNumber(BEATORAJA_NUM.MAINBPM, { ...input, mainBPM: 0 })).toBe(150);
  });

  it('reads the loading progress in whole percent and 0 for the numbers of a play', () => {
    expect(resolveBeatorajaDecideNumber(BEATORAJA_NUM.LOADING_PROGRESS, decide({}, 0.426))).toBe(43);
    expect(resolveBeatorajaDecideNumber(BEATORAJA_NUM.LOADING_PROGRESS, decide({}, 2))).toBe(100);
    expect(resolveBeatorajaDecideNumber(BEATORAJA_NUM.SCORE2, decide({}, 0.5))).toBe(0);
    expect(resolveBeatorajaDecideNumber(BEATORAJA_NUM.MAXCOMBO_LIVE, decide({}, 0.5))).toBe(0);
  });
});

describe('resolveBeatorajaDecideGraphValue', () => {
  it('fills the loading bar (102) with the progress and draws no other bar graph', () => {
    expect(resolveBeatorajaDecideGraphValue(102, decide({}, 0.25))).toBe(0.25);
    expect(resolveBeatorajaDecideGraphValue(102, decide({}, -1))).toBe(0);
    expect(resolveBeatorajaDecideGraphValue(1, decide({}, 0.25))).toBeUndefined();
  });
});

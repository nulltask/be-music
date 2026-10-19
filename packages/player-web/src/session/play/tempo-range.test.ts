import { resolveChart, type TempoPoint } from '@be-music/chart';
import { parseChart } from '@be-music/parser';
import { describe, expect, it } from 'vite-plus/test';
import { resolvePlayTempoRange, type PlayTempoChart } from './tempo-range.ts';

function bms(lines: string[]) {
  return resolveChart(parseChart(lines.join('\n'), 'song.bms'));
}

/** A chart without notes on the given tempo points. */
function tempoOnly(tempoPoints: TempoPoint[]): PlayTempoChart {
  return { notes: [], timing: { tempoPoints, bpmAtBeat: () => tempoPoints[0]?.bpm ?? 130 } };
}

describe('resolvePlayTempoRange', () => {
  it('reports a constant tempo as its own range', () => {
    expect(resolvePlayTempoRange(bms(['#BPM 150', '#00111:01']))).toEqual({ minBPM: 150, maxBPM: 150, mainBPM: 150 });
  });

  it('takes the main BPM from the notes (the BPM most of them sit at), not the BPM held longest', () => {
    const chart = bms([
      '#BPM 120',
      '#00111:01010101',
      // 60 from measure 2: one note, then 60 holds 8 s to the last note against 120's 4 s.
      '#00203:3C',
      '#00211:01',
      '#00411:01',
    ]);
    expect(resolvePlayTempoRange(chart)).toEqual({ minBPM: 60, maxBPM: 120, mainBPM: 120 });
  });

  it('is not moved by a split-second BPM spike (BPM × N + STOP)', () => {
    const chart = bms([
      '#BPM 145',
      '#BPM01 14500145',
      '#STOP01 19200000',
      '#00111:01010101',
      '#00208:01',
      '#00209:01',
      '#00211:01',
      '#00303:91',
      '#00311:0101',
    ]);
    expect(resolvePlayTempoRange(chart)).toMatchObject({ maxBPM: 14_500_145, mainBPM: 145 });
  });

  it('takes the start BPM as the main BPM of a chart without notes', () => {
    expect(resolvePlayTempoRange(bms(['#BPM 140', '#00103:B4']))).toEqual({ minBPM: 140, maxBPM: 180, mainBPM: 140 });
  });

  it('ignores zero and non-finite BPMs', () => {
    const points = [
      { beat: 0, bpm: 140, seconds: 0 },
      { beat: 1, bpm: 0, seconds: 5 },
      { beat: 2, bpm: Number.NaN, seconds: 6 },
    ];
    expect(resolvePlayTempoRange(tempoOnly(points))).toEqual({ minBPM: 140, maxBPM: 140, mainBPM: 140 });
  });

  it('falls back to the given BPM when no tempo point is usable', () => {
    expect(resolvePlayTempoRange(tempoOnly([]), 130)).toEqual({ minBPM: 130, maxBPM: 130, mainBPM: 130 });
    expect(resolvePlayTempoRange(tempoOnly([{ beat: 0, bpm: 0, seconds: 0 }]), 130)?.mainBPM).toBe(130);
    expect(resolvePlayTempoRange(tempoOnly([]))).toBeUndefined();
    expect(resolvePlayTempoRange(tempoOnly([]), 0)).toBeUndefined();
  });
});

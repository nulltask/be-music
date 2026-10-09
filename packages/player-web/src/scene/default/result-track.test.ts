import { describe, expect, it } from 'vite-plus/test';
import type { PixiGameplayResultData } from '../core/result-data.ts';
import { resolveResultLamp, resolveResultTrackRows } from './result-track.ts';

function score(partial: Partial<PixiGameplayResultData['score']>): PixiGameplayResultData['score'] {
  return { total: 100, perfect: 0, great: 0, good: 0, bad: 0, poor: 0, emptyPoor: 0, exScore: 0, score: 0, ...partial };
}

describe('resolveResultLamp', () => {
  it('reads FAILED for an uncleared play whatever the judgements', () => {
    expect(resolveResultLamp({ cleared: false, score: score({ perfect: 100 }) })).toBe('FAILED');
  });

  it('reads PERFECT when every note is a PGREAT', () => {
    expect(resolveResultLamp({ cleared: true, score: score({ perfect: 100 }) })).toBe('PERFECT');
  });

  it('reads FULL COMBO without BAD / POOR, ignoring empty POORs', () => {
    expect(resolveResultLamp({ cleared: true, score: score({ perfect: 90, great: 10, emptyPoor: 4 }) })).toBe(
      'FULL COMBO',
    );
  });

  it('reads CLEAR once a BAD or POOR broke the combo', () => {
    expect(resolveResultLamp({ cleared: true, score: score({ perfect: 98, bad: 1, poor: 1 }) })).toBe('CLEAR');
  });

  it('reads CLEAR for a chart without notes', () => {
    expect(resolveResultLamp({ cleared: true, score: score({ total: 0 }) })).toBe('CLEAR');
  });
});

describe('resolveResultTrackRows', () => {
  const song = {
    title: 'Song',
    playLevel: 12,
    bpm: 149.6,
    totalNotes: 100,
    chartPath: 'song.bms',
    chart: { events: [{ measure: 0, channel: '11', position: [0, 1], value: '01' }], bms: { player: 1 } },
  } as unknown as PixiGameplayResultData['song'];

  it('lists level, rounded tempo and the combo breaks', () => {
    const rows = resolveResultTrackRows({ song, score: score({ bad: 2, poor: 3 }) });
    expect(rows.map((row) => row.label)).toEqual(['MODE', 'LEVEL', 'BPM', 'COMBO BREAK']);
    expect(rows[0]!.value).toMatch(/KEYS$/u);
    expect(rows[1]!.value).toBe('12');
    expect(rows[2]!.value).toBe('150');
    expect(rows[3]!.value).toBe('5');
  });

  it('dashes out a missing level or tempo', () => {
    const bare = { ...song, playLevel: undefined, bpm: undefined } as PixiGameplayResultData['song'];
    const rows = resolveResultTrackRows({ song: bare, score: score({}) });
    expect(rows[1]!.value).toBe('-');
    expect(rows[2]!.value).toBe('-');
  });
});

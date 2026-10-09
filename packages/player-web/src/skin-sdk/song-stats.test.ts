import { describe, expect, it } from 'vite-plus/test';
import { parseChart } from '@be-music/parser';
import {
  formatBpmRange,
  formatSongLength,
  resolveSongRowFacts,
  resolveSongStats,
  resolveSongTags,
} from './song-stats.ts';

function song(source: string) {
  return { chart: parseChart(source, 'bms'), bpm: undefined };
}

const PLAIN = ['#BPM 120', '#WAV01 a.wav', '#00111:01010101', '#00211:01000000'].join('\n');

describe('resolveSongStats', () => {
  it('measures a steady chart up to its last note', () => {
    const stats = resolveSongStats(song(PLAIN));
    // Two 4/4 measures at 120 BPM: the last note sits on measure 2's downbeat, 4 seconds in.
    expect(stats.lengthSeconds).toBeCloseTo(4, 3);
    expect(stats.minBpm).toBe(120);
    expect(stats.maxBpm).toBe(120);
    expect(stats.longNotes).toBe(0);
    expect(stats.mines).toBe(0);
    expect(stats.stops).toBe(false);
    expect(resolveSongTags(stats)).toEqual([]);
  });

  it('collects the tempo range, long notes, mines and stops', () => {
    const stats = resolveSongStats(
      song(
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
    expect(stats.minBpm).toBe(120);
    expect(stats.maxBpm).toBe(240);
    expect(stats.longNotes).toBe(1);
    expect(stats.mines).toBe(1);
    expect(stats.stops).toBe(true);
    expect(resolveSongTags(stats)).toEqual(['LN', 'SOFLAN', 'STOP', 'MINE']);
  });

  it('caches per chart', () => {
    const entry = song(PLAIN);
    expect(resolveSongStats(entry)).toBe(resolveSongStats(entry));
  });
});

describe('formatSongLength', () => {
  it('prints m:ss', () => {
    expect(formatSongLength(125.4)).toBe('2:05');
    expect(formatSongLength(0)).toBe('0:00');
    expect(formatSongLength(Number.NaN)).toBe('0:00');
  });
});

describe('formatBpmRange', () => {
  it('prints one tempo or a range', () => {
    expect(formatBpmRange(150, 150)).toBe('150');
    expect(formatBpmRange(119.6, 240.2)).toBe('120-240');
    expect(formatBpmRange(0, 0)).toBe('-');
  });
});

describe('resolveSongRowFacts', () => {
  it('formats the notes, length, tempo and tags of a row', () => {
    const facts = resolveSongRowFacts({ ...song(PLAIN), totalNotes: 5 });
    expect(facts).toEqual({ notes: '5', length: '0:04', bpm: '120', tags: [] });
  });
});

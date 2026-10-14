import { describe, expect, test } from 'vite-plus/test';
import {
  chartExcerpt,
  densestWindow,
  documentBeatNotes,
  documentMeasureCount,
  MAX_EXCERPT_LANES,
  measureStartBeats,
  parseRational,
  type BeatNote,
  type ExcerptDocument,
} from './chart-excerpt.ts';

const lanes7 = [
  { channel: '16', tone: 'red' as const },
  ...['11', '12', '13', '14', '15', '18', '19'].map((channel, i) => ({
    channel,
    tone: i % 2 === 1 ? ('blue' as const) : ('white' as const),
  })),
];

describe('chart excerpt', () => {
  test('parseRational reads integers and fractions', () => {
    expect(parseRational('3')).toBe(3);
    expect(parseRational('3/4')).toBe(0.75);
    expect(parseRational('-1/2')).toBe(-0.5);
  });

  test('measureStartBeats follows the measure lengths, in 4/4 measures', () => {
    expect(measureStartBeats([], 3)).toEqual([0, 4, 8, 12]);
    expect(measureStartBeats([['1', '3/4']], 3)).toEqual([0, 4, 7, 11]);
  });

  test('documentBeatNotes puts notes and long-note ends on the beat axis, sorted by beat', () => {
    const document: ExcerptDocument = {
      measures: { lengths: [['1', '3/4']] },
      notes: [
        { m: '0', p: '1/2', lane: '11' },
        { m: '2', p: '1/4', lane: '1a' },
        { m: '1', p: '1/3', lane: '16', end: { m: '2', p: '0' } },
      ],
    };
    expect(documentMeasureCount(document)).toBe(3);
    expect(documentBeatNotes(document)).toEqual([
      { beat: 2, lane: '11' },
      { beat: 5, endBeat: 7, lane: '16' },
      { beat: 8, lane: '1A' },
    ]);
  });

  test('densestWindow finds the whole-beat window with the most notes, the earliest on a tie', () => {
    const at = (...beats: number[]): BeatNote[] => beats.map((beat) => ({ beat, lane: '11' }));
    expect(densestWindow([], 8)).toEqual({ start: 0, beats: 8, count: 0 });
    expect(densestWindow(at(0, 1, 20, 20.25, 20.5, 21, 27.75, 28), 8)).toEqual({ start: 20, beats: 8, count: 5 });
    // A note on a half beat opens the window on the beat before it, which takes in the notes since.
    expect(densestWindow(at(3, 3.5, 3.75, 11.5), 8)).toEqual({ start: 3, beats: 8, count: 3 });
    expect(densestWindow(at(0, 1, 10, 11), 4)).toEqual({ start: 0, beats: 4, count: 2 });
  });

  test("chartExcerpt keeps the densest window's notes on known lanes, relative to its start", () => {
    const document: ExcerptDocument = {
      measures: { lengths: [] },
      notes: [
        { m: '0', p: '0', lane: '11' },
        { m: '2', p: '0', lane: '16', end: { m: '5', p: '0' } },
        { m: '2', p: '1/4', lane: '12' },
        { m: '2', p: '1/2', lane: '13' },
        { m: '2', p: '1/2', lane: '2Z' },
        { m: '3', p: '0', lane: '19' },
        { m: '4', p: '1/2', lane: '11' },
      ],
    };
    expect(chartExcerpt(document, lanes7)).toEqual({
      lanes: ['red', 'white', 'blue', 'white', 'blue', 'white', 'blue', 'white'],
      beats: 8,
      notes: [
        { lane: 0, beat: 0, end: 12 },
        { lane: 2, beat: 1 },
        { lane: 3, beat: 2 },
        { lane: 7, beat: 4 },
      ],
      bars: [0, 4, 8],
    });
  });

  test('chartExcerpt has nothing to draw without lanes, with too many, or without notes on them', () => {
    const document: ExcerptDocument = { measures: { lengths: [] }, notes: [{ m: '0', p: '0', lane: '11' }] };
    expect(chartExcerpt(document, [])).toBeNull();
    const wide = Array.from({ length: MAX_EXCERPT_LANES + 1 }, (_, i) => ({
      channel: `1${i}`,
      tone: 'white' as const,
    }));
    expect(chartExcerpt(document, wide)).toBeNull();
    expect(chartExcerpt({ measures: { lengths: [] }, notes: [{ m: '0', p: '0', lane: '29' }] }, lanes7)).toBeNull();
  });
});

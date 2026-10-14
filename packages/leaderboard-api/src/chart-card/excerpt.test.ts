import { describe, expect, test } from 'vite-plus/test';
import { safeAreaViolation } from '../pages/share-card-safe-area.ts';
import {
  densestWindow,
  documentBeatNotes,
  documentMeasureCount,
  excerptLanes,
  layoutExcerpt,
  measureStartBeats,
  parseRational,
  type BeatNote,
  type ExcerptFrame,
} from './excerpt.ts';

const frame: ExcerptFrame = {
  box: { x: 100, y: 0, width: 400, height: 600 },
  judgeY: 500,
  topY: 100,
  noteHeight: 10,
  judgeLineHeight: 8,
};

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

  test('documentBeatNotes puts notes and long-note ends on the beat axis', () => {
    const document = {
      measures: { lengths: [['1', '3/4']] as Array<[string, string]> },
      notes: [
        { m: '0', p: '1/2', lane: '11' },
        { m: '1', p: '1/3', lane: '16', end: { m: '2', p: '0' } },
        { m: '2', p: '1/4', lane: '1a' },
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

  test('7 KEY lanes run scratch first, then the keys, white and blue', () => {
    const lanes = excerptLanes('7');
    expect(lanes.map((lane) => lane.channel)).toEqual(['16', '11', '12', '13', '14', '15', '18', '19']);
    expect(excerptLanes('14')).toHaveLength(16);
    expect(excerptLanes('unknown')).toEqual([]);
  });

  test('layoutExcerpt draws lanes, bar lines, the judge line and the window’s notes in BMS colours', () => {
    const notes: BeatNote[] = [
      { beat: 3, lane: '16' },
      { beat: 4, lane: '11' },
      { beat: 5, lane: '12' },
      { beat: 6, endBeat: 20, lane: '13' },
      { beat: 7, lane: 'ZZ' },
      { beat: 12, lane: '11' },
    ];
    const rects = layoutExcerpt(notes, '7', { start: 4, beats: 8, count: 4 }, frame, [0, 4, 8, 12]);
    const lanes = rects.filter((rect) => rect.color.startsWith('lane-'));
    expect(lanes).toHaveLength(8);
    expect(lanes[0]).toEqual({ x: 100, y: 0, width: 50, height: 600, color: 'lane-light' });
    expect(lanes[2]?.color).toBe('lane-dark');
    // The window's bar lines (beats 4, 8 and 12), and the judge line.
    expect(rects.filter((rect) => rect.color === 'bar-line').map((rect) => rect.y)).toEqual([499, 299, 99]);
    expect(rects.find((rect) => rect.color === 'judge-line')).toEqual({
      x: 100,
      y: 500,
      width: 400,
      height: 8,
      color: 'judge-line',
    });
    // 50 px a beat: beat 4 sits on the judge line, beat 5 50 px above; the scratch's note at beat 3 and the note at
    // beat 12 are outside the window, the ZZ lane is not in 7 KEY.
    const heads = rects.filter((rect) => rect.color.startsWith('note-'));
    expect(heads).toEqual([
      { x: 152, y: 490, width: 46, height: 10, color: 'note-white' },
      { x: 202, y: 440, width: 46, height: 10, color: 'note-blue' },
      { x: 252, y: 390, width: 46, height: 10, color: 'note-white' },
    ]);
    // The long note's body runs off the top of the lanes, so it has no end cap.
    expect(rects.find((rect) => rect.color.startsWith('long-'))).toEqual({
      x: 260,
      y: 0,
      width: 30,
      height: 400,
      color: 'long-white',
    });
  });

  test('a long note ending inside the lanes gets an end cap, and every head stays in the safe area', () => {
    const notes: BeatNote[] = [{ beat: 4, endBeat: 6, lane: '16' }];
    const rects = layoutExcerpt(notes, '7', { start: 4, beats: 8, count: 1 }, frame);
    expect(rects.filter((rect) => rect.color === 'note-red').map((rect) => rect.y)).toEqual([400, 490]);
    for (const rect of rects.filter((r) => r.color.startsWith('note-'))) expect(safeAreaViolation(rect)).toBeNull();
  });
});

import { describe, expect, it } from 'vite-plus/test';
import type { ChartScoreBar } from '@be-music/player-ui';
import {
  describePracticeBars,
  PracticeBarsMemory,
  practiceBarWindow,
  practiceBestEXScore,
  practiceNoteShare,
} from './practice-bars-model.ts';
import { playerText, setPlayerLang } from '../player-copy.ts';

function bar(index: number, measure: number, startMs: number, endMs: number): ChartScoreBar {
  return {
    index,
    measure,
    beats: 4,
    startMs,
    endMs,
    notes: [],
    longNotes: [],
    mines: [],
    tempos: [],
    stops: [],
    noteCount: 0,
    soundCount: 0,
  };
}

const LAYOUT = { bars: [bar(0, 0, 0, 2000), bar(1, 1, 2000, 4000), bar(2, 3, 4000, 7500)] };

describe('practiceBarWindow', () => {
  it('sounds the bar from its line to the next one, in seconds', () => {
    expect(practiceBarWindow({ startMs: 2000, endMs: 4000 })).toEqual({ startSeconds: 2, endSeconds: 4 });
    expect(practiceBarWindow({ startMs: 2000, endMs: 1000 })).toEqual({ startSeconds: 2, endSeconds: 2 });
  });
});

describe('describePracticeBars', () => {
  it('names the bars picked by measure number and their times', () => {
    setPlayerLang('en');
    const copy = playerText().practice;
    expect(describePracticeBars(LAYOUT, { first: 1, last: 1 }, copy)).toBe('Bar 001 · 0:02.0 → 0:04.0');
    expect(describePracticeBars(LAYOUT, { first: 1, last: 2 }, copy)).toBe('Bars 001–003 · 0:02.0 → 0:07.5');
  });

  it('says the whole chart loops with no bars picked, and when the chart could not be laid out', () => {
    setPlayerLang('en');
    const copy = playerText().practice;
    expect(describePracticeBars(LAYOUT, undefined, copy)).toBe(copy.wholeChart);
    expect(describePracticeBars(undefined, { first: 0, last: 0 }, copy)).toBe(copy.unreadable);
  });
});

describe('PracticeBarsMemory', () => {
  it('keeps the bars picked for each chart as the range a play loops', () => {
    const memory = new PracticeBarsMemory();
    expect(memory.remember('a', LAYOUT, { first: 1, last: 2 })).toEqual({
      bars: { first: 1, last: 2 },
      range: { startMs: 2000, endMs: 7500 },
      noteShare: 1,
    });
    expect(memory.rangeFor('a')).toEqual({ startMs: 2000, endMs: 7500 });
    expect(memory.pickFor('b')).toBeUndefined();
    expect(memory.rangeFor('b')).toBeUndefined();
  });

  it('forgets a chart’s pick when it starts with no bars, or bars the score does not have', () => {
    const memory = new PracticeBarsMemory();
    memory.remember('a', LAYOUT, { first: 1, last: 1 });
    expect(memory.remember('a', LAYOUT, undefined)).toBeUndefined();
    expect(memory.rangeFor('a')).toBeUndefined();
    memory.remember('a', LAYOUT, { first: 1, last: 1 });
    memory.remember('a', LAYOUT, { first: 5, last: 6 });
    expect(memory.rangeFor('a')).toBeUndefined();
  });
});

describe('PracticeBarsMemory without practice', () => {
  it('plays a chart started without practice as a regular play until it is practised again, keeping its pick', () => {
    const memory = new PracticeBarsMemory();
    memory.remember('a', LAYOUT, { first: 1, last: 1 });
    memory.skipPractice('a');
    expect(memory.skipsPractice('a')).toBe(true);
    expect(memory.skipsPractice('b')).toBe(false);
    expect(memory.pickFor('a')?.bars).toEqual({ first: 1, last: 1 });
    memory.remember('a', LAYOUT, { first: 2, last: 2 });
    expect(memory.skipsPractice('a')).toBe(false);
  });
});

describe('practiceNoteShare', () => {
  const counted = { bars: [10, 30, 0, 60].map((noteCount, index) => ({ ...bar(index, index, 0, 0), noteCount })) };

  it('is the share of the chart’s judged notes the bars picked hold', () => {
    expect(practiceNoteShare(counted, { first: 1, last: 1 })).toBe(0.3);
    expect(practiceNoteShare(counted, { first: 3, last: 1 })).toBe(0.9);
  });

  it('is 1 for a chart with no notes', () => {
    expect(practiceNoteShare(LAYOUT, { first: 0, last: 1 })).toBe(1);
  });

  it('is kept with the pick for the play to read, 1 for a chart started with no bars', () => {
    const memory = new PracticeBarsMemory();
    memory.remember('a', counted, { first: 0, last: 1 });
    expect(memory.noteShareFor('a')).toBe(0.4);
    memory.remember('a', counted, undefined);
    expect(memory.noteShareFor('a')).toBe(1);
  });
});

describe('practiceBestEXScore', () => {
  it('cuts the best EX score down to the share of the notes looped, rounding', () => {
    expect(practiceBestEXScore(1234, 0.25)).toBe(309);
    expect(practiceBestEXScore(1234, 1)).toBe(1234);
  });

  it('keeps the share within 0..1 and the score at 0 or more', () => {
    expect(practiceBestEXScore(100, 2)).toBe(100);
    expect(practiceBestEXScore(100, Number.NaN)).toBe(100);
    expect(practiceBestEXScore(-5, 0.5)).toBe(0);
  });
});

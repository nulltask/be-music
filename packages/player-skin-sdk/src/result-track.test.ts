import { describe, expect, it } from 'vite-plus/test';
import type { BeMusicResultData } from './result-data.ts';
import {
  resolveResultCourseCard,
  resolveResultCourseScroll,
  resolveResultLamp,
  resolveResultPlayTag,
  resolveResultTrackRows,
  resolveResultVerdict,
} from './result-track.ts';

function score(partial: Partial<BeMusicResultData['score']>): BeMusicResultData['score'] {
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

  it('reads CLEAR for a play that stopped before its last note', () => {
    expect(resolveResultLamp({ cleared: true, score: score({ perfect: 60 }) })).toBe('CLEAR');
  });
});

describe('resolveResultTrackRows', () => {
  const chartEntry = {
    title: 'Song',
    playLevel: 12,
    bpm: 149.6,
    totalNotes: 100,
    chartPath: 'song.bms',
    chart: { events: [{ measure: 0, channel: '11', position: [0, 1], value: '01' }], bms: { player: 1 } },
  } as unknown as BeMusicResultData['chart'];

  it('lists level, rounded tempo and the combo breaks', () => {
    const rows = resolveResultTrackRows({ chart: chartEntry, score: score({ bad: 2, poor: 3 }) });
    expect(rows.map((row) => row.label)).toEqual(['MODE', 'LEVEL', 'BPM', 'COMBO BREAK']);
    expect(rows[0]!.value).toMatch(/KEYS$/u);
    expect(rows[1]!.value).toBe('12');
    expect(rows[2]!.value).toBe('150');
    expect(rows[3]!.value).toBe('5');
  });

  it('dashes out a missing level or tempo', () => {
    const bare = { ...chartEntry, playLevel: undefined, bpm: undefined } as BeMusicResultData['chart'];
    const rows = resolveResultTrackRows({ chart: bare, score: score({}) });
    expect(rows[1]!.value).toBe('-');
    expect(rows[2]!.value).toBe('-');
  });
});

describe('resolveResultVerdict', () => {
  it('reads STAGE CLEAR / FAILED for one play', () => {
    expect(resolveResultVerdict({ cleared: true })).toBe('STAGE CLEAR');
    expect(resolveResultVerdict({ cleared: false })).toBe('FAILED');
  });

  it('reads COURSE CLEAR / COURSE FAILED for a course run', () => {
    expect(resolveResultVerdict({ cleared: true, run: 'course' })).toBe('COURSE CLEAR');
    expect(resolveResultVerdict({ cleared: false, run: 'course' })).toBe('COURSE FAILED');
  });

  it('reads a course stage and a NONSTOP run as one play', () => {
    expect(resolveResultVerdict({ cleared: true, run: 'stage' })).toBe('STAGE CLEAR');
    expect(resolveResultVerdict({ cleared: false, run: 'nonstop' })).toBe('FAILED');
  });
});

describe('resolveResultPlayTag', () => {
  const replay = (
    play: Partial<NonNullable<BeMusicResultData['replay']>['play']> = {},
  ): NonNullable<BeMusicResultData['replay']> =>
    ({
      chart: { notes: [{ id: 0, channel: '11', type: 'normal', timeUs: 0 }] },
      play: { mode: 'manual', autoScratch: false, gauge: 'GROOVE', ...play },
    }) as unknown as NonNullable<BeMusicResultData['replay']>;

  it('tags a full AUTO play, by its flag or by the mode of the replay it recorded', () => {
    expect(resolveResultPlayTag({ autoPlay: true })).toBe('AUTO PLAY');
    expect(resolveResultPlayTag({ replay: replay({ mode: 'auto' }) })).toBe('AUTO PLAY');
  });

  it('tags a play whose replay used an assisted option', () => {
    expect(resolveResultPlayTag({ replay: replay({ autoScratch: true }) })).toBe('ASSIST');
    expect(resolveResultPlayTag({ replay: replay({ judgeWindowOverrideMs: 50 }) })).toBe('ASSIST');
  });

  it('leaves a plain play untagged, and a play without a replay that was not AUTO', () => {
    expect(resolveResultPlayTag({ replay: replay() })).toBeUndefined();
    expect(resolveResultPlayTag({})).toBeUndefined();
  });
});

describe('resolveResultCourseCard', () => {
  const course: NonNullable<BeMusicResultData['course']> = {
    kind: 'grade',
    title: 'Dan 1',
    stages: [
      { title: 'A', subtitle: '[SPA]', artist: 'Composer A', genre: 'TECHNO', level: 10, difficulty: 4 },
      { title: 'B', artist: 'Composer B', level: 11 },
      { title: 'C' },
    ],
  };

  it('lists every stage of a course run, marking the ones the run never reached', () => {
    const card = resolveResultCourseCard({ run: 'course', course, courseRun: { stagesPlayed: 2 } });
    expect(card).toEqual({
      kind: 'DAN',
      title: 'Dan 1',
      detail: '2 / 3 STAGES',
      stages: [
        {
          stage: 1,
          title: 'A',
          subtitle: '[SPA]',
          artist: 'Composer A',
          genre: 'TECHNO',
          level: '10',
          difficulty: 4,
          played: true,
        },
        { stage: 2, title: 'B', artist: 'Composer B', level: '11', played: true },
        { stage: 3, title: 'C', level: '-', played: false },
      ],
    });
  });

  it('names the trophy the run earned', () => {
    const card = resolveResultCourseCard({
      run: 'course',
      course: { ...course, kind: 'expert' },
      courseRun: { stagesPlayed: 3, trophy: 'goldmedal' },
    });
    expect(card?.kind).toBe('COURSE');
    expect(card?.detail).toBe('3 / 3 STAGES · goldmedal');
  });

  it('reads every stage of a NONSTOP run without a course log as played', () => {
    const card = resolveResultCourseCard({ run: 'nonstop', course: { ...course, kind: 'nonstop' } });
    expect(card?.kind).toBe('NONSTOP');
    expect(card?.detail).toBe('3 / 3 STAGES');
    expect(card?.stages.every((stage) => stage.played)).toBe(true);
  });

  it('leaves a single play and a course stage to their own chart', () => {
    expect(resolveResultCourseCard({ run: 'single' })).toBeUndefined();
    expect(resolveResultCourseCard({ run: 'stage', course: { ...course, stageIndex: 1 } })).toBeUndefined();
  });
});

describe('resolveResultCourseScroll', () => {
  const timing = { holdMs: 1000, pxPerSecond: 50, fadeMs: 500 };
  const at = (overflowPx: number, elapsedMs: number) => resolveResultCourseScroll(overflowPx, elapsedMs, timing);

  it('rests at the top, scrolls to the bottom, rests, fades out and fades back in at the top', () => {
    // 100 px past the card: a 1 s rest, 2 s of scrolling, a 1 s rest, then a 0.5 s fade out and a 0.5 s fade in.
    expect(at(100, 500)).toEqual({ offsetPx: 0, alpha: 1 });
    expect(at(100, 2000)).toEqual({ offsetPx: 50, alpha: 1 });
    expect(at(100, 3500)).toEqual({ offsetPx: 100, alpha: 1 });
    expect(at(100, 4250)).toEqual({ offsetPx: 100, alpha: 0.5 });
    expect(at(100, 4750)).toEqual({ offsetPx: 0, alpha: 0.5 });
    // The cycle is 5 s: it starts over, fully shown at the top.
    expect(at(100, 5000)).toEqual({ offsetPx: 0, alpha: 1 });
    expect(at(100, 7000)).toEqual({ offsetPx: 50, alpha: 1 });
  });

  it('jumps back without a fade when the fade takes no time', () => {
    const cut = { ...timing, fadeMs: 0 };
    expect(resolveResultCourseScroll(100, 3999, cut)).toEqual({ offsetPx: 100, alpha: 1 });
    expect(resolveResultCourseScroll(100, 4000, cut)).toEqual({ offsetPx: 0, alpha: 1 });
  });

  it('keeps a list that fits, and the result before it shows, at the top', () => {
    const top = { offsetPx: 0, alpha: 1 };
    expect(at(0, 5000)).toEqual(top);
    expect(at(-20, 5000)).toEqual(top);
    expect(at(100, 0)).toEqual(top);
    expect(at(100, Number.NaN)).toEqual(top);
    expect(at(100, Number.POSITIVE_INFINITY)).toEqual(top);
    expect(resolveResultCourseScroll(100, 5000, { ...timing, pxPerSecond: 0 })).toEqual(top);
  });

  it('uses the built-in skins timing by default', () => {
    expect(resolveResultCourseScroll(60, 2500 + 1000).offsetPx).toBeCloseTo(30);
    expect(resolveResultCourseScroll(60, 2500 + 2000 + 2500 + 200).alpha).toBeCloseTo(0.5);
  });
});

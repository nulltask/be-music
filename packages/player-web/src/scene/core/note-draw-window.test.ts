import { describe, expect, it } from 'vite-plus/test';
import { createScrollDistanceMapper } from '@be-music/player/core/scroll-distance';
import {
  advanceDrawCursor,
  changesScrollRate,
  collectLaneTimelineBeats,
  collectResolvedLaneTimelineBeats,
  firstBeatAfter,
  isDrawnAtTime,
  isDrawnUntilJudged,
  isLongNoteDrawnAtTime,
  isPastDrawWindow,
  LR2_DROPPED_LONG_NOTE_ALPHA,
  resolveDrawBottom,
  resolveDrawY,
  resolveLongNoteAlpha,
  resolveNoteDrawRules,
  resolveNoteDrawWindow,
} from './note-draw-window.ts';

// A gimmick-chart shape: plain scroll, then a negative #SCROLL that pulls the chart back down, a frozen stretch with
// #SCROLL 0, and plain scroll again.
const GIMMICK_SCROLL = [
  { beat: 8, speed: -4 },
  { beat: 10, speed: 0 },
  { beat: 12, speed: 1 },
];

/** The beats the walk visits from `currentBeat`, of beat-sorted `beats`, and whose position lies inside the lane. */
function drawnBeats(beats: readonly number[], currentBeat: number, laneBeats: number): number[] {
  const mapper = createScrollDistanceMapper(GIMMICK_SCROLL);
  const window = resolveNoteDrawWindow({
    rules: 'beatoraja',
    currentBeat,
    nowSeconds: 0,
    mapper,
    laneBeats,
    overscanBeats: 1,
  });
  const drawn: number[] = [];
  for (const beat of beats) {
    if (beat < currentBeat) continue;
    if (isPastDrawWindow(window, beat)) break;
    const distance = mapper.distanceBetween(currentBeat, beat);
    if (distance >= 0 && distance <= laneBeats) drawn.push(beat);
  }
  return drawn;
}

describe('changesScrollRate', () => {
  it('is false without points and when every #SCROLL / #SPEED point is 1', () => {
    expect(changesScrollRate([], [])).toBe(false);
    expect(
      changesScrollRate(
        [
          { beat: 0, speed: 1 },
          { beat: 4, speed: 1 },
        ],
        [{ beat: 2, speed: 1 }],
      ),
    ).toBe(false);
  });

  it('is true once any #SCROLL or #SPEED point differs from 1', () => {
    expect(
      changesScrollRate(
        [
          { beat: 0, speed: 1 },
          { beat: 4, speed: 0.5 },
        ],
        [],
      ),
    ).toBe(true);
    expect(changesScrollRate([], [{ beat: 0, speed: 2 }])).toBe(true);
    expect(changesScrollRate([{ beat: 8, speed: -1 }], [{ beat: 0, speed: 1 }])).toBe(true);
  });
});

describe('collectLaneTimelineBeats / firstBeatAfter', () => {
  it('merges the lists into sorted beats without repeats', () => {
    expect([...collectLaneTimelineBeats([4, 1, 2], [2, 3], [], [Number.NaN, 0])]).toEqual([0, 1, 2, 3, 4]);
  });

  it('collects every timeline of a resolved chart: notes, long-note ends, mines, invisible, bars, tempo and scroll', () => {
    const beats = collectResolvedLaneTimelineBeats({
      notes: [{ beat: 1 }, { beat: 2, endBeat: 5 }] as never,
      mines: [{ beat: 3 }] as never,
      invisibleNotes: [{ beat: 3.5 }] as never,
      barLines: [0, 4, 8],
      timing: { tempoPoints: [{ beat: 0 }, { beat: 6 }], stopPoints: [{ beat: 7 }] } as never,
      scroll: [{ beat: 9, speed: 2 }],
      speed: [{ beat: 10, speed: 1 }],
    });
    expect([...beats]).toEqual([0, 1, 2, 3, 3.5, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('finds the first beat strictly after a beat', () => {
    const beats = [1, 2, 4];
    expect(firstBeatAfter(beats, 0)).toBe(1);
    expect(firstBeatAfter(beats, 2)).toBe(4);
    expect(firstBeatAfter(beats, 3.5)).toBe(4);
    expect(firstBeatAfter(beats, 4)).toBe(Number.POSITIVE_INFINITY);
    expect(firstBeatAfter(beats, Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('resolveNoteDrawRules', () => {
  it('follows beatoraja only when the chart scrolls (LR2 has no #SCROLL), LR2 otherwise', () => {
    // Drawing is not part of a judge ruleset, so the ruleset does not enter the choice.
    expect(resolveNoteDrawRules(true)).toBe('beatoraja');
    expect(resolveNoteDrawRules(false)).toBe('lr2');
  });
});

describe('resolveNoteDrawWindow', () => {
  it('stops the walk where the chart first overruns the lane, hiding what a negative scroll brings back', () => {
    // From beat 2 a 4-beat lane is overrun at beat 6; the negative scroll at beat 8 brings beat 9.5 back down onto the
    // judgement line, inside the lane, but beatoraja's walk never reaches it.
    const beats = [3, 5, 7, 9.5, 11, 12.5];
    expect(drawnBeats(beats, 2, 4)).toEqual([3, 5]);
    // Once the playhead is past the climb they come into reach.
    expect(drawnBeats(beats, 10.5, 4)).toEqual([11, 12.5]);
  });

  it('keeps everything a tall lane holds, through zero and negative scroll', () => {
    // A 9-beat lane is never overrun before beat 12 + (9 - 0): every note on screen is drawn.
    expect(drawnBeats([3, 7, 8.5, 11, 13], 0, 9)).toEqual([3, 7, 8.5, 11, 13]);
  });

  it('also draws the first timeline past the lane top, as LaneRenderer checks the lane top after drawing', () => {
    // From beat 2 the 4-beat lane is overrun at beat 6. The timeline at beat 7 is drawn (in the band above the lane),
    // the walk then stops, so beat 9.5 — back inside the lane after the negative scroll — still is not reached.
    const window = resolveNoteDrawWindow({
      rules: 'beatoraja',
      currentBeat: 2,
      nowSeconds: 0,
      mapper: createScrollDistanceMapper(GIMMICK_SCROLL),
      laneBeats: 4,
      timelineBeats: collectLaneTimelineBeats([3, 5, 7, 9.5], [8, 10, 12]),
      overscanBeats: 1,
    });
    expect(window.lastBeat).toBe(7);
    expect(isPastDrawWindow(window, 7)).toBe(false);
    expect(isPastDrawWindow(window, 9.5)).toBe(true);
  });

  it('stops on a timeline without notes (a #SCROLL point) when that is the first past the lane top', () => {
    const window = resolveNoteDrawWindow({
      rules: 'beatoraja',
      currentBeat: 4,
      nowSeconds: 0,
      mapper: createScrollDistanceMapper(GIMMICK_SCROLL),
      laneBeats: 3,
      timelineBeats: collectLaneTimelineBeats([5, 9.5], [8, 10, 12]),
      overscanBeats: 1,
    });
    // Overrun at beat 7; the #SCROLL point at beat 8 is the next timeline, so the note at 9.5 is never reached.
    expect(window.lastBeat).toBe(8);
  });

  it('extends a plain lane end to the next timeline too', () => {
    const window = resolveNoteDrawWindow({
      rules: 'beatoraja',
      currentBeat: 4,
      nowSeconds: 0,
      laneBeats: 2,
      timelineBeats: [5, 6, 6.5, 7],
      overscanBeats: 1,
    });
    expect(window.lastBeat).toBe(6.5);
  });

  it('matches the plain lane end when nothing scrolls', () => {
    const window = resolveNoteDrawWindow({
      rules: 'beatoraja',
      currentBeat: 4,
      nowSeconds: 0,
      laneBeats: 2,
      overscanBeats: 1,
    });
    expect(window.lastBeat).toBe(6);
    expect(isPastDrawWindow(window, 6)).toBe(false);
    expect(isPastDrawWindow(window, 6.01)).toBe(true);
  });

  it('walks without an early exit when the mapper cannot tell where the lane is overrun', () => {
    // A `ScrollDistanceMapperLike` written before `firstBeatBeyondDistance` existed leaves the member out.
    const window = resolveNoteDrawWindow({
      rules: 'beatoraja',
      currentBeat: 4,
      nowSeconds: 0,
      mapper: {},
      laneBeats: 2,
      overscanBeats: 1,
    });
    expect(window.lastBeat).toBe(Number.POSITIVE_INFINITY);
  });

  it('keeps the LR2 window (lane plus overscan) for charts without scroll events', () => {
    const window = resolveNoteDrawWindow({
      rules: 'lr2',
      currentBeat: 4,
      nowSeconds: 0,
      laneBeats: 2,
      overscanBeats: 1,
    });
    expect(window.lastBeat).toBe(7);
  });
});

describe('isDrawnAtTime / isLongNoteDrawnAtTime', () => {
  const at = (rules: 'lr2' | 'beatoraja', nowSeconds: number) =>
    resolveNoteDrawWindow({ rules, currentBeat: 0, nowSeconds, laneBeats: 4, overscanBeats: 1 });

  it('drops a note under beatoraja rules the moment its time has come, judged or not', () => {
    // beatoraja draws a NormalNote / MineNote only while `tl.getMicroTime() >= microtime`: a note the player has not
    // hit yet (still inside its late window) is already gone, and so is one under a STOP that started at its beat.
    expect(isDrawnAtTime(at('beatoraja', 10), 10)).toBe(true);
    expect(isDrawnAtTime(at('beatoraja', 10), 10.001)).toBe(true);
    expect(isDrawnAtTime(at('beatoraja', 10), 9.999)).toBe(false);
  });

  it('leaves LR2 rules to the judgement (a late, unjudged note keeps drawing)', () => {
    expect(isDrawnAtTime(at('lr2', 10), 9.9)).toBe(true);
  });

  it('keeps a long note under beatoraja rules while its end is still ahead (held or pending)', () => {
    expect(isLongNoteDrawnAtTime(at('beatoraja', 10), 12)).toBe(true);
    expect(isLongNoteDrawnAtTime(at('beatoraja', 10), 10)).toBe(true);
    expect(isLongNoteDrawnAtTime(at('beatoraja', 10), 9.5)).toBe(false);
    expect(isLongNoteDrawnAtTime(at('lr2', 10), 9.5)).toBe(true);
  });
});

describe('resolveDrawBottom', () => {
  const window = (rules: 'lr2' | 'beatoraja') =>
    resolveNoteDrawWindow({ rules, currentBeat: 0, nowSeconds: 0, laneBeats: 4, overscanBeats: 1, stageBottomY: 720 });

  it('lets beatoraja rules draw below the judgement line down to the bottom of the stage', () => {
    // `LaneRenderer` does not clip: a note a negative #SCROLL puts below the line (still ahead in time) is drawn there.
    expect(resolveDrawBottom(window('beatoraja'), 600)).toBe(720);
  });

  it('stops LR2 rules at the judgement line', () => {
    expect(resolveDrawBottom(window('lr2'), 600)).toBe(600);
  });

  it('never lifts the bottom above the judgement line', () => {
    expect(resolveDrawBottom(window('beatoraja'), 760)).toBe(760);
  });
});

describe('isDrawnUntilJudged', () => {
  const at = (rules: 'lr2' | 'beatoraja', currentBeat: number) =>
    resolveNoteDrawWindow({ rules, currentBeat, nowSeconds: 0, laneBeats: 4, overscanBeats: 1 });

  it('keeps a note LR2 has not judged yet, even once its beat has passed (it sits on the line until the miss)', () => {
    expect(isDrawnUntilJudged(at('lr2', 10), { beat: 9, judged: false }, false)).toBe(true);
  });

  it('keeps a note hit early until its beat reaches the playhead, then drops it', () => {
    expect(isDrawnUntilJudged(at('lr2', 10), { beat: 10.5, judged: true }, false)).toBe(true);
    expect(isDrawnUntilJudged(at('lr2', 10), { beat: 10, judged: true }, false)).toBe(false);
    expect(isDrawnUntilJudged(at('lr2', 10), { beat: 9, judged: true }, false)).toBe(false);
  });

  it('keeps a long note until it is judged and its end has passed', () => {
    // Held (head judged), its end still ahead.
    expect(isDrawnUntilJudged(at('lr2', 10), { beat: 8, endBeat: 12, judged: true }, false)).toBe(true);
    // Missed at the head, end passed: gone. Not judged yet: stays on the line.
    expect(isDrawnUntilJudged(at('lr2', 10), { beat: 8, endBeat: 9, judged: true }, false)).toBe(false);
    expect(isDrawnUntilJudged(at('lr2', 10), { beat: 8, endBeat: 9, judged: false }, false)).toBe(true);
  });

  it('drops a note on an auto lane once its beat (end) has passed, judged or not', () => {
    expect(isDrawnUntilJudged(at('lr2', 10), { beat: 9, judged: false }, true)).toBe(false);
    expect(isDrawnUntilJudged(at('lr2', 10), { beat: 10.5, judged: false }, true)).toBe(true);
    expect(isDrawnUntilJudged(at('lr2', 10), { beat: 9, endBeat: 11, judged: true }, true)).toBe(true);
  });

  it('leaves beatoraja rules to the time', () => {
    expect(isDrawnUntilJudged(at('beatoraja', 10), { beat: 9, judged: true }, false)).toBe(true);
  });
});

describe('resolveDrawY', () => {
  const window = (rules: 'lr2' | 'beatoraja') =>
    resolveNoteDrawWindow({ rules, currentBeat: 0, nowSeconds: 0, laneBeats: 4, overscanBeats: 1, stageBottomY: 720 });

  it('holds a passed object on the judgement line under LR2 rules', () => {
    expect(resolveDrawY(window('lr2'), 640, 600)).toBe(600);
    expect(resolveDrawY(window('lr2'), 580, 600)).toBe(580);
  });

  it('leaves the position under beatoraja rules (a negative #SCROLL can put a note below the line)', () => {
    expect(resolveDrawY(window('beatoraja'), 640, 600)).toBe(640);
  });
});

describe('resolveLongNoteAlpha', () => {
  it("dims a dropped long note to LR2's 0x80 and leaves the rest opaque", () => {
    expect(LR2_DROPPED_LONG_NOTE_ALPHA).toBeCloseTo(128 / 255, 9);
    expect(resolveLongNoteAlpha('dropped')).toBe(LR2_DROPPED_LONG_NOTE_ALPHA);
    for (const state of ['pending', 'held', 'done', undefined]) expect(resolveLongNoteAlpha(state)).toBe(1);
  });
});

describe('advanceDrawCursor', () => {
  const gone = (beat: number) => beat < 3;

  it('skips the leading objects that are gone and stops at the first one still drawn', () => {
    expect(advanceDrawCursor([1, 2, 3, 1, 4], 0, gone)).toBe(2);
  });

  it('resumes from an earlier result and never moves back', () => {
    expect(advanceDrawCursor([1, 2, 3, 4], 3, gone)).toBe(3);
    expect(advanceDrawCursor([1, 2], 0, gone)).toBe(2);
    expect(advanceDrawCursor([], 0, gone)).toBe(0);
  });
});

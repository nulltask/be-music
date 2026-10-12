import { describe, expect, it } from 'vite-plus/test';
import { createScrollDistanceMapper } from '@be-music/player/core/scroll-distance';
import {
  changesScrollRate,
  isDrawnAtTime,
  isLongNoteDrawnAtTime,
  isPastDrawWindow,
  resolveDrawBottom,
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

describe('resolveNoteDrawRules', () => {
  it('follows beatoraja whenever the chart scrolls (LR2 has no #SCROLL) or the beatoraja ruleset judges', () => {
    expect(resolveNoteDrawRules(true, 'lr2')).toBe('beatoraja');
    expect(resolveNoteDrawRules(false, 'beatoraja')).toBe('beatoraja');
    expect(resolveNoteDrawRules(false, 'lr2')).toBe('lr2');
    expect(resolveNoteDrawRules(false, 'iidx')).toBe('lr2');
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

  it('leaves LR2 rules to the position (a late, unjudged note keeps drawing until it scrolls past the line)', () => {
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

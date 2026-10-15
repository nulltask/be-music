import { createEmptyJson } from '@be-music/json';
import { parseBeatorajaCourseData } from '@be-music/player/course';
import type { BeMusicCoursePlaylog, PlaylogCourseResult } from '@be-music/player/playlog';
import type { BrowserCourseEntry, BrowserSongEntry } from '@be-music/player-web/collection';
import { describe, expect, test } from 'vite-plus/test';
import {
  courseDecideSong,
  courseRecordPlay,
  describeNonstopPrepareFailure,
  describeRandomCourseDrawFailure,
  describeUnplayableCourse,
  planCourseStart,
  resolveCourseRecordUpdate,
  resolveGameplayExit,
  resolveGameplayRestart,
  resolveResultRetry,
} from './course-flow.ts';

function song(id: string): BrowserSongEntry {
  return {
    id,
    sourceId: 'drop1',
    sourceLabel: 'pack',
    sourceKind: 'directory',
    chartPath: `${id}.bms`,
    directoryLabel: 'pack',
    fileLabel: `${id}.bms`,
    title: id,
    subtitle: `${id} [ANOTHER]`,
    artist: 'artist',
    genre: 'genre',
    totalNotes: 10,
    chart: createEmptyJson('bms'),
  };
}

function course(overrides: Partial<BrowserCourseEntry> = {}): BrowserCourseEntry {
  const definition = parseBeatorajaCourseData({ name: 'Dan', hash: [{ md5: '1'.repeat(32) }], constraint: [] })!;
  return { id: 'dan#0', definition, stages: [{ title: 'a', song: song('a') }], playable: true, ...overrides };
}

const RESULT: PlaylogCourseResult = {
  ruleset: 'lr2',
  judge: { pgreat: 10, great: 2, good: 1, bad: 1, poor: 1, emptyPoor: 1 },
  fast: 0,
  slow: 0,
  exScore: 22,
  noteCount: 15,
  missCount: 3,
  maxCombo: 9,
  djLevel: 'B',
  gauge: { type: 'GROOVE', final: 80, cleared: true },
  lamp: 'NORMAL',
  stagesPlayed: 1,
} as PlaylogCourseResult;

function courseLog(play: {
  mode?: 'auto' | 'manual';
  tempo?: number;
}): Pick<BeMusicCoursePlaylog, 'stages' | 'nonstop'> {
  return {
    stages: [{ played: true, playlog: { play: { mode: play.mode ?? 'manual', ...play } } }],
  } as unknown as Pick<BeMusicCoursePlaylog, 'stages' | 'nonstop'>;
}

describe('planCourseStart', () => {
  test('a NEW COURSE bar starts making a course of its kind', () => {
    expect(planCourseStart(course({ newCourse: true }))).toEqual({ action: 'make', kind: 'expert' });
  });

  test('a course with a missing stage starts nothing, even a random or NONSTOP one', () => {
    expect(planCourseStart(course({ playable: false }))).toEqual({ action: 'unplayable' });
  });

  test('a random course is drawn first; NONSTOP is stitched; others play stage by stage', () => {
    const random = course({ random: {} as BrowserCourseEntry['random'] });
    expect(planCourseStart(random)).toEqual({ action: 'draw' });
    const base = course();
    expect(planCourseStart({ ...base, definition: { ...base.definition, kind: 'nonstop' } })).toEqual({
      action: 'nonstop',
    });
    expect(planCourseStart({ ...base, definition: { ...base.definition, kind: 'grade' } })).toEqual({
      action: 'stages',
    });
  });
});

describe('courseDecideSong', () => {
  test('names the course and drops the first stage’s own subtitle, artist and genre', () => {
    const decided = courseDecideSong(course(), song('a'));
    expect(decided).toMatchObject({ id: 'a', title: 'Dan', chartPath: 'a.bms' });
    expect(decided).not.toHaveProperty('subtitle');
    expect(decided).not.toHaveProperty('artist');
    expect(decided).not.toHaveProperty('genre');
  });
});

describe('failure messages', () => {
  test('say how many stages of an unplayable course are missing', () => {
    const missingOne = course({ playable: false, stages: [{ title: 'a', song: song('a') }, { title: 'x' }] });
    expect(describeUnplayableCourse(missingOne)).toBe('Dan: 1 stage is not in the collection');
    expect(describeUnplayableCourse(course({ playable: false, stages: [{ title: 'x' }, { title: 'y' }] }))).toBe(
      'Dan: 2 stages are not in the collection',
    );
  });

  test('say which stage of a random course could not be drawn, and why', () => {
    expect(describeRandomCourseDrawFailure('R', { ok: false, stage: 1, reason: 'no-candidates' })).toBe(
      'R: stage 2 matches no chart',
    );
    expect(
      describeRandomCourseDrawFailure('R', { ok: false, stage: 0, reason: 'invalid-filter', error: 'bad column' }),
    ).toBe('R: stage 1 has an invalid filter (bad column)');
  });

  test('say why a NONSTOP course could not be stitched', () => {
    expect(describeNonstopPrepareFailure('N', { reason: 'bmson', stage: 2 })).toBe(
      'N: cannot stitch the NONSTOP course: bmson (stage 3)',
    );
    expect(describeNonstopPrepareFailure('N', { reason: 'id-space' })).toBe(
      'N: cannot stitch the NONSTOP course: id-space',
    );
  });
});

describe('resolveCourseRecordUpdate', () => {
  test('keeps the run’s lamp, EX score, max combo and BP under the course key', () => {
    expect(resolveCourseRecordUpdate(courseLog({}), RESULT, 'course:k')).toEqual({
      key: 'course:k',
      play: courseRecordPlay(RESULT),
    });
    expect(courseRecordPlay(RESULT)).toEqual({ lamp: 'NORMAL', exScore: 22, maxCombo: 9, missCount: 3 });
  });

  test('keeps nothing for an auto-played run or one at another tempo', () => {
    expect(resolveCourseRecordUpdate(courseLog({ mode: 'auto' }), RESULT, 'course:k')).toBeUndefined();
    expect(resolveCourseRecordUpdate(courseLog({ tempo: 1.1 }), RESULT, 'course:k')).toBeUndefined();
  });
});

describe('gameplay exits', () => {
  test('ESC gives a course up, shows a NONSTOP run’s result, and leaves a single chart for the select screen', () => {
    expect(resolveGameplayExit({ courseStage: true, nonstop: false })).toBe('give-up-course');
    expect(resolveGameplayExit({ courseStage: false, nonstop: true })).toBe('nonstop-result');
    expect(resolveGameplayExit({ courseStage: false, nonstop: false })).toBe('select');
  });

  test('F5 restitches a NONSTOP course, abandons a course stage and replays a single chart', () => {
    expect(resolveGameplayRestart({ courseStage: false, nonstop: true })).toBe('restitch');
    expect(resolveGameplayRestart({ courseStage: true, nonstop: false })).toBe('abandon-course');
    expect(resolveGameplayRestart({ courseStage: false, nonstop: false })).toBe('replay');
  });
});

describe('resolveResultRetry', () => {
  const lastPlay = { songId: 'a', play: 'last' };

  test('a NONSTOP result retries by stitching the course again', () => {
    const retry = () => {};
    expect(resolveResultRetry({ quickRetry: false, nonstopRetry: retry, songId: 'n', lastPlay })).toEqual({
      kind: 'nonstop',
      retry,
    });
  });

  test('a single chart replays the last play only when it was this chart', () => {
    expect(resolveResultRetry({ quickRetry: true, songId: 'a', lastPlay })).toEqual({ kind: 'replay', play: 'last' });
    expect(resolveResultRetry({ quickRetry: true, songId: 'b', lastPlay })).toBeUndefined();
    expect(resolveResultRetry({ quickRetry: true, songId: 'a' })).toBeUndefined();
  });

  test('a course stage or course result offers no retry', () => {
    expect(resolveResultRetry({ quickRetry: false, songId: 'a', lastPlay })).toBeUndefined();
  });
});

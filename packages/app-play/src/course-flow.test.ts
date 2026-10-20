import { createEmptyJSON } from '@be-music/chart-source';
import { parseBeatorajaCourseData } from '@be-music/player-engine/course';
import type { BeMusicCourseReplay, BeMusicReplay, ReplayCourseResult } from '@be-music/player-engine/replay';
import type { LibraryChart, LibraryCourse } from '@be-music/player-scene-model';
import type { RulesetId } from '@be-music/player-engine/ruleset';
import { describe, expect, test } from 'vite-plus/test';
import {
  activeCourseInfo,
  courseDecideSong,
  courseStageHistories,
  describeNonstopPrepareFailure,
  describeRandomCourseDrawFailure,
  describeUnplayableCourse,
  planCourseStart,
  playAgainOverrides,
  resolveCourseBestRecordUpdate,
  resolveGameplayExit,
  resolveGameplayRestart,
  resolveResultRetry,
  nextCourseStagePlay,
  startCourseRun,
} from './course-flow.ts';

function chartEntry(id: string): LibraryChart {
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
    chart: createEmptyJSON('bms'),
  };
}

function course(overrides: Partial<LibraryCourse> = {}): LibraryCourse {
  const definition = parseBeatorajaCourseData({ name: 'Dan', hash: [{ md5: '1'.repeat(32) }], constraint: [] })!;
  return { id: 'dan#0', definition, stages: [{ title: 'a', chart: chartEntry('a') }], playable: true, ...overrides };
}

const RESULT: ReplayCourseResult = {
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
} as ReplayCourseResult;

function courseLog(
  play: {
    mode?: 'auto' | 'manual';
    tempo?: number;
    judgeRuleset?: RulesetId;
  },
  second?: { judgeRuleset?: RulesetId },
): Pick<BeMusicCourseReplay, 'stages' | 'nonstop'> {
  const stage = (stagePlay: object) => ({ played: true, replay: { play: { mode: 'manual', ...stagePlay } } });
  return {
    stages: second === undefined ? [stage(play)] : [stage(play), stage(second)],
  } as unknown as Pick<BeMusicCourseReplay, 'stages' | 'nonstop'>;
}

describe('planCourseStart', () => {
  test('a NEW COURSE bar starts making a course of its kind', () => {
    expect(planCourseStart(course({ newCourse: true }))).toEqual({ action: 'make', kind: 'expert' });
  });

  test('a course with a missing stage starts nothing, even a random or NONSTOP one', () => {
    expect(planCourseStart(course({ playable: false }))).toEqual({ action: 'unplayable' });
  });

  test('a random course is drawn first; NONSTOP is stitched; others play stage by stage', () => {
    const random = course({ random: {} as LibraryCourse['random'] });
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
    const decided = courseDecideSong(course(), chartEntry('a'));
    expect(decided).toMatchObject({ id: 'a', title: 'Dan', chartPath: 'a.bms' });
    expect(decided).not.toHaveProperty('subtitle');
    expect(decided).not.toHaveProperty('artist');
    expect(decided).not.toHaveProperty('genre');
  });
});

describe('failure messages', () => {
  test('say how many stages of an unplayable course are missing', () => {
    const missingOne = course({ playable: false, stages: [{ title: 'a', chart: chartEntry('a') }, { title: 'x' }] });
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

describe('resolveCourseBestRecordUpdate', () => {
  test('keeps the run’s lamp, EX score, max combo and BP under the course key of its judge ruleset', () => {
    expect(resolveCourseBestRecordUpdate(courseLog({}), RESULT, 'course:k')).toEqual({
      key: 'lr2:course:k',
      play: { lamp: 'NORMAL', exScore: 22, maxCombo: 9, missCount: 3 },
    });
    expect(resolveCourseBestRecordUpdate(courseLog({ judgeRuleset: 'beatoraja' }), RESULT, 'course:k')?.key).toBe(
      'beatoraja:course:k',
    );
  });

  test('keeps nothing for a run whose stages were judged under different rulesets', () => {
    const mixed = courseLog({ judgeRuleset: 'lr2' }, { judgeRuleset: 'iidx' });
    expect(resolveCourseBestRecordUpdate(mixed, RESULT, 'course:k')).toBeUndefined();
  });

  test('keeps nothing for an auto-played run or one at another tempo', () => {
    expect(resolveCourseBestRecordUpdate(courseLog({ mode: 'auto' }), RESULT, 'course:k')).toBeUndefined();
    expect(resolveCourseBestRecordUpdate(courseLog({ tempo: 1.1 }), RESULT, 'course:k')).toBeUndefined();
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

  test('F5 plays a single chart again as it was played: AUTO stays AUTO and a replay stays a replay', () => {
    const replay = { play: { mode: 'auto' } };
    expect(playAgainOverrides({ autoPlay: true })).toEqual({ autoPlay: true });
    expect(playAgainOverrides({ autoPlay: true, replay })).toEqual({ autoPlay: true, replay });
    expect(playAgainOverrides({ autoPlay: false, replay })).toEqual({ autoPlay: false, replay });
    // A live play stays live: no `replay` key at all, so the restarted play records again.
    const manual = playAgainOverrides({ autoPlay: false, replay: undefined });
    expect(manual).toEqual({ autoPlay: false });
    expect('replay' in manual).toBe(false);
  });
});

describe('resolveResultRetry', () => {
  const lastPlay = { chartId: 'a', play: 'last' };

  test('a NONSTOP result retries by stitching the course again', () => {
    const retry = () => {};
    expect(resolveResultRetry({ quickRetry: false, nonstopRetry: retry, chartId: 'n', lastPlay })).toEqual({
      kind: 'nonstop',
      retry,
    });
  });

  test('a single chart replays the last play only when it was this chart', () => {
    expect(resolveResultRetry({ quickRetry: true, chartId: 'a', lastPlay })).toEqual({ kind: 'replay', play: 'last' });
    expect(resolveResultRetry({ quickRetry: true, chartId: 'b', lastPlay })).toBeUndefined();
    expect(resolveResultRetry({ quickRetry: true, chartId: 'a' })).toBeUndefined();
  });

  test('a course stage or course result offers no retry', () => {
    expect(resolveResultRetry({ quickRetry: false, chartId: 'a', lastPlay })).toBeUndefined();
  });
});

describe('a running course', () => {
  const three = (): LibraryCourse => {
    const definition = parseBeatorajaCourseData({
      name: 'Dan',
      hash: ['1', '2', '3'].map((digit) => ({ md5: digit.repeat(32) })),
      constraint: ['HCN'],
    })!;
    return {
      id: 'dan#0',
      definition,
      stages: ['a', 'b', 'c'].map((id) => ({ title: id, chart: chartEntry(id) })),
      playable: true,
    };
  };
  const stageLog = (): BeMusicReplay =>
    ({
      results: {
        native: {
          ruleset: 'be-music/native',
          judge: { pgreat: 10, great: 0, good: 0, bad: 0, poor: 0, emptyPoor: 0 },
          fast: 0,
          slow: 0,
          exScore: 20,
          noteCount: 10,
          maxCombo: 10,
          gauge: { type: 'GRADE', final: 90, cleared: true },
        },
      },
    }) as unknown as BeMusicReplay;

  test('plays the course bar’s songs, each stage named for the skins', () => {
    const active = startCourseRun(three());
    const first = nextCourseStagePlay(active)!;
    expect(first.stage.id).toBe('a');
    expect(first.stage.chart.sourceFormat === 'bms' && first.stage.chart.bms.lnMode).toBe(3);
    expect(first.courseInfo).toMatchObject({ kind: 'expert', title: 'Dan', stageIndex: 0 });
    expect(activeCourseInfo(active).stageIndex).toBeUndefined();
    active.run.recordStage(stageLog());
    expect(activeCourseInfo(active)).toMatchObject({
      stageIndex: 0,
      stages: [{ title: 'a' }, { title: 'b' }, { title: 'c' }],
    });
    expect(nextCourseStagePlay(active)!.courseInfo.stageIndex).toBe(1);
  });

  test('refuses a course with a stage missing from the collection', () => {
    const missing = three();
    missing.stages = [missing.stages[0]!, { title: 'gone' }, missing.stages[2]!];
    expect(() => startCourseRun({ ...missing, playable: false })).toThrow('has no chart for stage 2');
  });

  test('keeps each played stage’s graphs, a stage given up with none', () => {
    const active = startCourseRun(three());
    const history = { gaugeHistory: [{ progress: 1, value: 80 }], scoreHistory: [{ progress: 1, exScore: 20 }] };
    active.run.recordStage(stageLog(), history);
    active.run.giveUp(stageLog());
    expect(courseStageHistories(active)).toEqual([history, { gaugeHistory: [], scoreHistory: [] }]);
  });
});

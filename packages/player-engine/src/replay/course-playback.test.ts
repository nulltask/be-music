import { describe, expect, test } from 'vite-plus/test';
import type { BeMusicCourseReplay, ReplayCourseStageEntry } from './course.ts';
import {
  listCourseReplayStageCharts,
  matchesCourseReplayStageChart,
  planCourseReplayPlayback,
  type CourseReplayStageChart,
} from './course-playback.ts';
import type { BeMusicReplay } from './format.ts';
import type { RulesetChartFacts } from '../ruleset/facts.ts';

/** A played stage: only what the course replay helpers read of its replay. */
function played(
  chart: Partial<BeMusicReplay['chart']>,
  options: { final?: number; ruleset?: 'lr2' | 'beatoraja'; aborted?: boolean; results?: boolean } = {},
): ReplayCourseStageEntry {
  const ruleset = options.ruleset ?? 'lr2';
  const replay = {
    chart,
    play: { judgeRuleset: ruleset, ...(options.aborted === true ? { aborted: true } : {}) },
    ...(options.results === false
      ? {}
      : {
          results: {
            native: {
              ruleset,
              gauge: { type: 'GRADE', final: options.final ?? 80, cleared: (options.final ?? 80) > 0 },
            },
          },
        }),
  } as unknown as BeMusicReplay;
  return { played: true, replay };
}

function unplayed(keys: { sha256?: string; md5?: string; chartFingerprint?: string }): ReplayCourseStageEntry {
  return { played: false, ...keys, facts: {} as RulesetChartFacts };
}

function courseLog(stages: ReplayCourseStageEntry[]): Pick<BeMusicCourseReplay, 'stages'> {
  return { stages };
}

describe('listCourseReplayStageCharts', () => {
  test('names a played stage by its replay and an unreached one by its hashes', () => {
    const log = courseLog([
      played({ title: 'One', artist: 'A', sha256: 'AA11', md5: 'BB22', chartFingerprint: 'bmfp0:1' }),
      unplayed({ md5: 'cc33' }),
    ]);
    expect(listCourseReplayStageCharts(log)).toEqual([
      { index: 0, played: true, title: 'One', artist: 'A', sha256: 'aa11', md5: 'bb22', chartFingerprint: 'bmfp0:1' },
      { index: 1, played: false, md5: 'cc33' },
    ]);
  });
});

describe('matchesCourseReplayStageChart', () => {
  const stage = (keys: Partial<CourseReplayStageChart>): CourseReplayStageChart => ({
    index: 0,
    played: true,
    ...keys,
  });

  test('prefers SHA-256, then MD5, then the chart fingerprint', () => {
    expect(matchesCourseReplayStageChart(stage({ sha256: 'aa', md5: 'bb' }), { sha256: 'AA', md5: 'xx' })).toBe(true);
    // A stage that names a SHA-256 is not matched by its MD5 alone.
    expect(matchesCourseReplayStageChart(stage({ sha256: 'aa', md5: 'bb' }), { md5: 'bb' })).toBe(false);
    expect(matchesCourseReplayStageChart(stage({ md5: 'bb' }), { sha256: 'zz', md5: 'BB' })).toBe(true);
    expect(matchesCourseReplayStageChart(stage({ chartFingerprint: 'bmfp0:x' }), { chartFingerprint: 'bmfp0:x' })).toBe(
      true,
    );
  });

  test('a stage that names no chart matches nothing', () => {
    expect(matchesCourseReplayStageChart(stage({}), { sha256: 'aa', md5: 'bb', chartFingerprint: 'bmfp0:x' })).toBe(
      false,
    );
  });
});

describe('planCourseReplayPlayback', () => {
  test('plays every stage of a cleared run in order, the last one ending it', () => {
    const plan = planCourseReplayPlayback(courseLog([played({}), played({}), played({})]));
    expect(plan.map((stage) => [stage.index, stage.end])).toEqual([
      [0, 'next'],
      [1, 'next'],
      [2, 'cleared'],
    ]);
  });

  test('stops at the first failed stage, by the ruleset the stage was judged under', () => {
    // LR2 fails a course stage below 2 %; beatoraja only at 0.
    const lr2 = planCourseReplayPlayback(
      courseLog([played({}), played({}, { final: 1 }), played({}), unplayed({ md5: 'x' })]),
    );
    expect(lr2.map((stage) => stage.end)).toEqual(['next', 'failed']);
    const beatoraja = planCourseReplayPlayback(
      courseLog([played({}, { ruleset: 'beatoraja', final: 1 }), played({}, { ruleset: 'beatoraja', final: 0 })]),
    );
    expect(beatoraja.map((stage) => stage.end)).toEqual(['next', 'failed']);
  });

  test('stops at a stage given up', () => {
    const plan = planCourseReplayPlayback(courseLog([played({}), played({}, { aborted: true }), played({})]));
    expect(plan.map((stage) => stage.end)).toEqual(['next', 'given-up']);
  });

  test('a run that stopped before its last stage ends failed, even without a recorded result', () => {
    const plan = planCourseReplayPlayback(courseLog([played({}, { results: false }), unplayed({ md5: 'x' })]));
    expect(plan.map((stage) => stage.end)).toEqual(['failed']);
    expect(planCourseReplayPlayback(courseLog([unplayed({ md5: 'x' })]))).toEqual([]);
  });
});

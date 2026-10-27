import { describe, expect, test } from 'vite-plus/test';
import type { RulesetChartFacts } from '../ruleset/facts.ts';
import type { BeMusicCourseReplay, ReplayCourseStageEntry } from './course.ts';
import { checkCourseReplayEligibility } from './course-eligibility.ts';
import { computeCourseReplayFingerprint } from './course-fingerprint.ts';
import type { BeMusicReplay } from './format.ts';

const FACTS: RulesetChartFacts = {
  sourceFormat: 'bms',
  laneMode: '7keys',
  lnMode: 1,
  judgeRank: { percent: 75 },
  notes: { normal: 4, long: { 1: 0, 2: 0, 3: 0 } },
};

function stage(fingerprint: string, play: Partial<BeMusicReplay['play']> = {}): ReplayCourseStageEntry {
  return {
    played: true,
    replay: {
      format: 'be-music-replay',
      version: 0,
      clock: { unit: 'us', origin: 'chart-zero' },
      chart: {
        sourceFormat: 'bms',
        laneMode: '7keys',
        lnMode: 1,
        judgeRank: { percent: 75 },
        noteCount: 0,
        notes: [],
        chartFingerprint: fingerprint,
        playFingerprint: `${fingerprint}-play`,
      },
      inputs: [],
      play: { mode: 'manual', autoScratch: false, gauge: 'GROOVE', course: { kind: 'grade' }, ...play },
    },
  };
}

function unreached(chartFingerprint?: string): ReplayCourseStageEntry {
  return { played: false, facts: FACTS, ...(chartFingerprint !== undefined ? { chartFingerprint } : {}) };
}

function courseLog(stages: ReplayCourseStageEntry[]): BeMusicCourseReplay {
  return {
    format: 'be-music-course-replay',
    version: 0,
    course: { name: 'Dan', kind: 'grade', constraints: [], trophies: [] },
    stages,
  };
}

describe('checkCourseReplayEligibility', () => {
  test('accepts a manual run with its stage fingerprints and the assists of every stage', () => {
    const log = courseLog([
      stage('bmfp0:a', { autoScratch: true }),
      stage('bmfp0:b', { autoScratch: true, judgeWindowOverrideMs: 200 }),
      unreached('bmfp0:c'),
    ]);
    expect(checkCourseReplayEligibility(log)).toEqual({
      eligible: true,
      courseFingerprint: computeCourseReplayFingerprint(log),
      stages: [
        { chartFingerprint: 'bmfp0:a', playFingerprint: 'bmfp0:a-play' },
        { chartFingerprint: 'bmfp0:b', playFingerprint: 'bmfp0:b-play' },
      ],
      assistFlags: ['auto-scratch', 'judge-window-override'],
    });
  });

  test('rejects auto play, naming the stage', () => {
    expect(checkCourseReplayEligibility(courseLog([stage('bmfp0:a'), stage('bmfp0:b', { mode: 'auto' })]))).toEqual({
      eligible: false,
      reason: 'auto-play',
      stage: 1,
    });
  });

  test('accepts a run of a course that is not released (beatoraja release: false, a drawn random course), unranked', () => {
    const log = courseLog([stage('bmfp0:a'), stage('bmfp0:b')]);
    log.course.release = false;
    expect(checkCourseReplayEligibility(log)).toMatchObject({ eligible: true, unranked: 'unreleased' });
  });

  test('accepts a run with a stage played at another tempo, unranked', () => {
    const slowed = checkCourseReplayEligibility(courseLog([stage('bmfp0:a', { tempo: 0.9 }), stage('bmfp0:b')]));
    expect(slowed).toMatchObject({ eligible: true, unranked: 'tempo' });
    expect(checkCourseReplayEligibility(courseLog([stage('bmfp0:a'), stage('bmfp0:b')]))).not.toHaveProperty(
      'unranked',
    );
  });

  test('accepts a course given up on its last played stage as a failed run, and no other abort', () => {
    const givenUp = courseLog([stage('bmfp0:a'), stage('bmfp0:b', { aborted: true }), unreached('bmfp0:c')]);
    expect(checkCourseReplayEligibility(givenUp)).toMatchObject({ eligible: true });
    expect(checkCourseReplayEligibility(courseLog([stage('bmfp0:a', { aborted: true }), stage('bmfp0:b')]))).toEqual({
      eligible: false,
      reason: 'aborted',
      stage: 0,
    });
  });

  test('needs every stage chart fingerprint, unreached stages included', () => {
    expect(checkCourseReplayEligibility(courseLog([stage('bmfp0:a'), unreached()]))).toEqual({
      eligible: false,
      reason: 'missing-fingerprint',
      stage: 1,
    });
  });

  test('rejects stages that do not make one run of this course', () => {
    expect(checkCourseReplayEligibility(courseLog([unreached('bmfp0:a'), stage('bmfp0:b')]))).toMatchObject({
      reason: 'not-a-course-run',
      stage: 0,
    });
    expect(
      checkCourseReplayEligibility(courseLog([stage('bmfp0:a'), unreached('bmfp0:b'), stage('bmfp0:c')])),
    ).toMatchObject({ reason: 'not-a-course-run', stage: 2 });
    const single = stage('bmfp0:a');
    if (single.played) delete single.replay.play.course;
    expect(checkCourseReplayEligibility(courseLog([single]))).toMatchObject({ reason: 'not-a-course-run', stage: 0 });
    expect(checkCourseReplayEligibility(courseLog([stage('bmfp0:a', { course: { kind: 'expert' } })]))).toMatchObject({
      reason: 'not-a-course-run',
      stage: 0,
    });
  });

  test('accepts a NONSTOP run on its stitched play, keyed by the stage charts', () => {
    const log = nonstopLog([stage('bmfp0:a'), unreached('bmfp0:b')], { autoScratch: true });
    expect(checkCourseReplayEligibility(log)).toEqual({
      eligible: true,
      courseFingerprint: computeCourseReplayFingerprint(log),
      stages: [],
      nonstop: { chartFingerprint: 'bmfp0:stitched', playFingerprint: 'bmfp0:stitched' },
      assistFlags: ['auto-scratch'],
    });
    // A NONSTOP play given up with ESC is a failed run.
    expect(
      checkCourseReplayEligibility(nonstopLog([stage('bmfp0:a'), stage('bmfp0:b')], { aborted: true })),
    ).toMatchObject({
      eligible: true,
    });
  });

  test('rejects a NONSTOP run played on auto, without fingerprints or not covering the course', () => {
    const stages = () => [stage('bmfp0:a'), stage('bmfp0:b')];
    expect(checkCourseReplayEligibility(nonstopLog(stages(), { mode: 'auto' }))).toEqual({
      eligible: false,
      reason: 'auto-play',
    });
    const unnamed = nonstopLog(stages());
    delete unnamed.nonstop!.replay.chart.playFingerprint;
    expect(checkCourseReplayEligibility(unnamed)).toEqual({ eligible: false, reason: 'missing-fingerprint' });
    const cut = nonstopLog(stages());
    const second = cut.stages[1]!;
    if (second.played) delete second.replay.chart.chartFingerprint;
    expect(checkCourseReplayEligibility(cut)).toEqual({ eligible: false, reason: 'missing-fingerprint', stage: 1 });
    const short = nonstopLog(stages());
    short.nonstop!.stages.pop();
    expect(checkCourseReplayEligibility(short)).toEqual({ eligible: false, reason: 'not-a-course-run' });
    const notNonstop = nonstopLog(stages(), { course: { kind: 'grade' } });
    expect(checkCourseReplayEligibility(notNonstop)).toEqual({ eligible: false, reason: 'not-a-course-run' });
  });
});

/** A NONSTOP run over `stages` (their cut-out logs or unreached facts), with its stitched play. */
function nonstopLog(stages: ReplayCourseStageEntry[], play: Partial<BeMusicReplay['play']> = {}): BeMusicCourseReplay {
  const stitched = stage('bmfp0:stitched', { course: { kind: 'nonstop' }, ...play });
  if (!stitched.played) throw new Error('unreachable');
  stitched.replay.chart.playFingerprint = 'bmfp0:stitched';
  const log = courseLog(stages);
  log.course.kind = 'nonstop';
  log.nonstop = {
    connections: [],
    placement: 'intended',
    replay: stitched.replay,
    stages: stages.map((_entry, index) => ({ offsetUs: index * 1_000_000, windowStartUs: index * 1_000_000, rate: 1 })),
    noteStages: [],
  };
  return log;
}

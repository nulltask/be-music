import { sha256Hex } from '@be-music/chart';
import { describe, expect, test } from 'vite-plus/test';
import type { RulesetChartFacts } from '../ruleset/facts.ts';
import { createCoursePlaylog, parseCoursePlaylog, serializeCoursePlaylog } from './course.ts';
import {
  computeCourseFingerprint,
  computeCoursePlaylogFingerprint,
  resolveCourseStageChartFingerprints,
} from './course-fingerprint.ts';
import type { BeMusicPlaylog } from './format.ts';

const FACTS: RulesetChartFacts = {
  sourceFormat: 'bms',
  laneMode: '7keys',
  lnMode: 1,
  judgeRank: { percent: 75 },
  notes: { normal: 4, long: { 1: 0, 2: 0, 3: 0 } },
};

function stageLog(chartFingerprint: string | undefined): BeMusicPlaylog {
  return {
    format: 'be-music-playlog',
    version: 0,
    clock: { unit: 'us', origin: 'chart-zero' },
    chart: {
      sourceFormat: 'bms',
      laneMode: '7keys',
      lnMode: 1,
      judgeRank: { percent: 75 },
      noteCount: 0,
      notes: [],
      ...(chartFingerprint !== undefined ? { chartFingerprint, playFingerprint: chartFingerprint } : {}),
    },
    inputs: [],
    play: { mode: 'manual', autoScratch: false, gauge: 'GROOVE', course: { kind: 'grade' } },
  };
}

describe('computeCourseFingerprint', () => {
  test('hashes the kind, the sorted constraints and the stage charts in order', () => {
    const fingerprint = computeCourseFingerprint({
      kind: 'grade',
      constraints: ['grade_mirror', 'gauge_lr2'],
      stageChartFingerprints: ['bmfp0:a', 'bmfp0:b'],
    });
    expect(fingerprint).toBe(
      `bmcourse0:${sha256Hex('{"kind":"grade","constraints":["gauge_lr2","grade_mirror"],"stages":["bmfp0:a","bmfp0:b"]}')}`,
    );
  });

  test('ignores the constraint order and spelling, unknown names and repeats', () => {
    const base = computeCourseFingerprint({
      kind: 'grade',
      constraints: ['grade_mirror', 'gauge_lr2'],
      stageChartFingerprints: ['bmfp0:a'],
    });
    expect(
      computeCourseFingerprint({
        kind: 'grade',
        constraints: ['GAUGE_LR2', 'MIRROR', 'unknown', 'grade_mirror'],
        stageChartFingerprints: ['bmfp0:a'],
      }),
    ).toBe(base);
  });

  test('tells apart the kind, the constraints and the stage order', () => {
    const fingerprint = (kind: 'grade' | 'expert', constraints: string[], stages: string[]) =>
      computeCourseFingerprint({ kind, constraints, stageChartFingerprints: stages });
    const base = fingerprint('grade', ['gauge_lr2'], ['bmfp0:a', 'bmfp0:b']);
    expect(fingerprint('expert', ['gauge_lr2'], ['bmfp0:a', 'bmfp0:b'])).not.toBe(base);
    expect(fingerprint('grade', [], ['bmfp0:a', 'bmfp0:b'])).not.toBe(base);
    expect(fingerprint('grade', ['gauge_lr2'], ['bmfp0:b', 'bmfp0:a'])).not.toBe(base);
  });
});

describe('computeCoursePlaylogFingerprint', () => {
  const course = { name: 'Dan', kind: 'grade' as const, constraints: ['gauge_lr2'], trophies: [] };

  test('reads played stages and unreached stages alike, so a failed run is keyed too', () => {
    const log = createCoursePlaylog({
      course,
      stages: [
        { played: true, playlog: stageLog('bmfp0:a') },
        { played: false, facts: FACTS, chartFingerprint: 'bmfp0:b' },
      ],
    });
    expect(resolveCourseStageChartFingerprints(log)).toEqual(['bmfp0:a', 'bmfp0:b']);
    expect(computeCoursePlaylogFingerprint(log)).toBe(
      computeCourseFingerprint({
        kind: 'grade',
        constraints: ['gauge_lr2'],
        stageChartFingerprints: ['bmfp0:a', 'bmfp0:b'],
      }),
    );
    // The unreached stage's fingerprint survives a round trip.
    expect(parseCoursePlaylog(serializeCoursePlaylog(log)).stages[1]).toMatchObject({ chartFingerprint: 'bmfp0:b' });
    // The name and trophies do not take part.
    expect(computeCoursePlaylogFingerprint({ ...log, course: { ...course, name: 'Other' } })).toBe(
      computeCoursePlaylogFingerprint(log),
    );
  });

  test('is undefined when a stage chart is not known', () => {
    const unplayed = createCoursePlaylog({
      course,
      stages: [
        { played: true, playlog: stageLog('bmfp0:a') },
        { played: false, facts: FACTS },
      ],
    });
    expect(computeCoursePlaylogFingerprint(unplayed)).toBeUndefined();
    const played = createCoursePlaylog({ course, stages: [{ played: true, playlog: stageLog(undefined) }] });
    expect(computeCoursePlaylogFingerprint(played)).toBeUndefined();
  });
});

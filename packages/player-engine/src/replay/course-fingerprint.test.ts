import { sha256Hex } from '@be-music/chart-model';
import { describe, expect, test } from 'vite-plus/test';
import type { RulesetChartFacts } from '../ruleset/facts.ts';
import { createCourseReplay, parseCourseReplay, serializeCourseReplay } from './course.ts';
import {
  computeCourseFingerprint,
  createCourseFingerprintDocument,
  type CourseFingerprintInput,
  computeCourseReplayFingerprint,
  resolveCourseStageChartFingerprints,
} from './course-fingerprint.ts';
import type { BeMusicReplay } from './format.ts';

const FACTS: RulesetChartFacts = {
  sourceFormat: 'bms',
  laneMode: '7keys',
  lnMode: 1,
  judgeRank: { percent: 75 },
  notes: { normal: 4, long: { 1: 0, 2: 0, 3: 0 } },
};

function stageLog(chartFingerprint: string | undefined): BeMusicReplay {
  return {
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
      ...(chartFingerprint !== undefined ? { chartFingerprint, playFingerprint: chartFingerprint } : {}),
    },
    inputs: [],
    play: { mode: 'manual', autoScratch: false, gauge: 'GROOVE', course: { kind: 'grade' } },
  };
}

describe('computeCourseFingerprint', () => {
  test('hashes the RFC 8785 form of the course document', () => {
    const input = {
      kind: 'grade' as const,
      constraints: ['grade_mirror', 'gauge_lr2'],
      stageChartFingerprints: ['bmfp0:a', 'bmfp0:b'],
    };
    expect(createCourseFingerprintDocument(input)).toEqual({
      v: 'bmcourse0',
      kind: 'grade',
      constraints: ['gauge_lr2', 'grade_mirror'],
      stages: ['bmfp0:a', 'bmfp0:b'],
    });
    // Keys sorted, no whitespace.
    expect(computeCourseFingerprint(input)).toBe(
      `bmcourse0:${sha256Hex('{"constraints":["gauge_lr2","grade_mirror"],"kind":"grade","stages":["bmfp0:a","bmfp0:b"],"v":"bmcourse0"}')}`,
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

  test('tells NONSTOP courses apart by their connections and placement, not by a connection after the last stage', () => {
    const stages = ['bmfp0:a', 'bmfp0:b'];
    const nonstop = (connections: Array<'fade' | 'cut'>, placement: 'intended' | 'lr2' = 'intended') =>
      computeCourseFingerprint({
        kind: 'nonstop',
        constraints: [],
        stageChartFingerprints: stages,
        nonstop: { connections, placement },
      });
    const base = nonstop(['fade']);
    expect(nonstop(['cut'])).not.toBe(base);
    expect(nonstop(['fade'], 'lr2')).not.toBe(base);
    expect(nonstop(['fade', 'cut'])).toBe(base);
    // A seam the course does not name is stitched as `fade`, so it is keyed as one.
    expect(nonstop([])).toBe(base);
    expect(
      createCourseFingerprintDocument({
        kind: 'nonstop',
        constraints: [],
        stageChartFingerprints: ['bmfp0:a', 'bmfp0:b', 'bmfp0:c'],
        nonstop: { connections: ['cut'], placement: 'lr2' },
      }).nonstop,
    ).toEqual({ connections: ['cut', 'fade'], placement: 'lr2' });
    // Other kinds ignore it, so their fingerprints are what they were.
    const expert = { kind: 'expert' as const, constraints: [], stageChartFingerprints: stages };
    expect(computeCourseFingerprint({ ...expert, nonstop: { connections: ['cut'], placement: 'lr2' } })).toBe(
      computeCourseFingerprint(expert),
    );
  });
});

describe('golden course fingerprints (bmcourse0)', () => {
  // Pinned values: a change to any of them changes every stored course key. Under a stable version, updating one means
  // bumping the version (docs/fingerprint-spec.md).
  test.each([
    [
      'grade',
      { kind: 'grade', constraints: ['MIRROR', 'GAUGE_LR2'], stageChartFingerprints: ['bmfp0:a', 'bmfp0:b'] },
      'bmcourse0:82fb50db317e47fb09055175c9529d86568d43561359e05ac5febdddac325f96',
    ],
    [
      'expert',
      { kind: 'expert', constraints: [], stageChartFingerprints: ['bmfp0:a'] },
      'bmcourse0:30901132f2b861db0e42388c1abc31879b9195fa400d20cda6f185ba9aadb4c6',
    ],
    [
      'nonstop',
      {
        kind: 'nonstop',
        constraints: [],
        stageChartFingerprints: ['bmfp0:a', 'bmfp0:b', 'bmfp0:c'],
        nonstop: { connections: ['cut-fit'], placement: 'intended' },
      },
      'bmcourse0:488fd2163f590facad49757c979e6b41cae07bc94d75459eb2e2629c1a2b43f0',
    ],
  ] as const)('%s', (_name, input, expected) => {
    expect(computeCourseFingerprint(input as CourseFingerprintInput)).toBe(expected);
  });
});

describe('computeCourseReplayFingerprint', () => {
  const course = { name: 'Dan', kind: 'grade' as const, constraints: ['gauge_lr2'], trophies: [] };

  test('reads played stages and unreached stages alike, so a failed run is keyed too', () => {
    const log = createCourseReplay({
      course,
      stages: [
        { played: true, replay: stageLog('bmfp0:a') },
        { played: false, facts: FACTS, chartFingerprint: 'bmfp0:b' },
      ],
    });
    expect(resolveCourseStageChartFingerprints(log)).toEqual(['bmfp0:a', 'bmfp0:b']);
    expect(computeCourseReplayFingerprint(log)).toBe(
      computeCourseFingerprint({
        kind: 'grade',
        constraints: ['gauge_lr2'],
        stageChartFingerprints: ['bmfp0:a', 'bmfp0:b'],
      }),
    );
    // The unreached stage's fingerprint survives a round trip.
    expect(parseCourseReplay(serializeCourseReplay(log)).stages[1]).toMatchObject({ chartFingerprint: 'bmfp0:b' });
    // The name and trophies do not take part.
    expect(computeCourseReplayFingerprint({ ...log, course: { ...course, name: 'Other' } })).toBe(
      computeCourseReplayFingerprint(log),
    );
  });

  test('is undefined when a stage chart is not known', () => {
    const unplayed = createCourseReplay({
      course,
      stages: [
        { played: true, replay: stageLog('bmfp0:a') },
        { played: false, facts: FACTS },
      ],
    });
    expect(computeCourseReplayFingerprint(unplayed)).toBeUndefined();
    const played = createCourseReplay({ course, stages: [{ played: true, replay: stageLog(undefined) }] });
    expect(computeCourseReplayFingerprint(played)).toBeUndefined();
  });
});

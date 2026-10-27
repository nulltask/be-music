import { describe, expect, test } from 'vite-plus/test';
import type { CourseStageFigures } from '../courses/figures.ts';
import { courseCardByline, courseKindLabel, courseShareText } from './course-card-data.ts';
import { courseCardData, courseCardStages, type CourseCardResult } from './course-run-card.ts';

const figures = (exScore: number, noteCount: number, cleared: boolean): CourseStageFigures => ({
  exScore,
  noteCount,
  missCount: 0,
  maxCombo: 0,
  judges: {},
  gaugeType: 'GRADE',
  gaugeFinal: cleared ? 50 : 0,
  cleared,
});

const stages = [
  { chartFingerprint: 'bmfp0-aaaaaaaaaaaaaaaaaaaaaaaa', title: 'first' },
  { chartFingerprint: 'bmfp0-bbbbbbbbbbbbbbbbbbbbbbbb', title: 'second' },
  { chartFingerprint: 'bmfp0-cccccccccccccccccccccccc', title: null },
];

describe('a course run’s card', () => {
  test('the kind reads in the card’s capitals', () => {
    expect(courseKindLabel('grade')).toBe('GRADE COURSE');
    expect(courseKindLabel('nonstop')).toBe('NONSTOP COURSE');
  });

  test('each stage carries its rate and whether it cleared; stages never reached are marked', () => {
    expect(courseCardStages(stages, [figures(90, 50, true), figures(10, 50, false)], 2)).toEqual([
      { title: 'first', rate: '90.00%', state: 'cleared' },
      { title: 'second', rate: '10.00%', state: 'failed' },
      // A chart the server never saw goes by its fingerprint.
      { title: 'bmfp0-cccccccccccc…', rate: null, state: 'unreached' },
    ]);
  });

  test('a run kept without per-stage figures shows the stages it reached as played', () => {
    expect(courseCardStages(stages, null, 2).map((stage) => stage.state)).toEqual(['played', 'played', 'unreached']);
  });

  const played: CourseCardResult = {
    ruleset: 'lr2',
    exScore: 270,
    noteCount: 150,
    clearLamp: 3,
    missCount: 4,
    maxCombo: 120,
    stagesPlayed: 3,
    trophy: 'goldmedal',
    gaugeType: 'GRADE',
    gaugeFinal: 62.5,
    judges: { pgreat: 120, great: 30, good: 0, bad: 2, poor: 1, emptyPoor: 1 },
    stages: [figures(90, 50, true), figures(90, 50, true), figures(90, 50, true)],
  };

  test('the card shows the run under the ruleset it was played with', () => {
    const data = courseCardData({
      course: { name: 'Page Dan', kind: 'grade', stages },
      played,
      player: { displayName: 'Fay', handle: 'fay', avatarUrl: '/players/fay/avatar' },
      playedAt: 1_000,
    });
    expect(data).toMatchObject({
      kindLabel: 'GRADE COURSE',
      courseName: 'Page Dan',
      trophy: 'goldmedal',
      stagesPlayed: 3,
      rulesetLabel: 'LR2 rules',
      exScore: 270,
      maxExScore: 300,
      rate: '90.00%',
      bp: 4,
      maxCombo: 120,
      judges: { pgreat: 120, great: 30, good: 0, bad: 2, poor: 2 },
      gauge: 'GRADE 62.5%',
      playedAt: 1_000,
    });
    expect(data.stages).toHaveLength(3);
    expect(courseCardByline(data)).toBe('3 / 3 stages  ·  goldmedal');
    expect(courseShareText(data)).toBe(
      `Page Dan — ${data.lamp.label} · goldmedal · ${data.djRank} · EX 270/300 (90.00%) [LR2 rules]`,
    );
  });

  test('without a trophy, the byline and the share text leave it out', () => {
    const data = { courseName: 'Dan', lamp: { label: 'FAILED', color: '#7a1f2b' }, trophy: null, djRank: 'B' };
    expect(courseCardByline({ stagesPlayed: 1, stages: [], trophy: null })).toBe('1 / 0 stages');
    expect(courseShareText({ ...data, exScore: 5, maxExScore: 10, rate: '50.00%', rulesetLabel: 'LR2 rules' })).toBe(
      'Dan — FAILED · B · EX 5/10 (50.00%) [LR2 rules]',
    );
  });
});

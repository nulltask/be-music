import { describe, expect, test } from 'vite-plus/test';
import type { RulesetId } from '../ruleset/definitions.ts';
import type { BeMusicCourseReplay } from './course.ts';
import { resolveCoursePlayedRuleset } from './course-ruleset.ts';

type Log = Pick<BeMusicCourseReplay, 'stages' | 'nonstop'>;

const played = (judgeRuleset?: RulesetId) =>
  ({
    played: true,
    replay: { play: judgeRuleset === undefined ? {} : { judgeRuleset } },
  }) as unknown as Log['stages'][number];
const unreached = { played: false, facts: {} } as unknown as Log['stages'][number];

describe('resolveCoursePlayedRuleset', () => {
  test('is the ruleset every played stage shares, LR2 when a stage names none', () => {
    expect(resolveCoursePlayedRuleset({ stages: [played(), played('lr2'), unreached] })).toBe('lr2');
    expect(resolveCoursePlayedRuleset({ stages: [played('beatoraja'), played('beatoraja')] })).toBe('beatoraja');
  });

  test('is undefined when the stages were judged under different rulesets', () => {
    expect(resolveCoursePlayedRuleset({ stages: [played(), played('beatoraja')] })).toBeUndefined();
  });

  test('is the ruleset of a NONSTOP run’s stitched play', () => {
    const nonstop = { replay: { play: { judgeRuleset: '____' } } } as unknown as NonNullable<Log['nonstop']>;
    expect(resolveCoursePlayedRuleset({ stages: [played('lr2'), unreached], nonstop })).toBe('____');
    const unnamed = { replay: { play: {} } } as unknown as NonNullable<Log['nonstop']>;
    expect(resolveCoursePlayedRuleset({ stages: [unreached], nonstop: unnamed })).toBe('lr2');
  });
});

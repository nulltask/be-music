import type { PlaylogRulesetId } from '../ruleset/definitions.ts';
import type { BeMusicCoursePlaylog } from './course.ts';

/**
 * The judge ruleset every stage of a course run was judged under (`play.judgeRuleset`, `lr2` when absent), or
 * `undefined` when they differ. A NONSTOP run was one play: the ruleset of its stitched play. A run is ranked, and its
 * best record kept, under this ruleset.
 */
export function resolveCoursePlayedRuleset(
  courseLog: Pick<BeMusicCoursePlaylog, 'stages' | 'nonstop'>,
): PlaylogRulesetId | undefined {
  if (courseLog.nonstop !== undefined) return courseLog.nonstop.playlog.play.judgeRuleset ?? 'lr2';
  const rulesets = new Set(
    courseLog.stages.flatMap((entry) => (entry.played ? [entry.playlog.play.judgeRuleset ?? 'lr2'] : [])),
  );
  return rulesets.size === 1 ? [...rulesets][0] : undefined;
}

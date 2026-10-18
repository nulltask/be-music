import type { GaugeType, PlaylogRulesetId } from '@be-music/player/ruleset';
import type { PlayerGaugeSummary } from '@be-music/player/core/ui-signal-bus';
import { resolveCourseStageStartGauge, type PlaylogCourseStage } from '@be-music/player/playlog';

/**
 * Placeholder gauge state for the frames before the engine reports one (the READY / LOADING phase), and the first point
 * of the result graph. Values match the LR2 groove defaults so the bar does not visibly jump when the first real frame
 * lands; everything real arrives via `summary.gauge`.
 *
 * A course stage starts on its course gauge instead: the ruleset's course gauge id and the value carried in from the
 * previous stage (100 on the first), so the stage neither shows `GROOVE 20 %` nor graphs it before the engine runs.
 */
export function createPlaceholderGaugeState(
  type: GaugeType = 'GROOVE',
  course?: { stage: PlaylogCourseStage; ruleset: PlaylogRulesetId },
): PlayerGaugeSummary {
  if (course !== undefined) {
    const start = resolveCourseStageStartGauge(course.ruleset, course.stage, type);
    return {
      current: start.initial,
      max: start.max,
      clearThreshold: start.border,
      initial: start.initial,
      effectiveTotal: 0,
      cleared: start.initial > start.border,
      type: start.type,
      survival: start.survival,
      failedMidPlay: false,
    };
  }
  const survival = type === 'HARD' || type === 'DEATH';
  return {
    current: survival ? 100 : 20,
    max: 100,
    clearThreshold: survival ? 0 : 80,
    initial: survival ? 100 : 20,
    effectiveTotal: 0,
    cleared: survival,
    type,
    survival,
    failedMidPlay: false,
  };
}

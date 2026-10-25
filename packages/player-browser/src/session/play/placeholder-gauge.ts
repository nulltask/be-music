import type { GaugeType, RulesetId } from '@be-music/player-engine/ruleset';
import type { PlayerGaugeSummary } from '@be-music/player-engine/signals';
import { resolveCourseStageStartGauge, type ReplayCourseStage } from '@be-music/player-engine/replay';

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
  course?: { stage: ReplayCourseStage; ruleset: RulesetId },
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
  const survival = type === 'HARD' || type === 'DEATH' || type === 'EX-HARD' || type === 'P-ATTACK';
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

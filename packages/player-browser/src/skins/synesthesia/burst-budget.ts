/**
 * Spark budget for Synesthesia bombs. A lone hit throws its full burst; when many hits overlap, the frame's total grain
 * count is capped and shared between them, so a dense chord or a chart's busiest passage costs about as much to draw
 * as a few hits — the overlapping additive light reads just as full either way.
 */

/** Most spark grains drawn across every live bomb in one frame. */
export const BURST_FRAME_BUDGET = 960;

/**
 * Most skirt grains (the low powder that spreads along the judgement line under each burst) drawn across every live
 * bomb in one frame; budgeted apart from the sparks so the skirt never thins the fountain.
 */
export const BURST_SKIRT_FRAME_BUDGET = 720;

/**
 * Grains one bomb draws: its tier-scaled burst (`base + perTier × tier`, scaled by the effects `amount`), capped by an
 * even share of `budget` (the frame's grain budget, {@link BURST_FRAME_BUDGET} by default) among `liveBombs`.
 */
export function burstGrainCount(
  base: number,
  perTier: number,
  tier: number,
  amount: number,
  liveBombs: number,
  budget: number = BURST_FRAME_BUDGET,
): number {
  const wanted = Math.max(0, Math.round((base + perTier * tier) * amount));
  const share = Math.floor(budget / Math.max(1, liveBombs));
  return Math.min(wanted, share);
}

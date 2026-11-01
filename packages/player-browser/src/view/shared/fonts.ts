/** System faces for text the views paint themselves (no skin font available): the player loads no web fonts of its own. */
export const CORE_TEXT_FONT = 'ui-sans-serif, system-ui, sans-serif';
export const CORE_NUMERIC_FONT: string = CORE_TEXT_FONT;
export const CORE_JUDGE_FONT = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/** The LR2 views fall back to the same system fonts when a skin has none. */
export const LR2_TEXT_FALLBACK_FONT: string = CORE_TEXT_FONT;
export const LR2_NUMERIC_FALLBACK_FONT: string = CORE_NUMERIC_FONT;
export const LR2_JUDGE_FALLBACK_FONT: string = CORE_JUDGE_FONT;

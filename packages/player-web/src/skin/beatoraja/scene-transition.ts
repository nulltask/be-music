// The fade-out a beatoraja screen leaves over: upstream's `TIMER_FADEOUT` + `Skin.getFadeout()` pattern shared across
// `MusicDecide.render` / `MusicResult.render` / `BMSPlayer.render` (STATE_FINISHED branch). Some trigger (the screen's
// time running out, a key, the play's end) starts timer 2, the skin's elements gated on it animate from then, and the
// screen hands over once `Skin.fadeout` ms have passed. The decide and result sessions run that window from their
// view's timing (`view/beatoraja/scene-frame.ts`'s `resolveBeatorajaFadeOutMs`), the play scene from its skin metrics.

/**
 * Default fadeout window when the skin omits the field. Matches upstream's `select.json` /
 * `decidemain.lua` / `resultmain.lua` reference values (all 500 ms). Beatoraja's `Skin` class
 * declares `private int fadeout` with no initializer — Java default-initializes to 0, which would
 * mean "transition instantly". The skin always ships a value (the default theme uses 500), so
 * falling through to 0 means an unauthored skin would skip the transition window entirely. Using
 * 500 here matches the visible behavior every reference skin produces and keeps un-authored /
 * hand-rolled test fixtures behaving consistently.
 */
export const DEFAULT_BEATORAJA_FADEOUT_MS = 500;

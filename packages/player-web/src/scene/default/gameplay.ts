import { PixiGameplayView, type PixiGameplayViewOptions } from '../lr2/gameplay.ts';

/**
 * Constructor options for {@link DefaultPixiGameplayView}. The skin-bearing fields (`skin`, `invisibleNoteSkin`) are
 * stripped from the LR2 options shape because the default family does not consume them — passing a skin here would
 * defeat the purpose of selecting the default family in the first place. All other gameplay knobs
 * (auto-play, hi-speed, gauge, BGA size, …) are unchanged from {@link PixiGameplayViewOptions} and reach the same
 * engine pipeline; only the visual chrome differs.
 */
export type DefaultPixiGameplayViewOptions = Omit<PixiGameplayViewOptions, 'skin' | 'invisibleNoteSkin'>;

/**
 * Default-family gameplay scene. Used when the host loaded neither an LR2 theme nor a beatoraja theme, OR explicitly
 * opted into the built-in chrome despite having a theme available (rarely useful, but supported).
 *
 * Implementation note: the class currently extends {@link PixiGameplayView} and forces `skin: undefined`. The LR2
 * gameplay scene already paints the default chrome (via `renderFallbackLr2Frame`) when its `skin` option is omitted,
 * so this subclass is the typed entry-point for that path. Once `PixiGameplayView` is migrated to require a non-
 * optional skin, this class will own the default-skin render pipeline directly instead of reusing the LR2 scene's
 * fallback branch.
 *
 * At the type level, callers can no longer pass `skin` through this constructor — pick `PixiGameplayView` directly
 * when a theme is loaded, or this class when it isn't. The demo's family-routing layer makes that decision once per
 * play.
 */
export class DefaultPixiGameplayView extends PixiGameplayView {
  constructor(options: DefaultPixiGameplayViewOptions = {}) {
    // `skin: undefined` triggers `PixiGameplayView.renderSkin`'s fallback branch which calls
    // `renderFallbackLr2Frame` — see the import in `scene/lr2/gameplay.ts`. `invisibleNoteSkin: undefined` makes the
    // debug invisible-note overlay fall back to a flat green rectangle (no LR2 sprite source to crop from).
    super({ ...options, skin: undefined, invisibleNoteSkin: undefined });
  }
}

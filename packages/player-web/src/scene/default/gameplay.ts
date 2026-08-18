import { PixiGameplayView, type PixiGameplayViewOptions } from '../lr2/gameplay.ts';
import type { SkinlessGameplayChromeRenderer } from '../gameplay-chrome.ts';
import { renderDefaultGameplayFrame } from './gameplay-render.ts';
import { DefaultHudMotion } from './hud-motion.ts';

const hudMotion = new DefaultHudMotion();

const renderDefaultChrome: SkinlessGameplayChromeRenderer = ({
  layer,
  overlayLayer,
  layerPool,
  overlayLayerPool,
  runtime,
}) => {
  renderDefaultGameplayFrame(layer, runtime, { overlayLayer, layerPool, overlayLayerPool, motion: hudMotion });
};

/**
 * Constructor options for {@link DefaultPixiGameplayView}. The skin-bearing fields (`skin`, `invisibleNoteSkin`) are
 * stripped from the LR2 options shape because the default family does not consume them — passing a skin here would
 * defeat the purpose of selecting the default family in the first place. All other gameplay knobs
 * (auto-play, hi-speed, gauge, BGA size, …) are unchanged from {@link PixiGameplayViewOptions} and reach the same
 * engine pipeline; only the visual chrome differs.
 */
export type DefaultPixiGameplayViewOptions = Omit<
  PixiGameplayViewOptions,
  'skin' | 'invisibleNoteSkin' | 'skinlessChromeRenderer'
>;

/**
 * Default-family gameplay scene. Used when the host loaded neither an LR2 theme nor a beatoraja theme, OR explicitly
 * opted into the built-in chrome despite having a theme available (rarely useful, but supported).
 *
 * Implementation note: the class currently shares the common gameplay engine with {@link PixiGameplayView}, but the
 * visual chrome is injected through `skinlessChromeRenderer` from this default-family module. LR2 no longer imports
 * the default renderer, so default-skin visual edits stay under `scene/default/`.
 *
 * At the type level, callers can no longer pass `skin` through this constructor — pick `PixiGameplayView` directly
 * when a theme is loaded, or this class when it isn't. The demo's family-routing layer makes that decision once per
 * play.
 */
export class DefaultPixiGameplayView extends PixiGameplayView {
  constructor(options: DefaultPixiGameplayViewOptions = {}) {
    // `skin: undefined` keeps LR2 atlas rendering disabled; the default family supplies its own chrome renderer via
    // `skinlessChromeRenderer`. `invisibleNoteSkin: undefined` makes the debug invisible-note overlay fall back to a
    // flat green rectangle because there is no LR2 sprite source to crop from.
    super({ ...options, skin: undefined, invisibleNoteSkin: undefined, skinlessChromeRenderer: renderDefaultChrome });
  }
}

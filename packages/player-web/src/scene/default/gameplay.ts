import { PixiGameplayView, type PixiGameplayViewOptions } from '../lr2/gameplay.ts';
import { phantomSkin } from './phantom/index.ts';

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
 * Implementation note: the class currently shares the common gameplay engine with {@link PixiGameplayView}, but every
 * pixel the scene paints itself (HUD chrome, lanes, notes, bombs) comes from the be-music skin passed as `beMusicSkin`
 * — the built-in Phantom skin by default. Skins live under `scene/default/<skin>/`.
 *
 * At the type level, callers can no longer pass `skin` through this constructor — pick `PixiGameplayView` directly
 * when a theme is loaded, or this class when it isn't. The demo's family-routing layer makes that decision once per
 * play.
 */
export class DefaultPixiGameplayView extends PixiGameplayView {
  constructor(options: DefaultPixiGameplayViewOptions = {}) {
    // `skin: undefined` keeps LR2 atlas rendering disabled; the be-music skin supplies the chrome and playfield.
    // `invisibleNoteSkin: undefined` makes the debug invisible-note overlay fall back to a
    // flat green rectangle because there is no LR2 sprite source to crop from.
    super({
      ...options,
      skin: undefined,
      invisibleNoteSkin: undefined,
      skinlessChromeRenderer: undefined,
      beMusicSkin: options.beMusicSkin ?? phantomSkin,
    });
  }
}

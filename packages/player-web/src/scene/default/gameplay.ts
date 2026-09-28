import { CoreGameplayView, type CoreGameplayViewOptions } from '../core/gameplay.ts';
import { phantomSkin } from './phantom/index.ts';

/**
 * Constructor options for {@link DefaultPixiGameplayView}. `skinlessChromeRenderer` is stripped because the default
 * family always paints its chrome through the be-music skin (`beMusicSkin`, the built-in Phantom skin by default). All
 * other gameplay knobs (auto-play, hi-speed, gauge, BGA size, …) are the family-neutral
 * {@link CoreGameplayViewOptions} and reach the same engine pipeline as every other family; only the visual chrome
 * differs.
 */
export type DefaultPixiGameplayViewOptions = Omit<CoreGameplayViewOptions, 'skinlessChromeRenderer'>;

/**
 * Default-family gameplay scene. Used when the host loaded neither an LR2 theme nor a beatoraja theme, OR explicitly
 * opted into the built-in chrome despite having a theme available (rarely useful, but supported).
 *
 * Implementation note: the class is the family-neutral {@link CoreGameplayView} as-is — every pixel the scene paints
 * itself (HUD chrome, lanes, notes, bombs) comes from the be-music skin passed as `beMusicSkin`, the built-in Phantom
 * skin by default. Skins live under `scene/default/<skin>/`.
 *
 * Callers can't pass a theme skin through this constructor — pick the LR2 family's `PixiGameplayView` when a theme is
 * loaded, or this class when it isn't. The demo's family-routing layer makes that decision once per play.
 */
export class DefaultPixiGameplayView extends CoreGameplayView {
  constructor(options: DefaultPixiGameplayViewOptions = {}) {
    super({
      ...options,
      skinlessChromeRenderer: undefined,
      beMusicSkin: options.beMusicSkin ?? phantomSkin,
    });
  }
}

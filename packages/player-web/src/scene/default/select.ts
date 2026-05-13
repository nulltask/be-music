import { PixiSongSelectView, type PixiSongSelectViewOptions } from '../lr2/select.ts';

/**
 * Constructor options for {@link DefaultPixiSongSelectView}. The `skin` field is stripped because the default family
 * doesn't consume an LR2 skin object; everything else (BGM bytes, system sounds, navigation, play-option callbacks)
 * carries over unchanged.
 */
export type DefaultPixiSongSelectViewOptions = Omit<PixiSongSelectViewOptions, 'skin'>;

/**
 * Default-family song-select scene. Used when the host loaded neither an LR2 theme nor a beatoraja theme (the
 * beatoraja select scene is wired separately and takes precedence whenever a beatoraja theme ships a select skin).
 *
 * Like the gameplay wrapper, this class reuses {@link PixiSongSelectView}'s built-in skinless branch
 * (`renderFallbackSelectChrome` + the 640×480 design canvas) until the LR2 scene is migrated to require a non-optional
 * skin. The wrapper exists so the demo's family-routing layer can construct the right scene without sprinkling
 * `skin: undefined` literals through the call sites.
 */
export class DefaultPixiSongSelectView extends PixiSongSelectView {
  constructor(options: DefaultPixiSongSelectViewOptions = {}) {
    super({ ...options, skin: undefined });
  }
}

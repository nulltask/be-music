import { CoreSongSelectView, type CoreSongSelectViewOptions } from '../core/select.ts';

/**
 * Constructor options for {@link DefaultPixiSongSelectView}. The default family doesn't consume a skin-family theme, so
 * this is exactly the shared select options (BGM bytes, system sounds, navigation, play-option callbacks, be-music
 * skin).
 */
export type DefaultPixiSongSelectViewOptions = CoreSongSelectViewOptions;

/**
 * Default-family song-select scene. Used when the host loaded neither an LR2 theme nor a beatoraja theme (the
 * beatoraja select scene is wired separately and takes precedence whenever a beatoraja theme ships a select skin).
 *
 * The family-neutral {@link CoreSongSelectView} already renders through the be-music skin (the 640×480 design canvas)
 * when no theme hook takes over the frame, so this wrapper adds nothing on top — it exists so the demo's family-routing
 * layer can construct the right scene by name.
 */
export class DefaultPixiSongSelectView extends CoreSongSelectView {
  constructor(options: DefaultPixiSongSelectViewOptions = {}) {
    super(options);
  }
}

import { CoreResultView, type CoreResultViewOptions } from '../core/result.ts';

/**
 * Constructor options for {@link DefaultPixiResultView}. No theme skin slot — the default family paints its own
 * built-in result chrome through the be-music skin.
 */
export type DefaultPixiResultViewOptions = CoreResultViewOptions;

/**
 * Default-family result scene. Used when no LR2 / beatoraja theme is loaded. The core result scene's skinless path
 * (be-music skin panel) is exactly the default family's result screen, so no hooks are overridden.
 */
export class DefaultPixiResultView extends CoreResultView {
  constructor(options: DefaultPixiResultViewOptions = {}) {
    super(options);
  }
}

import { PixiResultView, type PixiResultViewOptions } from '../lr2/result.ts';

/**
 * Constructor options for {@link DefaultPixiResultView}. `skin` is stripped — the default family paints its own
 * built-in result chrome.
 */
export type DefaultPixiResultViewOptions = Omit<PixiResultViewOptions, 'skin'>;

/**
 * Default-family result scene. Used when no LR2 / beatoraja theme is loaded. Reuses {@link PixiResultView}'s skinless
 * branch — same transitional structure as the gameplay / select wrappers.
 */
export class DefaultPixiResultView extends PixiResultView {
  constructor(options: DefaultPixiResultViewOptions = {}) {
    super({ ...options, skin: undefined });
  }
}

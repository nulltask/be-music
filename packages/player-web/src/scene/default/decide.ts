import { CoreDecideView, type CoreDecideTarget, type CoreDecideViewOptions } from '../core/decide.ts';

/** Constructor options for {@link DefaultPixiDecideView}. */
export type DefaultPixiDecideViewOptions = CoreDecideViewOptions;

/** What {@link DefaultPixiDecideView.setTarget} names: the chart about to be played and the collection it came from. */
export type DefaultPixiDecideTarget = CoreDecideTarget;

/**
 * Default-family decide scene: the be-music skin's `decide` screen between select and play. Hosts show it only when
 * the skin declares one (`skin.decide`) and go straight to the play otherwise.
 */
export class DefaultPixiDecideView extends CoreDecideView {
  constructor(options: DefaultPixiDecideViewOptions) {
    super(options);
  }
}

import { isBeatorajaSkinIndicator } from '../../browser/drop.ts';
import type { SkinFamily } from '../family.ts';

/**
 * beatoraja skin family. Theme files are identified by the `.luaskin` extension OR a `.json` file under a `skin/`
 * folder (the standard `beatoraja/skin/<name>/…` layout). The two-pronged predicate matches `isBeatorajaSkinIndicator`
 * exactly — see `browser/drop.ts` for the rationale (a stray top-level `info.json` mustn't be misclassified as a
 * theme).
 *
 * Theme parsing is driven by `loadBeatorajaThemeFromFiles` in `skin/beatoraja/theme.ts`, which produces a
 * `BeatorajaThemeBundle`. Scenes live under `scene/beatoraja/` and are constructed directly by the host.
 */
export const beatorajaSkinFamily: SkinFamily = {
  id: 'beatoraja',
  label: 'beatoraja',
  matchesThemeFile(path) {
    return isBeatorajaSkinIndicator(path);
  },
};

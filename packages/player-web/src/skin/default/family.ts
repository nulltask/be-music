import type { SkinFamily } from '../family.ts';

/**
 * Default skin family. Returned by `SkinFamilyRegistry` as the fallthrough when no other family claims a chart — it
 * has no theme files of its own, so it deliberately omits `matchesThemeFile`. Hosts pick this family when:
 *
 * - the user dropped charts without dropping any theme bundle, OR
 * - the dropped theme(s) don't cover the chart's key mode (e.g. a 9-key chart and an LR2 theme that ships only
 *   `play_7.lr2skin` — the LR2 path takes over, but at the gameplay scene it falls back to this family's chrome).
 *
 * Scene classes for this family live under `scene/default/` (`DefaultPixiGameplayView` /
 * `DefaultPixiSongSelectView` / `DefaultPixiResultView`). Decide reuses `PixiDecideView` without a skin so the
 * default family can wipe-close into gameplay; hosts that mix default decide with an LR2 play skin still skip the
 * splash.
 */
export const defaultSkinFamily: SkinFamily = {
  id: 'default',
  label: 'Default',
  // Intentionally no `matchesThemeFile` — default is the fallthrough, never selected by drop routing.
};

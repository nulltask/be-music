import { isLr2SkinFilePath } from '../../browser/drop.ts';
import type { SkinFamily } from '../family.ts';

/**
 * LR2 skin family. Theme files are identified by the `.lr2skin` extension — every LR2 theme bundle ships at least one
 * (typically `select.lr2skin` + per-key-mode `play_*.lr2skin` + `decide.lr2skin` + `result.lr2skin`). The host invokes
 * `@be-music/lr2-skin`'s `loadLr2ThemeSkinsFromFiles` to parse the bundle into discrete `Lr2Skin` objects.
 *
 * Scene classes (`PixiSongSelectView`, `PixiDecideView`, `PixiGameplayView`, `PixiResultView`) live in
 * `scene/lr2/` and are constructed directly by the host. This family object exists for theme-file routing and
 * registry lookups, not as a scene factory — see `skin/family.ts`'s scope note.
 */
export const lr2SkinFamily: SkinFamily = {
  id: 'lr2',
  label: 'LR2',
  matchesThemeFile(path) {
    return isLr2SkinFilePath(path);
  },
};

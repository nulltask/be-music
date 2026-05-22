import type { SkinFamilyId } from '@be-music/player-web/skin';
import type { BeatorajaThemeBundle } from '@be-music/player-web/skin';
import type { BrowserSongEntry } from '@be-music/player-web/collection';
import { pickLr2PlaySkin, type Lr2PlaySkinMap, type Lr2Skin } from '@be-music/lr2-skin';
import type { SkinFamilyOverride, SkinFamilySceneKind } from './types.ts';
import { canPlaySongBeatoraja } from './chart-shape.ts';

/**
 * Read-only state snapshot the family-dispatch helpers operate on. The demo's `PlayerWebDemoApp` builds one of these
 * inline (see its `familyDispatchState()` helper) so its private theme / skin fields stay private — these functions
 * stay pure and easy to unit-test in isolation.
 */
export interface FamilyDispatchState {
  readonly beatorajaTheme: BeatorajaThemeBundle | undefined;
  readonly selectSkin: Lr2Skin | undefined;
  readonly decideSkin: Lr2Skin | undefined;
  readonly resultSkin: Lr2Skin | undefined;
  readonly playSkins: Lr2PlaySkinMap;
  readonly skinFamilyOverride: SkinFamilyOverride;
}

/**
 * Returns the set of skin families that can render the given scene with the currently-loaded assets. `'default'`
 * is always present (it's the catch-all chrome with no asset dependency); `'lr2'` and `'beatoraja'` only appear
 * when the matching theme actually ships a skin for that scene type — passing `song` matters for `'gameplay'`
 * (the beatoraja path needs a play-variant skin compatible with the chart's key mode) and `'decide'` (skip
 * entirely when the beatoraja theme has no decide skin) where the per-chart availability differs from the
 * per-theme availability.
 */
export function availableFamiliesForScene(
  state: FamilyDispatchState,
  scene: SkinFamilySceneKind,
  song?: BrowserSongEntry,
): Set<SkinFamilyId> {
  const available = new Set<SkinFamilyId>(['default']);
  // Beatoraja availability per scene. The play scene additionally needs a chart so we can check whether the
  // theme has a play-variant skin compatible with this chart's key mode.
  const beatorajaTheme = state.beatorajaTheme?.theme;
  if (beatorajaTheme !== undefined) {
    if (scene === 'select' && beatorajaTheme.selectSkin !== undefined) available.add('beatoraja');
    else if (scene === 'decide' && beatorajaTheme.decideSkin !== undefined) available.add('beatoraja');
    else if (scene === 'result' && beatorajaTheme.resultSkin !== undefined) available.add('beatoraja');
    else if (scene === 'gameplay' && song !== undefined && canPlaySongBeatoraja(state.beatorajaTheme, song)) {
      available.add('beatoraja');
    }
  }
  // LR2 availability per scene. The play scene needs an LR2 skin for the chart's variant — if `pickLr2PlaySkin`
  // returns `undefined` the play path would fall through to the default-family scene anyway, so it's correct to
  // mark LR2 unavailable here. The other scenes consult the slot directly because every LR2 theme can ship a
  // partial set (e.g. a play-only theme has no `selectSkin`).
  if (scene === 'select' && state.selectSkin !== undefined) available.add('lr2');
  else if (scene === 'decide' && state.decideSkin !== undefined) available.add('lr2');
  else if (scene === 'result' && state.resultSkin !== undefined) available.add('lr2');
  else if (scene === 'gameplay' && song !== undefined && pickLr2PlaySkin(state.playSkins, song) !== undefined) {
    available.add('lr2');
  }
  return available;
}

/**
 * Pick the family that should actually render the given scene right now. Honours the user's Debug Menu pick
 * (`state.skinFamilyOverride`) when it's available for this scene; otherwise falls through to the auto
 * priority. Auto priority is:
 *
 *   beatoraja  →  lr2  →  default
 *
 * The order matches the legacy implicit behaviour (beatoraja was the first branch in every scene dispatcher,
 * LR2 second with internal fallback, default emerged as the bottom layer). Explicit override values that aren't
 * available for the scene fall through to `'default'` rather than the auto chain — picking `'beatoraja'` when
 * no beatoraja decide skin is loaded shouldn't silently land on the LR2 decide scene.
 */
export function pickActiveFamilyForScene(
  state: FamilyDispatchState,
  scene: SkinFamilySceneKind,
  song?: BrowserSongEntry,
): SkinFamilyId {
  const available = availableFamiliesForScene(state, scene, song);
  const override = state.skinFamilyOverride;
  if (override !== 'auto') {
    return available.has(override) ? override : 'default';
  }
  if (available.has('beatoraja')) return 'beatoraja';
  if (available.has('lr2')) return 'lr2';
  return 'default';
}

/**
 * Subset of {@link FamilyDispatchState} {@link hasAnyLr2Skin} actually reads. Lets callers pass a snapshot that
 * doesn't carry the beatoraja / override fields (e.g. when probing inside `rebuildSkinFamilyPicker`).
 */
export type Lr2SkinPresence = Pick<FamilyDispatchState, 'selectSkin' | 'decideSkin' | 'resultSkin' | 'playSkins'>;

/**
 * Returns `true` when any LR2 skin asset is loaded — used by `rebuildSkinFamilyPicker` to decide whether the
 * `'LR2'` dropdown entry should be enabled. A play-only theme without `selectSkin` still counts: the gameplay
 * scene will paint LR2 chrome even though the select stays on the default family.
 */
export function hasAnyLr2Skin(state: Lr2SkinPresence): boolean {
  if (state.selectSkin !== undefined) return true;
  if (state.decideSkin !== undefined) return true;
  if (state.resultSkin !== undefined) return true;
  return Object.keys(state.playSkins).length > 0;
}

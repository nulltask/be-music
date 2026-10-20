import type {
  BGAMode,
  BGASize,
  BrowseSort,
  DifficultyFilter,
  HiddenSuddenMode,
  HSFix,
  KeysFilter,
  PlayOptions,
  RandomMode,
} from '@be-music/scene-model';
import type { GaugeType } from '@be-music/player/ruleset';

/**
 * Per-session gameplay tweaks the player picks on the select screen (`PlayOptions` of `@be-music/scene-model`):
 * hi-speed, autoplay, note arrangement, gauge type, HIDDEN / SUDDEN and the lane cover, BGA display, and the list's
 * sort and filters. The host owns the live values and hands them to every play it launches; be-music skins read them
 * from `BeMusicSelectFrame.playOptions` / `BeMusicDecideFrame.playOptions` and change them through
 * `BeMusicSelectActions.setPlayOption` / `cyclePlayOption`.
 */
export type BeMusicPlayOptions = PlayOptions;

/** Allowed values for {@link BeMusicPlayOptions.difficultyFilter}. */
export type BeMusicDifficultyFilter = DifficultyFilter;

/** Allowed values for {@link BeMusicPlayOptions.keysFilter}. */
export type BeMusicKeysFilter = KeysFilter;

/** Allowed values for {@link BeMusicPlayOptions.sort}. */
export type BeMusicSelectSort = BrowseSort;

/** Allowed values for {@link BeMusicPlayOptions.hsFix}. */
export type BeMusicHSFix = HSFix;

/** Allowed values for {@link BeMusicPlayOptions.hiddenSudden1P} / `hiddenSudden2P`. */
export type BeMusicHiddenSudden = HiddenSuddenMode;

/** Allowed values for {@link BeMusicPlayOptions.random1P} / `random2P`. */
export type BeMusicRandomMode = RandomMode;

/** Allowed values for {@link BeMusicPlayOptions.gauge1P} / `gauge2P`: the gauge type of `@be-music/player/ruleset`. */
export type BeMusicGaugeType = GaugeType;

/** Allowed values for {@link BeMusicPlayOptions.bga}. */
export type BeMusicBGAMode = BGAMode;

/** Allowed values for {@link BeMusicPlayOptions.bgaSize}. */
export type BeMusicBGASize = BGASize;

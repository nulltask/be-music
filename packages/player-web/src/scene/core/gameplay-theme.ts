/**
 * The vocabulary of the theme hooks of the LR2 gameplay scene's base (`CoreGameplayView`): the BGA rects, lane rects,
 * note cells and scene timing a theme family supplies, in the view contract's types, and the scene moments it reacts to.
 * `CoreGameplayView` answers the shared playfield and the play session from its hooks (`PlayfieldSkin`,
 * `PlaySessionTheme`); `gameplay.ts` re-exports these for the theme families.
 */

import type { PlayMoment } from '../../session/play/play-session-theme.ts';
import type {
  PlayfieldBgaTarget,
  PlayfieldCell,
  PlayfieldLaneRect,
  PlayfieldNoteKind,
  PlayfieldStage,
  PlayViewTiming,
} from '../../view/types.ts';

/** One rectangle the chart's BGA is composited into (`PlayfieldBgaTarget`). */
export type GameplayBgaTarget = PlayfieldBgaTarget;

/** Design canvas of the scene (`PlayfieldStage`). */
export type GameplayStageSize = PlayfieldStage;

/** Lane rectangle in design pixels (`PlayfieldLaneRect`). */
export type GameplayLaneRect = PlayfieldLaneRect;

/** Note-sprite slots a theme can supply textures for (`PlayfieldNoteKind`). */
export type GameplayThemeNoteKind = PlayfieldNoteKind;

/** Theme-supplied cell for one note sprite (`PlayfieldCell`). */
export type GameplayThemeNoteCell = PlayfieldCell;

/** Scene timing a theme authors (`PlayViewTiming`). */
export type GameplayThemeTiming = PlayViewTiming;

/**
 * Scene moments a theme can react to (the LR2 family stamps its skin timers from these): the play's moments, and a bomb
 * the playfield retired. `at` is the {@link CoreGameplayView.playClock} value the scene recorded for the moment.
 */
export type GameplayThemeEvent = PlayMoment | { kind: 'bomb-retired'; channel: string };

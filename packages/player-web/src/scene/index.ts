/**
 * Barrel for the `@be-music/player-web/scenes` subpath. Re-exports every scene class + the shared `PixiSceneHost`
 * primitive that owns the renderer. Importers that only need scene rendering should reach for this barrel directly so
 * they don't pull in unrelated skin / chart / collection symbols.
 *
 * Private scene helpers (`perf`, `pixi-utils`, gameplay sub-modules) stay internal to the package — they
 * compose the scene classes' implementations and aren't part of the public contract.
 */
export * from './host.ts';

// Hi-speed range shared by every family's select and gameplay scenes (and hosts that remember the player's pick).
export { DEFAULT_HISPEED, HISPEED_MAX, HISPEED_MIN, HISPEED_STEP, snapHiSpeed } from './hi-speed.ts';

// The course a scene shows (select bar under the cursor, running course stage, course result).
export * from './course-info.ts';

// Default family — built-in chrome when neither LR2 nor beatoraja themes are loaded.
export * from './default/index.ts';

// LR2 family — Lunatic Rave 2 skin-driven scenes.
// The LR2 select skin's default search box (the select screen is `createSelectScene`'s, below).
export { isInsideLr2DefaultSearchBox, type Lr2DefaultSearchBoxHitTestInput } from '../view/lr2/select-view.ts';
// The select scenes' play options and browse helpers under the names they were exported with, now the models of
// `@be-music/scene-model`.
export { DEFAULT_PLAY_OPTIONS, matchesSearchQuery, wrappedCursorDelta } from '@be-music/scene-model';
export type {
  BgaMode as PixiBgaMode,
  BgaSize as PixiBgaSize,
  BrowseSort as PixiSelectSort,
  DifficultyFilter as PixiDifficultyFilter,
  HiddenSuddenMode as PixiHiddenSudden,
  HsFix as PixiHsFix,
  KeysFilter as PixiKeysFilter,
  PlayOptions as PixiPlayOptions,
  RandomMode as PixiRandomMode,
} from '@be-music/scene-model';

// What a finished play hands its result screen (the play scene's `progress()` and `on.finish`).
export type { GaugeHistorySample, PixiGameplayResultData, ScoreHistorySample } from './core/result-data.ts';

// beatoraja family — beatoraja Lua skin-driven scenes.
export * from '../view/beatoraja/play/bga.ts';
export * from '../view/beatoraja/play/markers.ts';
export * from '../view/beatoraja/play/notes.ts';
export * from './beatoraja/skin-view.ts';

// Scene sessions and family views (ADR 0001): the kit a host hands each skin family, the frames and intents between a
// session and its view, and the scene that pairs them.
export type * from '../host/family-kit.ts';
export type * from '../view/types.ts';
export {
  SessionScene,
  type SceneSession,
  type SessionKeyEvent,
  type SessionKeyTarget,
  type SessionSceneOptions,
} from '../session/session-scene.ts';

// The host API: each screen as a scene, made of its session and the view of the kit's family.
export { createDecideScene, type DecideScene, type DecideSceneKit, type DecideSceneOptions } from '../host/decide.ts';
export type { DecideSessionEvents } from '../session/decide/decide-session.ts';
export { createResultScene, type ResultScene, type ResultSceneKit, type ResultSceneOptions } from '../host/result.ts';
export type { ResultSessionEvents } from '../session/result/result-session.ts';
export {
  createPlayScene,
  type PlayScene,
  type PlaySceneCourse,
  type PlaySceneEvents,
  type PlaySceneKit,
  type PlaySceneOptions,
  type PlaySceneRecording,
  type PlaySceneSettings,
} from '../host/play.ts';
export {
  createSelectScene,
  type SelectScene,
  type SelectSceneEvents,
  type SelectSceneKit,
  type SelectSceneOptions,
} from '../host/select.ts';
export type { SelectCourseMaker, SelectSessionEvents, SelectStartEntry } from '../session/select/select-session.ts';

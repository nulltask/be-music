/**
 * Barrel for the `@be-music/player-web/scenes` subpath: the host API (`createSelectScene` and its siblings), the shared
 * `PixiSceneHost` primitive that owns the renderer, and the kits, frames and views the scenes are made of. Importers
 * that only need scene rendering should reach for this barrel directly so they don't pull in unrelated skin / chart /
 * collection symbols.
 *
 * The subpath keeps its published name, `./scenes`, while its barrel is the host layer's (`src/host/`).
 *
 * Private helpers (`stage/`, `view/shared/`, the play session's modules) stay internal to the package — they compose
 * the scenes' implementations and aren't part of the public contract.
 */
import type { PlayResult } from '@be-music/scene-model';

export * from './scene-host.ts';

// Hi-speed range shared by every family's select and gameplay scenes (and hosts that remember the player's pick): the
// play options model of `@be-music/scene-model`.
export { DEFAULT_HISPEED, HISPEED_MAX, HISPEED_MIN, HISPEED_STEP, snapHiSpeed } from '@be-music/scene-model';

// The course a scene shows (select bar under the cursor, running course stage, course result): the course view model of
// `@be-music/scene-model`, under the names the scenes have always used.
export {
  resolveCourseView as resolveSceneCourseInfo,
  type CourseStageView as SceneCourseStageInfo,
  type CourseView as SceneCourseInfo,
} from '@be-music/scene-model';

// Default family — the built-in be-music skins, drawn when neither an LR2 nor a beatoraja theme is loaded, or when a
// loaded theme doesn't cover the scene or the chart's variant.
// The Phantom chrome's long-standing standalone entry points (kept for hosts that call them directly).
export {
  renderDefaultGameplayFrame,
  renderFallbackLr2Frame,
  type FallbackGameplayRenderOptions,
  type FallbackGameplayRuntime,
} from '../skins/phantom/chrome.ts';
export { latticeSkin } from '../skins/lattice/index.ts';
export { phantomSkin } from '../skins/phantom/index.ts';
export { plainSkin } from '../skins/plain/index.ts';
export { synesthesiaSkin } from '../skins/synesthesia/index.ts';
export { BUILT_IN_BE_MUSIC_SKINS } from '../skins/built-in.ts';

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

// What a finished play hands its result screen (the play scene's `progress()` and `on.finish`): the play result of
// `@be-music/scene-model`. The history samples are skin-sdk's names for it, which `./skin` re-exports too.
export type { GaugeHistorySample, ScoreHistorySample } from '@be-music/skin-sdk';
/** `PlayResult` of `@be-music/scene-model`, under the name the scenes have exported it with. */
export type PixiGameplayResultData = PlayResult;

// beatoraja family — beatoraja Lua skin-driven scenes.
export * from '../view/beatoraja/play/bga.ts';
export type { BeatorajaMarkerBeats } from '../chart/beatoraja/markers.ts';
export * from '../view/beatoraja/play/markers.ts';
export * from '../view/beatoraja/play/notes.ts';
export * from '../view/beatoraja/skin-view.ts';

// Scene sessions and family views (ADR 0001): the kit a host hands each skin family, the frames and intents between a
// session and its view, and the scene that pairs them.
export type * from './family-kit.ts';
export type * from '../view/types.ts';
export {
  SessionScene,
  type SceneSession,
  type SessionKeyEvent,
  type SessionKeyTarget,
  type SessionSceneOptions,
} from '../session/session-scene.ts';

// The host API: each screen as a scene, made of its session and the view of the kit's family.
export { createDecideScene, type DecideScene, type DecideSceneKit, type DecideSceneOptions } from './decide.ts';
export type { DecideSessionEvents } from '../session/decide/decide-session.ts';
export { createResultScene, type ResultScene, type ResultSceneKit, type ResultSceneOptions } from './result.ts';
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
} from './play.ts';
export {
  createSelectScene,
  type SelectScene,
  type SelectSceneEvents,
  type SelectSceneKit,
  type SelectSceneOptions,
} from './select.ts';
export type { SelectCourseMaker, SelectSessionEvents, SelectStartEntry } from '../session/select/select-session.ts';

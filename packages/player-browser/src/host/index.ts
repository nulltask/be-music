/**
 * Barrel for the `@be-music/player-browser/host` entry: the host API. `PixiSceneHost` owns the renderer and shows one
 * `PixiScene` at a time; `createSelectScene`, `createDecideScene`, `createPlayScene` and `createResultScene` make each
 * screen as a `SessionScene`, from the kit of a skin family and the scene's options. The family kit types, the view
 * contract types and the sessions' events are exported with them.
 *
 * The models the scenes take and hand back (play options, `PlayResult`, `CourseView`, the hi-speed range) are
 * `@be-music/player-scene-model`'s, and the built-in be-music skins are on `./skin`. Controllers are also available without a renderer from `./controller`. The sessions, views and layers under them
 * (`session/`, `view/`, `stage/`) stay internal to the package.
 */
export * from './scene-host.ts';

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

export { SceneController, createSelectController, type SceneStore } from './controllers.ts';

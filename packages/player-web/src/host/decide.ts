/**
 * The host API for the decide screen: `createDecideScene(kit, options)` pairs the decide session with the view of the
 * kit's family and returns the scene to show with `PixiSceneHost.setScene`.
 */

import type { CourseView, LibraryChart, PlayOptions, SystemSoundSet } from '@be-music/scene-model';
import type { BrowserSongAssetSource } from '../collection/types.ts';
import type { AudioService } from '../runtime/audio-service.ts';
import { DecideSession, type DecideSessionEvents } from '../session/decide/decide-session.ts';
import { SessionScene, type SessionSceneOptions } from '../session/session-scene.ts';
import { BuiltInDecideView } from '../view/built-in/decide-view.ts';
import type { DecideFrame, DecideIntent } from '../view/types.ts';
import type { BuiltInKit } from './family-kit.ts';

/**
 * The kits the decide scene takes. The LR2 and beatoraja decide screens are still `PixiDecideView` and
 * `PixiBeatorajaDecideScene`.
 */
export type DecideSceneKit = BuiltInKit;

export interface DecideSceneOptions extends SessionSceneOptions {
  /** The chart about to be played. */
  readonly chart: LibraryChart;
  /** The course and the stage about to be played, for a course stage. */
  readonly course?: CourseView;
  /** The options the play will run with, as the skin shows them. Defaults to `DEFAULT_PLAY_OPTIONS`. */
  readonly playOptions?: PlayOptions;
  /** Where the chart's files are, for the images a skin shows. */
  readonly source?: BrowserSongAssetSource;
  /** The theme's sounds: the screen plays `decideBgm`, its jingle, and stops it as it leaves. */
  readonly sounds: SystemSoundSet;
  readonly audio: AudioService;
  /** How far the play prepared behind the screen has loaded, 0..1, read every frame. */
  readonly progress?: () => number | undefined;
  /** Where the screen leads: the play (`continue`) or back to select (`cancel`); each fires once per entry. */
  readonly on: DecideSessionEvents;
}

/** The decide screen as a scene. */
export interface DecideScene extends SessionScene<DecideFrame, DecideIntent> {
  /** Takes the player's new settings for the kit's skin; the next frame draws with them. */
  updateKit(kit: DecideSceneKit): void;
}

class BuiltInDecideScene extends SessionScene<DecideFrame, DecideIntent> implements DecideScene {
  private readonly decideView: BuiltInDecideView;

  public constructor(session: DecideSession, view: BuiltInDecideView, options: SessionSceneOptions) {
    super(session, view, options);
    this.decideView = view;
  }

  public updateKit(kit: DecideSceneKit): void {
    this.decideView.updateKit(kit);
  }
}

/**
 * The decide screen for `kit`: the session times it, plays the decide jingle and says where it leads; the kit's family
 * view draws it. Show it with `PixiSceneHost.setScene`, and dispose it once it is gone.
 */
export function createDecideScene(kit: DecideSceneKit, options: DecideSceneOptions): DecideScene {
  const view = new BuiltInDecideView(kit, options.source !== undefined ? { source: options.source } : {});
  const session = new DecideSession({
    chart: options.chart,
    ...(options.course !== undefined ? { course: options.course } : {}),
    ...(options.playOptions !== undefined ? { playOptions: options.playOptions } : {}),
    sounds: options.sounds,
    audio: options.audio,
    timing: view.timing,
    ...(options.progress !== undefined ? { progress: options.progress } : {}),
    on: options.on,
  });
  return new BuiltInDecideScene(session, view, {
    ...(options.keyTarget !== undefined ? { keyTarget: options.keyTarget } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
}

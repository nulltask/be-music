/**
 * The host API for the result screen: `createResultScene(kit, options)` pairs the result session with the view of the
 * kit's family and returns the scene to show with `PixiSceneHost.setScene`.
 */

import type { PlayResult, PlayRunKind, SystemSoundSet } from '@be-music/scene-model';
import type { BrowserSongAssetSource } from '../collection/types.ts';
import type { AudioService } from '../runtime/audio-service.ts';
import { ResultSession, type ResultSessionEvents } from '../session/result/result-session.ts';
import { SessionScene, type SessionSceneOptions } from '../session/session-scene.ts';
import { BuiltInResultView } from '../view/built-in/result-view.ts';
import type { ResultFrame, ResultIntent } from '../view/types.ts';
import type { BuiltInKit } from './family-kit.ts';

/**
 * The kits the result scene takes. The LR2 and beatoraja result screens are still `PixiResultView` and
 * `PixiBeatorajaResultScene`.
 */
export type ResultSceneKit = BuiltInKit;

export interface ResultSceneOptions extends SessionSceneOptions {
  /** The play (or the course run) the screen shows. */
  readonly result: PlayResult;
  /**
   * Which play the result is of, when `result.run` does not say (a course stage's result): a course run plays the course
   * jingles, and only a single play or a NONSTOP run offers a quick retry.
   */
  readonly run?: PlayRunKind;
  /** Where the result's chart files are, for the images a skin shows. */
  readonly source?: BrowserSongAssetSource;
  /** The theme's sounds: the screen plays its clear, fail or result jingle and stops it as it leaves. */
  readonly sounds: SystemSoundSet;
  readonly audio: AudioService;
  /**
   * Where the screen leads: `continue` when the player is done, `retry` to play the chart again (R). Without `retry`
   * the screen offers no quick retry. Each fires once per entry.
   */
  readonly on: ResultSessionEvents;
}

/** The result screen as a scene. */
export interface ResultScene extends SessionScene<ResultFrame, ResultIntent> {
  /** Takes the player's new settings for the kit's skin; the next frame draws with them. */
  updateKit(kit: ResultSceneKit): void;
}

class BuiltInResultScene extends SessionScene<ResultFrame, ResultIntent> implements ResultScene {
  private readonly resultView: BuiltInResultView;

  public constructor(session: ResultSession, view: BuiltInResultView, options: SessionSceneOptions) {
    super(session, view, options);
    this.resultView = view;
  }

  public updateKit(kit: ResultSceneKit): void {
    this.resultView.updateKit(kit);
  }
}

/**
 * The result screen for `kit`: the session plays the result's jingle, steps the screen as the player presses and says
 * where it leads; the kit's family view draws it. Show it with `PixiSceneHost.setScene`, and dispose it once it is gone.
 */
export function createResultScene(kit: ResultSceneKit, options: ResultSceneOptions): ResultScene {
  const view = new BuiltInResultView(kit, options.source !== undefined ? { source: options.source } : {});
  const session = new ResultSession({
    result: options.result,
    ...(options.run !== undefined ? { run: options.run } : {}),
    sounds: options.sounds,
    audio: options.audio,
    timing: view.timing,
    on: options.on,
  });
  return new BuiltInResultScene(session, view, {
    ...(options.keyTarget !== undefined ? { keyTarget: options.keyTarget } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
}

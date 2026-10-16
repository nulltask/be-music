/**
 * The host API for the result screen: `createResultScene(kit, options)` pairs the result session with the view of the
 * kit's family and returns the scene to show with `PixiSceneHost.setScene`.
 */

import type { PlayResult, PlayRunKind, SystemSoundSet } from '@be-music/scene-model';
import type { BrowserSongAssetSource } from '../collection/types.ts';
import type { AudioService } from '../runtime/audio-service.ts';
import { ResultSession, type ResultSessionEvents } from '../session/result/result-session.ts';
import { SessionScene, type SessionSceneOptions } from '../session/session-scene.ts';
import { logger } from '../logger.ts';
import { BuiltInResultView } from '../view/built-in/result-view.ts';
import { Lr2ResultView } from '../view/lr2/result-view.ts';
import type { ResultFrame, ResultIntent, ResultView } from '../view/types.ts';
import type { BuiltInKit, Lr2Kit } from './family-kit.ts';

const log = logger('result');

/**
 * The kits the result scene takes: a be-music skin, or an LR2 result skin (the course-result skin for a course run).
 * The beatoraja result screen is still `PixiBeatorajaResultScene`.
 */
export type ResultSceneKit = BuiltInKit | Lr2Kit;

export interface ResultSceneOptions extends SessionSceneOptions {
  /**
   * The play (or the course run) the screen shows. An LR2 skin shows the course of `result.course` (its ops, numbers and
   * texts): the course a stage belongs to, with the stage, or the course run.
   */
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
  /**
   * Takes the player's new settings for the kit's skin; the next frame draws with them. The scene keeps its family and
   * its skin: a kit of another family or skin is ignored.
   */
  updateKit(kit: ResultSceneKit): void;
}

/** A family's result view, and how it takes a new kit. */
interface FamilyResultView {
  readonly view: ResultView;
  updateKit(kit: ResultSceneKit): void;
}

/** The result view of `kit`'s family, reading the chart's files from `source`. */
function createResultView(kit: ResultSceneKit, source: BrowserSongAssetSource | undefined): FamilyResultView {
  const options = source !== undefined ? { source } : {};
  if (kit.family === 'lr2') {
    const view = new Lr2ResultView(kit, options);
    return {
      view,
      updateKit: (next) => (next.family === 'lr2' ? view.updateKit(next) : ignoreKit(next, 'lr2')),
    };
  }
  const view = new BuiltInResultView(kit, options);
  return {
    view,
    updateKit: (next) => (next.family === 'built-in' ? view.updateKit(next) : ignoreKit(next, 'built-in')),
  };
}

function ignoreKit(kit: ResultSceneKit, family: ResultSceneKit['family']): void {
  log.warn(`a ${family} result scene keeps its family; ignoring a ${kit.family} kit`);
}

class FamilyResultScene extends SessionScene<ResultFrame, ResultIntent> implements ResultScene {
  private readonly familyView: FamilyResultView;

  public constructor(session: ResultSession, familyView: FamilyResultView, options: SessionSceneOptions) {
    super(session, familyView.view, options);
    this.familyView = familyView;
  }

  public updateKit(kit: ResultSceneKit): void {
    this.familyView.updateKit(kit);
  }
}

/**
 * The result screen for `kit`: the session plays the result's jingle, steps the screen as the player presses and says
 * where it leads; the kit's family view draws it. Show it with `PixiSceneHost.setScene`, and dispose it once it is gone.
 */
export function createResultScene(kit: ResultSceneKit, options: ResultSceneOptions): ResultScene {
  const familyView = createResultView(kit, options.source);
  const { view } = familyView;
  const session = new ResultSession({
    result: options.result,
    ...(options.run !== undefined ? { run: options.run } : {}),
    sounds: options.sounds,
    audio: options.audio,
    timing: view.timing,
    on: options.on,
  });
  return new FamilyResultScene(session, familyView, {
    ...(options.keyTarget !== undefined ? { keyTarget: options.keyTarget } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
}

/**
 * The host API for the decide screen: `createDecideScene(kit, options)` pairs the decide session with the view of the
 * kit's family and returns the scene to show with `PixiSceneHost.setScene`.
 */

import type { ResolvedPlayChart } from '@be-music/player/core/engine';
import type { CourseView, LibraryChart, PlayOptions, SystemSoundSet } from '@be-music/scene-model';
import type { BrowserSongAssetSource } from '../collection/types.ts';
import type { AudioService } from '../runtime/audio-service.ts';
import { DecideSession, type DecideSessionEvents } from '../session/decide/decide-session.ts';
import { SessionScene, type SessionSceneOptions } from '../session/session-scene.ts';
import { logger } from '../logger.ts';
import { BuiltInDecideView } from '../view/built-in/decide-view.ts';
import { Lr2DecideView } from '../view/lr2/decide-view.ts';
import type { DecideFrame, DecideIntent, DecideView } from '../view/types.ts';
import type { BuiltInKit, Lr2Kit } from './family-kit.ts';

const log = logger('decide');

/**
 * The kits the decide scene takes: a be-music skin, or an LR2 decide skin. The beatoraja decide screen is still
 * `PixiBeatorajaDecideScene`.
 */
export type DecideSceneKit = BuiltInKit | Lr2Kit;

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
  /** The random source the chart's `#RANDOM` / `#SWITCH` branches are drawn with. Defaults to `Math.random`. */
  readonly random?: () => number;
  /** Where the screen leads: the play (`continue`) or back to select (`cancel`); each fires once per entry. */
  readonly on: DecideSessionEvents;
}

/** The decide screen as a scene. */
export interface DecideScene extends SessionScene<DecideFrame, DecideIntent> {
  /**
   * The chart as the play will play it: its `#RANDOM` / `#SWITCH` branches drawn once, when the scene was made, with the
   * draws. The screen shows these branches; hand it to the play (`preResolved`) so the play plays them too.
   */
  readonly resolved: ResolvedPlayChart;
  /**
   * Takes the player's new settings for the kit's skin; the next frame draws with them. The scene keeps its family and
   * its skin: a kit of another family or skin is ignored.
   */
  updateKit(kit: DecideSceneKit): void;
}

/** A family's decide view, and how it takes a new kit. */
interface FamilyDecideView {
  readonly view: DecideView;
  updateKit(kit: DecideSceneKit): void;
}

/** The decide view of `kit`'s family, reading the chart's files from `source`. */
function createDecideView(kit: DecideSceneKit, source: BrowserSongAssetSource | undefined): FamilyDecideView {
  const options = source !== undefined ? { source } : {};
  if (kit.family === 'lr2') {
    const view = new Lr2DecideView(kit, options);
    return {
      view,
      updateKit: (next) => (next.family === 'lr2' ? view.updateKit(next) : ignoreKit(next, 'lr2')),
    };
  }
  const view = new BuiltInDecideView(kit, options);
  return {
    view,
    updateKit: (next) => (next.family === 'built-in' ? view.updateKit(next) : ignoreKit(next, 'built-in')),
  };
}

function ignoreKit(kit: DecideSceneKit, family: DecideSceneKit['family']): void {
  log.warn(`a ${family} decide scene keeps its family; ignoring a ${kit.family} kit`);
}

class FamilyDecideScene extends SessionScene<DecideFrame, DecideIntent> implements DecideScene {
  public readonly resolved: ResolvedPlayChart;
  private readonly familyView: FamilyDecideView;

  public constructor(session: DecideSession, familyView: FamilyDecideView, options: SessionSceneOptions) {
    super(session, familyView.view, options);
    this.resolved = session.resolved;
    this.familyView = familyView;
  }

  public updateKit(kit: DecideSceneKit): void {
    this.familyView.updateKit(kit);
  }
}

/**
 * The decide screen for `kit`: the session times it, plays the decide jingle and says where it leads; the kit's family
 * view draws it. Show it with `PixiSceneHost.setScene`, and dispose it once it is gone.
 */
export function createDecideScene(kit: DecideSceneKit, options: DecideSceneOptions): DecideScene {
  const familyView = createDecideView(kit, options.source);
  const { view } = familyView;
  const session = new DecideSession({
    chart: options.chart,
    ...(options.course !== undefined ? { course: options.course } : {}),
    ...(options.playOptions !== undefined ? { playOptions: options.playOptions } : {}),
    sounds: options.sounds,
    audio: options.audio,
    timing: view.timing,
    ...(options.progress !== undefined ? { progress: options.progress } : {}),
    ...(options.random !== undefined ? { random: options.random } : {}),
    on: options.on,
  });
  return new FamilyDecideScene(session, familyView, {
    ...(options.keyTarget !== undefined ? { keyTarget: options.keyTarget } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
}

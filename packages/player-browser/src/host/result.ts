/**
 * The host API for the result screen: `createResultScene(kit, options)` pairs the result session with the view of the
 * kit's family and returns the scene to show with `PixiSceneHost.setScene`.
 */

import { DOMResultView } from '../view/built-in/dom-view.ts';
import type { BeMusicJSON } from '@be-music/chart-source';
import type { PlayResult, PlayRunKind, ReplaySlotState, SystemSoundSet } from '@be-music/player-scene-model';
import type { BrowserAssetSource } from '../collection/types.ts';
import type { AudioService } from '../runtime/audio-service.ts';
import { ResultSession, type ResultSessionEvents } from '../session/result/result-session.ts';
import { SessionScene, type SessionSceneOptions } from '../session/session-scene.ts';
import { logger } from '../logger.ts';
import { BeatorajaResultView, resolveBeatorajaResultTiming } from '../view/beatoraja/result-view.ts';
import { BUILT_IN_RESULT_TIMING, BuiltInResultView } from '../view/built-in/result-view.ts';
import { LR2ResultView, resolveLR2ResultTiming } from '../view/lr2/result-view.ts';
import type { ResultFrame, ResultIntent, ResultView, ResultViewTiming } from '../view/types.ts';
import type { ResultKit } from './family-kit.ts';

const log = logger('result');

/**
 * The kits the result scene takes: a be-music skin, an LR2 result skin (the course-result skin for a course run), or a
 * beatoraja theme's result entry (its course-result entry for a course run), loaded with `loadBeatorajaSceneKit`.
 */
export type ResultSceneKit = ResultKit;

export interface ResultSceneOptions extends SessionSceneOptions {
  /**
   * The play (or the course run) the screen shows. An LR2 or beatoraja skin shows the course of `result.course` (its
   * ops, numbers and texts): the course a stage belongs to, with the stage, or the course run.
   */
  readonly result: PlayResult;
  /**
   * Which play the result is of, when `result.run` does not say (a course stage's result): a course run plays the course
   * jingles, and only a single play or a NONSTOP run offers a quick retry.
   */
  readonly run?: PlayRunKind;
  /** Where the result's chart files are, for the images a skin shows. */
  readonly source?: BrowserAssetSource;
  /**
   * The chart as the play played it (its `#RANDOM` branches drawn), when the host has it: a beatoraja skin's BPM graph,
   * note kinds and TOTAL readout read it, and show nothing of the chart without it.
   */
  readonly playChart?: BeMusicJSON;
  /** The theme's sounds: the screen plays its clear, fail or result jingle and stops it as it leaves. */
  readonly sounds: SystemSoundSet;
  /**
   * The host's audio service: the jingle plays through it, and so do a beatoraja skin's Lua sounds (`skinSounds`,
   * resolved against the theme's files set with `setTheme`), which stop as the screen leaves.
   */
  readonly audio: AudioService;
  /**
   * The replay slots of the chart (or the course), read every frame: a beatoraja skin shows them (ops 196-198 and
   * 1196-1204). Pair it with `on.saveReplay`.
   */
  readonly replaySlots?: () => readonly ReplaySlotState[];
  /**
   * Where the screen leads: `continue` when the player is done, `retry` to play the chart again (R). Without `retry`
   * the screen offers no quick retry. Each fires once per entry. `saveReplay` saves the play into a replay slot (keys
   * 1-4, a beatoraja skin's replay buttons).
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

/** The skin timing of `kit`'s result view, which the session times the screen from. */
function resultTimingOf(kit: ResultSceneKit): ResultViewTiming {
  switch (kit.family) {
    case 'lr2':
      return resolveLR2ResultTiming(kit.skin);
    case 'beatoraja':
      return resolveBeatorajaResultTiming(kit.kit.skin);
    case 'built-in':
      return BUILT_IN_RESULT_TIMING;
  }
}

/**
 * The result view of `kit`'s family, reading the chart's files from `options.source`. A beatoraja skin's Lua sounds
 * play through the audio service as the session's, so they stop as the screen leaves.
 */
function createResultView(
  kit: ResultSceneKit,
  session: ResultSession,
  options: Pick<ResultSceneOptions, 'result' | 'source' | 'audio'>,
): FamilyResultView {
  const source = options.source !== undefined ? { source: options.source } : {};
  switch (kit.family) {
    case 'lr2': {
      const view = new LR2ResultView(kit, source);
      return {
        view,
        updateKit: (next) => (next.family === 'lr2' ? view.updateKit(next) : ignoreKit(next, 'lr2')),
      };
    }
    case 'beatoraja': {
      const view = new BeatorajaResultView(kit, {
        chart: options.result.chart,
        ...source,
        skinSounds: options.audio.skinSounds.owned(session),
      });
      return {
        view,
        updateKit: (next) => (next.family === 'beatoraja' ? view.updateKit(next) : ignoreKit(next, 'beatoraja')),
      };
    }
    case 'built-in': {
      const view = kit.skin.dom?.result ? new DOMResultView(kit) : new BuiltInResultView(kit, source);
      return {
        view,
        updateKit: (next) => (next.family === 'built-in' ? view.updateKit(next) : ignoreKit(next, 'built-in')),
      };
    }
  }
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
  const session = new ResultSession({
    result: options.result,
    ...(options.run !== undefined ? { run: options.run } : {}),
    ...(options.playChart !== undefined ? { playChart: options.playChart } : {}),
    sounds: options.sounds,
    audio: options.audio,
    timing: resultTimingOf(kit),
    ...(options.replaySlots !== undefined ? { replaySlots: options.replaySlots } : {}),
    on: options.on,
  });
  return new FamilyResultScene(session, createResultView(kit, session, options), {
    ...(options.keyTarget !== undefined ? { keyTarget: options.keyTarget } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
}

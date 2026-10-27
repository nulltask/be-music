/**
 * The beatoraja family's decide screen: a beatoraja decide skin (`header.type` 6, `decide.json` / `decidemain.lua`)
 * drawn by `BeatorajaPlaySkinView`, its canvas fitted into the window. It draws the decide session's frames through the
 * scene mapping (`resolveBeatorajaDecideOps` / `Number` / `GraphValue` of `@be-music/skin-beatoraja/scene`, and the
 * song texts) and beatoraja's scene timers, which it reads off each frame ({@link resolveBeatorajaSceneTimers}): the
 * chart's texts, level and BPM, its difficulty ops, the loading bar, the main BPM and the BPM and note-kind graphs of the
 * chart as the play will play it (`DecideFrame.playChart`) and the chart's own images. The session times the screen
 * from the skin's `scene`, `input` and `fadeout` ({@link resolveBeatorajaDecideTiming}). As on beatoraja, the screen
 * takes keys only.
 */

import { resolveBeatorajaOptionRef } from './option-refs.ts';
import { buildBaseOpSet, type BeatorajaSkin } from '@be-music/skin-beatoraja';
import {
  resolveBeatorajaDecideGraphValue,
  resolveBeatorajaDecideNumber,
  resolveBeatorajaDecideOps,
  type BeatorajaDecideInput,
} from '@be-music/skin-beatoraja/scene';
import type { BeMusicJSON } from '@be-music/chart-source';
import type { LibraryChart } from '@be-music/player-scene-model';
import type { Container } from 'pixi.js';
import { computeBeatorajaBPMCurve, type BPMCurvePoint } from '../../chart/beatoraja/bpm-curve.ts';
import { computeBeatorajaNoteBreakdown } from '../../chart/beatoraja/note-counts.ts';
import { resolveShownChartMainBPM } from '../../chart/main-bpm.ts';
import type { BrowserAssetSource } from '../../collection/types.ts';
import type { BeatorajaKit } from '../../host/family-kit.ts';
import { logger } from '../../logger.ts';
import { BeatorajaPlaySkinView } from './skin-view.ts';
import type { PixiSceneHost } from '../../host/scene-host.ts';
import type { BeatorajaSkinAudio } from '../../skin/beatoraja/audio.ts';
import type { DecideFrame, DecideView, SceneViewTiming } from '../types.ts';
import {
  BeatorajaSkinStage,
  BeatorajaViewChartImages,
  beatorajaSceneNowMs,
  resolveBeatorajaFadeOutMs,
  resolveBeatorajaSceneTimers,
  resolveBeatorajaSkinTimingMs,
  resolveBeatorajaChartText,
} from './scene-frame.ts';

const log = logger('decide');

/**
 * How long a beatoraja decide screen shows before it moves on by itself, for a skin without `scene`: the 3000 ms of
 * `decidemain.lua` (beatoraja's `MusicDecide` moves on once `Skin.scene` has passed). Upstream's `JSONSkin.Skin.scene`
 * has no initializer (Java's 0, which moves on at once), but the reference skin authors one, so an unauthored skin falls
 * back to it, as the fade-out does (`DEFAULT_BEATORAJA_FADEOUT_MS`).
 */
export const BEATORAJA_DECIDE_DEFAULT_SCENE_MS = 3000;

/** When a beatoraja decide screen takes input, for a skin without `input`: the 500 ms of `decidemain.lua`. */
export const BEATORAJA_DECIDE_DEFAULT_INPUT_MS = 500;

/**
 * The decide skin's timing: input opens after its `input` (500 ms without one) and holds back Escape until then, as
 * beatoraja's `MusicDecide` does; the screen moves on by itself after its `scene` (3000 ms without one) and fades out
 * over its `fadeout` (500 ms without one).
 *
 * A `scene` of 0 (or less) moves on at once, before input opens, as upstream's does: `MusicDecide.render` starts the
 * fade-out once `nowtime > getSkin().getScene()` (`src/bms/player/beatoraja/decide/MusicDecide.java`, lines 46-50, at
 * exch-bms2/beatoraja c2ed5db1), and `input()` takes no key once the fade-out has started.
 */
export function resolveBeatorajaDecideTiming(
  skin: Pick<BeatorajaSkin, 'scene' | 'input' | 'fadeout'>,
): SceneViewTiming {
  return {
    inputDelayMs: Math.max(0, resolveBeatorajaSkinTimingMs(skin.input, BEATORAJA_DECIDE_DEFAULT_INPUT_MS)),
    autoAdvanceMs: Math.max(0, resolveBeatorajaSkinTimingMs(skin.scene, BEATORAJA_DECIDE_DEFAULT_SCENE_MS)),
    fadeOutMs: resolveBeatorajaFadeOutMs(skin.fadeout),
    escapeWaitsForInput: true,
  };
}

/**
 * The graphs a decide skin draws of the chart as the play will play it, and its main BPM (number 92), worked out once
 * per chart.
 */
interface ChartGraphs {
  readonly chart: BeMusicJSON;
  readonly bpmCurve: readonly BPMCurvePoint[];
  /** The note-kind bars (`[normal, ln, scratch, bss]`) of the judge graph's type 0. */
  readonly noteKinds: readonly number[];
  /** The BPM the most judged notes sit at (`resolveShownChartMainBPM`); absent without notes. */
  readonly mainBPM: number | undefined;
}

export interface BeatorajaDecideViewOptions {
  /** The chart about to be played, whose images the view loads before its first frame. */
  readonly chart?: Pick<LibraryChart, 'chart' | 'chartPath'>;
  /** Where the chart's files are, for its `#STAGEFILE`, `#BACKBMP` and `#BANNER`; none load without one. */
  readonly source?: BrowserAssetSource;
  /** Where the skin's Lua sounds play (`main_state.audio_*`); they are silent without it. */
  readonly skinSounds?: BeatorajaSkinAudio;
}

/** The beatoraja decide view. See the module comment. */
export class BeatorajaDecideView implements DecideView {
  public readonly family = 'beatoraja' as const;
  public readonly timing: SceneViewTiming;
  private kit: BeatorajaKit;
  private readonly options: BeatorajaDecideViewOptions;
  private readonly stage: BeatorajaSkinStage;
  /** The frame being drawn and what the scene mapping reads of it; the skin view's resolvers read them. */
  private frame: DecideFrame | undefined;
  private input: BeatorajaDecideInput | undefined;
  private graphs: ChartGraphs | undefined;
  private baseOps: ReadonlySet<number> | undefined;
  private readonly chartImages: BeatorajaViewChartImages;
  private host: PixiSceneHost | undefined;
  private disposed = false;

  public constructor(kit: BeatorajaKit, options: BeatorajaDecideViewOptions = {}) {
    this.kit = kit;
    this.options = options;
    this.chartImages = new BeatorajaViewChartImages(options.chart, options.source);
    const { skin, textures, fonts } = kit.kit;
    this.timing = resolveBeatorajaDecideTiming(skin);
    this.stage = new BeatorajaSkinStage(
      new BeatorajaPlaySkinView({
        skin,
        textures,
        resolveRefValue: (ref) =>
          // beatoraja's decide screen shows the player's LN MODE, not the chart's.
          resolveBeatorajaOptionRef(ref, this.frame !== undefined ? { playOptions: this.frame.playOptions } : {}) ?? 0,
        resolveTextContent: (ref) =>
          resolveBeatorajaChartText(ref, {
            ...(this.frame !== undefined ? { chart: this.frame.chart } : {}),
            skin: this.kit.kit.skin,
            tableTextFallback: '',
          }),
        resolveNumberValue: (ref) => (this.input !== undefined ? resolveBeatorajaDecideNumber(ref, this.input) : 0),
        resolveFontFamily: fonts !== undefined ? (id) => fonts.family(id) : undefined,
        resolveFontKind: fonts !== undefined ? (id) => fonts.kind(id) : undefined,
        resolveBPMGraphPoints: () => {
          const curve = this.graphs?.bpmCurve;
          return curve !== undefined && curve.length > 0 ? curve : undefined;
        },
        // The judge graph's type 0 shows the chart's note kinds (ModernChic's decide pane); the judgment graphs have
        // nothing to show before the play.
        resolveJudgeGraphBars: (type) => (type === 0 ? this.graphs?.noteKinds : undefined),
        resolveGraphValue: (type) =>
          this.input !== undefined ? resolveBeatorajaDecideGraphValue(type, this.input) : undefined,
        chartImageProvider: (id) => this.chartImages.resolve(id),
      }),
    );
  }

  public get root(): Container {
    return this.stage.root;
  }

  /**
   * Takes the player's settings for the skin; the next frame draws with them. A beatoraja skin is loaded with its
   * options, so another skin needs another view.
   */
  public updateKit(kit: BeatorajaKit): void {
    if (kit.kit.skin !== this.kit.kit.skin) {
      log.warn('a decide view keeps its skin; ignoring a kit of another skin');
      return;
    }
    this.kit = kit;
    this.baseOps = undefined;
  }

  /**
   * Gets ready to draw on `host`, once the chart's images have loaded (on the first attach), so the first frame shows
   * them. A beatoraja decide screen takes no clicks.
   */
  public async attach(host: PixiSceneHost): Promise<void> {
    if (this.disposed) return;
    await this.chartImages.load();
    if (this.disposed) return;
    this.host = host;
  }

  public detach(): void {
    this.host = undefined;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.detach();
    this.disposed = true;
    this.stage.dispose();
    this.chartImages.dispose();
  }

  public getStageInfo(): { container: Container; width: number; height: number } {
    return this.stage.getStageInfo();
  }

  public draw(frame: DecideFrame): void {
    const host = this.host;
    if (host === undefined || this.disposed) return;
    this.stage.fitTo(host);
    this.frame = frame;
    if (this.graphs?.chart !== frame.playChart) this.graphs = chartGraphsOf(frame.playChart, frame.chart.chartPath);
    const mainBPM = this.graphs.mainBPM;
    // Without the host's progress or an auto advance, nothing is loading: the play is ready.
    const input: BeatorajaDecideInput = {
      chart: frame.chart,
      ...(mainBPM !== undefined ? { mainBPM } : {}),
      progress: frame.progress ?? 1,
    };
    this.input = input;
    const timers = resolveBeatorajaSceneTimers(frame, 'input');
    const skinSounds = this.options.skinSounds;
    this.stage.view.update({
      activeOps: new Set([...this.skinOptionOps(), ...resolveBeatorajaDecideOps(input)]),
      // A timer that has not started reads `undefined`, which hides what is gated on it (the fade-out's black overlay).
      getTimerStart: (timerId) => timers.get(timerId),
      nowMs: beatorajaSceneNowMs(frame.clock),
      audioPlay: skinSounds === undefined ? undefined : (path, volume) => skinSounds.play(path, volume),
      audioLoop: skinSounds === undefined ? undefined : (path, volume) => skinSounds.loop(path, volume),
      audioStop: skinSounds === undefined ? undefined : (path) => skinSounds.stop(path),
    });
  }

  /** The ops of the player's picks for the skin's options. */
  private skinOptionOps(): ReadonlySet<number> {
    this.baseOps ??= buildBaseOpSet(this.kit.kit.skinConfig?.option);
    return this.baseOps;
  }
}

function chartGraphsOf(chart: BeMusicJSON, chartPath: string): ChartGraphs {
  const kinds = computeBeatorajaNoteBreakdown(chart);
  return {
    chart,
    bpmCurve: computeBeatorajaBPMCurve(chart),
    noteKinds: [kinds.normal, kinds.ln, kinds.scratch, kinds.bss],
    mainBPM: resolveShownChartMainBPM(chart, chartPath),
  };
}

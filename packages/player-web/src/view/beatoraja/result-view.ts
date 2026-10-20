/**
 * The beatoraja family's result screen: a beatoraja result skin (`header.type` 7, or the course-result skin for a course
 * run) drawn by `BeatorajaPlaySkinView`, its canvas fitted into the window. It reads the result session's `PlayResult`
 * directly through the scene mapping (`resolveBeatorajaResult*` of `@be-music/beatoraja-skin/scene`): the score, the
 * judgments and their timings, the gauge with its border and TOTAL, the rank, verdict and lamp ops, the graphs and the
 * course. The chart's note kinds, BPM graph and `#TOTAL` come from the chart as the play played it
 * (`ResultFrame.playChart`), the chart's own images from its files; beatoraja's scene timers are read off each frame.
 * The session times the screen from the skin's `input` and `fadeout` ({@link resolveBeatorajaResultTiming}). As on
 * beatoraja, the screen takes keys and no mouse clicks; a tap (a touch or a pen) presses on as Enter does, so a device
 * with no keyboard can leave it ({@link resolveBeatorajaResultPointerIntent}).
 */

import { buildBaseOpSet, type BeatorajaSkin } from '@be-music/beatoraja-skin';
import {
  resolveBeatorajaGaugePolyline,
  resolveBeatorajaResultGaugePercent,
  resolveBeatorajaResultGaugeState,
  resolveBeatorajaResultGraphValue,
  resolveBeatorajaResultJudgeGraph,
  resolveBeatorajaResultNumber,
  resolveBeatorajaResultOps,
  resolveBeatorajaResultPolyline,
  resolveBeatorajaResultText,
  type BeatorajaNoteBreakdown,
  type BeatorajaResultInput,
} from '@be-music/beatoraja-skin/scene';
import type { BeMusicJSON } from '@be-music/json';
import type { LibraryChart, PlayResult } from '@be-music/scene-model';
import type { Container } from 'pixi.js';
import { computeBeatorajaBPMCurve, type BPMCurvePoint } from '../../chart/beatoraja/bpm-curve.ts';
import { computeBeatorajaNoteBreakdown } from '../../chart/beatoraja/note-counts.ts';
import type { BrowserAssetSource } from '../../collection/types.ts';
import type { BeatorajaKit } from '../../host/family-kit.ts';
import { logger } from '../../logger.ts';
import { BeatorajaPlaySkinView } from './skin-view.ts';
import type { PixiSceneHost } from '../../host/scene-host.ts';
import type { BeatorajaSkinAudio } from '../../skin/beatoraja/audio.ts';
import type { IntentSink, ResultFrame, ResultIntent, ResultView, ResultViewTiming } from '../types.ts';
import {
  BeatorajaSkinStage,
  BeatorajaViewChartImages,
  beatorajaSceneNowMs,
  beatorajaChartTextOf,
  resolveBeatorajaFadeOutMs,
  resolveBeatorajaSceneTimers,
  resolveBeatorajaSkinTimingMs,
} from './scene-frame.ts';

const log = logger('result');

/** When a beatoraja result screen takes input, for a skin without `input`: the 500 ms of `resultmain.lua`. */
export const BEATORAJA_RESULT_DEFAULT_INPUT_MS = 500;

/**
 * The result skin's timing: input opens after its `input` (500 ms without one) and holds back every key until then, as
 * beatoraja's `MusicResult` does; the first press leaves, with no steps to press through, after a fade-out over its
 * `fadeout` (500 ms without one). The screen does not move on by itself.
 */
export function resolveBeatorajaResultTiming(skin: Pick<BeatorajaSkin, 'input' | 'fadeout'>): ResultViewTiming {
  return {
    inputDelayMs: Math.max(0, resolveBeatorajaSkinTimingMs(skin.input, BEATORAJA_RESULT_DEFAULT_INPUT_MS)),
    fadeOutMs: resolveBeatorajaFadeOutMs(skin.fadeout),
    escapeWaitsForInput: true,
    skipsResultSteps: true,
  };
}

/**
 * What a pointer pressed on a beatoraja result screen asks for: a tap (a touch or a pen) presses on, as Enter does (the
 * session waits for input to open), so a phone or a tablet can leave the screen; a mouse click asks for nothing, as
 * beatoraja's `MusicResult.input` reads keys only.
 */
export function resolveBeatorajaResultPointerIntent(pointerType: string): ResultIntent | undefined {
  return pointerType === 'touch' || pointerType === 'pen' ? { type: 'continue' } : undefined;
}

/** What the result skin reads of one result, worked out once per result ({@link readBeatorajaResult}). */
export interface BeatorajaResultReading {
  readonly result: PlayResult;
  readonly playChart: BeMusicJSON | undefined;
  readonly input: BeatorajaResultInput;
  /** The run's ops (rank, verdict, lamp, judgments, course stage). */
  readonly ops: readonly number[];
  readonly bpmCurve: readonly BPMCurvePoint[];
  /** Every timed judgment, as the timing distribution graph reads them. */
  readonly timings: readonly { deltaMs: number; kind: string }[];
}

export interface BeatorajaResultViewOptions {
  /** The chart the result is of, whose images the view loads before its first frame. */
  readonly chart?: Pick<LibraryChart, 'chart' | 'chartPath'>;
  /** Where the chart's files are, for its `#STAGEFILE`, `#BACKBMP` and `#BANNER`; none load without one. */
  readonly source?: BrowserAssetSource;
  /** Where the skin's Lua sounds play (`main_state.audio_*`); they are silent without it. */
  readonly skinSounds?: BeatorajaSkinAudio;
}

/** The beatoraja result view. See the module comment. */
export class BeatorajaResultView implements ResultView {
  public readonly family = 'beatoraja' as const;
  public readonly timing: ResultViewTiming;
  private kit: BeatorajaKit;
  private readonly options: BeatorajaResultViewOptions;
  private readonly stage: BeatorajaSkinStage;
  private readonly chartImages: BeatorajaViewChartImages;
  /** What the skin reads of the result being drawn; the skin view's resolvers read it. */
  private reading: BeatorajaResultReading | undefined;
  private baseOps: ReadonlySet<number> | undefined;
  private activeOps: ReadonlySet<number> | undefined;
  private host: PixiSceneHost | undefined;
  private emit: IntentSink<ResultIntent> | undefined;
  private disposed = false;

  public constructor(kit: BeatorajaKit, options: BeatorajaResultViewOptions = {}) {
    this.kit = kit;
    this.options = options;
    this.chartImages = new BeatorajaViewChartImages(options.chart, options.source);
    const { skin, textures, fonts } = kit.kit;
    this.timing = resolveBeatorajaResultTiming(skin);
    this.stage = new BeatorajaSkinStage(
      new BeatorajaPlaySkinView({
        skin,
        textures,
        resolveTextContent: (ref) => this.read((input) => resolveBeatorajaResultText(ref, input)),
        resolveNumberValue: (ref) => this.read((input) => resolveBeatorajaResultNumber(ref, input)),
        resolveFontFamily: fonts !== undefined ? (id) => fonts.family(id) : undefined,
        resolveFontKind: fonts !== undefined ? (id) => fonts.kind(id) : undefined,
        resolveGraphValue: (type) => this.read((input) => resolveBeatorajaResultGraphValue(type, input)),
        resolveGraphPolyline: (type) => this.read((input) => resolveBeatorajaResultPolyline(type, input)),
        resolveGaugePercent: () => this.read((input) => resolveBeatorajaResultGaugePercent(input)),
        resolveJudgeGraphBars: (type) => this.read((input) => resolveBeatorajaResultJudgeGraph(type, input)),
        resolveBPMGraphPoints: () => {
          const curve = this.reading?.bpmCurve;
          return curve !== undefined && curve.length > 0 ? curve : undefined;
        },
        resolveGaugeGraphPoints: () =>
          this.read((input) => resolveBeatorajaGaugePolyline(input.result.gaugeHistory ?? [])),
        resolveTimingDistribution: () => this.reading?.timings,
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
      log.warn('a result view keeps its skin; ignoring a kit of another skin');
      return;
    }
    this.kit = kit;
    this.baseOps = undefined;
    this.activeOps = undefined;
  }

  /**
   * Gets ready to draw on `host`, once the chart's images have loaded (on the first attach), so the first frame shows
   * them, then listens for taps on the canvas. A beatoraja result screen takes no mouse clicks.
   */
  public async attach(host: PixiSceneHost, emit: IntentSink<ResultIntent>): Promise<void> {
    if (this.disposed) return;
    await this.chartImages.load();
    if (this.disposed) return;
    this.detach();
    this.host = host;
    this.emit = emit;
    host.app.canvas.addEventListener('pointerdown', this.handlePointerDown);
  }

  public detach(): void {
    this.host?.app.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.host = undefined;
    this.emit = undefined;
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

  public draw(frame: ResultFrame): void {
    const host = this.host;
    if (host === undefined || this.disposed) return;
    this.stage.fitTo(host);
    const reading = this.readingOf(frame);
    const timers = resolveBeatorajaSceneTimers(frame, 'entry');
    const skinSounds = this.options.skinSounds;
    this.stage.view.update({
      activeOps: this.opsOf(reading),
      // A timer that has not started reads `undefined`, which hides what is gated on it (the fade-out's black overlay).
      getTimerStart: (timerId) => timers.get(timerId),
      // The gauge the play ended on, so `main_state.gauge_type()` and the gauge slab name it (a course's class gauge
      // included) instead of defaulting to NORMAL.
      resolveGaugeState: () => resolveBeatorajaResultGaugeState(reading.input),
      nowMs: beatorajaSceneNowMs(frame.clock),
      audioPlay: skinSounds === undefined ? undefined : (path, volume) => skinSounds.play(path, volume),
      audioLoop: skinSounds === undefined ? undefined : (path, volume) => skinSounds.loop(path, volume),
      audioStop: skinSounds === undefined ? undefined : (path) => skinSounds.stop(path),
    });
  }

  /** A tap presses on (the session waits for input to open); a mouse click does nothing. */
  private readonly handlePointerDown = (event: PointerEvent): void => {
    const intent = resolveBeatorajaResultPointerIntent(event.pointerType);
    if (intent !== undefined) this.emit?.(intent);
  };

  /** Reads the result being drawn through `resolve`; `undefined` before the first frame. */
  private read<T>(resolve: (input: BeatorajaResultInput) => T): T | undefined {
    return this.reading !== undefined ? resolve(this.reading.input) : undefined;
  }

  /** What the skin reads of the frame's result, worked out again only for another result or chart. */
  private readingOf(frame: ResultFrame): BeatorajaResultReading {
    const current = this.reading;
    if (current !== undefined && current.result === frame.result && current.playChart === frame.playChart) {
      return current;
    }
    const reading = readBeatorajaResult(frame.result, frame.playChart, this.kit.kit.skin);
    this.reading = reading;
    this.activeOps = undefined;
    return reading;
  }

  /** The ops of the player's picks for the skin's options and the run's ops, kept until the result or kit changes. */
  private opsOf(reading: BeatorajaResultReading): ReadonlySet<number> {
    this.baseOps ??= buildBaseOpSet(this.kit.kit.skinConfig?.option);
    this.activeOps ??= new Set([...this.baseOps, ...reading.ops]);
    return this.activeOps;
  }
}

/**
 * What a result skin reads of `result` (`BeatorajaResultInput`): the result itself, the chart's `#TOTAL` and note kinds
 * (counted the first time a skin asks) from the chart as played, the chart's song texts and the skin's own; with the
 * run's ops, the BPM graph of the chart as played and the timings as the timing distribution graph reads them.
 */
export function readBeatorajaResult(
  result: PlayResult,
  playChart: BeMusicJSON | undefined,
  skin: Pick<BeatorajaSkin, 'name' | 'author'>,
): BeatorajaResultReading {
  let breakdown: BeatorajaNoteBreakdown | undefined;
  const chartEntry = beatorajaChartTextOf(result.chart);
  const input: BeatorajaResultInput = {
    result,
    ...(playChart?.metadata.total !== undefined ? { chartTotal: playChart.metadata.total } : {}),
    get breakdown(): BeatorajaNoteBreakdown | undefined {
      if (playChart === undefined) return undefined;
      breakdown ??= computeBeatorajaNoteBreakdown(playChart);
      return breakdown;
    },
    ...(chartEntry !== undefined ? { chart: chartEntry } : {}),
    skin: { name: skin.name, author: skin.author },
  };
  return {
    result,
    playChart,
    input,
    ops: resolveBeatorajaResultOps(input),
    bpmCurve: playChart !== undefined ? computeBeatorajaBPMCurve(playChart) : [],
    timings: (result.judgeTimings ?? []).map((timing) => ({ deltaMs: timing.deltaMs, kind: timing.judge })),
  };
}

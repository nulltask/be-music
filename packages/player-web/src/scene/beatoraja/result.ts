// Beatoraja-skinned result scene.
//
// Mounts a `BeatorajaPlaySkinView` against a result-format skin (`type = 7`, parsed from
// `result.json` / `resultmain.lua`) with a fixed `PlayerSummary` snapshot — score / judge
// counts / max combo / cleared flag — handed in by the gameplay scene's `onComplete` hook.
//
// What this scene resolves for the skin:
//
// What the skin reads — the ops, numbers, texts, gauge and graphs of the run — is resolved by
// `@be-music/beatoraja-skin/scene` from the run's result (`resolveBeatorajaResult*`); best-record,
// target and rival numbers read 0 until records feed them.

import type { SceneCourseInfo } from '../course-info.ts';
import { Container, Graphics } from 'pixi.js';
import type { PlayerSummary } from '@be-music/player/core/engine';
import { buildBaseOpSet, type BeatorajaSkin, type BeatorajaSkinConfig } from '@be-music/beatoraja-skin';
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
import type { BeMusicJson } from '@be-music/json';
import { BeatorajaPlaySkinView } from './skin-view.ts';
import { resolveClearLamp, type PlaylogRulesetId } from '@be-music/player/ruleset';
import { computeBeatorajaBpmCurve, type BpmCurvePoint } from '../../chart/beatoraja/bpm-curve.ts';
import { computeBeatorajaNoteBreakdown } from '../../chart/beatoraja/note-counts.ts';
import type { BeatorajaSceneTransition } from '../../skin/beatoraja/scene-transition.ts';
import type { BeatorajaTextureCache } from '../../skin/beatoraja/textures.ts';
import type { BeatorajaFontCache } from '../../skin/beatoraja/fonts.ts';
import type { BeatorajaSkinAudio } from '../../skin/beatoraja/audio.ts';
import type { PixiScene, PixiSceneHost } from '../host.ts';
import type { BrowserSongEntry } from '../../collection/types.ts';
import { isResultRetryKey } from '../../session/result/result-keys.ts';
import {
  attachBeatorajaSceneLifecycle,
  BeatorajaSceneBgmPlayer,
  fitBeatorajaViewToStage,
  hasBeatorajaSceneLockedTransition,
  isBeatorajaSceneInputReady,
  beatorajaSongTextOf,
  resolveBeatorajaSkinTimingMs,
  type BeatorajaSceneLoopAttachment,
} from './shared-scene.ts';
import { resolveBeatorajaChartImage, type BeatorajaChartImages } from '../../skin/beatoraja/chart-images.ts';

export interface PixiBeatorajaResultSceneOptions {
  /** Result skin (`header.type === 7`). */
  skin: BeatorajaSkin;
  /** The judge ruleset the play ran under: keeps the clear lamp to that game's own lamps (see `resolveClearLamp`). */
  judgeRuleset?: PlaylogRulesetId;
  textures: BeatorajaTextureCache;
  fonts?: BeatorajaFontCache;
  /** Confirmed user picks for the skin's `property[]`. */
  skinConfig?: BeatorajaSkinConfig;
  /** Song that was just played; drives the text-ref resolver. Optional → text destinations render empty. */
  song?: BrowserSongEntry;
  /**
   * Parsed chart that was just played. Used to compute the BPM curve for any `bpmgraph[]`
   * element the result skin authors. Optional — when omitted, bpmgraph hides itself.
   */
  chart?: BeMusicJson;
  /** Final per-judge / score snapshot from gameplay's `onComplete`. */
  summary: PlayerSummary;
  /**
   * Maximum combo achieved this run, latched independently of `summary` because `PlayerSummary`
   * doesn't carry a max-combo field — gameplay is the only place where the running combo can be
   * observed before it resets on a break verdict.
   */
  maxCombo: number;
  /**
   * Per-judge `(progress, exScore)` polyline samples. Drives `graph[].type = 110` (current run's
   * EX-score over time). Empty arrays render no polyline. Optional because the no-decide /
   * no-engine fast path can mount the result scene without a real run (e.g., a debug entry from
   * the host's GUI).
   */
  scoreHistory?: ReadonlyArray<{ progress: number; exScore: number }>;
  /** Per-judge `(progress, gauge%)` polyline samples. Drives gauge-history graph elements. */
  gaugeHistory?: ReadonlyArray<{ progress: number; value: number }>;
  /**
   * Full-run timing samples (every judgement's signed deltaMs + kind). Drives the
   * `timingdistributiongraph[]` histogram. Empty / omitted = no histogram drawn.
   */
  timingHistory?: ReadonlyArray<{ deltaMs: number; kind: string }>;
  /**
   * Optional result BGM bytes (WAV / OGG / MP3). The host typically picks between `clear.wav` /
   * `fail.wav` / generic `result.wav` based on the run's outcome before passing it here. Played
   * once at scene `enter()` through a scene-owned `AudioContext` (closed in `dispose()`).
   */
  bgmBytes?: Uint8Array;
  /**
   * Pre-decoded chart imagery for the synthetic-id slots `-100 STAGEFILE` / `-101 BACKBMP` /
   * `-102 BANNER`. GdbG_Skin's result authors a stagefile preview gated on
   * `op:[910, 191]`; default skin paints the stagefile under the score readouts on cleared /
   * failed outcomes. Missing entries hide the matching destinations.
   */
  chartImages?: BeatorajaChartImages;
  /** Fired exactly once when the user dismisses the result (Enter / Space / Escape). */
  onContinue?: () => void;
  /**
   * Fired exactly once when the user asks to play the same chart again (a bare R press, no modifiers, not an
   * auto-repeat, after `Skin.input`). Runs after the same `Skin.fadeout` window as {@link onContinue}; hosts typically
   * start the chart straight away with the options the play just ended with. R does nothing when this is unset.
   */
  onRetry?: () => void;
  /** Optional audio backend for `main_state.audio_play / loop / stop` Lua calls. */
  skinAudio?: BeatorajaSkinAudio;
  /**
   * The course this result belongs to. With a `stageIndex` it is a stage's result: `MODE_COURSE` and the stage op
   * light. Without one it is the course result (a `COURSE_RESULT` skin): `MODE_COURSE` lights and the title strings
   * (10 / 12) read the course title, as beatoraja's `StringPropertyFactory` does for `CourseResult`. Either way the
   * stage titles fill strings 150-159.
   */
  courseInfo?: SceneCourseInfo;
}

/**
 * Default input-active delay when the skin omits `Skin.input`. Mirrors `resultmain.lua`'s
 * reference value (500 ms) and upstream `MusicResult.render` line 12-14:
 *
 *     if (time > getSkin().getInput()) {
 *         timer.switchTimer(TIMER_STARTINPUT, true);
 *     }
 *
 * Until this gate elapses, input-gated chrome stays hidden AND user input is ignored —
 * stops the player from accidentally dismissing the result splash within the first
 * few hundred ms while their hand is still on the gameplay key.
 */
const DEFAULT_RESULT_INPUT_MS = 500;

export class PixiBeatorajaResultScene implements PixiScene {
  readonly root: Container = new Container();
  readonly identity = { kind: 'result', family: 'beatoraja' } as const;
  private readonly backdrop = new Graphics();
  private view: BeatorajaPlaySkinView;
  private readonly options: PixiBeatorajaResultSceneOptions;
  private host?: PixiSceneHost;
  private sceneLoop?: BeatorajaSceneLoopAttachment;
  private startMs = 0;
  private timerStartedAt: Map<number, number> = new Map();
  private lastFitWidth = 0;
  private lastFitHeight = 0;
  /**
   * Drives the user-input → `setTimerOn(TIMER_FADEOUT)` → wait `Skin.fadeout` →
   * `changeState(MUSICSELECT)` lifecycle from upstream `MusicResult.render`
   * (`result/MusicResult.java`, the `if (timer.isTimerOn(TIMER_FADEOUT))` branch around
   * lines 16-22 in the simplified flow). Allocated per `enter()` so re-entered scenes
   * start fresh.
   *
   * Result has no auto-advance trigger (upstream `Skin.scene` defaults to 24h /
   * effectively never), so the helper is only kicked off by the keyboard handler.
   */
  private transitionToContinue: BeatorajaSceneTransition | undefined;
  private transitionToRetry: BeatorajaSceneTransition | undefined;
  private disposed = false;
  private readonly bgm = new BeatorajaSceneBgmPlayer('beatoraja-result', () => this.disposed);
  private cachedBaseOps: ReadonlySet<number> | undefined;
  /** Cached BPM polyline for the chart that was just played — `[]` when no chart was supplied. */
  private readonly chartBpmCurve: ReadonlyArray<BpmCurvePoint>;
  /** What the skin reads of the run (`@be-music/beatoraja-skin/scene`). */
  private readonly result: BeatorajaResultInput;

  constructor(options: PixiBeatorajaResultSceneOptions) {
    this.options = options;
    this.chartBpmCurve = options.chart !== undefined ? computeBeatorajaBpmCurve(options.chart) : [];
    this.result = resultInputOf(options);
    const result = this.result;
    this.view = new BeatorajaPlaySkinView({
      skin: options.skin,
      textures: options.textures,
      resolveTextContent: (refOp) => resolveBeatorajaResultText(refOp, result),
      resolveNumberValue: (refOp) => resolveBeatorajaResultNumber(refOp, result),
      resolveFontFamily: options.fonts ? (id) => options.fonts!.family(id) : undefined,
      resolveFontKind: options.fonts ? (id) => options.fonts!.kind(id) : undefined,
      resolveGraphValue: (type) => resolveBeatorajaResultGraphValue(type, result),
      resolveGraphPolyline: (type) => resolveBeatorajaResultPolyline(type, result),
      resolveGaugePercent: () => resolveBeatorajaResultGaugePercent(result),
      resolveJudgeGraphBars: (type) => resolveBeatorajaResultJudgeGraph(type, result),
      resolveBpmGraphPoints: () => (this.chartBpmCurve.length > 0 ? this.chartBpmCurve : undefined),
      resolveGaugeGraphPoints: () => resolveBeatorajaGaugePolyline(result.result.gaugeHistory ?? []),
      resolveTimingDistribution: () => options.timingHistory,
      // Synthetic chart-image ids — GdbG_Skin's result paints `-100 STAGEFILE` under the
      // top-right song-info pane gated on `op:[910, 191]`; default skin uses it for the
      // results-screen background. Missing entries hide their destinations.
      chartImageProvider: (id) => resolveBeatorajaChartImage(this.options.chartImages, id),
    });
    this.root.addChild(this.backdrop);
    this.root.addChild(this.view.container);
    // eslint-disable-next-line no-console
    console.log(
      '[beatoraja-result] mounted',
      JSON.stringify({
        canvas: { w: this.view.width, h: this.view.height },
        skinName: options.skin.name,
        song: options.song?.title,
        cleared: options.summary.gauge?.cleared ?? false,
        score: options.summary.score,
        exScore: options.summary.exScore,
        maxCombo: options.maxCombo,
      }),
    );
  }

  enter(host: PixiSceneHost): void {
    if (this.disposed) return;
    this.host = host;
    this.startMs = performance.now();
    this.fitToStage();
    // Resolve `Skin.input` per upstream `MusicResult.render` line 12-14. Reference theme
    // ships `input = 500`; we fall back to the same value when the skin omits the field.
    const inputDelayMs = resolveBeatorajaSkinTimingMs(this.options.skin.input, DEFAULT_RESULT_INPUT_MS);
    const lifecycle = attachBeatorajaSceneLifecycle({
      host,
      skin: this.options.skin,
      inputDelayMs,
      readyAtMs: 0,
      playAtMs: 0,
      getElapsedMs: () => performance.now() - this.startMs,
      tick: () => this.tick(),
      handleKeyDown: this.handleKeyDown,
      transitionCompletions: [() => this.options.onContinue?.(), () => this.options.onRetry?.()],
    });
    const [continueTransition, retryTransition] = lifecycle.transitions;
    this.timerStartedAt = lifecycle.timerStartedAt;
    this.transitionToContinue = continueTransition;
    this.transitionToRetry = retryTransition;
    this.sceneLoop = lifecycle.sceneLoop;
    void this.bgm.start(this.options.bgmBytes);
  }

  exit(): void {
    this.sceneLoop?.dispose();
    this.sceneLoop = undefined;
    this.host = undefined;
    // Drop the per-enter() transition helper so a future re-entry rebuilds it. The
    // helper's internal `completed` latch would otherwise carry over and silently no-op
    // future fadeouts on the same instance.
    this.transitionToContinue = undefined;
    this.transitionToRetry = undefined;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.exit();
    this.bgm.stop();
    this.view.dispose();
    if (!this.backdrop.destroyed) {
      this.backdrop.destroy({ children: false, context: true });
    }
    if (!this.root.destroyed) {
      this.root.destroy({ children: false });
    }
  }

  /** Screenshot capture descriptor — see `PixiScene.getStageInfo`. */
  getStageInfo(): { container: Container; width: number; height: number } {
    return { container: this.view.container, width: this.view.width, height: this.view.height };
  }

  // ─── Internals ────────────────────────────────────────────────────────────────────────────────

  private tick(): void {
    if (this.disposed) return;
    this.fitToStage();
    const elapsed = performance.now() - this.startMs;
    this.view.update({
      activeOps: this.baseOps(),
      // Pass through the raw timer value so unfired timers return `undefined` and the
      // destination renderer's "hide gated content until the timer fires" gate works. The
      // earlier `?? 0` fallback made every timer behave as if it fired at scene start —
      // catastrophic for TIMER_FADEOUT (id=2): the default result skin authors a fullscreen
      // BLACK fade-IN destination gated on `timer=2`, so once the player dismissed the screen
      // the fade played. With the `?? 0` fallback the fade played from t=0 of scene mount —
      // an opaque black overlay covering the entire skin chrome, leaving only the graph
      // polylines (`Graphics` nodes drawn after the overlay) visible. Mirrors the pattern in
      // beatoraja's reference themes; the gameplay scene has always done it correctly through
      // `BeatorajaRuntimeAdapter.getTimerStart` which already returns `undefined` for unfired
      // timers.
      getTimerStart: (timerId) => this.timerStartedAt.get(timerId),
      // The gauge the play ended on, so `main_state.gauge_type()` and the gauge slab name it (a course's class gauge
      // included) instead of defaulting to NORMAL.
      resolveGaugeState: () => resolveBeatorajaResultGaugeState(this.result),
      nowMs: elapsed,
      audioPlay:
        this.options.skinAudio === undefined ? undefined : (path, vol) => this.options.skinAudio!.play(path, vol),
      audioLoop:
        this.options.skinAudio === undefined ? undefined : (path, vol) => this.options.skinAudio!.loop(path, vol),
      audioStop: this.options.skinAudio === undefined ? undefined : (path) => this.options.skinAudio!.stop(path),
    });
    // Per-frame fadeout-window poll. No-op until the keyboard handler kicks off the
    // transition; once active, fires `onContinue` once the `Skin.fadeout` window elapses.
    this.transitionToContinue?.tick();
    this.transitionToRetry?.tick();
  }

  /** The skin config's option ops and the run's ops (rank, verdict, lamp, judgments, course stage). */
  private baseOps(): ReadonlySet<number> {
    this.cachedBaseOps ??= new Set([
      ...buildBaseOpSet(this.options.skinConfig?.option),
      ...resolveBeatorajaResultOps(this.result),
    ]);
    return this.cachedBaseOps;
  }

  private fitToStage(): void {
    const fitted = fitBeatorajaViewToStage(this.host, this.view, this.backdrop, {
      width: this.lastFitWidth,
      height: this.lastFitHeight,
    });
    if (fitted === undefined) return;
    this.lastFitWidth = fitted.width;
    this.lastFitHeight = fitted.height;
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (this.disposed) return;
    // Mirrors upstream `MusicResult.render` line 16's `if (timer.isTimerOn(TIMER_FADEOUT))`
    // short-circuit — once the fadeout has begun, additional key presses are ignored.
    if (hasBeatorajaSceneLockedTransition(this.transitionToContinue, this.transitionToRetry)) return;
    // Gate input on `Skin.input` per upstream `MusicResult.render` line 12. Stops the
    // player from accidentally dismissing the result splash within the first few hundred
    // ms while their hand is still on the gameplay key.
    const inputDelay = resolveBeatorajaSkinTimingMs(this.options.skin.input, DEFAULT_RESULT_INPUT_MS);
    if (!isBeatorajaSceneInputReady(this.startMs, inputDelay, performance.now())) return;
    if (this.options.onRetry !== undefined && isResultRetryKey(event)) {
      event.preventDefault();
      // Same fadeout as a dismissal, but `onRetry` fires at its end instead of `onContinue`.
      this.transitionToRetry?.begin();
      return;
    }
    switch (event.key) {
      case 'Enter':
      case ' ':
      case 'Escape':
        event.preventDefault();
        // Begin the fadeout window. Stamp of `TIMER_FADEOUT` and the `Skin.fadeout`-ms
        // delay before `onContinue` fires happen inside the helper.
        this.transitionToContinue?.begin();
        break;
    }
  };
}

/**
 * What the result skin reads of the run (`BeatorajaResultInput`): the final summary as the result's score, the max
 * combo, the verdict and its lamp by the one clear-lamp rule, the graphs and timings, the course, and the final gauge,
 * the chart's `#TOTAL` and note kinds (counted the first time a skin asks), the chart's song texts and the skin's own.
 */
function resultInputOf(options: PixiBeatorajaResultSceneOptions): BeatorajaResultInput {
  const { summary, chart } = options;
  const cleared = summary.gauge?.cleared ?? false;
  let breakdown: BeatorajaNoteBreakdown | undefined;
  const song = beatorajaSongTextOf(options.song);
  return {
    result: {
      score: summary,
      fast: summary.fast,
      slow: summary.slow,
      maxCombo: options.maxCombo,
      cleared,
      lamp: resolveClearLamp({
        cleared,
        score: summary,
        ...(summary.gauge?.type !== undefined ? { gauge: summary.gauge.type } : {}),
        ...(options.judgeRuleset !== undefined ? { ruleset: options.judgeRuleset } : {}),
      }),
      gaugeHistory: options.gaugeHistory ?? [],
      scoreHistory: options.scoreHistory ?? [],
      judgeTimings: (options.timingHistory ?? []).map((sample) => ({ deltaMs: sample.deltaMs, judge: sample.kind })),
      ...(options.courseInfo !== undefined ? { course: options.courseInfo } : {}),
    },
    ...(summary.gauge !== undefined ? { gauge: summary.gauge } : {}),
    ...(chart?.metadata.total !== undefined ? { chartTotal: chart.metadata.total } : {}),
    get breakdown(): BeatorajaNoteBreakdown | undefined {
      if (chart === undefined) return undefined;
      breakdown ??= computeBeatorajaNoteBreakdown(chart);
      return breakdown;
    },
    ...(song !== undefined ? { song } : {}),
    skin: { name: options.skin.name, author: options.skin.author },
  };
}

// Beatoraja-skinned result scene.
//
// Mounts a `BeatorajaPlaySkinView` against a result-format skin (`type = 7`, parsed from
// `result.json` / `resultmain.lua`) with a fixed `PlayerSummary` snapshot — score / judge
// counts / max combo / cleared flag — handed in by the gameplay scene's `onComplete` hook.
//
// What this scene resolves for the skin:
//
//   - `text[].ref` — TITLE / SUBTITLE / GENRE / ARTIST etc., from the picked song.
//   - `value[].ref` — the entire LIVE-block of prop.lua's `num` table populated from the final
//     `PlayerSummary`. Score (POINT, SCORE2), score-rate / total-rate (with afterdot pairs),
//     judge counts (PERFECT … POOR / MISS), fast/slow totals (TOTALEARLY / TOTALLATE),
//     combobreak aliases, max combo, gauge percent. Best-record and rival diff slots stay 0
//     (no DB / IR layer yet).
//
// What this scene does NOT yet do:
//   - Score graph / gauge polyline rendering (`SRC_SCORECHART` / `SRC_GAUGECHART_*` in LR2;
//     beatoraja's equivalent is per-skin authored chart polylines we don't yet emit)
//   - Per-rank / clear-lamp op gates (CLEAR_RANK_AAA / CLEAR_LAMP_FULLCOMBO in prop.lua) —
//     these need the score DB to compute "vs best" deltas; we surface only LIVE-run data
//   - Result BGM (clear / fail jingles) — beatoraja themes ship per-theme audio that we
//     haven't yet routed through the audio bus

import { Container, Graphics, type Texture, type Ticker } from 'pixi.js';
import type { PlayerSummary } from '@be-music/player/core/engine';
import {
  BEATORAJA_NUM,
  BEATORAJA_OP,
  BEATORAJA_TEXT,
  TIMER_FADEOUT,
  TIMER_PLAY,
  TIMER_READY,
  TIMER_SCENE_START,
  TIMER_STARTINPUT,
  buildBaseOpSet,
  computeClearLampOp,
  computeGenericRankOp,
  computeJudgeExistOps,
  computeRankOp,
  computeResultRankOp,
  type BeatorajaSkin,
  type BeatorajaSkinConfig,
} from '@be-music/beatoraja-skin';
import type { BeMusicJson } from '@be-music/json';
import { BeatorajaPlaySkinView } from './pixi-beatoraja-skin-view.ts';
import { computeBeatorajaBpmCurve, type BpmCurvePoint } from './beatoraja-chart-bpm-curve.ts';
import { extractChartSubartist } from './beatoraja-chart-meta.ts';
import { computeBeatorajaNoteBreakdown } from './beatoraja-chart-note-counts.ts';
import type { BeatorajaTextureCache } from './beatoraja-textures.ts';
import type { BeatorajaFontCache } from './beatoraja-fonts.ts';
import type { BeatorajaSkinAudio } from './beatoraja-skin-audio.ts';
import type { PixiScene, PixiSceneHost } from './pixi-scene-host.ts';
import type { BrowserSongEntry } from './types.ts';

export interface PixiBeatorajaResultSceneOptions {
  /** Result skin (`header.type === 7`). */
  skin: BeatorajaSkin;
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
  chartImages?: {
    stageFile?: Texture;
    backBmp?: Texture;
    banner?: Texture;
  };
  /** Fired exactly once when the user dismisses the result (Enter / Space / Escape). */
  onContinue?: () => void;
  /** Optional audio backend for `main_state.audio_play / loop / stop` Lua calls. */
  skinAudio?: BeatorajaSkinAudio;
}

const STARTINPUT_DELAY_MS = 500;

export class PixiBeatorajaResultScene implements PixiScene {
  readonly root = new Container();
  private readonly backdrop = new Graphics();
  private view: BeatorajaPlaySkinView;
  private readonly options: PixiBeatorajaResultSceneOptions;
  private host?: PixiSceneHost;
  private tickerHandle?: (ticker: Ticker) => void;
  private startMs = 0;
  private timerStartedAt: Map<number, number> = new Map();
  private lastFitWidth = 0;
  private lastFitHeight = 0;
  private dismissed = false;
  private disposed = false;
  private cachedBaseOps: ReadonlySet<number> | undefined;
  /** Scene-owned `AudioContext` for the result jingle. Closed in `dispose()`. */
  private audioContext: AudioContext | undefined;
  private bgmSource: AudioBufferSourceNode | undefined;
  /** Cached BPM polyline for the chart that was just played — `[]` when no chart was supplied. */
  private readonly chartBpmCurve: ReadonlyArray<BpmCurvePoint>;

  constructor(options: PixiBeatorajaResultSceneOptions) {
    this.options = options;
    this.chartBpmCurve = options.chart !== undefined ? computeBeatorajaBpmCurve(options.chart) : [];
    this.view = new BeatorajaPlaySkinView({
      skin: options.skin,
      textures: options.textures,
      resolveTextContent: (refOp) => this.resolveSongText(refOp),
      resolveNumberValue: (refOp) => this.resolveResultNumber(refOp),
      resolveFontFamily: options.fonts ? (id) => options.fonts!.family(id) : undefined,
      resolveFontKind: options.fonts ? (id) => options.fonts!.kind(id) : undefined,
      resolveGraphValue: (type) => this.resolveResultGraph(type),
      resolveGraphPolyline: (type) => this.resolveResultPolyline(type),
      resolveGaugePercent: () => {
        const gauge = options.summary.gauge;
        if (gauge === undefined || gauge.max <= 0) return 0;
        return (gauge.current / gauge.max) * 100;
      },
      resolveJudgeGraphBars: (type) => this.resolveResultJudgeBars(type),
      resolveBpmGraphPoints: () => (this.chartBpmCurve.length > 0 ? this.chartBpmCurve : undefined),
      resolveGaugeGraphPoints: () => this.resolveResultGaugePolyline(),
      resolveTimingDistribution: () => options.timingHistory,
      // Synthetic chart-image ids — GdbG_Skin's result paints `-100 STAGEFILE` under the
      // top-right song-info pane gated on `op:[910, 191]`; default skin uses it for the
      // results-screen background. Missing entries hide their destinations.
      chartImageProvider: (id) => this.resolveChartImage(id),
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
    // Result scenes have their own timer ladder. We surface the same scene-relative timers as
    // gameplay so chrome gated on `TIMER_PLAY` / `TIMER_READY` (e.g., "music finished" reveals)
    // also fires here. The scene-start timer is at 0 ms so author keyframes run from the moment
    // the scene is visible.
    this.timerStartedAt = new Map([
      [TIMER_SCENE_START, 0],
      [TIMER_STARTINPUT, STARTINPUT_DELAY_MS],
      [TIMER_READY, 0],
      [TIMER_PLAY, 0],
    ]);
    this.tickerHandle = () => this.tick();
    host.app.ticker.add(this.tickerHandle);
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.handleKeyDown);
    }
    void this.startBgm();
  }

  exit(): void {
    if (this.tickerHandle && this.host) {
      this.host.app.ticker.remove(this.tickerHandle);
    }
    this.tickerHandle = undefined;
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.handleKeyDown);
    }
    this.host = undefined;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.exit();
    this.stopBgm();
    this.view.dispose();
    if (!this.root.destroyed) {
      this.root.destroy({ children: false });
    }
  }

  /** Screenshot capture descriptor — see `PixiScene.getStageInfo`. */
  getStageInfo(): { container: Container; width: number; height: number } {
    return { container: this.view.container, width: this.view.width, height: this.view.height };
  }

  /**
   * Decode + start the result BGM. Same lazy-init pattern as the decide scene's `startBgm`. The
   * jingle plays once (no loop) — beatoraja's result audio is typically a single-play fanfare,
   * not a looping background track.
   */
  private async startBgm(): Promise<void> {
    const bytes = this.options.bgmBytes;
    if (bytes === undefined) return;
    if (typeof globalThis === 'undefined' || typeof globalThis.AudioContext === 'undefined') return;
    try {
      if (this.audioContext === undefined) {
        this.audioContext = new globalThis.AudioContext();
      }
      const ctx = this.audioContext;
      void ctx.resume().catch(() => undefined);
      const buffer = await ctx.decodeAudioData(bytes.slice().buffer);
      if (this.disposed) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start();
      this.bgmSource = source;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[beatoraja-result] bgm playback failed', error);
    }
  }

  private stopBgm(): void {
    if (this.bgmSource !== undefined) {
      try {
        this.bgmSource.stop();
      } catch {
        /* already stopped */
      }
      this.bgmSource.disconnect();
      this.bgmSource = undefined;
    }
    if (this.audioContext !== undefined) {
      void this.audioContext.close().catch(() => undefined);
      this.audioContext = undefined;
    }
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
      nowMs: elapsed,
      audioPlay:
        this.options.skinAudio === undefined
          ? undefined
          : (path, vol) => this.options.skinAudio!.play(path, vol),
      audioLoop:
        this.options.skinAudio === undefined
          ? undefined
          : (path, vol) => this.options.skinAudio!.loop(path, vol),
      audioStop:
        this.options.skinAudio === undefined ? undefined : (path) => this.options.skinAudio!.stop(path),
    });
  }

  private baseOps(): ReadonlySet<number> {
    if (this.cachedBaseOps !== undefined) return this.cachedBaseOps;
    // Start from the user's confirmed `property[]` picks, then merge in summary-derived gates
    // (rank, clear lamp, result outcome, *_EXIST). The result scene's chrome is mostly built
    // around these classifiers — without them the skin renders in a "no-data" state where
    // every rank graphic is hidden and the clear-lamp panel stays blank.
    const ops = new Set(buildBaseOpSet(this.options.skinConfig?.option));
    const summary = this.options.summary;
    const maxExScore = summary.total * 2;

    // Rank ops — side / generic / result-only blocks. The first two mirror the live gameplay
    // path (some skins reuse the live ops on result); the result-only block is set explicitly
    // for skins that authored their rank graphics under `result_*_1p`.
    ops.add(computeRankOp(summary.exScore, maxExScore, 1));
    ops.add(computeGenericRankOp(summary.exScore, maxExScore));
    ops.add(computeResultRankOp(summary.exScore, maxExScore));

    // Clear lamp + outcome flag. The gauge variant ('GROOVE' / 'EASY' / 'HARD' / 'DEATH') comes
    // from `summary.gauge.type` if the engine surfaced it; the lamp picker uses it to pick
    // between NORMAL / EASY / HARD / EXHARD lamps. PERFECT and FULLCOMBO short-circuit ahead of
    // gauge-type discrimination — those are independent of the gauge curve.
    const cleared = summary.gauge?.cleared ?? false;
    ops.add(cleared ? BEATORAJA_OP.RESULT_CLEAR : BEATORAJA_OP.RESULT_FAIL);
    ops.add(
      computeClearLampOp({
        cleared,
        perfect: summary.perfect,
        great: summary.great,
        good: summary.good,
        bad: summary.bad,
        poor: summary.poor,
        total: summary.total,
        gaugeType: summary.gauge?.type,
      }),
    );

    // *_EXIST gates — same logic as the live adapter, but evaluated once against the final
    // counters (no per-frame refresh needed).
    for (const op of computeJudgeExistOps(summary)) ops.add(op);

    this.cachedBaseOps = ops;
    return this.cachedBaseOps;
  }

  /**
   * Synthetic chart-image resolver. Maps the negative-id sentinels onto whichever pre-decoded
   * chart bitmaps the host supplied via `chartImages`. Same shape as the decide / play scenes.
   */
  private resolveChartImage(syntheticId: number): Texture | undefined {
    const images = this.options.chartImages;
    if (images === undefined) return undefined;
    switch (syntheticId) {
      case -100:
        return images.stageFile;
      case -101:
        return images.backBmp;
      case -102:
        return images.banner;
      default:
        return undefined;
    }
  }

  private resolveSongText(refOp: number): string | undefined {
    const song = this.options.song;
    const skin = this.options.skin;
    switch (refOp) {
      case BEATORAJA_TEXT.TITLE:
        return song?.title ?? '';
      case BEATORAJA_TEXT.SUBTITLE:
        return song?.subtitle ?? '';
      case BEATORAJA_TEXT.FULLTITLE:
        return joinNonEmpty(song?.title, song?.subtitle);
      case BEATORAJA_TEXT.GENRE:
        return song?.genre ?? '';
      case BEATORAJA_TEXT.ARTIST:
        return song?.artist ?? '';
      case BEATORAJA_TEXT.SUBARTIST:
        // BMS `#SUBARTIST` lands in `metadata.extras.SUBARTIST`; bmson's structured
        // `info.subartists[]` joins with spaces. Both paths surface the same string here.
        return extractChartSubartist(song?.chart);
      case BEATORAJA_TEXT.FULLARTIST:
        return joinNonEmpty(song?.artist, extractChartSubartist(song?.chart));
      // Skin / directory metadata — same contract as decide / gameplay paths. Lets the result
      // panel display "Played: <directory> / <song.title>" in skins that author the layout.
      case BEATORAJA_TEXT.SKIN_NAME:
        return skin.name ?? '';
      case BEATORAJA_TEXT.SKIN_AUTHOR:
        return skin.author ?? '';
      case BEATORAJA_TEXT.DIRECTORY:
        return song?.directoryLabel ?? '';
      default:
        return undefined;
    }
  }

  /**
   * Result-scene `value[].ref` resolver. Result skins share the live-block num codes with
   * gameplay (perfect/great/good/bad/poor/score/combo/etc.) — same prop.lua slots, just frozen
   * at the chart's last frame. Mirrors the cases handled by `BeatorajaRuntimeAdapter`'s resolver
   * but reads from the static `summary` payload instead of a live frame.
   */
  private resolveResultNumber(refOp: number): number | undefined {
    const summary = this.options.summary;
    const exScoreMax = summary.total * 2;
    const exScoreRatePct = exScoreMax > 0 ? (summary.exScore / exScoreMax) * 100 : 0;
    const scoreMax = summary.total * 1000;
    const scoreRatePct = scoreMax > 0 ? (summary.score / scoreMax) * 100 : 0;
    const gaugePct =
      summary.gauge !== undefined && summary.gauge.max > 0 ? (summary.gauge.current / summary.gauge.max) * 100 : 0;

    switch (refOp) {
      // ─── Score ────────────────────────────────────────────────────────────────────────────
      case BEATORAJA_NUM.POINT:
      case BEATORAJA_NUM.SCORE2:
        return summary.score;
      case BEATORAJA_NUM.SCORE_RATE:
        return Math.floor(exScoreRatePct);
      case BEATORAJA_NUM.SCORE_RATE_AFTERDOT:
        return Math.floor((exScoreRatePct - Math.floor(exScoreRatePct)) * 100);
      case BEATORAJA_NUM.TOTAL_RATE:
        return Math.floor(scoreRatePct);
      case BEATORAJA_NUM.TOTAL_RATE_AFTERDOT:
        return Math.floor((scoreRatePct - Math.floor(scoreRatePct)) * 100);

      // ─── Combo / total notes ──────────────────────────────────────────────────────────────
      // Final combo isn't tracked separately from max — beatoraja's `combo = 104` slot on result
      // displays the max combo of the run (the running counter has long been reset by then).
      // Surfacing `maxCombo` for both keeps skins that read either slot consistent.
      case BEATORAJA_NUM.COMBO:
      case BEATORAJA_NUM.MAXCOMBO_LIVE:
        return this.options.maxCombo;
      case BEATORAJA_NUM.TOTALNOTES:
      case BEATORAJA_NUM.TOTALNOTES_LIVE:
        return summary.total;

      // ─── Gauge ────────────────────────────────────────────────────────────────────────────
      case BEATORAJA_NUM.GROOVEGAUGE:
        return Math.floor(gaugePct);
      case BEATORAJA_NUM.GROOVEGAUGE_AFTERDOT:
        return Math.floor((gaugePct - Math.floor(gaugePct)) * 100);

      // ─── Per-judge counts ─────────────────────────────────────────────────────────────────
      case BEATORAJA_NUM.PERFECT:
        return summary.perfect;
      case BEATORAJA_NUM.GREAT:
        return summary.great;
      case BEATORAJA_NUM.GOOD:
        return summary.good;
      case BEATORAJA_NUM.BAD:
        return summary.bad;
      case BEATORAJA_NUM.POOR:
        return summary.poor;
      case BEATORAJA_NUM.MISS:
        return summary.poor;
      case BEATORAJA_NUM.TOTALEARLY:
        return summary.fast;
      case BEATORAJA_NUM.TOTALLATE:
        return summary.slow;

      // Per-judge fast / slow split — derived from `timingHistory`. Engine doesn't aggregate
      // these per-kind, so we fan out the full sample list once and cache. Each pair sums to
      // the per-kind total (PERFECT, GREAT, …); empty timingHistory leaves all at 0.
      case BEATORAJA_NUM.EARLY_PERFECT:
        return this.cachedJudgeFastSlow().earlyPerfect;
      case BEATORAJA_NUM.LATE_PERFECT:
        return this.cachedJudgeFastSlow().latePerfect;
      case BEATORAJA_NUM.EARLY_GREAT:
        return this.cachedJudgeFastSlow().earlyGreat;
      case BEATORAJA_NUM.LATE_GREAT:
        return this.cachedJudgeFastSlow().lateGreat;
      case BEATORAJA_NUM.EARLY_GOOD:
        return this.cachedJudgeFastSlow().earlyGood;
      case BEATORAJA_NUM.LATE_GOOD:
        return this.cachedJudgeFastSlow().lateGood;
      case BEATORAJA_NUM.EARLY_BAD:
        return this.cachedJudgeFastSlow().earlyBad;
      case BEATORAJA_NUM.LATE_BAD:
        return this.cachedJudgeFastSlow().lateBad;
      case BEATORAJA_NUM.EARLY_POOR:
        return this.cachedJudgeFastSlow().earlyPoor;
      case BEATORAJA_NUM.LATE_POOR:
        return this.cachedJudgeFastSlow().latePoor;
      case BEATORAJA_NUM.EARLY_MISS:
        return this.cachedJudgeFastSlow().earlyPoor;
      case BEATORAJA_NUM.LATE_MISS:
        return this.cachedJudgeFastSlow().latePoor;
      case BEATORAJA_NUM.COMBOBREAK:
      case BEATORAJA_NUM.BAD_PLUS_POOR_PLUS_MISS:
        return summary.bad + summary.poor;
      case BEATORAJA_NUM.POOR_PLUS_MISS:
        return summary.poor;

      // ─── Timing statistics (374-377) — computed from the run's timingHistory ───────────
      // GdbG_Skin authors `Avg N ms` / `Stdev N ms` labels from these refs; ModernChic uses
      // them on its impression / centerinfo panes. Computed once via a memoized helper so the
      // ms-pass-through doesn't recompute the stddev every frame.
      case BEATORAJA_NUM.AVERAGE_TIMING:
        return Math.floor(Math.abs(this.cachedTimingStats().mean));
      case BEATORAJA_NUM.AVERAGE_TIMING_AFTERDOT: {
        const mean = Math.abs(this.cachedTimingStats().mean);
        return Math.floor((mean - Math.floor(mean)) * 100);
      }
      case BEATORAJA_NUM.STDDEV_TIMING:
        return Math.floor(this.cachedTimingStats().stddev);
      case BEATORAJA_NUM.STDDEV_TIMING_AFTERDOT: {
        const stddev = this.cachedTimingStats().stddev;
        return Math.floor((stddev - Math.floor(stddev)) * 100);
      }

      // ─── Best-record / target / IR — no live data, return 0 to silence "ref not wired" ──
      // The result skin authors a lot of "vs best" / "vs target" slots; without a DB layer they
      // all stay at 0. Returning 0 (not undefined) keeps the readouts visually present and the
      // log clean.
      default:
        return 0;
    }
  }

  /**
   * Mean / stddev of the run's `timingHistory` deltas (positive = late, negative = early).
   * Cached on first call — both stats are stable for the run's lifetime so per-frame resolves
   * stay O(1). Empty history returns `{mean: 0, stddev: 0}` — matches beatoraja's "no data"
   * behaviour where the stat readouts sit at 0.
   */
  private cachedTimingStats(): { mean: number; stddev: number } {
    if (this.timingStatsCache !== undefined) return this.timingStatsCache;
    const samples = this.options.timingHistory;
    if (samples === undefined || samples.length === 0) {
      this.timingStatsCache = { mean: 0, stddev: 0 };
      return this.timingStatsCache;
    }
    let sum = 0;
    for (const s of samples) sum += s.deltaMs;
    const mean = sum / samples.length;
    let sqSum = 0;
    for (const s of samples) {
      const d = s.deltaMs - mean;
      sqSum += d * d;
    }
    const stddev = Math.sqrt(sqSum / samples.length);
    this.timingStatsCache = { mean, stddev };
    return this.timingStatsCache;
  }
  private timingStatsCache: { mean: number; stddev: number } | undefined;

  /**
   * Per-judge fast / slow counts derived from `timingHistory`. The engine emits a
   * `(deltaMs, kind)` tuple for every judgement; we bucket by kind into the EARLY (deltaMs <
   * 0) / LATE (deltaMs > 0) bins. Cached on first call — the history is static per run.
   * Empty / missing history leaves every bucket at 0.
   *
   * MISS is mapped onto the POOR bucket because the engine treats missed-press as a POOR
   * judgement (no separate kind). Skin authors who use ref 421 / 422 (EARLY_MISS / LATE_MISS)
   * effectively see the same numbers as EARLY_POOR / LATE_POOR — same convention as our
   * `MISS` (ref 420) which surfaces `summary.poor`.
   */
  private cachedJudgeFastSlow(): {
    earlyPerfect: number;
    latePerfect: number;
    earlyGreat: number;
    lateGreat: number;
    earlyGood: number;
    lateGood: number;
    earlyBad: number;
    lateBad: number;
    earlyPoor: number;
    latePoor: number;
  } {
    if (this.judgeFastSlowCache !== undefined) return this.judgeFastSlowCache;
    const out = {
      earlyPerfect: 0,
      latePerfect: 0,
      earlyGreat: 0,
      lateGreat: 0,
      earlyGood: 0,
      lateGood: 0,
      earlyBad: 0,
      lateBad: 0,
      earlyPoor: 0,
      latePoor: 0,
    };
    for (const sample of this.options.timingHistory ?? []) {
      const isEarly = sample.deltaMs < 0;
      const isLate = sample.deltaMs > 0;
      if (!isEarly && !isLate) continue; // Exactly-on-zero deltas don't count toward either bucket.
      switch (sample.kind) {
        case 'PERFECT':
          if (isEarly) out.earlyPerfect += 1;
          else out.latePerfect += 1;
          break;
        case 'GREAT':
          if (isEarly) out.earlyGreat += 1;
          else out.lateGreat += 1;
          break;
        case 'GOOD':
          if (isEarly) out.earlyGood += 1;
          else out.lateGood += 1;
          break;
        case 'BAD':
          if (isEarly) out.earlyBad += 1;
          else out.lateBad += 1;
          break;
        case 'POOR':
          if (isEarly) out.earlyPoor += 1;
          else out.latePoor += 1;
          break;
      }
    }
    this.judgeFastSlowCache = out;
    return this.judgeFastSlowCache;
  }
  private judgeFastSlowCache:
    | {
        earlyPerfect: number;
        latePerfect: number;
        earlyGreat: number;
        lateGreat: number;
        earlyGood: number;
        lateGood: number;
        earlyBad: number;
        lateBad: number;
        earlyPoor: number;
        latePoor: number;
      }
    | undefined;

  /**
   * Result-scene graph-value resolver. Surfaces the run's frozen ratios — gauge percent, score
   * rate — for graph elements. Polyline-style graphs (`110` / `113` / `115`) return `undefined`
   * so the renderer hides them; per-frame history rendering would require gameplay to plumb a
   * `scoreHistory` array through `onComplete`, which it doesn't yet do.
   */
  private resolveResultGraph(type: number): number | undefined {
    const summary = this.options.summary;
    switch (type) {
      // Gauge bars — 1P (`1`) and 2P (`6`). The result panel typically shows the final gauge level
      // from the cleared / failed run.
      case 1:
      case 6: {
        const gauge = summary.gauge;
        if (gauge === undefined || gauge.max <= 0) return 0;
        return gauge.current / gauge.max;
      }
      // EX-score rate — many result skins show a horizontal bar that fills with the score
      // percentage. Mirrors the live `score_rate = 102` num convention.
      case 7: {
        const max = summary.total * 2;
        return max > 0 ? summary.exScore / max : 0;
      }
      default:
        return undefined;
    }
  }

  /**
   * Result-scene polyline resolver. Maps `graph[].type` codes to normalized `(x, y)` points in
   * `[0, 1]²`. Coordinates are progress along the chart on x and the value's fraction-of-max on
   * y; the renderer flips y so high values draw upward.
   *
   * Supported types:
   *   - `110` — current run's EX-score over time (from `scoreHistory`, normalized by `total*2`)
   *   - `107` — running gauge over time (from `gaugeHistory`, normalized by 100)
   *
   * Best-record / target codes (`113` / `115`) need a DB layer to source the comparison run's
   * polyline; until that ships they return `undefined` so the renderer hides them.
   */
  private resolveResultPolyline(type: number): ReadonlyArray<{ x: number; y: number }> | undefined {
    const summary = this.options.summary;
    switch (type) {
      case 110: {
        const history = this.options.scoreHistory;
        if (history === undefined || history.length === 0) return undefined;
        const max = summary.total * 2;
        if (max <= 0) return undefined;
        return history.map((sample) => ({
          x: sample.progress,
          y: Math.max(0, Math.min(1, sample.exScore / max)),
        }));
      }
      case 107: {
        const history = this.options.gaugeHistory;
        if (history === undefined || history.length === 0) return undefined;
        return history.map((sample) => ({
          x: sample.progress,
          y: Math.max(0, Math.min(1, sample.value / 100)),
        }));
      }
      default:
        return undefined;
    }
  }

  /**
   * Build the gauge polyline for the result scene's `gaugegraph[]`. Maps `gaugeHistory`
   * (sampled per-judge during the run) into normalized `{x, y}` points: `x = sample.progress`,
   * `y = sample.value / 100` (gauge values arrive in 0..100 already). Returns `undefined` when
   * no history is available — the renderer hides the graph in that case.
   */
  private resolveResultGaugePolyline(): ReadonlyArray<{ x: number; y: number }> | undefined {
    const history = this.options.gaugeHistory;
    if (history === undefined || history.length === 0) return undefined;
    return history.map((sample) => ({
      x: sample.progress,
      y: Math.max(0, Math.min(1, sample.value / 100)),
    }));
  }

  /**
   * Resolve a `judgegraph[].type` for the result scene. Three histogram kinds:
   *   - `0` note distribution → `[normal, ln, scratch, bss]` from the played chart's static
   *     breakdown. ModernChic's centerinfo / impression panes author this for "what's in this
   *     chart" stat strips. Cached on first call (the breakdown is static per chart).
   *   - `1` judgement spread → `[perfect, great, good, bad, poor]` from the run's summary.
   *   - `2` early/late → `[fast, slow]` from the run's summary.
   *
   * The result scene's snapshot is static, so the renderer paints once and short-circuits
   * subsequent frames via the per-entry signature cache.
   */
  private resolveResultJudgeBars(type: number): ReadonlyArray<number> | undefined {
    if (type === 0) {
      if (this.options.chart === undefined) return undefined;
      if (this.cachedNoteBreakdownBars === undefined) {
        const breakdown = computeBeatorajaNoteBreakdown(this.options.chart);
        this.cachedNoteBreakdownBars = [breakdown.normal, breakdown.ln, breakdown.scratch, breakdown.bss];
      }
      return this.cachedNoteBreakdownBars;
    }
    const summary = this.options.summary;
    switch (type) {
      case 1:
        return [summary.perfect, summary.great, summary.good, summary.bad, summary.poor];
      case 2:
        return [summary.fast, summary.slow];
      default:
        return undefined;
    }
  }
  private cachedNoteBreakdownBars: ReadonlyArray<number> | undefined;

  private fitToStage(): void {
    const host = this.host;
    if (!host) return;
    const { width, height } = host.app.screen;
    if (width === this.lastFitWidth && height === this.lastFitHeight) return;
    if (width <= 0 || height <= 0) return;
    this.lastFitWidth = width;
    this.lastFitHeight = height;
    const scale = Math.min(width / this.view.width, height / this.view.height);
    if (!Number.isFinite(scale) || scale <= 0) return;
    const c = this.view.container;
    c.scale.set(scale, scale);
    c.x = (width - this.view.width * scale) / 2;
    c.y = (height - this.view.height * scale) / 2;
    this.backdrop.clear().rect(0, 0, width, height).fill(0x000000);
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (this.disposed || this.dismissed) return;
    switch (event.key) {
      case 'Enter':
      case ' ':
      case 'Escape':
        event.preventDefault();
        this.dismissed = true;
        // Stamp the fadeout timer so any outro keyframes can play out for the few frames before
        // the host swaps the scene.
        this.timerStartedAt.set(TIMER_FADEOUT, performance.now() - this.startMs);
        this.options.onContinue?.();
        break;
    }
  };
}

function joinNonEmpty(...parts: ReadonlyArray<string | undefined>): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' ');
}

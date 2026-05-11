// Beatoraja-skinned "now loading" / decide splash.
//
// Mounts a `BeatorajaPlaySkinView` against a decide-format skin (`type = 6`, parsed from
// `decide.json` / `decidemain.lua`) and runs the standard timer ladder so the skin's intro
// keyframe animation plays out. The scene auto-advances after a short window OR the user
// confirms with Enter / Space. Escape backs out without continuing.
//
// What this scene resolves for the skin:
//
//   - `text[].ref` — TITLE / SUBTITLE / FULLTITLE / GENRE / ARTIST / SUBARTIST / FULLARTIST,
//     pulled from the picked song so the splash matches the chart about to play.
//   - `value[].ref` — PLAYLEVEL, MAINBPM (from chart metadata when available), and the rest
//     are returned as 0 (no live engine state to surface during decide).
//
// What this scene does NOT do:
//   - Score-best-record lookups (no DB layer)
//   - Per-side (1P / 2P) chart info — only single-player decide is exercised today.

import { Container, Graphics, type Ticker } from 'pixi.js';
import {
  BEATORAJA_NUM,
  BEATORAJA_OP,
  TIMER_PLAY,
  TIMER_READY,
  TIMER_SCENE_START,
  TIMER_STARTINPUT,
  buildBaseOpSet,
  type BeatorajaSkin,
  type BeatorajaSkinConfig,
} from '@be-music/beatoraja-skin';
import type { BeMusicJson } from '@be-music/json';
import { BeatorajaPlaySkinView } from './skin-view.ts';
import { computeBeatorajaBpmCurve, type BpmCurvePoint } from '../../chart/beatoraja/bpm-curve.ts';
import { computeBeatorajaNoteBreakdown } from '../../chart/beatoraja/note-counts.ts';
import { BeatorajaSceneTransition } from '../../skin/beatoraja/scene-transition.ts';
import type { BeatorajaTextureCache } from '../../skin/beatoraja/textures.ts';
import type { BeatorajaFontCache } from '../../skin/beatoraja/fonts.ts';
import type { PixiScene, PixiSceneHost } from '../host.ts';
import type { BeatorajaSkinAudio } from '../../skin/beatoraja/audio.ts';
import type { BrowserSongEntry } from '../../collection/types.ts';
import {
  BeatorajaSceneBgmPlayer,
  fitBeatorajaViewToStage,
  resolveBeatorajaChartImage,
  resolveBeatorajaSongText,
  type BeatorajaChartImages,
} from './shared-scene.ts';

export interface PixiBeatorajaDecideSceneOptions {
  /** Decide skin (`header.type === 6`). */
  skin: BeatorajaSkin;
  textures: BeatorajaTextureCache;
  fonts?: BeatorajaFontCache;
  /** Confirmed user picks for the skin's `property[]`. */
  skinConfig?: BeatorajaSkinConfig;
  /** Song the user picked; drives the text-ref resolver. Optional → text destinations render empty. */
  song?: BrowserSongEntry;
  /**
   * Parsed chart for the picked song. Used to compute the BPM curve for any `bpmgraph[]` element
   * the decide skin authors. Optional — when omitted, bpmgraph hides (decide themes that don't
   * preview the BPM curve work fine without this).
   */
  chart?: BeMusicJson;
  /**
   * Optional decide BGM bytes (WAV / OGG / MP3). Played once at scene `enter()`. The scene owns
   * its own short-lived `AudioContext` so the splash audio doesn't bleed into other scenes; the
   * context is closed in `dispose()`. Decoding is lazy on `enter()` — passing pre-decoded bytes
   * here keeps the scene constructor cheap.
   */
  bgmBytes?: Uint8Array;
  /**
   * Pre-decoded chart imagery for the synthetic-id slots `-100 STAGEFILE` / `-101 BACKBMP` /
   * `-102 BANNER`. Default decide skin and ModernChic both author a `-100` destination that
   * paints the chart's loading-screen art behind the title; ModernChic also uses `-110 BLACK`
   * as an overlay (handled separately by the view as a synthetic black quad).
   *
   * Hosts that have decoded the chart's bitmaps pass them in here; missing entries hide the
   * matching destinations. Loading is the host's responsibility — the scene doesn't own a
   * decoder for arbitrary BMP / PNG / JPG paths.
   */
  chartImages?: BeatorajaChartImages;
  /**
   * Optional override for the auto-advance window in ms. When unset, the scene reads
   * {@link BeatorajaSkin.scene} from the parsed skin (mirrors upstream `MusicDecide.render`'s
   * `nowtime > getSkin().getScene()` gate at `decide/MusicDecide.java:29`). The default
   * `decidemain.lua` ships `scene = 3000`, so the splash holds for 3 s before auto-firing
   * the fadeout — this preserves that behavior while letting hosts override for tests or
   * custom flows. Set to `0` to disable auto-advance entirely (the user must press Enter /
   * Space to continue).
   *
   * @default skin.scene ?? {@link DEFAULT_DECIDE_SCENE_MS}
   */
  autoAdvanceMs?: number;
  /**
   * Optional audio backend for `main_state.audio_play / loop / stop` calls fired by Lua-driven
   * skins (ModernChic's `Root/customsound.lua` is the heavy user — every panel toggle / song
   * change calls through it). Forwarded into the per-frame render context so BooleanProperty
   * closures evaluated at draw time can fire SE. Hosts that don't want SE just leave this off.
   */
  skinAudio?: BeatorajaSkinAudio;
  /**
   * Fired exactly once when the scene transitions out toward gameplay — either the auto-advance
   * timer fired or the user confirmed with Enter / Space. The host typically chains into the
   * gameplay scene here.
   */
  onContinue?: () => void;
  /**
   * Fired exactly once when the user backs out (Escape). When omitted, Escape falls through to
   * `onContinue` so the splash stays dismissable in any environment.
   */
  onCancel?: () => void;
  /**
   * Optional live load-progress hook in `[0, 1]`. The decide scene polls this once per tick and
   * surfaces the value through:
   *
   *   - `value[].ref = 165` (`BEATORAJA_NUM.LOADING_PROGRESS`) — the integer percentage `0..100`
   *     that beatoraja themes display next to the splash loading bar.
   *   - `graph[].type = 102` — the proportional bar-fill the default skin authors as
   *     `{ id = "load-progress", type = 102 }`. Filled from `0` (empty) to `1` (full).
   *   - `op` set membership — `BEATORAJA_OP.NOW_LOADING` (80) is active while progress `< 1`,
   *     `BEATORAJA_OP.LOADED` (81) is active at `>= 1`. Reference theme destinations gate
   *     `load-progress` chrome on `op = {80}` and "press to continue" prompts on `op = {81}`.
   *
   * When omitted, the scene synthesizes a 0 → 1 ramp tied to the {@link autoAdvanceMs} window —
   * good enough for the common case where assets pre-decode at the host before decide mounts
   * (the splash is just a brief consistent dramatic pause). Hosts that DO have async asset prep
   * running concurrently should override this with the prep's actual progress so the bar tracks
   * reality instead of an arbitrary synthetic clock.
   */
  getLoadingProgress?: () => number;
}

/**
 * Default auto-advance window when neither the host override nor the skin authors `scene`.
 * Mirrors the `decidemain.lua` reference value (3000 ms). Upstream's `Skin.scene` defaults
 * to `24h` for "never auto-advance", but the decide scene is unique in that it ALWAYS
 * authors a real value — falling back to 24h here would silently break headless tests or
 * hand-rolled fixtures that omit the field.
 */
const DEFAULT_DECIDE_SCENE_MS = 3000;
/**
 * Default input-active delay when the skin doesn't author `input`. Mirrors the
 * `decidemain.lua` reference value (500 ms) and upstream `MusicDecide.render` line 22-24:
 *
 *     if (nowtime > getSkin().getInput()) {
 *         timer.switchTimer(TIMER_STARTINPUT, true);
 *     }
 *
 * Until that gate elapses, input-gated chrome (e.g. "press Enter to continue" prompts)
 * stays hidden.
 */
const DEFAULT_DECIDE_INPUT_MS = 500;

export class PixiBeatorajaDecideScene implements PixiScene {
  readonly root: Container = new Container();
  private readonly backdrop = new Graphics();
  private view: BeatorajaPlaySkinView;
  private readonly options: PixiBeatorajaDecideSceneOptions;
  private host?: PixiSceneHost;
  private tickerHandle?: (ticker: Ticker) => void;
  private startMs = 0;
  /**
   * Stamped at scene `enter()`. Subsequent calls clamp to this value so the timer ladder is
   * monotonic even if the host's clock drifts (e.g. tab backgrounded then refocused).
   */
  private timerStartedAt: Map<number, number> = new Map();
  private lastFitWidth = 0;
  private lastFitHeight = 0;
  /**
   * Drives the `Skin.scene → setTimerOn(TIMER_FADEOUT) → wait skin.fadeout → changeState`
   * lifecycle from upstream `MusicDecide.render` (`decide/MusicDecide.java:25-32`). Allocated
   * per `enter()` so re-entered scenes (host re-uses the instance after a back-out) start
   * fresh. The fadeout window honors `skin.fadeout` with a 500 ms fallback that matches
   * `decidemain.lua`'s reference value.
   */
  private transitionToContinue: BeatorajaSceneTransition | undefined;
  private transitionToCancel: BeatorajaSceneTransition | undefined;
  private disposed = false;
  private readonly bgm = new BeatorajaSceneBgmPlayer('beatoraja-decide', () => this.disposed);
  private cachedBaseOps: ReadonlySet<number> | undefined;
  /** Cached BPM polyline for the picked chart — `[]` when no chart was supplied. */
  private readonly chartBpmCurve: ReadonlyArray<BpmCurvePoint>;
  /**
   * Cached note-breakdown bars for the `judgegraph` `type:0` resolver — `[normal, ln, scratch,
   * bss]` from the chart's playable events. Computed once at construction; `undefined` when no
   * chart was supplied so the graph hides.
   */
  private readonly noteBreakdownBars: ReadonlyArray<number> | undefined;

  constructor(options: PixiBeatorajaDecideSceneOptions) {
    this.options = options;
    this.chartBpmCurve = options.chart !== undefined ? computeBeatorajaBpmCurve(options.chart) : [];
    if (options.chart !== undefined) {
      const breakdown = computeBeatorajaNoteBreakdown(options.chart);
      this.noteBreakdownBars = [breakdown.normal, breakdown.ln, breakdown.scratch, breakdown.bss];
    } else {
      this.noteBreakdownBars = undefined;
    }
    this.view = new BeatorajaPlaySkinView({
      skin: options.skin,
      textures: options.textures,
      resolveTextContent: (refOp) => this.resolveSongText(refOp),
      resolveNumberValue: (refOp) => this.resolveSongNumber(refOp),
      resolveFontFamily: options.fonts ? (id) => options.fonts!.family(id) : undefined,
      resolveFontKind: options.fonts ? (id) => options.fonts!.kind(id) : undefined,
      resolveBpmGraphPoints: () => (this.chartBpmCurve.length > 0 ? this.chartBpmCurve : undefined),
      // Note-distribution graph (`judgegraph` `type:0`) — ModernChic's decide pane authors
      // a 4-bar histogram of [normal / LN / scratch / BSS] from the chart's note breakdown.
      // Skipped (returns `undefined` → graph hidden) for the live-judge histogram types
      // (1=judge spread, 2=early/late) since decide is pre-play; those have no data yet.
      resolveJudgeGraphBars: (type) => this.resolveJudgeGraphBars(type),
      // Bar-fill graphs. `type = 102` is the loading-progress bar — default play7's
      // `{ id = "load-progress", type = 102 }` graph. The decide scene fills this `0 → 1`
      // across the splash window so the skin's authored bar visually progresses (rather than
      // staying empty for the splash duration). Other `type` values fall through to
      // `undefined` so unknown graph kinds hide cleanly.
      resolveGraphValue: (type) => (type === 102 ? this.currentLoadingProgress() : undefined),
      // Synthetic-id chart-image lookup. `-100 STAGEFILE` / `-101 BACKBMP` / `-102 BANNER`
      // resolve to the host-supplied textures; missing entries return `undefined` and the
      // matching destinations stay hidden.
      chartImageProvider: (id) => resolveBeatorajaChartImage(this.options.chartImages, id),
    });
    this.root.addChild(this.backdrop);
    this.root.addChild(this.view.container);
    // eslint-disable-next-line no-console
    console.log(
      '[beatoraja-decide] mounted',
      JSON.stringify({
        canvas: { w: this.view.width, h: this.view.height },
        skinName: options.skin.name,
        song: options.song?.title,
      }),
    );
  }

  enter(host: PixiSceneHost): void {
    if (this.disposed) return;
    this.host = host;
    this.startMs = performance.now();
    this.fitToStage();
    // Resolve `Skin.input` per upstream `MusicDecide.render` line 22-24. Reference theme
    // ships `input = 500`; we fall back to the same value when the skin omits the field
    // so headless tests / hand-rolled fixtures behave consistently.
    const inputDelayMs =
      typeof this.options.skin.input === 'number' && Number.isFinite(this.options.skin.input)
        ? this.options.skin.input
        : DEFAULT_DECIDE_INPUT_MS;
    // Stamp the timer ladder at scene-start. `TIMER_SCENE_START = 0` is always at 0 ms (the global
    // clock); `TIMER_STARTINPUT = 1` fires after the `Skin.input` idle so input-gated chrome only
    // appears once the splash has settled. `TIMER_READY = 40` and `TIMER_PLAY = 41` are present so
    // chrome gated on "post-load" / "now playing" ops also reveals during the splash — the gameplay
    // scene re-stamps them when it mounts, so nothing in the live path notices.
    this.timerStartedAt = new Map([
      [TIMER_SCENE_START, 0],
      [TIMER_STARTINPUT, inputDelayMs],
      [TIMER_READY, inputDelayMs],
      [TIMER_PLAY, inputDelayMs],
    ]);
    // Two parallel transition slots — one for the "continue" hand-off (auto-advance / Enter /
    // Space) and one for "cancel" (Escape). Whichever fires first wins (the helpers are gated
    // by `isFadingOut()` to ignore late triggers); they only differ in which callback fires
    // when the fadeout window completes.
    const fadeoutMs = this.options.skin.fadeout;
    this.transitionToContinue = new BeatorajaSceneTransition({
      fadeoutMs,
      getElapsedMs: () => performance.now() - this.startMs,
      stampFadeoutTimer: (timerId, atMs) => this.timerStartedAt.set(timerId, atMs),
      onComplete: () => this.options.onContinue?.(),
    });
    this.transitionToCancel = new BeatorajaSceneTransition({
      fadeoutMs,
      getElapsedMs: () => performance.now() - this.startMs,
      stampFadeoutTimer: (timerId, atMs) => this.timerStartedAt.set(timerId, atMs),
      onComplete: () => (this.options.onCancel ?? this.options.onContinue)?.(),
    });
    this.tickerHandle = () => this.tick();
    host.app.ticker.add(this.tickerHandle);
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.handleKeyDown);
    }
    void this.bgm.start(this.options.bgmBytes);
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
    // Drop the per-enter() transition helpers so a future re-entry rebuilds them. The
    // helpers' internal `completed` latch would otherwise carry over and silently no-op
    // future fadeouts on the same instance.
    this.transitionToContinue = undefined;
    this.transitionToCancel = undefined;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.exit();
    this.bgm.stop();
    this.view.dispose();
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
    const skinAudio = this.options.skinAudio;
    this.view.update({
      activeOps: this.computeActiveOps(),
      // Pass through the raw value so unfired timers return `undefined` and the destination
      // renderer hides any element gated on them. The earlier `?? 0` fallback made every
      // timer behave as if it fired at scene start — wrong for `TIMER_FADEOUT` (id=2): the
      // default decide skin authors a fullscreen black fade-IN destination keyed on
      // `timer=2`, so the splash painted black from the moment it mounted instead of waiting
      // for the auto-advance / user-dismiss path to stamp the timer.
      getTimerStart: (timerId) => this.timerStartedAt.get(timerId),
      nowMs: elapsed,
      audioPlay: skinAudio === undefined ? undefined : (path, vol) => skinAudio.play(path, vol),
      audioLoop: skinAudio === undefined ? undefined : (path, vol) => skinAudio.loop(path, vol),
      audioStop: skinAudio === undefined ? undefined : (path) => skinAudio.stop(path),
    });

    // Auto-advance trigger — mirrors upstream `MusicDecide.render` line 28-32:
    //
    //     if (nowtime > getSkin().getScene()) {
    //         timer.setTimerOn(TIMER_FADEOUT);
    //     }
    //
    // ...and the `if (timer.isTimerOn(TIMER_FADEOUT))` check at line 25 prevents re-stamps.
    // We only kick off the "continue" transition when neither slot has begun a fadeout yet
    // (a user-driven Escape can race the auto-advance; whichever fires first wins).
    const autoAdvance = this.resolveAutoAdvanceMs();
    if (
      !this.isAnyTransitionActive() &&
      autoAdvance > 0 &&
      elapsed >= autoAdvance &&
      this.transitionToContinue !== undefined
    ) {
      this.transitionToContinue.begin();
    }
    // Per-frame fadeout-window poll. Helpers are idempotent — the one that hasn't been
    // `begin()`ed no-ops, the active one fires `onComplete` once the window elapses.
    this.transitionToContinue?.tick();
    this.transitionToCancel?.tick();
  }

  /**
   * Resolve the effective auto-advance window in ms. Order of precedence:
   *   1. {@link PixiBeatorajaDecideSceneOptions.autoAdvanceMs} — host override (test fixtures).
   *   2. `skin.scene` from the parsed skin — upstream `MusicDecide.render`'s `getSkin().getScene()`.
   *   3. {@link DEFAULT_DECIDE_SCENE_MS} — matches `decidemain.lua` reference value (3000 ms).
   */
  private resolveAutoAdvanceMs(): number {
    const override = this.options.autoAdvanceMs;
    if (typeof override === 'number' && Number.isFinite(override) && override >= 0) {
      return override;
    }
    const skinScene = this.options.skin.scene;
    if (typeof skinScene === 'number' && Number.isFinite(skinScene) && skinScene >= 0) {
      return skinScene;
    }
    return DEFAULT_DECIDE_SCENE_MS;
  }

  /**
   * `true` while either the continue or cancel transition is mid-fadeout. Used by the
   * tick + key handler to short-circuit further triggers, mirroring upstream's
   * `if (timer.isTimerOn(TIMER_FADEOUT))` short-circuit.
   */
  private isAnyTransitionActive(): boolean {
    return this.transitionToContinue?.isFadingOut() === true || this.transitionToCancel?.isFadingOut() === true;
  }

  /** Stable per-skin op set (skin_config.option picks). Live ops are added by `computeActiveOps`. */
  private baseOps(): ReadonlySet<number> {
    if (this.cachedBaseOps !== undefined) return this.cachedBaseOps;
    this.cachedBaseOps = buildBaseOpSet(this.options.skinConfig?.option);
    return this.cachedBaseOps;
  }

  /**
   * Per-frame active op set. Combines the stable base ops with the picked song's chart-derived
   * difficulty op block (both beatoraja-native LEVEL_* 70-74 and LR2-style DIFFICULTY_* 150-155
   * fire so either flavour of skin renders). Without this, GdbG_Skin's per-difficulty labels +
   * level numerals stay hidden, and ModernChic's tablename / genre / title / artist / category
   * (all gated on `MAIN.OP.DIFFICULTY1..5,0` = 151..155, 150) never reveal.
   */
  private computeActiveOps(): ReadonlySet<number> {
    const ops = new Set(this.baseOps());
    const difficulty = this.options.song?.chart.metadata.difficulty;
    switch (difficulty) {
      case 1:
        ops.add(BEATORAJA_OP.LEVEL_BEGINNER);
        ops.add(BEATORAJA_OP.DIFFICULTY_BEGINNER);
        break;
      case 2:
        ops.add(BEATORAJA_OP.LEVEL_NORMAL);
        ops.add(BEATORAJA_OP.DIFFICULTY_NORMAL);
        break;
      case 3:
        ops.add(BEATORAJA_OP.LEVEL_HYPER);
        ops.add(BEATORAJA_OP.DIFFICULTY_HYPER);
        break;
      case 4:
        ops.add(BEATORAJA_OP.LEVEL_ANOTHER);
        ops.add(BEATORAJA_OP.DIFFICULTY_ANOTHER);
        break;
      case 5:
        ops.add(BEATORAJA_OP.LEVEL_INSANE);
        ops.add(BEATORAJA_OP.DIFFICULTY_INSANE);
        break;
      default:
        ops.add(BEATORAJA_OP.DIFFICULTY_UNDEFINED);
        break;
    }
    // Loading-state op gates. Reference theme destinations gate the splash-progress chrome on
    // `op = {80}` (NOW_LOADING) so the bar only appears WHILE loading, and "press to continue"
    // prompts on `op = {81}` (LOADED) so they reveal once the load has finished. Mirror the
    // same flip-flop here using {@link currentLoadingProgress} as the source of truth: while
    // progress < 1 the bar is visible; at >= 1 the prompts (and any post-load chrome) reveal.
    if (this.currentLoadingProgress() < 1) {
      ops.add(BEATORAJA_OP.NOW_LOADING);
    } else {
      ops.add(BEATORAJA_OP.LOADED);
    }
    return ops;
  }

  /**
   * Resolve the active loading-progress ratio in `[0, 1]`. Order of precedence:
   *
   *   1. Host-supplied {@link PixiBeatorajaDecideSceneOptions.getLoadingProgress} when set —
   *      lets a host with real async asset prep drive the bar from actual completion data.
   *   2. Synthesized ramp tied to {@link autoAdvanceMs}: `elapsed / window`. Default 1500 ms
   *      window means the bar fills smoothly across the splash duration. Clamped to `[0, 1]`
   *      so the resolver never returns out-of-range values even if the host's clock drifts
   *      past the auto-advance.
   *
   * The synthesized fallback is "honest enough" because the decide scene runs concurrently
   * with — or after — the host's real prep step; the user perceives the splash as "loading"
   * and the bar's smooth fill matches that mental model regardless of whether the prep is
   * actually still working.
   */
  private currentLoadingProgress(): number {
    const supplied = this.options.getLoadingProgress?.();
    if (typeof supplied === 'number' && Number.isFinite(supplied)) {
      return Math.max(0, Math.min(1, supplied));
    }
    const autoAdvance = this.resolveAutoAdvanceMs();
    if (autoAdvance <= 0) return 1;
    if (this.startMs === 0) return 0;
    const elapsed = performance.now() - this.startMs;
    if (elapsed <= 0) return 0;
    return Math.min(1, elapsed / autoAdvance);
  }

  /**
   * `judgegraph` resolver for the decide scene. Maps `type:0` (note distribution histogram)
   * onto the chart's pre-computed `[normal, ln, scratch, bss]` breakdown — ModernChic's decide
   * pane uses this for the centred 4-bar graph above the title text. Live-judge types (1=judge
   * spread, 2=early/late) have no pre-play data and stay hidden.
   */
  private resolveJudgeGraphBars(type: number): ReadonlyArray<number> | undefined {
    if (type === 0) return this.noteBreakdownBars;
    return undefined;
  }

  private resolveSongText(refOp: number): string | undefined {
    return resolveBeatorajaSongText(refOp, {
      song: this.options.song,
      skin: this.options.skin,
      tableTextFallback: '',
    });
  }

  /**
   * Decide-scene `value[].ref` resolver. Surfaces the chart's metadata (level / BPM) when the
   * picked song has it; everything else returns 0 so the skin renders zero (still readable) rather
   * than treating the slot as missing. Returning `undefined` would cause the resolver's
   * "ref not wired" log to fire on every value the decide skin authors — most decide skins use a
   * dozen metadata slots for stat displays, and they're all genuinely "not yet wired" rather than
   * "engine bug", so silencing them keeps the console legible.
   */
  private resolveSongNumber(refOp: number): number | undefined {
    const song = this.options.song;
    switch (refOp) {
      case BEATORAJA_NUM.PLAYLEVEL: {
        if (song?.playLevel === undefined) return 0;
        const parsed =
          typeof song.playLevel === 'number' ? Math.trunc(song.playLevel) : Number.parseInt(String(song.playLevel), 10);
        return Number.isFinite(parsed) ? parsed : 0;
      }
      case BEATORAJA_NUM.MAINBPM:
      case BEATORAJA_NUM.MAXBPM:
      case BEATORAJA_NUM.MINBPM:
      case BEATORAJA_NUM.NOWBPM:
        return Math.round(song?.bpm ?? 0);
      // `loading_progress = 165` — integer percentage shown next to the splash loading bar.
      // Driven by {@link currentLoadingProgress} so themes that author both the bar
      // (`graph[].type = 102`) AND the percent readout (`value[].ref = 165`) see them rise
      // together. Rounded to the nearest integer because beatoraja's value displays don't
      // surface fractional digits for this slot.
      case BEATORAJA_NUM.LOADING_PROGRESS:
        return Math.round(this.currentLoadingProgress() * 100);
      // Decide is "between" select and gameplay — there's no live score / combo / judge to display
      // yet, but a skin author may still author value slots for them. Return 0 to keep the
      // readouts visually present without spamming "ref not wired" warnings.
      default:
        return 0;
    }
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
    // Mirrors upstream `MusicDecide.render` line 25 short-circuit — once a fadeout has
    // begun, additional key presses are ignored. (Note: upstream's `cancel` flag CAN be
    // mutated mid-fadeout to flip the destination scene, but the timer is never re-stamped.
    // We separate continue / cancel into two helpers to keep the destination immutable
    // post-trigger; the more common UX pattern.)
    if (this.isAnyTransitionActive()) return;
    // Gate input on `Skin.input` per upstream `MusicDecide.render` line 22 — `nowtime >
    // getSkin().getInput()`. Stops the user from accidentally dismissing the splash within
    // the first few hundred ms while their finger is still on the Enter key from the
    // select scene's confirmation.
    const elapsed = performance.now() - this.startMs;
    const inputDelay =
      typeof this.options.skin.input === 'number' && Number.isFinite(this.options.skin.input)
        ? this.options.skin.input
        : DEFAULT_DECIDE_INPUT_MS;
    if (elapsed < inputDelay) return;
    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.transitionToContinue?.begin();
        break;
      case 'Escape':
        event.preventDefault();
        this.transitionToCancel?.begin();
        break;
    }
  };
}

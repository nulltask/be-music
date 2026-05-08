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
//   - Audio cues (the LR2 splash plays a per-theme `decide.wav`; beatoraja themes typically
//     bundle their own — wiring decide BGM is a follow-up patch)
//   - Per-side (1P / 2P) chart info — only single-player decide is exercised today.

import { Container, Graphics, type Ticker } from 'pixi.js';
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
  type BeatorajaSkin,
  type BeatorajaSkinConfig,
} from '@be-music/beatoraja-skin';
import type { BeMusicJson } from '@be-music/json';
import { BeatorajaPlaySkinView } from './pixi-beatoraja-skin-view.ts';
import { computeBeatorajaBpmCurve, type BpmCurvePoint } from './beatoraja-chart-bpm-curve.ts';
import { computeBeatorajaNoteBreakdown } from './beatoraja-chart-note-counts.ts';
import type { BeatorajaTextureCache } from './beatoraja-textures.ts';
import type { BeatorajaFontCache } from './beatoraja-fonts.ts';
import type { PixiScene, PixiSceneHost } from './pixi-scene-host.ts';
import type { BrowserSongEntry } from './types.ts';

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
  chartImages?: {
    stageFile?: import('pixi.js').Texture;
    backBmp?: import('pixi.js').Texture;
    banner?: import('pixi.js').Texture;
  };
  /**
   * Auto-advance window in ms. The scene fires `onContinue` automatically after this many ms have
   * elapsed since `enter()`, mirroring beatoraja's reference behavior of holding the splash for a
   * short consistent window before kicking off gameplay. Set to `0` to disable auto-advance (the
   * user must press Enter / Space to continue).
   *
   * @default 1500
   */
  autoAdvanceMs?: number;
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
}

const DEFAULT_AUTO_ADVANCE_MS = 1500;
/** Delay before stamping `TIMER_STARTINPUT` (= 1). Mirrors LR2's ~500 ms idle before input is taken. */
const STARTINPUT_DELAY_MS = 500;

export class PixiBeatorajaDecideScene implements PixiScene {
  readonly root = new Container();
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
  private advanced = false;
  private disposed = false;
  private cachedBaseOps: ReadonlySet<number> | undefined;
  /**
   * Scene-owned `AudioContext` for the decide BGM. Lazily created on first `enter()` when
   * `bgmBytes` is set. Closed in `dispose()` so the OS audio output isn't held open longer than
   * the scene's visible lifetime.
   */
  private audioContext: AudioContext | undefined;
  private bgmSource: AudioBufferSourceNode | undefined;
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
      // Synthetic-id chart-image lookup. `-100 STAGEFILE` / `-101 BACKBMP` / `-102 BANNER`
      // resolve to the host-supplied textures; missing entries return `undefined` and the
      // matching destinations stay hidden.
      chartImageProvider: (id) => this.resolveChartImage(id),
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
    // Stamp the timer ladder at scene-start. `TIMER_SCENE_START = 0` is always at 0 ms (the global
    // clock); `TIMER_STARTINPUT = 1` fires after a short idle so input-gated chrome only appears
    // once the splash has settled. `TIMER_READY = 40` and `TIMER_PLAY = 41` are present so chrome
    // gated on "post-load" / "now playing" ops also reveals during the splash — the gameplay scene
    // re-stamps them when it mounts, so nothing in the live path notices.
    this.timerStartedAt = new Map([
      [TIMER_SCENE_START, 0],
      [TIMER_STARTINPUT, STARTINPUT_DELAY_MS],
      [TIMER_READY, STARTINPUT_DELAY_MS],
      [TIMER_PLAY, STARTINPUT_DELAY_MS],
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

  /**
   * Decode + start the decide BGM. Lazy in two senses: the `AudioContext` is constructed on
   * demand (so headless tests that never `enter()` the scene don't allocate one), and the bytes
   * are decoded inline on first play (cheap for the few hundred KB BGM payloads — fast enough
   * that the splash isn't visibly silent on the first frame).
   *
   * No-op when `bgmBytes` is unset, the browser doesn't expose `AudioContext`, or the decode
   * fails. Failures are logged once and don't tear down the scene — the user still sees the
   * splash, just silent.
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
      // The user just confirmed a song pick — that gesture should be enough to satisfy autoplay
      // policy. Ignore resume failures (they happen in tests / iframe sandboxes); the rest of
      // the scene still works without sound.
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
      console.warn('[beatoraja-decide] bgm playback failed', error);
    }
  }

  /** Halt + tear down the decide BGM. Idempotent; safe to call before `startBgm` ever ran. */
  private stopBgm(): void {
    if (this.bgmSource !== undefined) {
      try {
        this.bgmSource.stop();
      } catch {
        /* already stopped — ignore */
      }
      this.bgmSource.disconnect();
      this.bgmSource = undefined;
    }
    if (this.audioContext !== undefined) {
      // Closing the context is async but we don't await — the OS resource cleanup happens
      // on its own schedule and we don't block the scene's tear-down on it.
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
      activeOps: this.computeActiveOps(),
      // Pass through the raw value so unfired timers return `undefined` and the destination
      // renderer hides any element gated on them. The earlier `?? 0` fallback made every
      // timer behave as if it fired at scene start — wrong for `TIMER_FADEOUT` (id=2): the
      // default decide skin authors a fullscreen black fade-IN destination keyed on
      // `timer=2`, so the splash painted black from the moment it mounted instead of waiting
      // for the auto-advance / user-dismiss path to stamp the timer.
      getTimerStart: (timerId) => this.timerStartedAt.get(timerId),
      nowMs: elapsed,
    });

    // Auto-advance hand-off. Fired once per scene; subsequent ticks no-op via `advanced`.
    const autoAdvance = this.options.autoAdvanceMs ?? DEFAULT_AUTO_ADVANCE_MS;
    if (!this.advanced && autoAdvance > 0 && elapsed >= autoAdvance) {
      // Stamp the fadeout timer for chrome gated on `TIMER_FADEOUT` (e.g., outro animations) — the
      // scene stays mounted for a few extra frames before the host swaps it out, giving the timer
      // a chance to drive its keyframes.
      this.timerStartedAt.set(TIMER_FADEOUT, elapsed);
      this.advance(() => this.options.onContinue?.());
    }
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
    return ops;
  }

  private advance(then: () => void): void {
    if (this.advanced) return;
    this.advanced = true;
    then();
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

  /**
   * Synthetic chart-image resolver. Maps the negative-id sentinels onto whichever pre-decoded
   * chart bitmaps the host supplied via `chartImages`. Missing entries return `undefined`,
   * which the view interprets as "destination hidden".
   *
   *   -100 STAGEFILE — the chart's `#STAGEFILE` (loading-screen art).
   *   -101 BACKBMP   — the chart's `#BACKBMP` (select-screen preview).
   *   -102 BANNER    — the chart's `#BANNER` (small song-bar banner).
   */
  private resolveChartImage(syntheticId: number): import('pixi.js').Texture | undefined {
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
        // BrowserSongEntry doesn't carry sub-artist — surface empty rather than `undefined` so the
        // text destination doesn't disappear (would confuse skins that style the row regardless).
        return '';
      case BEATORAJA_TEXT.FULLARTIST:
        return song?.artist ?? '';
      // Skin / directory metadata. The skin header is always present (we just mounted it); the
      // song's directory label may be empty when the host didn't preserve folder info.
      case BEATORAJA_TEXT.SKIN_NAME:
        return skin.name ?? '';
      case BEATORAJA_TEXT.SKIN_AUTHOR:
        return skin.author ?? '';
      case BEATORAJA_TEXT.DIRECTORY:
        return song?.directoryLabel ?? '';
      // Difficulty-table refs (1001/1002/1003) — used by GdbG_Skin's decide for "★1" labels
      // when the user is playing through a dan-grade table course. We don't have table mode
      // yet, so return empty strings — keeps the destinations alive (skin authors style the
      // row regardless) without rendering stale / placeholder text.
      case BEATORAJA_TEXT.TABLE_NAME:
      case BEATORAJA_TEXT.TABLE_LEVEL:
      case BEATORAJA_TEXT.TABLE_FULL:
        return '';
      default:
        return undefined;
    }
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
      // Decide is "between" select and gameplay — there's no live score / combo / judge to display
      // yet, but a skin author may still author value slots for them. Return 0 to keep the
      // readouts visually present without spamming "ref not wired" warnings.
      default:
        return 0;
    }
  }

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
    if (this.disposed) return;
    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.advance(() => this.options.onContinue?.());
        break;
      case 'Escape':
        event.preventDefault();
        this.advance(() => (this.options.onCancel ?? this.options.onContinue)?.());
        break;
    }
  };
}

function joinNonEmpty(...parts: ReadonlyArray<string | undefined>): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' ');
}

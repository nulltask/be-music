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

  constructor(options: PixiBeatorajaDecideSceneOptions) {
    this.options = options;
    this.chartBpmCurve = options.chart !== undefined ? computeBeatorajaBpmCurve(options.chart) : [];
    this.view = new BeatorajaPlaySkinView({
      skin: options.skin,
      textures: options.textures,
      resolveTextContent: (refOp) => this.resolveSongText(refOp),
      resolveNumberValue: (refOp) => this.resolveSongNumber(refOp),
      resolveFontFamily: options.fonts ? (id) => options.fonts!.family(id) : undefined,
      resolveFontKind: options.fonts ? (id) => options.fonts!.kind(id) : undefined,
      resolveBpmGraphPoints: () => (this.chartBpmCurve.length > 0 ? this.chartBpmCurve : undefined),
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
      activeOps: this.baseOps(),
      // Sample timers from the latched map. Entries returned as `0` for timers that haven't been
      // stamped yet — the skin sees them as "fired at scene start" and animations gated on those
      // timers play out from the start of the splash, which matches beatoraja's behavior on
      // un-stamped timers.
      getTimerStart: (timerId) => this.timerStartedAt.get(timerId) ?? 0,
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

  private baseOps(): ReadonlySet<number> {
    if (this.cachedBaseOps !== undefined) return this.cachedBaseOps;
    this.cachedBaseOps = buildBaseOpSet(this.options.skinConfig?.option);
    return this.cachedBaseOps;
  }

  private advance(then: () => void): void {
    if (this.advanced) return;
    this.advanced = true;
    then();
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

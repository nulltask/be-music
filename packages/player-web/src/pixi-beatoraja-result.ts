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

import { Container, Graphics, type Ticker } from 'pixi.js';
import type { PlayerSummary } from '@be-music/player/core/engine';
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
import { BeatorajaPlaySkinView } from './pixi-beatoraja-skin-view.ts';
import type { BeatorajaTextureCache } from './beatoraja-textures.ts';
import type { BeatorajaFontCache } from './beatoraja-fonts.ts';
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
  /** Final per-judge / score snapshot from gameplay's `onComplete`. */
  summary: PlayerSummary;
  /**
   * Maximum combo achieved this run, latched independently of `summary` because `PlayerSummary`
   * doesn't carry a max-combo field — gameplay is the only place where the running combo can be
   * observed before it resets on a break verdict.
   */
  maxCombo: number;
  /** Fired exactly once when the user dismisses the result (Enter / Space / Escape). */
  onContinue?: () => void;
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

  constructor(options: PixiBeatorajaResultSceneOptions) {
    this.options = options;
    this.view = new BeatorajaPlaySkinView({
      skin: options.skin,
      textures: options.textures,
      resolveTextContent: (refOp) => this.resolveSongText(refOp),
      resolveNumberValue: (refOp) => this.resolveResultNumber(refOp),
      resolveFontFamily: options.fonts ? (id) => options.fonts!.family(id) : undefined,
      resolveFontKind: options.fonts ? (id) => options.fonts!.kind(id) : undefined,
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
    this.view.dispose();
    if (!this.root.destroyed) {
      this.root.destroy({ children: false });
    }
  }

  // ─── Internals ────────────────────────────────────────────────────────────────────────────────

  private tick(): void {
    if (this.disposed) return;
    this.fitToStage();
    const elapsed = performance.now() - this.startMs;
    this.view.update({
      activeOps: this.baseOps(),
      getTimerStart: (timerId) => this.timerStartedAt.get(timerId) ?? 0,
      nowMs: elapsed,
    });
  }

  private baseOps(): ReadonlySet<number> {
    if (this.cachedBaseOps !== undefined) return this.cachedBaseOps;
    this.cachedBaseOps = buildBaseOpSet(this.options.skinConfig?.option);
    return this.cachedBaseOps;
  }

  private resolveSongText(refOp: number): string | undefined {
    const song = this.options.song;
    if (song === undefined) return '';
    switch (refOp) {
      case BEATORAJA_TEXT.TITLE:
        return song.title;
      case BEATORAJA_TEXT.SUBTITLE:
        return song.subtitle ?? '';
      case BEATORAJA_TEXT.FULLTITLE:
        return joinNonEmpty(song.title, song.subtitle);
      case BEATORAJA_TEXT.GENRE:
        return song.genre ?? '';
      case BEATORAJA_TEXT.ARTIST:
        return song.artist ?? '';
      case BEATORAJA_TEXT.SUBARTIST:
        return '';
      case BEATORAJA_TEXT.FULLARTIST:
        return song.artist ?? '';
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
      case BEATORAJA_NUM.COMBOBREAK:
      case BEATORAJA_NUM.BAD_PLUS_POOR_PLUS_MISS:
        return summary.bad + summary.poor;
      case BEATORAJA_NUM.POOR_PLUS_MISS:
        return summary.poor;

      // ─── Best-record / target / IR — no live data, return 0 to silence "ref not wired" ──
      // The result skin authors a lot of "vs best" / "vs target" slots; without a DB layer they
      // all stay at 0. Returning 0 (not undefined) keeps the readouts visually present and the
      // log clean.
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

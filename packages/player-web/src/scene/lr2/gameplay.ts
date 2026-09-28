import { Container, TextStyle, type Texture } from 'pixi.js';
import { computeScoreRate } from '@be-music/player/core/scoring';
import type { PlayerUiCommand } from '@be-music/player/core/ui-signal-bus';
import {
  type Lr2BarGraphElement,
  type Lr2DestinationRect,
  type Lr2ImageElement,
  type Lr2ImageRect,
  type Lr2JudgeLineElement,
  type Lr2Skin,
  type Lr2SliderElement,
  type Lr2SpecialGraphic,
  type Lr2TextElement,
  LR2_SPECIAL_GRAPHIC,
  isLr2SpecialGraphic,
} from '@be-music/lr2-skin';
import { loadAssetBytes, resolveChartImageAsset } from '../../collection/collection.ts';
import { loadSkinAssetTexture, loadTextureFromBytes } from '../../skin/lr2/textures.ts';
import {
  applyDestinationToSprite,
  createCroppedTexture,
  evaluateElementDestination,
  evaluateKeyframes,
  normalizeRect,
  pickAnimatedCell,
  renderNumberElement,
} from '../../skin/lr2/render.ts';
import { disposeChildren } from '../pixi-utils.ts';
import {
  BLUE,
  BOMB_CYCLE_MS,
  BOMB_DIVX,
  BOMB_DIVY,
  HISPEED_MAX,
  HISPEED_MIN,
  LR2_1P_BOMB_TIMER_BASE,
  LR2_1P_KEYON_TIMER_BASE,
  LR2_1P_LN_HOLD_TIMER_BASE,
  LR2_2P_BOMB_TIMER_BASE,
  LR2_2P_KEYON_TIMER_BASE,
  LR2_2P_LN_HOLD_TIMER_BASE,
  LR2_LANE_TIMER_BANK_SIZE,
  PLAYFIELD,
} from '../gameplay-constants.ts';
import { resolveLr2LaneIndex, resolveSideRelativeLaneIndex } from '../gameplay-lanes.ts';
import {
  computeBombDurationsMs,
  computeFullComboDurationMs,
  computeGaugeTimerDurationsMs,
  computeKeyOnFadeDurationsMs,
  computeLnHoldDurationsMs,
  computeRankOp,
  isLr2OverlayImage,
  lastJudgeToNowComboKind,
  renderGrooveGaugeElement,
  renderNowComboElement,
  resolveDifficultyName,
  resolveJudgeSkinKind,
  resolveNumberValue,
} from './gameplay-hud.ts';
import { LR2_JUDGE_FALLBACK_FONT, LR2_TEXT_FALLBACK_FONT } from './fonts.ts';
import {
  CoreGameplayView,
  KEY_ON_FADE_OUT_MS,
  type CoreGameplayViewOptions,
  type GameplayBgaTarget,
  type GameplayLaneRect,
  type GameplayMeasureLineFrame,
  type GameplayThemeEvent,
  type GameplayThemeNoteCell,
  type GameplayThemeNoteKind,
  type GameplayThemeTiming,
} from '../core/gameplay.ts';
import { loadSkinBitmapFonts } from '../../skin/lr2/font-loader.ts';
import { makeLr2BitmapTextSprite, type Lr2LoadedFont } from '../../skin/lr2/bitmap-text.ts';

/**
 * Fallback bomb-explosion cleanup duration in ms. The actual value used at runtime is the longest `time` keyframe
 * across the skin's elements gated on a given bomb timer (50..69), computed in {@link prepareSkin} via
 * `computeBombDurationsMs`. This constant is the fallback for bomb slots the loaded skin doesn't author. 150 ms matches
 * the LR2 default 7-keys skin's bomb cycle.
 */
const BOMB_CLEANUP_FALLBACK_MS = 150;

/**
 * Fallback gauge-increase timer (42 / 43) cleanup duration in ms, used when the loaded skin has no element authored on
 * those timers. ~300 ms is a comfortable flash window for the gauge bar "rise" sparkle when the skin doesn't dictate
 * one.
 */
const GAUGE_INCREASE_FALLBACK_MS = 300;

export type { GaugeHistorySample, PixiGameplayResultData, ScoreHistorySample } from '../core/result-data.ts';

/**
 * Constructor options for {@link PixiGameplayView}: every family-neutral gameplay knob from
 * {@link CoreGameplayViewOptions} plus the LR2 skin fields.
 */
export interface PixiGameplayViewOptions extends CoreGameplayViewOptions {
  /** LR2 play skin that paints the chrome, lanes, notes, and bombs. Omit to fall back to the skinless scene. */
  skin?: Lr2Skin;
  /**
   * Optional source skin for the green note sprite drawn on top of each invisible note when
   * {@link CoreGameplayViewOptions.showInvisibleNotes} is on. The renderer pulls `notes.note[3]` from this skin — index
   * 3 is the green wide note in the LR2 default `play_9.lr2skin` POP layout (Pop'n's third lane), so the convention
   * is: pass the loaded 9-keys play variant here and the invisible-note overlay uses the same green sprite a PMS chart
   * would.
   *
   * Falls back to a flat green rectangle when the skin is absent, lacks `notes.note[3]`, or its texture failed to load.
   * Texture is preloaded alongside the active skin's own assets in {@link prepareSkin} so by the time `renderNotes`
   * runs the cropped cell is ready.
   */
  invisibleNoteSkin?: Lr2Skin;
}

/**
 * LR2-family gameplay scene. Extends the family-neutral {@link CoreGameplayView} with everything an LR2 play skin
 * drives: atlas rendering, the LR2 timer / op tables, skin note sprites, textured bombs from the skin's BOMB file,
 * bitmap fonts, `#LOADSTART` / `#LOADEND` / `#PLAYSTART` / `#FADEOUT` / `#CLOSE` scene timing, the scratch turntable,
 * and the invisible-note skin. Without `skin` it paints exactly like the core scene.
 */
export class PixiGameplayView extends CoreGameplayView<PixiGameplayViewOptions> {
  /**
   * Sub-layer of `skinLayer` that hosts every `makeLr2BitmapTextSprite` Container created on the bitmap-font path of
   * `renderTextElement`. The bitmap-text helper returns a freshly-allocated `Container` each call, which the pool
   * abstraction can't recycle (it tracks `Sprite` / `Graphics` / `Text` instances only). Without this dedicated
   * sub-layer the per-frame Containers used to silently accumulate inside `skinLayer` after the pool refactor —
   * visible as the LR2 intro title text staying painted across every subsequent frame. We `disposeChildren` this
   * sub-layer at the top of every `renderThemeLayer` pass so its content is rebuilt from scratch each tick, the same
   * as the pre-pool path did for the whole skin layer.
   */
  private readonly skinBitmapTextLayer = new Container();
  /** Lazy-loaded LR2 bitmap fonts (font index → glyph payload). */
  private bitmapFonts: Map<number, Lr2LoadedFont> = new Map();

  /**
   * LR2 turntable physics — per-side angular state for sprites authored with `op4 === 1` (1P scratch) or `op4 === 2`
   * (2P scratch).
   *
   * Model: - **Baseline**: the disc always spins forward at a constant angular velocity (1 rev/sec). - **Press**: snaps
   * the velocity to `baseline ± delta`. The delta is larger than the baseline, so a brake (`−delta`) actually drives
   * `v` negative — the disc visibly reverses direction, like a real DJ scratching the platter back. - **Streak
   * alternation**: a press within {@link TURNTABLE_STREAK_GAP_MS} of the previous press continues a "scratch run" — the
   * sign flips on each press, so consecutive rapid hits alternate forward / reverse / forward / reverse just like
   * manual scratching. A press after a longer pause resets the streak so isolated presses always brake first (not jump
   * forward). - **Recovery**: between presses, velocity exponentially relaxes back to baseline, so the brake / forward
   * push fades and the disc resumes its idle cadence on its own.
   *
   * State is integrated in {@link updateTurntable} on the tick loop and read by `renderImageElement` per frame.
   */
  private turntableAngle: Record<'1' | '2', number> = { '1': 0, '2': 0 };
  /**
   * Initialized in the constructor body to the baseline so the disc spins from t=0 even before any input arrives. Not
   * initialized inline because `private static readonly` fields can't be safely referenced at instance-field-init time
   * across all TS targets.
   */
  private turntableVelocity: Record<'1' | '2', number>;
  /**
   * Direction the *next* press will push the disc. `-1` brakes (drives velocity below baseline → momentary reverse);
   * `+1` accelerates (drives velocity above baseline → momentary forward spike). Flipped after every press to produce
   * the alternating "scratch run" feel; reset to `-1` after a quiet gap so isolated presses always brake first.
   */
  private turntableNextSign: Record<'1' | '2', -1 | 1> = { '1': -1, '2': -1 };
  /**
   * Last-press timestamp per side (in `playClock()` ms), used to detect streak continuity. A press within {@link
   * TURNTABLE_STREAK_GAP_MS} keeps the alternation going; a press after a longer pause resets `nextSign` to `-1` so the
   * first press of a fresh streak brakes.
   */
  private turntableLastImpulseAt: Record<'1' | '2', number> = {
    '1': Number.NEGATIVE_INFINITY,
    '2': Number.NEGATIVE_INFINITY,
  };
  private turntableLastUpdateAt = 0;
  private static readonly TURNTABLE_BASELINE_RAD_PER_SEC = 2 * Math.PI;
  /**
   * Snap delta on each press. Larger than {@link TURNTABLE_BASELINE_RAD_PER_SEC} so a brake (`baseline − delta`) is
   * genuinely negative — the disc visibly reverses rather than just slowing down.
   */
  private static readonly TURNTABLE_PRESS_DELTA_RAD_PER_SEC = 3 * Math.PI;
  private static readonly TURNTABLE_RECOVERY_PER_SEC = 3;
  /**
   * Time window (ms) within which two presses count as part of the same streak. ~250 ms is faster than a casual
   * isolated press and slower than the fastest practical scratch tempo (about 10 Hz = 100 ms gaps), so it cleanly
   * separates "rapid scratch run" from "two unrelated single presses".
   */
  private static readonly TURNTABLE_STREAK_GAP_MS = 250;
  /** Active LR2 `#DST_*` op flags for the play session (see {@link initializeRuntimeOps}). */
  private readonly runtimeOps = new Set<number>();
  /**
   * Per-key-on-timer fade duration in ms, derived from the LR2 skin's `#DST_*` keyframes anchored to that timer
   * (longest `time` value across all elements). Populated in {@link prepareSkin}; consumers fall back to {@link
   * KEY_ON_FADE_OUT_MS} when a timer has no skin element.
   */
  private readonly keyOnFadeDurationMs = new Map<number, number>();
  /**
   * Per-bomb-timer (`50..69`) explosion cleanup duration in ms. Populated in {@link prepareSkin} from the skin's
   * authored keyframes; {@link resolveBombDurationMs} falls back to {@link BOMB_CLEANUP_FALLBACK_MS} for slots the skin
   * doesn't author (or to the be-music skin's bomb length in skinless mode).
   */
  private readonly bombDurationMs = new Map<number, number>();
  /**
   * Per-LN-hold-effect-timer (`70..89`) play-clock at which the release fade began. {@link renderSkinImage} consumes
   * this to taper the sprite alpha down to 0 over {@link lnHoldFadeDurationMs} starting at the recorded value. {@link
   * startLnHoldTimer} clears the entry on a fresh LN head; {@link releaseLnHoldTimer} populates it at the tail.
   */
  private readonly lnHoldFadeOutStart = new Map<number, number>();
  /**
   * Per-LN-hold-effect-timer fade duration derived from the skin's keyframes anchored to that timer (longest `time`
   * across elements). Populated in {@link prepareSkin}; consumers fall back to {@link KEY_ON_FADE_OUT_MS} when the skin
   * doesn't author the slot (skinless mode, or a chart that never used LN-hold visuals).
   */
  private readonly lnHoldFadeDurationMs = new Map<number, number>();
  /**
   * Per-gauge-rise / gauge-max timer (`42..45`) keyframe spans derived from the skin in {@link prepareSkin}. The
   * `gauge` theme event consults the rise entries (42 / 43) to time the gauge-increase flash; max entries (44 / 45)
   * stay active for as long as the gauge sits at 100 %, so their span is informational only.
   */
  private readonly gaugeTimerDurationMs = new Map<number, number>();
  /**
   * Active `setTimeout` handle for the gauge-increase flash (timer 42 / 43). Cleared on each new rise so consecutive
   * increases re-stamp the flash instead of letting a stale deferred-delete retire the freshly-stamped timer.
   */
  private gaugeIncreaseTimeout: number | undefined;
  /** Bomb sprite sheet from the skin's `BOMB` custom file, when it ships one. */
  private bombTexture: Texture | undefined;
  /**
   * Duration in milliseconds of the longest FC-anchored keyframe sequence in the loaded skin. Used by
   * `cleanupFullComboTimer` to remove timer 48 / 49 from `timerStartedAt` once the animation has finished — without
   * that, the skin's FC graphic (typically authored with `loop = -1` "play once and clamp") would stay frozen on its
   * final frame for the rest of the play session, mirroring the bomb-cleanup pattern. Defaults to 3000 ms when no FC
   * element is present in the skin.
   */
  private fullComboDurationMs = 3000;
  /**
   * `setTimeout` handle for the LR2 op 80 → 81 transition (load incomplete → load complete). Cleared on dispose so the
   * deferred state mutation doesn't fire onto a torn-down scene.
   */
  private loadCompleteTimerHandle: number | undefined;
  /**
   * Lazily-built `TextStyle` instance for fallback (no-skin) judge text. Held so we re-use the same
   * `TextStyle` reference across frames — re-assigning a Text's `.style` to a freshly-constructed `TextStyle` (even
   * with identical fields) invalidates Pixi's paragraph layout cache and forces a full re-shape every frame.
   */
  private fallbackJudgeStyle: TextStyle | undefined;

  public constructor(options: PixiGameplayViewOptions = {}) {
    super(options);
    // Seed the per-side turntable velocity at the baseline rate so the disc visibly spins from the moment the scene
    // mounts — even before any input arrives or any chart loads.
    this.turntableVelocity = {
      '1': PixiGameplayView.TURNTABLE_BASELINE_RAD_PER_SEC,
      '2': PixiGameplayView.TURNTABLE_BASELINE_RAD_PER_SEC,
    };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Theme hook overrides (see `CoreGameplayView`).
  // ---------------------------------------------------------------------------------------------------------------

  protected override attachThemeLayers(): void {
    // Park the bitmap-text sub-layer inside `skinLayer` so it inherits the skin's scale / position transform. Stacked
    // last among `skinLayer`'s children so its painted glyphs sit on top of the rest of the skin chrome, matching the
    // z-order the pre-pool path produced (where bitmap text was the last `addChild` in the skin pass).
    this.skinBitmapTextLayer.eventMode = 'none';
    this.skinLayer.addChild(this.skinBitmapTextLayer);
  }

  protected override async prepareTheme(): Promise<void> {
    // Reset the turntable physics so the disc starts each chart at angle 0, spinning at baseline. Without this,
    // F5-restarting mid-spin would leave the new play's first visible frame at a random angle (or with a residual brake
    // / forward state if the player had just scratched at song-end), and the alternation streak from the prior play
    // would carry into the new song's first press.
    this.turntableAngle = { '1': 0, '2': 0 };
    this.turntableVelocity = {
      '1': PixiGameplayView.TURNTABLE_BASELINE_RAD_PER_SEC,
      '2': PixiGameplayView.TURNTABLE_BASELINE_RAD_PER_SEC,
    };
    this.turntableNextSign = { '1': -1, '2': -1 };
    this.turntableLastImpulseAt = { '1': Number.NEGATIVE_INFINITY, '2': Number.NEGATIVE_INFINITY };
    this.turntableLastUpdateAt = 0;
    this.initializeRuntimeOps();
    await this.prepareSkin();
    if (this.disposed) return;
    // Eager-upload every freshly loaded skin texture to the GPU before the first paint. Without this, Pixi's lazy
    // upload-on-first-render path issues all the GL `texSubImage2D` calls in the chart's opening frames, which on
    // lower-end devices stalls the very first rendered frames by 30–80 ms (visible as the LR2 intro slide-in being
    // late by a beat or two). PrepareSystem walks the queue at its own cadence so this await stays bounded — the
    // Decide splash above is already showing during this window. BGA textures get the same treatment per-batch
    // inside `prepareBga` once each background load resolves.
    await this.preparePixiUpload(this.textures.values());
    if (this.bombTexture) await this.preparePixiUpload([this.bombTexture]);
  }

  /**
   * LR2 intro timeline. Per `docs/LR2SkinHelp.md`:
   *
   * t=0 scene start (timer 0) t=LOADSTART load begins t=LOADSTART + LOADEND load ends, "READY" fires (timer 40)
   * t=LOADSTART + LOADEND + PLAYSTART chart begins, play-start fires (timer 41)
   *
   * `#PLAYSTART` is therefore the gap between load-end and chart start, not the full intro length. The LR2 default
   * 7-keys ships LOADSTART=0, LOADEND≈1500, PLAYSTART≈1500 → ~3 s before notes begin, which lines up with how the
   * skin's title overlay fades out (anchored to timer 40 with a fade keyframe landing at ~PLAYSTART ms after that).
   * Treating PLAYSTART as the full intro length (the previous version) made the chart start while the title was still
   * on screen. `#FADEOUT` / `#CLOSE` describe the scene-EXIT phase ("when the scene starts to close, fade out for N ms
   * then close"), not offsets from scene mount.
   */
  protected override get themeTiming(): GameplayThemeTiming {
    const timing = this.options.skin?.timing ?? {};
    const loadStartMs = Math.max(0, timing.loadStart ?? 0);
    const loadEndOffsetMs = loadStartMs + Math.max(0, timing.loadEnd ?? 0);
    const playStartOffsetMs = loadEndOffsetMs + Math.max(0, timing.playStart ?? 0);
    return {
      loadEndOffsetMs,
      playStartOffsetMs,
      fadeOutMs: Math.max(0, timing.fadeOut ?? 0),
      closeMs: Math.max(0, timing.close ?? 0),
    };
  }

  /** Stamps the LR2 timers (and flips the ops) the skin's `#DST_*` keyframes are anchored to. */
  protected override onThemeEvent(event: GameplayThemeEvent): void {
    switch (event.kind) {
      case 'scene-start':
        // Seed the LR2 scene-stage timers so the skin's `#STARTINPUT` / `#LOADSTART` / `#LOADEND` / `#PLAYSTART`
        // directives drive their attached `#DST_*` keyframes (without seeds, anything anchored to those timers would
        // pin to time 0 and never animate). Timer 0 (scene start) fires immediately; timer 1 (`#STARTINPUT`) keeps its
        // configured offset. Timer 40 (`#LOADEND`) and timer 41 (`#PLAYSTART`) are seeded by the later stage events.
        //
        // Timer 2 (FADEOUT) and timer 3 (CLOSE) are deliberately NOT seeded here even when the skin authored
        // `#FADEOUT` / `#CLOSE` durations: the exit events stamp them at the actual transition moment (ESC / chart end)
        // so the LR2 default 7-keys "STAGE FAILED" plate (anchored to timer 3) only paints during the brief exit window
        // instead of bleeding over the gameplay field for the entire chart.
        this.timerStartedAt.set(0, event.at);
        this.seedSceneStageTimer(1, this.options.skin?.timing?.startInput);
        // LR2 op 80 / 81 ("load not complete" / "load complete") gate the centered title / genre / artist display in
        // the play skin. Op 80 is on during the LOADING phase; the 80→81 flip fires alongside timer 40 once the gate
        // opens.
        this.runtimeOps.add(80);
        this.runtimeOps.delete(81);
        if (this.loadCompleteTimerHandle !== undefined) {
          window.clearTimeout(this.loadCompleteTimerHandle);
          this.loadCompleteTimerHandle = undefined;
        }
        break;
      case 'load-end':
        // LOAD END fires LR2 timer 40 and flips op 80→81 (READY), which the skin's load-complete animations key off of.
        this.timerStartedAt.set(40, event.at);
        this.runtimeOps.delete(80);
        this.runtimeOps.add(81);
        break;
      case 'play-start':
        this.timerStartedAt.set(41, event.at);
        break;
      case 'exit-fade-out':
        this.timerStartedAt.set(2, event.at);
        break;
      case 'exit-close':
        this.timerStartedAt.set(3, event.at);
        break;
      case 'judge':
        // LR2 spec: timer 46 (1P judge) / 47 (2P judge) restarts on every judgement on its respective side so the
        // attached `#DST_NOWJUDGE` / `#DST_NOWCOMBO` chains animate from time=0 per hit. Without this the keyframe
        // playhead drifts hours into the song and the post-hit fade-out keyframes have long since passed.
        this.timerStartedAt.set(event.side === '2P' ? 47 : 46, event.at);
        break;
      case 'full-combo':
        // Both 48 and 49 are stamped at the same instant because we don't yet model per-side combos.
        this.timerStartedAt.set(48, event.at);
        this.timerStartedAt.set(49, event.at);
        break;
      case 'gauge':
        this.applyGaugeTimers(event.previous, event.next);
        break;
      case 'bomb':
        this.stampBombTimer(event.channel, event.at);
        break;
      case 'bomb-retired': {
        const timerId = this.resolveBombTimerId(event.channel);
        if (timerId !== undefined) {
          this.timerStartedAt.delete(timerId);
        }
        break;
      }
      case 'lane-command':
        this.applyLaneCommand(event.command);
        break;
    }
  }

  protected override updateThemeState(): void {
    this.updateRankOps();
    this.updateGaugeOps();
    // Integrate turntable physics before render so the disc's angle reflects this frame's elapsed time. Cheap
    // (constant work per side).
    this.updateTurntable(this.playClock());
  }

  protected override collectBgaTargets(out: GameplayBgaTarget[]): void {
    const skin = this.options.skin;
    if (!skin) {
      super.collectBgaTargets(out);
      return;
    }
    // Render ALL `#DST_BGA` rectangles whose op gating is true. For SP charts the LR2 default skin authors two — op 30
    // ("BGA NORMAL") and op 31 ("BGA EXTEND") — and only one is visible at a time, so the loop produces a single
    // sprite. For DP (`14keys/14_LR0.csv` line 78+) the skin authors *three* rects: one big op-31 EXTEND square plus a
    // pair of op-30 NORMAL panels stacked vertically on the right side. The previous `find(...)` short-circuited at the
    // first match and clipped the second NORMAL panel, so DP charts under "BGA NORMAL" mode showed only the top panel
    // and left the bottom one blank.
    for (const entry of skin.bgas) {
      if (!this.isDestinationVisible(entry.destination)) {
        continue;
      }
      const dst = this.evaluateElementDst(entry);
      const { x, y, w, h } = normalizeRect(dst);
      out.push({
        x,
        y,
        w,
        h,
        noBase: entry.noBase,
        noLayer: entry.noLayer,
        noPoor: entry.noPoor,
        applyToSprite: (sprite) => applyDestinationToSprite(sprite, dst),
      });
    }
  }

  protected override get themeOwnsPlayfield(): boolean {
    return this.options.skin !== undefined;
  }

  protected override resolveThemeLaneRect(
    channel: string,
    width: number,
    height: number,
  ): GameplayLaneRect | undefined {
    const skin = this.options.skin;
    // Skin's `#DST_NOTE,index,...` puts 1P-side rects at 0..9 and 2P-side rects at 10..19. We index with the LR2-spec
    // lane id (channel-derived) so a DP chart's 2P notes land on the 2P-side rects the skin actually authored — not on
    // whatever happens to sit at iteration position 8..15 in `laneRects`.
    const lr2Lane = skin?.laneRects[resolveLr2LaneIndex(channel, this.chartPlayVariant)];
    if (!skin || !lr2Lane) {
      return undefined;
    }
    const scale = Math.min(width / skin.width, height / skin.height);
    const skinX = (width - skin.width * scale) / 2;
    const skinY = (height - skin.height * scale) / 2;
    // `lr2Lane.y` is the TOP of the judgement-line bar (LR2 #DST_NOTE convention); the just-timing reference is the
    // BOTTOM edge of that bar, which is `y + h`. For the LR2 default 7-keys skin (y=315, h=6) that puts the just line at
    // y=321 — exactly where the white piano keys begin and notes "land" visually.
    const lr2JudgeBottom = lr2Lane.y + Math.abs(lr2Lane.h);
    return {
      x: skinX + lr2Lane.x * scale,
      w: Math.max(4, lr2Lane.w * scale),
      top: skinY,
      bottom: skinY + lr2JudgeBottom * scale,
    };
  }

  protected override resolveThemeNoteCell(
    kind: GameplayThemeNoteKind,
    laneIndex: number,
  ): GameplayThemeNoteCell | undefined {
    if (kind === 'invisible') {
      // `notes.note[3]` is the Pop'n green wide note in the LR2 default `play_9.lr2skin` POP layout — the convention the
      // host opts into by passing the loaded 9-keys play variant as {@link PixiGameplayViewOptions.invisibleNoteSkin}.
      // When unavailable (no 9-keys variant in the loaded theme, or its texture failed to load) the scene falls back
      // to a flat green rectangle.
      const greenNoteSrc = this.options.invisibleNoteSkin?.notes.note?.[3];
      const greenBaseTexture = greenNoteSrc ? this.textures.get(greenNoteSrc.imagePath) : undefined;
      if (!greenNoteSrc || !greenBaseTexture) return undefined;
      const cell = pickAnimatedCell(greenNoteSrc, this.elapsedSinceTimer(greenNoteSrc.timer));
      return { texture: createCroppedTexture(greenBaseTexture, cell), width: cell.w, height: cell.h };
    }
    const src = this.resolveNoteSource(this.options.skin, kind, laneIndex);
    if (!src) return undefined;
    // Some LR2 skins animate notes (shimmer / pulse). Pick the current SRC cell from divx*divy/cycle. For non-animated
    // notes (cycle=0) this returns cell (0,0) which matches the static behavior.
    if (kind === 'lnstart' || kind === 'lnend') {
      // LN caps crop straight from the (possibly still loading) texture — a missing texture just skips the cap.
      const cell = pickAnimatedCell(src, this.elapsedSinceTimer(src.timer));
      return { texture: createCroppedTexture(this.textures.get(src.imagePath), cell), width: cell.w, height: cell.h };
    }
    const baseTexture = this.textures.get(src.imagePath);
    if (!baseTexture) return undefined;
    const cell = pickAnimatedCell(src, this.elapsedSinceTimer(src.timer));
    return { texture: createCroppedTexture(baseTexture, cell), width: cell.w, height: cell.h };
  }

  /**
   * Prefers the LR2 skin's `#DST_LINE` (e.g. the LR2 default 7-keys skin's 1-px white strip at y=320) when present.
   * The DST encodes per-side x/w and texture; we replicate it at every measure boundary, scrolled. Iterate every
   * `#DST_LINE,index,...` the skin authored. SP charts only have `index === 0` so this is a one-line loop; DP charts
   * add `index === 1` for the 2P-side strip and we draw both at the same beat boundaries.
   */
  protected override renderThemeMeasureLines(frame: GameplayMeasureLineFrame): boolean {
    const skin = this.options.skin;
    const skinLines = (skin?.measureLines ?? []).filter((entry) => this.textures.has(entry.source.imagePath));
    if (skinLines.length === 0) {
      return false;
    }
    const { beats, firstBeatIndex, maxBeat, pixelsPerBeat, beatDistance, top, bottom } = frame;
    for (const skinLine of skinLines) {
      const baseTexture = this.textures.get(skinLine.source.imagePath);
      if (!baseTexture) continue;
      const lineDst = this.evaluateElementDst(skinLine);
      const cell = pickAnimatedCell(skinLine.source, this.elapsedSinceTimer(skinLine.source.timer));
      const cropped = createCroppedTexture(baseTexture, cell);
      if (!cropped) continue;
      for (let beatIndex = firstBeatIndex; beatIndex < beats.length; beatIndex += 1) {
        const beat = beats[beatIndex]!;
        if (beat > maxBeat) {
          break;
        }
        const y = bottom - beatDistance(beat) * pixelsPerBeat;
        if (y < top - 1 || y > bottom + 1) {
          continue;
        }
        const sprite = this.noteLayerPool.acquireSprite();
        sprite.texture = cropped;
        sprite.label = `measure-line[idx=${skinLine.index},beat=${beat}]`;
        sprite.position.set(lineDst.x, Math.round(y));
        sprite.width = lineDst.w;
        sprite.height = Math.max(1, Math.abs(lineDst.h));
        applyDestinationToSprite(sprite, lineDst);
      }
    }
    return true;
  }

  protected override renderThemeText(seconds: number): void {
    // Retire timer 48 / 49 once the FC animation has played out (after the bomb pass, before the text pass — the same
    // slot in the frame it always ran in). Same pattern as bomb-timer cleanup: without this the skin's `loop = -1` FC
    // graphic stays clamped to its final frame for the remainder of the play session. Cheap O(1) lookup so we can run
    // it unconditionally every frame.
    this.cleanupFullComboTimer();
    if (this.options.skin && this.lastJudge && seconds <= this.lastJudgeUntil && !this.hasSkinnedJudge()) {
      const judge = this.textLayerPool.acquireText();
      if (this.fallbackJudgeStyle === undefined) {
        this.fallbackJudgeStyle = new TextStyle({
          fill: BLUE,
          stroke: { color: 0xffffff, width: 2 },
          fontSize: 32,
          fontWeight: '800',
          fontFamily: LR2_JUDGE_FALLBACK_FONT,
        });
      }
      if (judge.style !== this.fallbackJudgeStyle) {
        judge.style = this.fallbackJudgeStyle;
      }
      judge.text = this.lastJudge;
      judge.label = `fallback-judge[${this.lastJudge}]`;
      judge.anchor.set(0.5);
      // Y aligned with LR2's `#DST_NOWJUDGE_1P,...,73,230,102,30,...` — the default skin parks the judge graphic 91 px
      // above the judgement line. Hard-coded to the LR2 number rather than `judgementY - 91` so the relationship is
      // greppable when comparing to LR2 source.
      judge.position.set(PLAYFIELD.x + PLAYFIELD.w / 2, 230);
    }
  }

  protected override renderBombEffects(): void {
    if (this.bombTexture) {
      this.renderTexturedBombs();
    } else {
      super.renderBombEffects();
    }
  }

  /**
   * Per-bomb-timer cleanup duration — derived from the loaded skin's keyframes in `prepareSkin` so each lane's
   * explosion retires at its authored cycle length, with the LR2-default 150 ms fallback for unauthored slots (and the
   * be-music skin's own effect length in skinless mode).
   */
  protected override resolveBombDurationMs(channel: string): number {
    const timerId = this.resolveBombTimerId(channel);
    return (
      (timerId === undefined ? undefined : this.bombDurationMs.get(timerId)) ??
      (this.options.skin ? BOMB_CLEANUP_FALLBACK_MS : super.resolveBombDurationMs(channel))
    );
  }

  protected override resolveKeyOnFadeMs(timerId: number): number {
    return this.keyOnFadeDurationMs.get(timerId) ?? super.resolveKeyOnFadeMs(timerId);
  }

  protected override disposeTheme(): Iterable<Texture | undefined> {
    if (this.loadCompleteTimerHandle !== undefined) {
      window.clearTimeout(this.loadCompleteTimerHandle);
      this.loadCompleteTimerHandle = undefined;
    }
    if (this.gaugeIncreaseTimeout !== undefined) {
      window.clearTimeout(this.gaugeIncreaseTimeout);
      this.gaugeIncreaseTimeout = undefined;
    }
    // Drop skin / font caches and the LR2 timer-span tables so a lingering async tail can't pin them.
    this.skinTextStyleCache.clear();
    this.bitmapFonts.clear();
    this.runtimeOps.clear();
    this.keyOnFadeDurationMs.clear();
    this.lnHoldFadeOutStart.clear();
    this.lnHoldFadeDurationMs.clear();
    this.bombDurationMs.clear();
    this.gaugeTimerDurationMs.clear();
    const bombTexture = this.bombTexture;
    this.bombTexture = undefined;
    return [bombTexture];
  }

  // ---------------------------------------------------------------------------------------------------------------
  // LR2 timers / ops.
  // ---------------------------------------------------------------------------------------------------------------

  /** Reset runtime DST-op state to a sensible default for a play session. */
  private initializeRuntimeOps(): void {
    this.runtimeOps.clear();
    // CUSTOMOPTION defaults declared by the loaded skin.
    this.options.skin?.customOptions.forEach((option) => this.runtimeOps.add(option.defaultOp));
    // Static-ish play-session ops that are conventionally true while gameplay runs.
    const defaults = [
      5, // selected bar is playable
      34, // ghost off
      // ops 38 / 39 (scoregraph off / on) — set dynamically below from `options.scoreGraph`. ops 40 / 41 (BGA off / on)
      // — set dynamically below from `options.bga` so the runtime gating matches the live setting. ops 42 / 43 (1P
      // normal / red gauge), 44 / 45 (2P) — set dynamically below from `options.gauge`.
      47, // difficulty filter disabled
      50, // offline
      52, // EXTRA MODE OFF — gates wallpaper / decoration elements in
      // the LR2 default skin family. Op 53 is the EXTRA MODE ON variant; we never enable EXTRA MODE in the web build.
      // ops 54 / 55 (autoscratch 1P off / on), 56 / 57 (autoscratch 2P off / on) — set dynamically below from
      // `options.autoScratch1P / 2P`.
      61, // score saveable
      81, // load complete
      82, // replay off
      174, // attached text absent
      178, // RANDOM absent
      182, // judge normal
      196, // replay absent
    ];
    defaults.forEach((op) => this.runtimeOps.add(op));
    // Autoscratch 1P / 2P (54 / 55, 56 / 57).
    this.runtimeOps.add(this.options.autoScratch1P ? 55 : 54);
    this.runtimeOps.add(this.options.autoScratch2P ? 57 : 56);
    // Gauge type — HARD / DEATH map to the LR2 "red" gauge ops (43 / 45); GROOVE / EASY share the normal branch (42 /
    // 44).
    const selectedGauge = this.resolveSelectedGauge();
    const isRedGaugeOp = selectedGauge === 'HARD' || selectedGauge === 'DEATH';
    this.runtimeOps.add(isRedGaugeOp ? 43 : 42);
    this.runtimeOps.add(isRedGaugeOp ? 45 : 44);
    // Score graph (38 / 39).
    this.runtimeOps.add(this.options.scoreGraph ? 39 : 38);
    // BGA on/off (40 / 41). With AUTOPLAY_ONLY we mirror LR2: the BGA is "on" only when autoplay is also engaged.
    const bgaMode = this.options.bga ?? 'ON';
    const bgaActive = bgaMode === 'ON' || (bgaMode === 'AUTOPLAY_ONLY' && this.options.autoPlay);
    this.runtimeOps.add(bgaActive ? 41 : 40);
    // op 32 = autoplay off, op 33 = autoplay on (mutually exclusive).
    this.runtimeOps.add(this.options.autoPlay ? 33 : 32);
    // Keymode op (160=7keys / 161=5keys / 162=14keys / 163=10keys / 164=9keys) — derived from the chart's actual lane
    // usage so 5K-only charts get the LR2 default skin's "DISABLE LANE" overlay on keys 6 & 7.
    this.runtimeOps.add(this.resolveKeymodeOp());
    // Long-note presence flag (172 = absent, 173 = present).
    const hasLongNotes = this.notes.some((note) => note.endBeat !== undefined);
    this.runtimeOps.add(hasLongNotes ? 173 : 172);
    // BPM change presence flag (176 = absent, 177 = present).
    const hasBpmChanges = (this.timingResolver?.tempoPoints.length ?? 0) > 1;
    this.runtimeOps.add(hasBpmChanges ? 177 : 176);
    // BGA presence flag (170 = absent, 171 = present). Drives the LR2 default skin's BGA-frame visibility — without 171
    // the borders and per-side gating fail to switch on.
    this.runtimeOps.add(this.hasBga ? 171 : 170);
    // Resource-presence flags (per LR2 spec — see `dst_option` table in `docs/LR2SkinHelp.md`): 190 / 191 = STAGEFILE
    // absent / present 192 / 193 = BANNER absent / present 194 / 195 = BACKBMP absent / present The previous revision
    // swapped these — it set 191 (=present) any time a chart was loaded, regardless of whether `#STAGEFILE` was
    // actually defined, while leaving 190 (=absent) unset. Drive both halves dynamically from the chart's metadata so
    // skin elements gated on either branch render correctly.
    const meta = this.song?.chart.metadata;
    this.runtimeOps.add(meta?.stageFile ? 191 : 190);
    this.runtimeOps.add(meta?.banner ? 193 : 192);
    this.runtimeOps.add(meta?.backBmp ? 195 : 194);
    // BGA size: op 30 = normal, op 31 = extend. Defer to the CUSTOMOPTION default if the skin already declared one
    // (rare — most skins leave this to the runtime); otherwise pick from `options.bgaSize` so the LR2 panel-1 BGA size
    // toggle (`#SRC_BUTTON,type=73`) is honored.
    if (!this.runtimeOps.has(30) && !this.runtimeOps.has(31)) {
      this.runtimeOps.add(this.options.bgaSize === 'EXTEND' ? 31 : 30);
    }
  }

  /**
   * Detects the chart's effective LR2 keymode op from its lane usage and the player option. Mirrors
   * `resolveChartPlayVariant`'s mapping (which already drives skin selection) but emits the LR2 `dst_option` numbers
   * instead of the string variant id:
   *
   * - - PMS / 9 KEY → 164 - DP 14 KEY → 162 - DP 10 KEY → 163 - SP 7 KEY → 160 - SP 5 KEY → 161
   */
  private resolveKeymodeOp(): number {
    if (this.chartPlayVariant === '9') {
      return 164; // 9keys (Pop'n / PMS)
    }
    const usesPlayer2 = this.laneChannels.some((channel) => channel.startsWith('2'));
    const uses6or7 = this.laneChannels.some(
      (channel) => channel === '18' || channel === '19' || channel === '28' || channel === '29',
    );
    if (usesPlayer2) {
      return uses6or7 ? 162 : 163; // 14keys vs 10keys
    }
    return uses6or7 ? 160 : 161; // 7keys vs 5keys
  }

  private isOpActive(op: number): boolean {
    if (op === 0) {
      return true;
    }
    if (op === 999) {
      return false;
    }
    return this.runtimeOps.has(op);
  }

  private evaluateOps(ops: ReadonlyArray<number>): boolean {
    for (const op of ops) {
      if (op > 0) {
        if (!this.isOpActive(op)) {
          return false;
        }
      } else if (this.isOpActive(-op)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Returns whether the given LR2 timer id is "running" right now.
   *
   * LR2 attaches every `#DST_*` to a base timer (`timer=N` argument) and the destination is only meant to be visible
   * while that timer is actively counting up. During gameplay only a small subset of timers run -- in particular `0`
   * (main, scene start) and `41` (play start). Result/fadeout/ close timers (`2`, `3`, `90`, `91`, ...) are dormant and
   * their attached DSTs (e.g. "STAGE FAILED" plates) should not appear on the play field.
   */
  /**
   * Milliseconds elapsed since the given LR2 timer started counting. Used to advance both `cycle`-based SRC animations
   * and `loop`-based DST keyframe playback. For "always-on" timers (0, 40, 41) we anchor to the play session start; for
   * explicit timers (50–69, 100–119) we use the recorded `timerStartedAt` time.
   */
  private elapsedSinceTimer(timer: number): number {
    // Judge timers (46 = 1P, 47 = 2P) restart on every judgement so the attached NOWJUDGE / NOWCOMBO keyframe chain
    // replays per hit. We use the recorded timestamp when present, falling back to scene start so the slot doesn't go
    // invisible before the first judgement happens.
    if (timer === 46 || timer === 47) {
      const judgedAt = this.timerStartedAt.get(timer);
      const now = this.playClock();
      if (judgedAt !== undefined) {
        return Math.max(0, now - judgedAt);
      }
      return Math.max(0, now - this.sceneStartTime);
    }
    // Timer 140 — rhythm timer. Per the LR2 skin help: "this timer treats one beat as 1000" — one beat remaps to 1000
    // logical ms regardless of BPM. The LR2 default 7-keys skin's lane-bottom aura keyframes (`#SRC_IMAGE,..., y=2007`
    // at `#DST_IMAGE,...,33,286,194,29,...,0,140,...`) ride this timer so the glow pulses bright on every beat boundary
    // and fades over the rest of the beat. We map the chart's current beat fractional part to that 0..1000 window so
    // the pulse stays beat-locked under soflan, hi-speed change, and STOP — anything that bends the seconds→beats
    // relationship is already absorbed by `currentBeat`.
    if (timer === 140) {
      if (!this.song) return 0;
      const beat = this.currentBeat(this.currentSeconds());
      if (!Number.isFinite(beat) || beat < 0) return 0;
      const fraction = beat - Math.floor(beat);
      return fraction * 1000;
    }
    // Explicit seed wins. `mount()` seeds the LR2 scene-stage timers (0 / 1 / 40 / 41) based on the skin's
    // `#STARTINPUT` / `#LOADSTART` / `#LOADEND` / `#PLAYSTART` directives, so anchored keyframes animate from the right
    // moment. NO fallback for unsigned 40 / 41 here: a pre-fire fallback would make the title plate / loading ring
    // (anchored to timer 40 in the LR2 default skin) start ticking from scene mount instead of from `READY`, jumping
    // backwards once the deferred seed lands and producing the "title appears at the wrong time" symptom. Timer 0 is
    // always seeded immediately at mount, so it doesn't need a fallback either.
    const started = this.timerStartedAt.get(timer);
    if (started !== undefined) {
      return Math.max(0, this.playClock() - started);
    }
    return 0;
  }

  private isTimerActive(timer: number): boolean {
    // Explicit seed = active. Scene-stage timers (0 / 1 / 40 / 41) are seeded by `mount()` based on the skin's LR2
    // timing directives, so checking `timerStartedAt` here honors their actual fire moment — e.g. timer 40 (READY)
    // stays inactive until `#LOADSTART + #LOADEND` ms have elapsed, and the LR2 default skin's title plate + loading
    // ring (anchored to timer 40) only paint from that moment onward, just as the LR2 reference video shows them
    // appearing mid-intro rather than at scene mount.
    if (this.timerStartedAt.has(timer)) {
      return true;
    }
    // Judgement display timers (1P/2P). LR2 fires these on every judgement so the attached NOWJUDGE/NOWCOMBO
    // destinations animate from time=0. We don't model the timer instant directly -- our `lastJudge` window already
    // gates the rendering -- so we simply mark them as always active and rely on the higher-level renderer to draw only
    // while a judgement is fresh.
    if (timer === 46 || timer === 47) {
      return true;
    }
    // Timer 140 — rhythm timer. Beat-locked, but suppressed during the LR2 LOADING → DONE intro window so the lane- bottom
    // aura keyframes stay invisible until notes actually start scrolling. Without this gate the glow would already be
    // pulsing in the empty playfield while the title plate / ring chrome is still sliding in. `isIntroPlaying()` is the
    // same gate that hides falling notes / measure lines, so pinning the aura to it lines up with the "the chart has
    // started" moment users perceive.
    if (timer === 140) {
      return this.song !== undefined && !this.isIntroPlaying();
    }
    // Bomb (50-69) and key-on (100-119) timers are tracked explicitly via `timerStartedAt`. They become active the
    // moment we record a start time and stay active until `releaseKeyOnTimer`'s deferred clean-up retires the entry
    // (key-on) or the bomb's animation cycle finishes (bomb).
    //
    // Full-combo timers (48 = 1P, 49 = 2P) are tracked the same way: `maybeFireFullCombo` stamps them once when the
    // player's combo hits the chart's note count, and elements anchored to those timers (the `Play/fullcombo/...` skin
    // graphic) read the running elapsed time afterward to slide in / fade out per the skin's keyframe chain.
    if (
      (timer >= 42 && timer <= 45) ||
      timer === 48 ||
      timer === 49 ||
      (timer >= 50 && timer <= 69) ||
      (timer >= 70 && timer <= 89) ||
      (timer >= 100 && timer <= 119)
    ) {
      // All explicitly-seeded timer ranges share the same gating: active iff `timerStartedAt` has an entry. Gauge rise
      // / max (42..45) are stamped by `applyGaugeDelta`, LN-hold (70..89) by `startLnHoldTimer`, bombs (50..69) /
      // key-on (100..119) by their own helpers, FC (48 / 49) by `maybeFireFullCombo`. Without an entry the slot stays
      // hidden.
      return this.timerStartedAt.has(timer);
    }
    return false;
  }

  private isDestinationVisible(destination: Lr2DestinationRect): boolean {
    if (!this.isTimerActive(destination.timer)) {
      return false;
    }
    return this.evaluateOps(destination.ops);
  }

  /**
   * Schedules a scene-stage timer to fire at `offsetMs` after scene mount. Used for LR2 timing directives
   * (`#STARTINPUT` / `#LOADSTART` / `#LOADEND` / `#FADEOUT` / `#CLOSE`) — see `mount()` for the full mapping.
   *
   * `undefined` offset → fall back to "fire immediately" so a skin that omits the directive still has the timer
   * available to elements that gated on it (matches the pre-skin-timing default behavior).
   */
  private seedSceneStageTimer(timer: number, offsetMs: number | undefined): void {
    const safeOffset = offsetMs === undefined ? 0 : Math.max(0, offsetMs);
    if (safeOffset <= 0) {
      this.timerStartedAt.set(timer, this.sceneStartTime);
      return;
    }
    this.setSceneStageTimeout(() => {
      if (this.disposed) return;
      this.timerStartedAt.set(timer, this.playClock());
    }, safeOffset);
  }

  /**
   * LR2 gauge-rise (timer 42) / gauge-max (timer 44) visual feedback. Mirrors what the legacy `applyGaugeDelta` did —
   * stamp on every transition so authored skin elements (rise sparkle, max-glow overlay) animate. We compare against
   * the previous frame's value rather than against an "EMPTY_POOR-sized delta" because the engine drives gauge updates
   * monotonically through `summary.gauge.current`, not through judge deltas.
   */
  private applyGaugeTimers(previous: number, next: number): void {
    if (next > previous) {
      if (this.gaugeIncreaseTimeout !== undefined) {
        window.clearTimeout(this.gaugeIncreaseTimeout);
        this.gaugeIncreaseTimeout = undefined;
      }
      this.timerStartedAt.set(42, this.playClock());
      const fadeMs = this.gaugeTimerDurationMs.get(42) ?? GAUGE_INCREASE_FALLBACK_MS;
      this.gaugeIncreaseTimeout = window.setTimeout(() => {
        this.gaugeIncreaseTimeout = undefined;
        if (this.disposed) return;
        this.timerStartedAt.delete(42);
      }, fadeMs);
    }
    if (next >= 100 && previous < 100) {
      this.timerStartedAt.set(44, this.playClock());
    } else if (next < 100 && previous >= 100) {
      this.timerStartedAt.delete(44);
    }
  }

  /**
   * LR2 bomb timer id (50+sideLaneIndex / 60+sideLaneIndex) for `channel`, or `undefined` for lanes past the bank.
   * Side-relative lane index is used so 2P SC maps to timer 60 (not 60+8).
   */
  private resolveBombTimerId(channel: string): number | undefined {
    const laneIndex = resolveSideRelativeLaneIndex(channel, this.chartPlayVariant);
    // Each side's bomb bank is 10 timers wide (50..59 / 60..69). The 24-key keyboard modes address lanes past that, and
    // an unclamped `base + laneIndex` would spill into the LN-hold bank at 70+ — so those lanes stamp no LR2 timer and
    // rely on `bombStartedAt` alone, which is what the fallback playfield renders from anyway.
    if (laneIndex > LR2_LANE_TIMER_BANK_SIZE - 1) {
      return undefined;
    }
    // PMS / 9 KEY routes every lane through the 1P-side bank (50..58) regardless of which side the chart sourced it
    // from.
    const isPlayer2 = this.chartPlayVariant !== '9' && channel.startsWith('2');
    const base = isPlayer2 ? LR2_2P_BOMB_TIMER_BASE : LR2_1P_BOMB_TIMER_BASE;
    return base + laneIndex;
  }

  /**
   * Stamps the LR2 bomb timer for a freshly triggered bomb. The LR2 default 7keys skin attaches its bomb sprite to
   * `timer=50..57` (1P), so we mirror that here. The timer auto-clears once the core scene retires the bomb.
   */
  private stampBombTimer(channel: string, at: number): void {
    const timerId = this.resolveBombTimerId(channel);
    if (timerId === undefined) return;
    this.timerStartedAt.set(timerId, at);
  }

  /** LR2-side reaction to the engine's lane commands: the scratch turntable and the LN-hold-effect timers. */
  private applyLaneCommand(command: PlayerUiCommand): void {
    switch (command.kind) {
      case 'flash-lane':
      case 'press-lane':
        this.applyTurntableImpulse(command.channel);
        break;
      case 'release-lane':
        this.releaseLnHoldTimer(command.channel);
        break;
      case 'hold-lane-until-beat':
        this.startLnHoldTimer(command.channel);
        break;
      default:
        break;
    }
  }

  /**
   * LR2 LN-hold-effect timer id for the given chart channel (`70..79` for 1P SC + key1..9, `80..89` for 2P). Mirrors
   * {@link resolveKeyOnTimerId}; returned only when the channel maps onto a known lane index.
   */
  private resolveLnHoldTimerId(channel: string): number | undefined {
    const laneIndex = resolveSideRelativeLaneIndex(channel, this.chartPlayVariant);
    if (laneIndex < 0 || laneIndex > LR2_LANE_TIMER_BANK_SIZE - 1) {
      return undefined;
    }
    // PMS / 9 KEY collapses onto the 1P-side `70..79` bank.
    const isPlayer2 = this.chartPlayVariant !== '9' && channel.startsWith('2');
    const base = isPlayer2 ? LR2_2P_LN_HOLD_TIMER_BASE : LR2_1P_LN_HOLD_TIMER_BASE;
    return base + laneIndex;
  }

  /**
   * Stamps the LR2 LN-hold-effect timer (70..89) for the given channel — fires at the head of an LN, paired with {@link
   * releaseLnHoldTimer} at LN end. Skin elements gated on these timers (sustain glow, hold sparkles, etc.) become
   * visible while the timer is active and fade through their keyframe sequence on release. A no-op if the channel
   * doesn't map onto a known LN-hold slot.
   */
  private startLnHoldTimer(channel: string): void {
    const timerId = this.resolveLnHoldTimerId(channel);
    if (timerId === undefined) return;
    this.timerStartedAt.set(timerId, this.playClock());
    this.lnHoldFadeOutStart.delete(timerId);
  }

  /**
   * Mirrors {@link releaseKeyOnTimer} but for the LN-hold-effect timer (70..89). Stamps the play-clock at which the
   * fade began, schedules the timer's deferred delete, and lets `renderSkinImage` taper any LN-hold-anchored sprite
   * alpha to 0 over the same skin-derived span as the key-on lasers (we reuse the per-timer duration map populated in
   * `prepareSkin`, with `KEY_ON_FADE_OUT_MS` as the fallback).
   */
  private releaseLnHoldTimer(channel: string): void {
    const timerId = this.resolveLnHoldTimerId(channel);
    if (timerId === undefined) return;
    // Stamp the fade origin unconditionally for the same reason as `releaseKeyOnTimer`: the render-side defensive
    // cleanup in `renderSkinImage` keys off `lnHoldFadeOutStart` to taper sustain-glow / hold-sparkle sprites to
    // alpha=0, so a missing `timerStartedAt` (whose deferred-cleanup setTimeout could already have wiped the slot
    // under battery-saver throttling) must not skip the stamp. The `timerStartedAt.has` gate now controls only the
    // deferred cleanup below.
    this.lnHoldFadeOutStart.set(timerId, this.playClock());
    if (!this.timerStartedAt.has(timerId)) return;
    const fadeMs = this.lnHoldFadeDurationMs.get(timerId) ?? KEY_ON_FADE_OUT_MS;
    const timeout = window.setTimeout(() => {
      this.keyFlashTimeouts.delete(timeout);
      if (this.disposed) return;
      this.timerStartedAt.delete(timerId);
      this.lnHoldFadeOutStart.delete(timerId);
    }, fadeMs);
    this.keyFlashTimeouts.add(timeout);
  }

  /**
   * Snaps the turntable velocity on a scratch press. Called on every scratch-channel press (manual `Shift` keydown,
   * full autoplay, or auto-scratch mode).
   *
   * - First press of an isolated event: brake (`v = −delta`, pure reverse rotation).
   * - Subsequent presses inside {@link TURNTABLE_STREAK_GAP_MS}: alternate sign each press, so a rapid scratch run
   *   paints a back-and-forth motion (forward / reverse / forward / reverse) at equal magnitudes. After a quiet gap,
   *   the sign resets so the next isolated press brakes again rather than spinning forward unprompted.
   *
   * Snap is centered on zero (not baseline) deliberately. The baseline is the *idle* spin; while the user is actively
   * scratching, the disc should behave as if the hand is on it — pure forward / pure reverse motion. The integrator in
   * {@link updateTurntable} suppresses the baseline-recovery pull during the streak window so the snapped velocity
   * actually persists between presses.
   *
   * Channels other than `16` / `26` are no-ops, so this can be called unconditionally from generic note-hit paths.
   */
  private applyTurntableImpulse(channel: string): void {
    if (channel !== '16' && channel !== '26') return;
    const side = channel === '16' ? '1' : '2';
    const now = this.playClock();
    const gap = now - this.turntableLastImpulseAt[side];
    // Reset the alternation streak when the gap is long. Bare `>` (not `>=`) treats any back-to-back press as part of
    // the same streak; the threshold has no useful "boundary" case.
    if (gap > PixiGameplayView.TURNTABLE_STREAK_GAP_MS) {
      this.turntableNextSign[side] = -1;
    }
    const sign = this.turntableNextSign[side];
    const delta = PixiGameplayView.TURNTABLE_PRESS_DELTA_RAD_PER_SEC;
    this.turntableVelocity[side] = sign * delta;
    // Flip for next press. Re-typed via the conditional so TS narrows back to the `-1 | 1` literal; a plain `-sign`
    // widens to `number` and breaks the field's type.
    this.turntableNextSign[side] = sign === -1 ? 1 : -1;
    this.turntableLastImpulseAt[side] = now;
  }

  /**
   * Integrates the turntable physics one tick. Called from {@link tick} just before render so the rendered angle
   * reflects this frame's elapsed time rather than the previous frame's.
   *
   * Two regimes, gated on the streak window:
   *
   * - **In streak** (within {@link TURNTABLE_STREAK_GAP_MS} of the last press): the snapped velocity is preserved as
   *   the user "holds" the disc. Each press flips the sign, so the angle traces a back-and-forth motion at constant
   *   ±delta speed — the visual analog of a hand on the platter rocking it forward / back.
   * - **Out of streak**: velocity exponentially relaxes toward the baseline `v += (baseline − v) · (1 −
   *   exp(−recovery·dt))`. Steady-state is the baseline forward spin, so the disc resumes its idle cadence on its own
   *   once the player stops pressing.
   *
   * Pause skips integration so the disc holds its current angle until the user resumes — matches what gameplay pause
   * does for every other animated element.
   */
  private updateTurntable(now: number): void {
    if (this.turntableLastUpdateAt === 0) {
      this.turntableLastUpdateAt = now;
      return;
    }
    // Hold the disc still during the LR2 intro chrome (LOADING / DONE banner, fade-in, etc.). The chart isn't playing
    // yet, so a spinning disc would read as "the song is already running" — exactly the wrong cue. Reset the timestamp
    // so the first post-intro tick produces a small dt (rather than the cumulative wall-clock since the intro began,
    // which would integrate to a huge angle jump on the first frame).
    if (this.isIntroPlaying()) {
      this.turntableLastUpdateAt = now;
      return;
    }
    const dt = Math.max(0, (now - this.turntableLastUpdateAt) / 1000);
    this.turntableLastUpdateAt = now;
    if (this.paused || dt <= 0) return;
    const baseline = PixiGameplayView.TURNTABLE_BASELINE_RAD_PER_SEC;
    const recovery = 1 - Math.exp(-PixiGameplayView.TURNTABLE_RECOVERY_PER_SEC * dt);
    for (const side of ['1', '2'] as const) {
      this.turntableAngle[side] += this.turntableVelocity[side] * dt;
      // Suppress baseline pull while the user is still inside the streak window. The disc holds the snapped velocity so
      // consecutive presses carry the angle through visible forward / reverse arcs without the spring snapping it back
      // toward baseline between presses.
      const inStreak = now - this.turntableLastImpulseAt[side] < PixiGameplayView.TURNTABLE_STREAK_GAP_MS;
      if (inStreak) continue;
      this.turntableVelocity[side] += (baseline - this.turntableVelocity[side]) * recovery;
    }
  }

  /**
   * Sets the LR2 1P rank ops (200=AAA, 201=AA, …, 207=F) based on the current EX-score rate so the corresponding rank
   * graphic in the skin (e.g. the "AAA" indicator above the gauge percentage) lights up.
   */
  private updateRankOps(): void {
    // Clear the entire rank slot first; only one of these should be active.
    for (let op = 200; op <= 207; op += 1) {
      this.runtimeOps.delete(op);
    }
    const rank = computeRankOp(this.score);
    if (rank !== undefined) {
      this.runtimeOps.add(rank);
    }
  }

  /**
   * Drives the LR2 1P gauge state ops: - **230–240**: 10 %-bucket flags (230 = 0–9 %, 231 = 10–19 %, …, 240 = 100 %).
   * Skin elements like the "WARNING" overlay light up by gating on these buckets. - **42 / 43**: NORMAL (gauge-up
   * animation) vs HARD (red-zone) flag. The NORMAL gauge fires 42; we don't currently model HARD/EX.
   */
  private updateGaugeOps(): void {
    for (let op = 230; op <= 240; op += 1) {
      this.runtimeOps.delete(op);
    }
    const bucket = Math.min(10, Math.max(0, Math.floor(this.gaugeState.current / 10)));
    this.runtimeOps.add(230 + bucket);
    // NORMAL gauge is the default play-session gauge type; keep op 42 set so the matching frame plate (`#IF op42`)
    // remains visible.
    this.runtimeOps.add(42);
    // op 43 = 1P HARD/EX (not modeled yet — leave clear).
    this.runtimeOps.delete(43);
  }

  /**
   * One-shot full-combo timer cleanup. Same pattern as {@link cleanupBombTimers}: once the FC animation's full
   * keyframe-time window has elapsed, retire timer 48 / 49 from `timerStartedAt` so the skin's FC graphic (`loop = -1`
   * "play once and clamp" by convention) doesn't stay frozen on its final frame for the rest of the play session.
   * Idempotent — the lookups are O(1) and the second call after retirement is a no-op.
   */
  private cleanupFullComboTimer(): void {
    const startedAt = this.timerStartedAt.get(48);
    if (startedAt === undefined) {
      return;
    }
    if (this.playClock() - startedAt < this.fullComboDurationMs) {
      return;
    }
    this.timerStartedAt.delete(48);
    this.timerStartedAt.delete(49);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // LR2 skin loading.
  // ---------------------------------------------------------------------------------------------------------------

  private async prepareSkin(): Promise<void> {
    if (!this.options.skin) {
      return;
    }
    const skin = this.options.skin;
    // Load LR2 bitmap fonts in parallel with the texture preload — they go through their own loader, so we don't need
    // to await the result here. The renderer falls back to the system font for any font index that isn't ready yet.
    void loadSkinBitmapFonts(skin.lr2FontPaths, skin.files).then((loaded) => {
      if (this.disposed || this.options.skin !== skin) return;
      this.bitmapFonts = loaded;
    });
    // Compute the FC animation duration from the skin's keyframes. Walk every element type that can be anchored to a
    // timer and pick the longest keyframe time across those whose `timer` is 48 (1P FC) or 49 (2P FC).
    // `cleanupFullComboTimer` later uses this value to retire timer 48 / 49 once the animation has played out, matching
    // the bomb-cleanup pattern.
    this.fullComboDurationMs = computeFullComboDurationMs(skin);
    // Pre-compute lane-laser release fade durations from the skin's key-on (`100..117`) keyframes so
    // `releaseKeyOnTimer` / `renderSkinImage` decay each lane at its authored speed instead of a hard-coded 120 ms.
    this.keyOnFadeDurationMs.clear();
    for (const [timerId, span] of computeKeyOnFadeDurationsMs(skin)) {
      this.keyOnFadeDurationMs.set(timerId, span);
    }
    // Same idea for the bomb-explosion timers (50..69). `cleanupBombTimers` retires the active bomb entries once the
    // skin's authored keyframe span has elapsed, so charts that ship a longer (or shorter) explosion animation match.
    this.bombDurationMs.clear();
    for (const [timerId, span] of computeBombDurationsMs(skin)) {
      this.bombDurationMs.set(timerId, span);
    }
    // LN-hold-effect timer (70-89) keyframe spans — `releaseLnHoldTimer` uses these to fade authored sustain-glow
    // visuals out at the skin's pace when the hold ends.
    this.lnHoldFadeDurationMs.clear();
    for (const [timerId, span] of computeLnHoldDurationsMs(skin)) {
      this.lnHoldFadeDurationMs.set(timerId, span);
    }
    // Gauge rise / max timers (42..45). The "rise" entries drive `applyGaugeDelta`'s flash retirement; the "max"
    // entries are kept just for symmetry with the other timer-derived maps.
    this.gaugeTimerDurationMs.clear();
    for (const [timerId, span] of computeGaugeTimerDurationsMs(skin)) {
      this.gaugeTimerDurationMs.set(timerId, span);
    }
    const imagePaths = new Set<string>();
    skin.images.forEach((image) => imagePaths.add(image.source.imagePath));
    Object.values(skin.notes).forEach((group) => group?.forEach((note) => imagePaths.add(note.imagePath)));
    Object.values(skin.judges).forEach((group) => group?.forEach((judge) => imagePaths.add(judge.source.imagePath)));
    Object.values(skin.judges2P).forEach((group) => group?.forEach((judge) => imagePaths.add(judge.source.imagePath)));
    skin.numbers.forEach((number) => imagePaths.add(number.source.imagePath));
    skin.grooveGauges.forEach((gauge) => imagePaths.add(gauge.source.imagePath));
    skin.nowCombos.forEach((combo) => imagePaths.add(combo.source.imagePath));
    await Promise.all(
      [...imagePaths].map(async (path) => {
        if (this.disposed) {
          return;
        }
        // LR2 special graphics (`gr=100..111`) point at runtime-bound textures, not files in the skin bundle. Skip them
        // here and load them via `prepareChartGraphics()` below.
        if (isLr2SpecialGraphic(path)) {
          return;
        }
        const texture = await this.loadSkinAssetTexture(skin, path);
        if (texture) {
          if (this.disposed) {
            texture.destroy(true);
            return;
          }
          this.textures.set(path, texture);
        }
      }),
    );
    if (this.disposed) {
      return;
    }
    const bombFile = skin.customFiles.find((file) => file.name === 'BOMB');
    if (bombFile) {
      const texture = await this.loadSkinAssetTexture(skin, bombFile.path);
      if (this.disposed) {
        texture?.destroy(true);
        return;
      }
      this.bombTexture = texture;
    }
    // Invisible-note overlay sprite. Pulls index 3 from the dedicated `invisibleNoteSkin` (Pop'n's green wide note in
    // the LR2 default `play_9.lr2skin` POP layout) and asks *that* skin's bundled file map for the bytes — for LR2
    // default themes this resolves to the same `frame.tga` the active skin already uses, so the texture cache key is
    // shared. Themes that ship a per-variant atlas instead get an extra entry under a distinct key.
    const invisibleNoteSrc = this.options.invisibleNoteSkin?.notes.note?.[3];
    if (invisibleNoteSrc?.imagePath && !this.textures.has(invisibleNoteSrc.imagePath)) {
      const texture = await this.loadSkinAssetTexture(this.options.invisibleNoteSkin!, invisibleNoteSrc.imagePath);
      if (this.disposed) {
        texture?.destroy(true);
        return;
      }
      if (texture) {
        this.textures.set(invisibleNoteSrc.imagePath, texture);
      }
    }
    if (this.disposed) {
      return;
    }
    // Chart-side `#STAGEFILE` / `#BACKBMP` / `#BANNER`. These are referenced by skin elements via `gr=100/101/102`;
    // they live in the chart bundle (next to the .bms file), not the skin bundle.
    await this.prepareChartGraphics();
  }

  /**
   * Loads the chart's `#STAGEFILE` / `#BACKBMP` / `#BANNER` images into the skin texture map under their LR2 sentinel
   * paths so the existing `renderSkinImage` flow picks them up when a skin element uses `gr=100`/`101`/`102`. Skipped
   * for charts that don't declare the corresponding metadata field (the runtime ops also flip to `190`/`192`/`194` in
   * that case so the skin's "absent" branch handles the missing-asset path).
   */
  private async prepareChartGraphics(): Promise<void> {
    const song = this.song;
    const source = this.source;
    if (!song || !source) {
      return;
    }
    const meta = song.chart.metadata;
    const candidates: Array<{ key: Lr2SpecialGraphic; assetPath: string }> = [];
    if (meta.stageFile) {
      candidates.push({ key: LR2_SPECIAL_GRAPHIC.STAGEFILE, assetPath: meta.stageFile });
    }
    if (meta.backBmp) {
      candidates.push({ key: LR2_SPECIAL_GRAPHIC.BACKBMP, assetPath: meta.backBmp });
    }
    if (meta.banner) {
      candidates.push({ key: LR2_SPECIAL_GRAPHIC.BANNER, assetPath: meta.banner });
    }
    await Promise.all(
      candidates.map(async ({ key, assetPath }) => {
        // Song-bundle assets are stored as lazy `File` references (only the theme bundle keeps eager bytes). Read on
        // demand so the at-rest heap stays at "parsed chart metadata only" until the user actually starts a song.
        // Image-aware resolver so STAGEFILE / BANNER / BACKBMP entries that ship the actual graphic with a different
        // extension (e.g. declared `.bmp` but bundled as `.png`) still resolve.
        const entry = resolveChartImageAsset(source, song.chartPath, assetPath);
        const bytes = await loadAssetBytes(entry);
        if (!bytes) return;
        try {
          const texture = await loadTextureFromBytes(assetPath, bytes);
          if (texture) {
            if (this.disposed) {
              texture.destroy(true);
              return;
            }
            this.textures.set(key, texture);
          }
        } catch {
          // Decode failures are silently skipped — the skin's "asset absent" branch (gated on op 190/192/194) takes
          // over.
        }
      }),
    );
  }

  private loadSkinAssetTexture(skin: Lr2Skin, path: string): Promise<Texture | undefined> {
    // Delegates to the shared loader in `skin/lr2/textures.ts`. For `.tga` assets it routes through the bundled TGA decoder;
    // everything else goes via `createImageBitmap`. Honors the skin's `#TRANSCOLOR`.
    return loadSkinAssetTexture(skin, path);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // LR2 skin rendering.
  // ---------------------------------------------------------------------------------------------------------------

  protected override renderThemeLayer(width: number, height: number): void {
    const skin = this.options.skin;
    if (!skin) {
      super.renderThemeLayer(width, height);
      return;
    }
    this.skinLayerPool.begin();
    this.overlayLayerPool.begin();
    // The bitmap-font path of `renderTextElement` adds a freshly-allocated Container per text element each frame
    // (see `makeLr2BitmapTextSprite`). The pool abstraction can't recycle those, so we host them in a dedicated
    // sub-layer and tear it down per render — same approach the pre-pool path used for the whole skin layer.
    disposeChildren(this.skinBitmapTextLayer);
    const scale = Math.min(width / skin.width, height / skin.height);
    this.skinLayer.scale.set(scale);
    this.skinLayer.position.set((width - skin.width * scale) / 2, (height - skin.height * scale) / 2);
    // Mirror the skin transform onto the overlay AND BGA layers so they share the same design-pixel coordinate system
    // as `renderSkin`.
    this.overlayLayer.scale.set(scale);
    this.overlayLayer.position.copyFrom(this.skinLayer.position);
    this.bgaLayer.scale.set(scale);
    this.bgaLayer.position.copyFrom(this.skinLayer.position);
    // Two-pass image render so the judgement line lands at the right z-depth: drawn AFTER the static frame / lane
    // background (so the red bar isn't covered by the lane area) but BEFORE on-top overlays — bombs (timer 50–69), LN
    // holds (70–89), key-on lasers (100–139) — so those visually punch through the line.
    for (const image of skin.images) {
      if (isLr2OverlayImage(image)) {
        continue;
      }
      this.renderSkinImage(image);
    }
    for (const judgeLine of skin.judgeLines) {
      // Render every side's judgement line. DP charts authored with both `#DST_JUDGELINE,0,...` (1P) and
      // `#DST_JUDGELINE,1,...` (2P) get both bars drawn at their respective playfield positions. SP charts only have
      // one entry, so this is a no-cost loop in the common case.
      this.renderJudgeLineElement(judgeLine);
    }
    for (const image of skin.images) {
      if (!isLr2OverlayImage(image)) {
        continue;
      }
      this.renderSkinImage(image);
    }
    for (const number of skin.numbers) {
      if (!this.isDestinationVisible(number.destination)) {
        continue;
      }
      const value = resolveNumberValue(
        number.source.num,
        this.score,
        this.song,
        this.gaugeState.current,
        this.tracker.combo,
        this.hiSpeed,
        this.currentSeconds(),
        this.displayedScore,
        this.fps,
        this.timingResolver?.bpmAtBeat(this.currentBeat(this.currentSeconds())),
        this.resolveSongDurationSeconds(),
        this.maxCombo,
      );
      if (value === undefined) {
        continue;
      }
      renderNumberElement(this.skinLayerPool, number, value, this.textures, this.evaluateElementDst(number), {
        // Groove-gauge percentage is naturally variable-length; LR2 default skins specify keta=3 which would print
        // "020" / "100". Suppress leading zeros so the displayed value reads like a normal integer.
        suppressLeadingZeros: number.source.num === 107,
      });
    }
    for (const gauge of skin.grooveGauges) {
      if (gauge.index !== 0) {
        // 1P only for now -- 2P side requires battle/dp wiring.
        continue;
      }
      if (!this.isDestinationVisible(gauge.destination)) {
        continue;
      }
      renderGrooveGaugeElement(
        this.skinLayerPool,
        gauge,
        this.gaugeState.current,
        this.textures,
        this.evaluateElementDst(gauge),
        {
          // Survival gauges (HARD / DEATH) have no 80 % clear border in LR2 — the whole bar renders in the red cell,
          // so suppress the green clear-zone split for them. GROOVE / EASY keep the green ≥ 80 % zone.
          survivalGauge: this.gaugeState.survival === true,
          // Drives the LR2 4-cell × N-frame animation cycle (lit-tip highlight scan). Anchored to the SRC's timer per
          // spec — `0` is "scene start" which is what most skins use for the gauge.
          elapsedMs: this.elapsedSinceTimer(gauge.source.timer),
        },
      );
    }
    for (const bargraph of skin.bargraphs) {
      if (!this.isDestinationVisible(bargraph.destination)) {
        continue;
      }
      this.renderBarGraphElement(bargraph);
    }
    for (const slider of skin.sliders) {
      if (!this.isDestinationVisible(slider.destination)) {
        continue;
      }
      this.renderSliderElement(slider);
    }
    for (const text of skin.texts) {
      if (!this.isDestinationVisible(text.destination)) {
        continue;
      }
      this.renderTextElement(text);
    }
    this.renderJudgeAndComboOnOverlay(skin);
    this.skinLayerPool.end();
    this.overlayLayerPool.end();
    // Re-pin the bitmap-text sub-layer at the top of `skinLayer`'s child stack. The pool's `acquireSprite` /
    // `acquireGraphics` calls land freshly-allocated children at the END of `skinLayer.children` whenever the
    // pool grows (first render, after a pool growth, etc.), which would otherwise leave the bitmap-text Container
    // — created up-front in the scene constructor — sitting at index 0 / behind every chrome sprite. Re-`addChild`-
    // ing it once per render moves it to the tail in O(1) inside Pixi's child array, so its glyphs (LR2 intro
    // title etc.) paint on top of the pool-allocated chrome instead of being covered by the lane-frame image.
    this.skinLayer.addChild(this.skinBitmapTextLayer);
  }

  private renderTexturedBombs(): void {
    const bombTexture = this.bombTexture;
    if (!bombTexture) return;
    const naturalRatio = bombTexture.frame.width / Math.max(1, bombTexture.frame.height);
    const lr2Layout = naturalRatio >= 6;
    const divx = lr2Layout ? 9 : BOMB_DIVX;
    const divy = lr2Layout ? 1 : BOMB_DIVY;
    const totalFrames = divx * divy;
    const cellWidth = bombTexture.frame.width / divx;
    const cellHeight = bombTexture.frame.height / divy;
    const cycle = lr2Layout ? 150 / totalFrames : BOMB_CYCLE_MS;
    const now = this.playClock();
    for (const [channel, startedAt] of this.bombStartedAt) {
      const elapsed = now - startedAt;
      const lane = this.laneX.get(channel);
      if (!lane) {
        continue;
      }
      // Frame is clamped — never wraps — so the explosion plays exactly once.
      const frameIndex = Math.min(totalFrames - 1, Math.max(0, Math.floor(elapsed / cycle)));
      const cellX = frameIndex % divx;
      const cellY = Math.floor(frameIndex / divx);
      const cropped = createCroppedTexture(bombTexture, {
        x: cellWidth * cellX,
        y: cellHeight * cellY,
        w: cellWidth,
        h: cellHeight,
      });
      if (!cropped) {
        continue;
      }
      const sprite = this.bombLayerPool.acquireSprite();
      sprite.texture = cropped;
      sprite.label = `bomb[ch=${channel},frame=${frameIndex}]`;
      const displayWidth = Math.max(cellWidth * 0.6, lane.w * (lr2Layout ? 4.5 : 3));
      const displayHeight = displayWidth * (cellHeight / cellWidth);
      sprite.position.set(lane.x + lane.w / 2 - displayWidth / 2, lane.bottom - displayHeight * 0.45);
      sprite.width = displayWidth;
      sprite.height = displayHeight;
      sprite.blendMode = 'add';
    }
  }

  /**
   * Renders a single LR2 `#SRC_IMAGE` + `#DST_IMAGE` element to the skin layer. Factored out so the caller can
   * interleave `judgeLines` between the static frame images and the timer-driven overlays (bombs, lasers, key-on
   * flashes) — see `renderSkin`.
   */
  private renderSkinImage(image: Lr2ImageElement): void {
    if (!this.isDestinationVisible(image.destination)) {
      return;
    }
    // Interpolate the destination keyframes against the timer-anchored elapsed time so multi-keyframe `#DST_IMAGE`
    // sequences animate smoothly.
    const elapsed = this.elapsedSinceTimer(image.destination.timer);
    const dst = image.keyframes.length > 1 ? evaluateKeyframes(image.keyframes, elapsed) : image.destination;
    // LR2: a DST with explicit w=0 or h=0 is effectively a no-op. Negative w/h is valid (grow-in-opposite-direction);
    // only zero is hidden.
    if (dst.w === 0 || dst.h === 0) {
      return;
    }
    const baseTexture = this.textures.get(image.source.imagePath);
    if (!baseTexture) {
      return;
    }
    // For LR2 special-graphic slots (`gr=100..111`) the chart's actual STAGEFILE / BACKBMP / BANNER is loaded under the
    // sentinel path and is the WHOLE image — not a cell of a divx*divy grid. Skip the cell crop and use the live
    // texture as-is so its native dimensions are preserved (the DST rectangle still scales it into the skin's intended
    // slot).
    let texture: Texture | undefined;
    if (isLr2SpecialGraphic(image.source.imagePath)) {
      texture = baseTexture;
    } else {
      // Pick the current SRC cell from the divx*divy animation grid; a `loop=-1` destination clamps SRC frames at the
      // last cell (one-shot effects). Pass the texture extents so LR2's `w=0` / `h=0` "use native size" shorthand
      // resolves correctly — without it, `w=0` produces a zero-width cell and we'd skip rendering the element entirely.
      // SRC cycling and DST keyframe looping are independent in LR2. Pass `dst.loop` to `pickAnimatedCell` ONLY for the
      // one-shot overlay timers (FC 48/49, bombs 50–69) so their explosion plays through the SRC cells exactly once and
      // then clamps at the last frame for the brief moment before the timer's own cleanup retires the element. Every
      // other element — most critically the LR2 default skin's "DONE" plate (timer 40 + op 81 + dst.loop=-1) — relies
      // on continuous SRC cycling for its blink animation, so we pass `undefined` and let `pickAnimatedCell` use its
      // default looping behavior.
      const dstTimer = image.destination.timer;
      const isOneShotOverlayTimer = dstTimer === 48 || dstTimer === 49 || (dstTimer >= 50 && dstTimer <= 69);
      const srcLoop = isOneShotOverlayTimer ? dst.loop : undefined;
      const cellRect = pickAnimatedCell(image.source, this.elapsedSinceTimer(image.source.timer), srcLoop, {
        width: baseTexture.width,
        height: baseTexture.height,
      });
      if (cellRect.w <= 0 || cellRect.h <= 0) {
        return;
      }
      texture = createCroppedTexture(baseTexture, cellRect);
    }
    if (!texture) {
      return;
    }
    // The AUTOPLAY label (any image gated on op 33) belongs in the same visual layer as the judgement plate — i.e.
    // above the falling notes. All other skin images stay in the regular skin layer.
    const targetPool = image.destination.ops.includes(33) ? this.overlayLayerPool : this.skinLayerPool;
    const sprite = targetPool.acquireSprite();
    sprite.texture = texture;
    sprite.label = `image[${image.source.imagePath}]`;
    const { x, y, w, h } = normalizeRect(dst);
    // op4=1 / op4=2 are the LR2 scratch-turntable spin markers (1P / 2P side respectively). We drive the sprite from
    // {@link turntableAngle}, which {@link updateTurntable} integrates from per-press impulses with exponential decay —
    // pressing scratch kicks the disc, releasing lets it spin down. Anchor at the center so the rotation pivots through
    // the visible disc rather than spinning around the top-left corner; PixiJS's y-down coords make positive `rotation`
    // turn the disc clockwise on screen.
    if (dst.op4 === 1 || dst.op4 === 2) {
      const side = dst.op4 === 1 ? '1' : '2';
      sprite.anchor.set(0.5, 0.5);
      sprite.position.set(x + w / 2, y + h / 2);
      sprite.rotation = this.turntableAngle[side];
    } else {
      sprite.position.set(x, y);
    }
    sprite.width = w;
    sprite.height = h;
    applyDestinationToSprite(sprite, dst);
    // Lane-laser release fade. When `releaseKeyOnTimer` has marked a key-on slot (timer 100..117) as fading, OVERRIDE
    // the sprite's alpha with a linear 1 → 0 taper over `KEY_ON_FADE_OUT_MS`. We override (rather than multiply)
    // because the LR2 default skin's key-on keyframe[0] is the fade-in origin (alpha = 0) — multiplying that by our
    // taper would keep the laser invisible the whole time. Position / size / color from the keyframe still apply via
    // the rest of `applyDestinationToSprite`.
    //
    // Defensive cleanup: when the elapsed time has crossed the full fade window we retire the timer state right here
    // instead of waiting on the `releaseKeyOnTimer` setTimeout. Browsers throttle / drop setTimeout callbacks under
    // battery-save / background-tab pressure, and we'd previously seen the laser stay painted at full brightness in
    // autoplay (where the only `releaseKeyOnTimer` caller is `flashKeyOnTimer`'s setTimeout chain) when the timer
    // never fired. Tearing the state down render-side guarantees the laser actually disappears once its fade window
    // has elapsed regardless of whether the deferred cleanup arrives.
    const fadeTimer = image.destination.timer;
    const keyOnFadeStart = this.keyOnFadeOutStart.get(fadeTimer);
    if (keyOnFadeStart !== undefined) {
      const elapsed = this.playClock() - keyOnFadeStart;
      const fadeMs = this.keyOnFadeDurationMs.get(fadeTimer) ?? KEY_ON_FADE_OUT_MS;
      if (elapsed >= fadeMs) {
        sprite.alpha = 0;
        // Belt-and-braces — keep the maps consistent so `isTimerActive` stops reporting the slot as active and the
        // next press starts from a clean fade-in keyframe. We mirror `releaseKeyOnTimer`'s deferred cleanup: only
        // wipe `timerStartedAt` when no real keypress is keeping the slot alive.
        this.keyOnFadeOutStart.delete(fadeTimer);
        const channel = this.resolveChannelForKeyOnTimer(fadeTimer);
        if (channel !== undefined && !this.pressedChannels.has(channel)) {
          this.timerStartedAt.delete(fadeTimer);
        }
      } else {
        sprite.alpha = Math.max(0, 1 - elapsed / fadeMs);
      }
    }
    // Same alpha taper for LN-hold-effect timers (70..89). Authored hold sprites stay visible while the timer is active
    // and decay through this taper after `releaseLnHoldTimer` records the fade origin.
    const lnHoldFadeStart = this.lnHoldFadeOutStart.get(fadeTimer);
    if (lnHoldFadeStart !== undefined) {
      const elapsed = this.playClock() - lnHoldFadeStart;
      const fadeMs = this.lnHoldFadeDurationMs.get(fadeTimer) ?? KEY_ON_FADE_OUT_MS;
      if (elapsed >= fadeMs) {
        sprite.alpha = 0;
        this.lnHoldFadeOutStart.delete(fadeTimer);
      } else {
        sprite.alpha = Math.max(0, 1 - elapsed / fadeMs);
      }
    }
  }

  /**
   * Reverse of {@link resolveKeyOnTimerId} — given a timer slot in the 100..119 range, returns the BMS channel id
   * that the gameplay engine would press / release for it. Used by the defensive fade-cleanup path so the render-
   * side teardown can leave `timerStartedAt` populated when the user is still physically holding the matching key.
   */
  private resolveChannelForKeyOnTimer(timerId: number): string | undefined {
    if (timerId < LR2_1P_KEYON_TIMER_BASE || timerId >= LR2_2P_KEYON_TIMER_BASE + 10) {
      return undefined;
    }
    const isPlayer2 = timerId >= LR2_2P_KEYON_TIMER_BASE;
    const base = isPlayer2 ? LR2_2P_KEYON_TIMER_BASE : LR2_1P_KEYON_TIMER_BASE;
    const laneIndex = timerId - base;
    if (laneIndex < 0 || laneIndex > 9) return undefined;
    if (this.chartPlayVariant === '9') {
      return `1${laneIndex}`;
    }
    const sidePrefix = isPlayer2 ? '2' : '1';
    // Lane index 0 is the scratch (LR2 maps it to channel `?6`); 1..7 map to `?1..?7`. We mirror the small table
    // from `resolveKeyOnTimerId` exactly to avoid drift.
    if (laneIndex === 0) return `${sidePrefix}6`;
    if (laneIndex >= 1 && laneIndex <= 7) return `${sidePrefix}${laneIndex}`;
    return undefined;
  }

  /**
   * Renders the LR2 `#DST_JUDGELINE` sprite (the horizontal bar at the judgement line, typically a thin red strip in
   * the LR2 default 7-keys skin). The skin's source frame already encodes the color; we only need to honor the
   * destination rectangle.
   */
  private renderJudgeLineElement(judgeLine: Lr2JudgeLineElement): void {
    if (!this.isDestinationVisible(judgeLine.destination)) {
      return;
    }
    const dst = this.evaluateElementDst(judgeLine);
    if (dst.w === 0 || dst.h === 0) {
      return;
    }
    const baseTexture = this.textures.get(judgeLine.source.imagePath);
    if (!baseTexture) {
      return;
    }
    const texture = createCroppedTexture(baseTexture, judgeLine.source);
    if (!texture) {
      return;
    }
    const sprite = this.skinLayerPool.acquireSprite();
    sprite.texture = texture;
    sprite.label = `judgeline[idx=${judgeLine.index}]`;
    sprite.position.set(dst.x, dst.y);
    sprite.width = dst.w;
    sprite.height = dst.h;
    applyDestinationToSprite(sprite, dst);
  }

  /**
   * Picks the current destination rect for any element type. When the element has a multi-keyframe DST chain,
   * interpolates against the timer-anchored elapsed time. Otherwise returns the static destination.
   */
  private evaluateElementDst(element: {
    destination: Lr2DestinationRect;
    keyframes: Lr2DestinationRect[];
  }): Lr2DestinationRect {
    return evaluateElementDestination(element, (timer) => this.elapsedSinceTimer(timer));
  }

  /**
   * Renders an LR2 `#DST_TEXT` element. We currently use a system font (no `#LR2FONT` bitmap-font support yet), which
   * means custom-styled labels in the LR2 skin will look generic. The string content for each `st` code is resolved
   * from the loaded chart metadata.
   */
  private renderTextElement(text: Lr2TextElement): void {
    const interpolated = this.evaluateElementDst(text);
    const { x, y, w, h } = normalizeRect(interpolated);
    // `w === 0` is an LR2-spec "no width constraint" hint (the field shrinks to fit the rendered string), so we must
    // NOT bail just because of it — skipping would hide every auto-sized label, including the centered song-title
    // display in the LR2 default play skin. Only `h === 0` is fatal (no glyph height to size on).
    if (h === 0) {
      return;
    }
    const value = this.resolveTextValue(text.st);
    if (!value) {
      return;
    }
    // Bitmap-font path — when the host loaded the matching `#LR2FONT`, paint glyphs from its sprite sheet so the text
    // matches the skin's pixel-art aesthetic. Falls through to the system-font path below when the font index isn't
    // loaded.
    const loaded = this.bitmapFonts.get(text.font);
    if (loaded) {
      // Bitmap-text path uses a per-frame disposeChildren'd sub-layer (see `skinBitmapTextLayer`) instead of the
      // pool because `makeLr2BitmapTextSprite` builds a fresh `Container` of glyph sprites each call.
      this.skinBitmapTextLayer.addChild(makeLr2BitmapTextSprite(value, text, interpolated, loaded));
      return;
    }
    // Match the LR2 destination height as the font size; this gives roughly the right size for system fonts even though
    // the original skin used a bitmap font that pre-baked size and glyph spacing.
    const fontSize = Math.max(8, Math.min(64, h * 0.8));
    const tint = (interpolated.r << 16) | (interpolated.g << 8) | interpolated.b;
    const node = this.skinLayerPool.acquireText();
    // Re-use a TextStyle keyed by `(st, fontSize, tint)` so identical descriptors share one paragraph layout cache,
    // keeping the per-frame allocation off the hot path. Distinct tuples build their own cached style on first
    // appearance and stay pinned across frames.
    const styleKey = `${text.st}:${fontSize}:${tint}`;
    let style = this.skinTextStyleCache.get(styleKey);
    if (!style) {
      style = new TextStyle({
        fill: tint,
        fontSize,
        fontWeight: '600',
        fontFamily: LR2_TEXT_FALLBACK_FONT,
      });
      this.skinTextStyleCache.set(styleKey, style);
    }
    if (node.style !== style) {
      node.style = style;
    }
    node.text = value;
    node.label = `text[st=${text.st}]`;
    node.alpha = interpolated.alpha;
    node.scale.set(1, 1); // pool acquireText keeps `tint/alpha`, but scale needs an explicit reset before measuring.
    // LR2 #SRC_TEXT spec (`docs/LR2SkinHelp.md` lines 1350+): align=0 → DST x is the LEFT edge of the rendered string
    // align=1 → DST x is the CENTER of the rendered string align=2 → DST x is the RIGHT edge of the rendered string
    if (text.alignment === 'center') {
      node.anchor.set(0.5, 0.5);
    } else if (text.alignment === 'right') {
      node.anchor.set(1, 0.5);
    } else {
      node.anchor.set(0, 0.5);
    }
    node.position.set(x, y + h / 2);
    // LR2 shrink-to-fit (LR2SkinHelp line 1343): the rendered string is auto-compressed horizontally when its width
    // exceeds the DST's `w`. We squeeze via `scale.x`; the scale applies around the text's anchor, so the alignment
    // edge stays pinned (right-aligned text squeezes toward its right edge, centered text stays centered, …).
    if (w > 0 && node.width > w) {
      node.scale.x = w / node.width;
    }
  }

  /**
   * `TextStyle` cache keyed by `(st, fontSize, tint)` — every distinct skin-text descriptor builds a single style
   * and pins it; subsequent frames reuse the same `TextStyle` reference, so re-assigning `node.style` is a no-op
   * (Pixi's paragraph layout cache only invalidates on identity change, not value-equality).
   */
  private readonly skinTextStyleCache = new Map<string, TextStyle>();

  /**
   * Resolves the string content for an `#SRC_TEXT,st=…` slot. This is a minimal subset focused on values that are
   * meaningful during a play session — title / subtitle / artist / genre / difficulty.
   */
  private resolveTextValue(st: number): string | undefined {
    const song = this.song;
    if (!song) {
      return undefined;
    }
    const subartists = song.chart.bmson.info?.subartists?.join(' / ');
    switch (st) {
      case 1:
        // Target / rival name. We don't have a multiplayer rival, so just show "TARGET" as a placeholder so the slot
        // isn't visually missing.
        return 'TARGET';
      case 2:
        return 'PLAYER';
      case 10:
      case 20:
        return song.title;
      case 11:
      case 21:
        return song.subtitle ?? '';
      case 12:
      case 22:
        return [song.title, song.subtitle].filter((value): value is string => Boolean(value)).join(' ');
      case 13:
      case 23:
        return song.genre ?? '';
      case 14:
      case 24:
        return song.artist ?? '';
      case 15:
      case 25:
        return subartists ?? '';
      case 17:
      case 27:
        return song.playLevel?.toString() ?? '';
      case 18:
      case 28:
        return resolveDifficultyName(song.chart.metadata.difficulty);
      default:
        return undefined;
    }
  }

  /**
   * Renders an LR2 `#SRC_BARGRAPH` element. The bar is drawn by clipping the destination rect to a `progress`-fraction
   * of its width (or height for vertical bars). Only the most common types — gauge, score graph, song progress — are
   * wired; others fall back to a 0-progress (hidden) draw.
   */
  private renderBarGraphElement(bargraph: Lr2BarGraphElement): void {
    const interpolated = this.evaluateElementDst(bargraph);
    const { x, y, w, h } = normalizeRect(interpolated);
    if (w === 0 || h === 0) {
      return;
    }
    const baseTexture = this.textures.get(bargraph.source.imagePath);
    if (!baseTexture) {
      return;
    }
    const progress = this.resolveBarGraphProgress(bargraph.type);
    if (progress <= 0) {
      return;
    }
    // Stretch the SRC rect over the (clipped) DST rect. For horizontal bars we shrink the width by `progress`; for
    // vertical bars we shrink height and shift the top edge down so the bar fills upward.
    const cropTexture = createCroppedTexture(baseTexture, bargraph.source);
    if (!cropTexture) {
      return;
    }
    const sprite = this.skinLayerPool.acquireSprite();
    sprite.texture = cropTexture;
    sprite.label = `bargraph[type=${bargraph.type}]`;
    if (bargraph.muki === 'vertical') {
      const filledHeight = Math.round(h * progress);
      sprite.position.set(x, y + (h - filledHeight));
      sprite.width = w;
      sprite.height = filledHeight;
    } else {
      sprite.position.set(x, y);
      sprite.width = Math.round(w * progress);
      sprite.height = h;
    }
    applyDestinationToSprite(sprite, interpolated);
  }

  /**
   * Returns the 0..1 progress fraction for a given LR2 bargraph `type`. See `lr2skinhelp/bargraph.txt` for the full
   * enum; the play screen mostly uses 1 (song progress) and 10/11 (1P EX score).
   */
  private resolveBarGraphProgress(type: number): number {
    switch (type) {
      case 1: {
        // Chart progress: ratio of currentSeconds to total chart duration.
        const total = this.resolveSongDurationSeconds();
        if (total <= 0) {
          return 0;
        }
        return Math.max(0, Math.min(1, this.currentSeconds() / total));
      }
      case 2:
        // Load state — we always finish loading before play, so 1.
        return 1;
      case 10:
      case 11:
      case 12:
      case 13: {
        // 1P EX-score (current / predicted / highscore current/final). We don't yet track predicted/highscore; reuse
        // the live EX rate.
        return computeScoreRate(this.score);
      }
      default:
        return 0;
    }
  }

  /**
   * Renders an LR2 `#SRC_SLIDER` element. We treat sliders as static "knob" sprites positioned along the `range` axis
   * according to the runtime value. Most play-screen sliders (hi-speed, song progress) read back nicely from existing
   * state.
   */
  private renderSliderElement(slider: Lr2SliderElement): void {
    const interpolated = this.evaluateElementDst(slider);
    const { x, y, w, h } = normalizeRect(interpolated);
    if (w === 0 || h === 0) {
      return;
    }
    const baseTexture = this.textures.get(slider.source.imagePath);
    if (!baseTexture) {
      return;
    }
    const cropTexture = createCroppedTexture(baseTexture, slider.source);
    if (!cropTexture) {
      return;
    }
    const value = this.resolveSliderValue(slider.type); // 0..1
    const offset = slider.range * value;
    let drawX = x;
    let drawY = y;
    switch (slider.muki) {
      case 'down':
        drawY = y + offset;
        break;
      case 'up':
        drawY = y - offset;
        break;
      case 'right':
        drawX = x + offset;
        break;
      case 'left':
        drawX = x - offset;
        break;
    }
    const sprite = this.skinLayerPool.acquireSprite();
    sprite.texture = cropTexture;
    sprite.label = `slider[type=${slider.type}]`;
    sprite.position.set(drawX, drawY);
    sprite.width = w;
    sprite.height = h;
    applyDestinationToSprite(sprite, interpolated);
  }

  /** Returns the 0..1 value for a slider type. */
  private resolveSliderValue(type: number): number {
    switch (type) {
      case 2: {
        // HiSpeed 1P: map the multiplier into [0..1] over the supported range.
        const span = HISPEED_MAX - HISPEED_MIN;
        return span <= 0 ? 0 : Math.max(0, Math.min(1, (this.hiSpeed - HISPEED_MIN) / span));
      }
      case 6: {
        // Chart progress ratio
        const total = this.resolveSongDurationSeconds();
        return total <= 0 ? 0 : Math.max(0, Math.min(1, this.currentSeconds() / total));
      }
      default:
        return 0;
    }
  }

  /**
   * Renders the judgement plate + NOWCOMBO digits as a single horizontally centered assembly. The two are drawn together
   * so the relative gap stays stable while the whole group slides left/right to center on the lane area as the combo
   * gets longer.
   *
   * Called from `renderSkin` and emits to `overlayLayer` so the assembly sits *above* falling notes — matching the LR2
   * reference where the "GREAT 158" text punches through the note stream.
   */
  private renderJudgeAndComboOnOverlay(skin: Lr2Skin): void {
    // DP charts paint judge + combo on BOTH sides simultaneously, but each side reads its own *snapshot* state so the
    // combo number on each side reflects that side's most recent hit (and stays still while only the other side fires).
    // SP charts only ever populate the 1P slot.
    this.renderJudgeAndComboForSide(skin, '1P');
    // 9 KEY (PMS) charts can store their lane data on the 2x channel block but they're still *single-side* — only DP
    // (variant 10/14) actually wants a second judge/combo plate painted on the 2P lane.
    const usesPlayer2 = this.chartPlayVariant !== '9' && this.laneChannels.some((channel) => channel.startsWith('2'));
    if (usesPlayer2) {
      this.renderJudgeAndComboForSide(skin, '2P');
    }
  }

  /**
   * Renders one side's judge plate + NOWCOMBO assembly. Picks the side-specific elements (`skin.judges2P` / matching
   * `skin.nowCombos.side === '2P'`), falling back to the 1P slots when the skin omitted the 2P pair — matches LR2's
   * "DP-aware skins author both sides; SP-only skins reuse the 1P rect for any 2P hit" convention. The verdict text +
   * combo number come from the per-side snapshot in {@link judgeSideState} so the 1P / 2P assemblies tick
   * independently.
   */
  private renderJudgeAndComboForSide(skin: Lr2Skin, side: '1P' | '2P'): void {
    const state = this.judgeSideState[side];
    const seconds = this.currentSeconds();
    if (!state.judge || seconds > state.until) {
      return;
    }
    const judgeKind = resolveJudgeSkinKind(state.judge);
    if (!judgeKind) return;
    const comboKind = lastJudgeToNowComboKind(state.judge);
    const sideJudgeMap = side === '2P' ? skin.judges2P : skin.judges;
    const judgeElements = sideJudgeMap[judgeKind] ?? skin.judges[judgeKind];
    const judgeAnchor = judgeElements?.[0]?.destination;
    if (!judgeElements?.length || !judgeAnchor) {
      return;
    }
    const comboElement = comboKind
      ? (skin.nowCombos.find(
          (entry) => entry.kind === comboKind && entry.side === side && this.isDestinationVisible(entry.destination),
        ) ?? skin.nowCombos.find((entry) => entry.kind === comboKind && this.isDestinationVisible(entry.destination)))
      : undefined;
    const visibleCombo = comboKind && state.combo > 0 ? state.combo : 0;
    // Compute centering offset so that judge plate + combo sits centered on this side's lane area. Without this the
    // assembly was anchored at LR2's static x=73 / x=185 coordinates, biased ~10px to the left of the lane center and
    // drifting further as the combo grew.
    const laneCenter = this.resolveLaneCenter(skin, side);
    const judgeRight = judgeAnchor.x + judgeAnchor.w;
    let assemblyRight = judgeRight;
    if (comboElement && visibleCombo > 0) {
      const totalDigits = visibleCombo.toString().length;
      const comboLeft = judgeAnchor.x + comboElement.destination.x;
      assemblyRight = Math.max(judgeRight, comboLeft + comboElement.destination.w * totalDigits);
    }
    const offsetX = laneCenter - (judgeAnchor.x + assemblyRight) / 2;

    // 1) Judge plate. The full keyframe chain animates against timer 46 (1P) / 47 (2P), both restarted on the matching
    // side's hit in `publishJudge`. We pick the side-specific timer so the fade-in / fade-out keyframes land in sync
    // with the verdict that triggered them.
    const judgeElapsed = this.elapsedSinceTimer(side === '2P' ? 47 : 46);
    for (const element of judgeElements) {
      if (!this.isDestinationVisible(element.destination)) {
        continue;
      }
      const dst = this.evaluateElementDst(element);
      if (dst.w === 0 || dst.h === 0) {
        continue;
      }
      const baseTexture = this.textures.get(element.source.imagePath);
      if (!baseTexture) {
        continue;
      }
      const cellRect = pickAnimatedCell(element.source, judgeElapsed);
      const texture = createCroppedTexture(baseTexture, cellRect);
      if (!texture) {
        continue;
      }
      const sprite = this.overlayLayerPool.acquireSprite();
      sprite.texture = texture;
      sprite.label = `nowjudge[side=${side},kind=${judgeKind}]`;
      sprite.position.set(dst.x + offsetX, dst.y);
      sprite.width = dst.w;
      sprite.height = dst.h;
      applyDestinationToSprite(sprite, dst);
    }

    // 2) Combo digits (animated for PERFECT — divx*divy with cycle).
    if (comboElement && visibleCombo > 0) {
      renderNowComboElement(
        this.overlayLayerPool,
        comboElement,
        visibleCombo,
        judgeAnchor,
        this.textures,
        judgeElapsed,
        offsetX,
        this.evaluateElementDst(comboElement),
      );
    }
  }

  /**
   * Returns the horizontal center of one side's play-field area (in design pixels) derived from the LR2 skin's
   * `#DST_NOTE` rectangles. `side` filters the lane set: `1P` keeps indices 0..9, `2P` keeps indices 10..19 (per
   * `resolveLr2LaneIndex`'s mapping). Falls back to the fallback playfield constant when no skin is loaded or the
   * requested side has no lanes.
   */
  private resolveLaneCenter(skin: Lr2Skin, side: '1P' | '2P' = '1P'): number {
    const sideLanes: Lr2DestinationRect[] = [];
    skin.laneRects.forEach((rect, index) => {
      if (!rect) return;
      const isPlayer2Index = index >= 10;
      if (side === '2P' && !isPlayer2Index) return;
      if (side === '1P' && isPlayer2Index) return;
      sideLanes.push(rect);
    });
    if (sideLanes.length === 0) {
      return PLAYFIELD.x + PLAYFIELD.w / 2;
    }
    const leftmost = sideLanes.reduce((acc, lane) => Math.min(acc, lane.x), sideLanes[0]!.x);
    const rightmost = sideLanes.reduce(
      (acc, lane) => Math.max(acc, lane.x + lane.w),
      sideLanes[0]!.x + sideLanes[0]!.w,
    );
    return (leftmost + rightmost) / 2;
  }

  /**
   * Picks the best note SRC for the given kind + lane index.
   *
   * The LR2 `#SRC_AUTO_*` variants ("dummy notes") are *not* a global "use this when autoplay is on" override — they
   * only kick in for lanes that the per-lane autoscratch / autolane options (op 53/55) handle automatically, with
   * `AUTOPLAY LANE = DUMMY NOTES` (op 915) selected. Full-game autoplay (op 33) keeps the regular note sprite, exactly
   * like the LR2 reference video.
   */
  private resolveNoteSource(
    skin: Lr2Skin | undefined,
    kind: 'note' | 'lnstart' | 'lnend' | 'lnbody' | 'mine',
    laneIndex: number,
  ): Lr2ImageRect | undefined {
    if (!skin) {
      return undefined;
    }
    if (this.isAutoLane(laneIndex) && this.runtimeOps.has(915)) {
      const autoKind = ('auto' + kind) as keyof Lr2Skin['notes'];
      const auto = skin.notes[autoKind];
      const direct = auto?.[laneIndex];
      const fallback = auto?.find((entry): entry is Lr2ImageRect => Boolean(entry));
      const autoSrc = direct ?? fallback;
      if (autoSrc) {
        return autoSrc;
      }
    }
    return skin.notes[kind]?.[laneIndex];
  }

  /**
   * Returns true when the given lane index is currently auto-handled by the per-lane play options — autoscratch on (op
   * 55) → scratch lane auto, or autolane on (op 53) → all lanes auto. Global autoplay (op 33) is deliberately not
   * counted here so notes still render in their normal color during autoplay demonstrations, matching the LR2
   * reference.
   */
  private isAutoLane(laneIndex: number): boolean {
    if (this.runtimeOps.has(53)) {
      return true;
    }
    if (laneIndex === 0 && this.runtimeOps.has(55)) {
      return true;
    }
    return false;
  }

  private hasSkinnedJudge(): boolean {
    const skin = this.options.skin;
    if (!skin) {
      return false;
    }
    const kind = resolveJudgeSkinKind(this.lastJudge);
    if (!kind) return false;
    // Either side authoring the verdict counts — the renderer falls back to 1P when the 2P slot is empty, so the
    // fallback judge text path needs to follow the same either-side rule.
    return Boolean(skin.judges[kind]?.length || skin.judges2P[kind]?.length);
  }
}

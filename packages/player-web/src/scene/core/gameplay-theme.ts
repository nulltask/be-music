/**
 * The vocabulary of the theme hooks of the built-in and LR2 gameplay scenes (`CoreGameplayView`): the BGA rects, lane
 * rects, note cells, measure-line frames and scene timing a theme family supplies, and the scene moments it reacts to.
 * The modules the scene's parts live in read them from here; `gameplay.ts` re-exports them for the theme families.
 */

import type { PlayerUiCommand } from '@be-music/player/core/ui-signal-bus';
import type { Sprite, Texture } from 'pixi.js';

/**
 * One rectangle the chart's BGA is composited into. The core scene paints into the default-family BGA rect; themes
 * supply their own via {@link CoreGameplayView.collectBgaTargets} (the LR2 family maps its `#DST_BGA` entries).
 */
export interface GameplayBgaTarget {
  /** Destination rect in design pixels, already normalized. Zero-sized rects are skipped. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Suppress the base track (channel 04) on this rect. */
  noBase: boolean;
  /** Suppress the layer track (channels 07 / 0A) on this rect. */
  noLayer: boolean;
  /** Suppress the POOR override (channel 06) on this rect. */
  noPoor: boolean;
  /**
   * Applies the destination's alpha / tint / blend (and any rotation) to a BGA sprite after the scene positioned and
   * sized it. The chart-level `#ARGBxx` tint is composed on top afterwards.
   */
  applyToSprite(sprite: Sprite): void;
}

/** Design canvas of the scene: its width / height and, for the be-music path, the skin's stage. */
export interface GameplayStageSize {
  width: number;
  height: number;
}

/** Lane rectangle in design pixels. `bottom` is the judgement line a note's bottom edge lands on. */
export interface GameplayLaneRect {
  x: number;
  w: number;
  top: number;
  bottom: number;
}

/** Note-sprite slots a theme can supply textures for. `invisible` is the debug keysound overlay. */
export type GameplayThemeNoteKind = 'note' | 'lnstart' | 'lnend' | 'lnbody' | 'mine' | 'invisible';

/**
 * Theme-supplied cell for one note sprite. `texture` is `undefined` when the theme authors the slot but the cell could
 * not be cropped this frame — the scene then draws nothing for that part (LN body / caps) or falls back to its own
 * drawing (single notes / mines / invisible notes).
 */
export interface GameplayThemeNoteCell {
  texture: Texture | undefined;
  width: number;
  height: number;
}

/** Inputs for {@link CoreGameplayView.renderThemeMeasureLines}. */
export interface GameplayMeasureLineFrame {
  /** Beat at the start of every measure. */
  beats: readonly number[];
  /** First index into `beats` worth visiting. */
  firstBeatIndex: number;
  /**
   * Walk stops past this beat. Under beatoraja's rules (see `note-draw-window.ts`) it is where the chart first runs
   * past the lane top, so a line a negative `#SCROLL` brings back into the lane after that is not drawn.
   */
  maxBeat: number;
  pixelsPerBeat: number;
  /** Scroll distance in beats from the current playhead to `beat`. */
  beatDistance: (beat: number) => number;
  /**
   * Where the line at `beat` draws: `bottom - beatDistance(beat) * pixelsPerBeat`, held on the judgement line once
   * passed under LR2's rules (see `note-draw-window.ts`).
   */
  lineY: (beat: number) => number;
  /** Lane area top / judgement-line bottom in design pixels. */
  top: number;
  bottom: number;
  /**
   * Lowest y a line may be drawn at: `bottom`, or under beatoraja's rules the bottom of the stage, where a negative
   * `#SCROLL` can put a line that is still ahead.
   */
  drawBottom: number;
}

/** Scene timing a theme authors: the intro gates before chart start and the exit fade / close lengths, in ms. */
export interface GameplayThemeTiming {
  /** Offset from scene start at which loading counts as finished (LR2 `#LOADSTART + #LOADEND`). */
  loadEndOffsetMs: number;
  /** Offset from scene start at which the chart begins; `0` falls back to {@link FALLBACK_INTRO_DELAY_MS}. */
  playStartOffsetMs: number;
  /** Exit fade-out length; `0` skips the fade. */
  fadeOutMs: number;
  /** Hold after the fade before the host callback fires; `0` skips it. */
  closeMs: number;
}

/**
 * Scene moments a theme can react to (the LR2 family stamps its skin timers from these). `at` is the
 * {@link CoreGameplayView.playClock} value the scene recorded for the moment.
 */
export type GameplayThemeEvent =
  | { kind: 'scene-start'; at: number }
  | { kind: 'load-end'; at: number }
  | { kind: 'play-start'; at: number }
  | { kind: 'exit-fade-out'; at: number }
  | { kind: 'exit-close'; at: number }
  | { kind: 'judge'; side: '1P' | '2P'; at: number }
  | { kind: 'full-combo'; at: number }
  | { kind: 'gauge'; previous: number; next: number }
  | { kind: 'bomb'; channel: string; at: number }
  | { kind: 'bomb-retired'; channel: string }
  | { kind: 'lane-command'; command: PlayerUiCommand };

/**
 * `CoreGameplayView`'s overridable theme hooks, for the modules the scene's parts live in. The hooks stay `protected`
 * for the theme families that override them, so the scene hands the modules this object (`CoreGameplayView.theme`),
 * whose functions call them; `themeTiming`, `stageSize` and `themeOwnsPlayfield` are the hooks' getters.
 */
export interface GameplayThemeHooks {
  attachThemeLayers(): void;
  renderThemeLayer(width: number, height: number): void;
  themeTiming(): GameplayThemeTiming;
  stageSize(): GameplayStageSize;
  themeOwnsPlayfield(): boolean;
  resolveThemeLaneRect(channel: string, width: number, height: number): GameplayLaneRect | undefined;
  resolveThemeNoteCell(kind: GameplayThemeNoteKind, laneIndex: number): GameplayThemeNoteCell | undefined;
  renderThemeMeasureLines(frame: GameplayMeasureLineFrame): boolean;
  renderThemeText(seconds: number): void;
  renderBombEffects(): void;
  resolveBombDurationMs(channel: string): number;
  resolveKeyOnFadeMs(timerId: number): number;
  collectBgaTargets(out: GameplayBgaTarget[]): void;
  onThemeEvent(event: GameplayThemeEvent): void;
}

/**
 * The theme hooks the play session itself calls (`session/play/*`): the timing of the intro and the fade-out, the scene
 * moments, the key-beam fade and the stage the touch lanes map onto. The rest only the view's own drawing calls.
 */
export type GameplaySessionHooks = Pick<
  GameplayThemeHooks,
  'onThemeEvent' | 'themeTiming' | 'resolveKeyOnFadeMs' | 'stageSize'
>;

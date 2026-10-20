/**
 * What a play session asks of the view that draws it (`PlaySessionTheme`), and the moments of the play it tells the
 * view about (`PlayMoment`). The session draws nothing: the view's timing gates its intro and ending, and the view's
 * key-beam fade times the key beams the session keeps. The view's touch lanes come back to the session as `lane`
 * intents.
 */

import type { PlayerUICommand } from '@be-music/player/signals';
import type { Texture } from 'pixi.js';
import type { PlayViewSetting, PlayViewTiming } from '../../view/types.ts';

/**
 * A moment of the play the session raises for its view: the scene stages, the exit phases, a judgment, the full combo,
 * a gauge move, a bomb and the engine's lane commands. `at` is on the play clock (`PlaySession.playClock`). The scene
 * session hands them to the view in its frames (`PlayFrame.events`, `playViewEventFromMoment`).
 */
export type PlayMoment =
  | { readonly kind: 'scene-start'; readonly at: number }
  | { readonly kind: 'load-end'; readonly at: number }
  | { readonly kind: 'play-start'; readonly at: number }
  | { readonly kind: 'exit-fade-out'; readonly at: number }
  | { readonly kind: 'exit-close'; readonly at: number }
  | {
      readonly kind: 'judge';
      readonly side: '1P' | '2P';
      readonly at: number;
      /** The judgment, as the engine named it. */
      readonly judge: string;
      readonly channel?: string;
      /** The signed offset (ms, > 0 late), when the judgment has a timing. */
      readonly deltaMs?: number;
      /** The running combo after the judgment. */
      readonly combo: number;
    }
  | { readonly kind: 'full-combo'; readonly at: number }
  | { readonly kind: 'gauge'; readonly previous: number; readonly next: number; readonly at: number }
  | { readonly kind: 'bomb'; readonly channel: string; readonly at: number }
  | { readonly kind: 'lane-command'; readonly command: PlayerUICommand }
  /** The player's keys changed a view setting (the hi-speed, a lane cover). */
  | { readonly kind: 'view-setting'; readonly setting: PlayViewSetting; readonly at: number };

/**
 * What a play session asks of the view that draws it: the view's timing (the intro gates, the fade-out, the close), the
 * moments it animates against, how long a key beam fades, and the loading and GPU upload only the view can do.
 */
export interface PlaySessionTheme {
  /** The view's timing as its skin authors it: when loading counts as done, when the chart starts, the fade and close. */
  timing(): PlayViewTiming;
  /** A moment of the play happened. */
  moment(moment: PlayMoment): void;
  /** How long `channel`'s key beam fades once its key is up, in ms. */
  keyOnFadeMs(channel: string): number;
  /**
   * Loads the view's own assets once the chart is prepared and before its samples decode (an LR2 skin's images, fonts
   * and timer spans); the play waits for it. It should stop early once the play is disposed.
   */
  prepareView?(): Promise<void>;
  /** Uploads `textures` to the GPU now, so the first frame that draws them does not stall. */
  uploadTextures?(textures: Iterable<Texture | undefined>): Promise<void>;
  /**
   * How the view's hi-speed reads in the replay (`ReplayViewState`): its scale and the lane in beats at hi-speed 1.
   * Without it the replay reads the built-in and LR2 scale over the lanes the shared playfield laid out. Either way
   * the visible time is taken at the play's main BPM, which the session works out for every family.
   */
  replayView?(): PlayReplayViewScale | undefined;
  /**
   * Whether the view draws the LIFT (the beatoraja play skin raises its judgement line): a replay then shows the
   * recorded one. Without it the view draws none, and a replay leaves the play state's LIFT alone.
   */
  drawsLift?(): boolean;
}

/** How a view's hi-speed reads in the replay: its scale and the lane in beats at hi-speed 1. */
export interface PlayReplayViewScale {
  readonly scale: string;
  readonly laneBeats: number;
}

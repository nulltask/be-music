/**
 * What a play session asks of the view that draws it (`PlaySessionTheme`), and the moments of the play it tells the
 * view about (`PlayMoment`). The session draws nothing: the view's timing gates its intro and ending, the view's key-beam
 * fade times the key-on state the session keeps, and the view's stage is where the touch lanes are.
 */

import type { PlayerUiCommand } from '@be-music/player/core/ui-signal-bus';
import type { Texture } from 'pixi.js';
import type { PlayfieldStage, PlayViewTiming } from '../../view/types.ts';

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
  | { readonly kind: 'judge'; readonly side: '1P' | '2P'; readonly at: number }
  | { readonly kind: 'full-combo'; readonly at: number }
  | { readonly kind: 'gauge'; readonly previous: number; readonly next: number; readonly at: number }
  | { readonly kind: 'bomb'; readonly channel: string; readonly at: number }
  | { readonly kind: 'lane-command'; readonly command: PlayerUiCommand };

/**
 * What a play session asks of the view that draws it: the view's timing (the intro gates, the fade-out, the close), the
 * moments it animates against, how long a key beam fades, the stage the touch lanes map onto, and the loading and GPU
 * upload only the view can do.
 */
export interface PlaySessionTheme {
  /** The view's timing as its skin authors it: when loading counts as done, when the chart starts, the fade and close. */
  timing(): PlayViewTiming;
  /** A moment of the play happened. */
  moment(moment: PlayMoment): void;
  /** How long `channel`'s key beam fades once its key is up, in ms. */
  keyOnFadeMs(channel: string): number;
  /** The design stage the playfield is laid out on, which the touch lanes map onto. */
  stage(): PlayfieldStage;
  /**
   * Loads the view's own assets once the chart is prepared and before its samples decode (an LR2 skin's images, fonts
   * and timer spans); the play waits for it. It should stop early once the play is disposed.
   */
  prepareView?(): Promise<void>;
  /** Uploads `textures` to the GPU now, so the first frame that draws them does not stall. */
  uploadTextures?(textures: Iterable<Texture | undefined>): Promise<void>;
}

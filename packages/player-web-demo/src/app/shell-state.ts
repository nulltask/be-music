// The demo shell's state as the scenes change: which overlays step aside, whether the touch controls show, and where the
// search field goes. Pure, so the per-frame check in `shell.ts` only reads the app and applies the result.

import type { SceneKind } from '@be-music/player-web/host';

/** What the shell state is resolved from. */
export interface ShellStateInput {
  /** The play's family while there is a play (loading behind a decide screen, or on the stage). */
  readonly playFamily: string | undefined;
  /** Whether the play is paused. */
  readonly paused: boolean;
  /** The kind of scene on stage, `undefined` between scenes. */
  readonly showing: SceneKind | undefined;
  /** Whether the skin draws on a portrait stage. */
  readonly portraitStage: boolean;
  /** Whether the select skin has its own search box. */
  readonly skinHasBox: boolean;
}

/** The shell's classes and the page's viewport, as {@link resolveShellState} decides them. */
export interface ShellState {
  /** A play screen is up (or being prepared behind a decide screen): the select-screen overlays step aside. */
  readonly inGameplay: boolean;
  /** The play takes touch input and has the touch pause / quit controls (the built-in and LR2 play views). */
  readonly touchPlay: boolean;
  readonly paused: boolean;
  readonly portraitStage: boolean;
  /** The select skin's search box opens the field in place, so the field at the foot of the screen is hidden. */
  readonly searchInSkin: boolean;
  /** The select screen is not on stage: the search field hides, whatever the family. */
  readonly offSelect: boolean;
}

export function resolveShellState(input: ShellStateInput): ShellState {
  const inGameplay = input.playFamily !== undefined;
  return {
    inGameplay,
    // A beatoraja skin draws its own lanes and takes no touch.
    touchPlay: inGameplay && input.playFamily !== 'beatoraja',
    paused: inGameplay && input.paused,
    portraitStage: input.portraitStage,
    searchInSkin: !inGameplay && input.skinHasBox,
    offSelect: inGameplay || input.showing !== 'select',
  };
}

/** A key that changes whenever the resolved state does, so the shell touches the DOM only on a change. */
export function shellStateKey(state: ShellState): string {
  return `${state.inGameplay}/${state.touchPlay}/${state.paused}/${state.portraitStage}/${state.searchInSkin}/${state.offSelect}`;
}

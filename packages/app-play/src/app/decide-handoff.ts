// What a decide screen hands the stage to once the play loading behind it settles. The play shown is the one the
// preload made, never whichever play the host happens to hold by then, and a play made again after a failed preload
// keeps the decide screen's `#RANDOM` / `#SWITCH` draws (`preResolved`), so it plays the branches the screen showed.

/** The play loading behind a decide screen, with the options it was made with. */
export interface DecidePreload<P, O> {
  /**
   * What the play was made with, the decide screen's draws (`preResolved`) among them: a play made again without the
   * preload takes the same.
   */
  readonly options: O;
  /** The play once it has loaded, or `undefined` when a newer navigation replaced it first. */
  readonly play: Promise<P | undefined>;
}

/** Where the decide screen goes once its preload has settled. */
export type DecideHandOff<P, O> =
  /** Show the play the preload made. */
  | { readonly kind: 'play'; readonly play: P }
  /** The preload failed: make the play again without one, with the same options. */
  | { readonly kind: 'reload'; readonly options: O; readonly error: unknown }
  /** A newer navigation replaced the decide screen: nothing to show. */
  | { readonly kind: 'stale' };

/**
 * Waits for the play loading behind a decide screen and says where the screen goes. `isCurrent` tells whether the
 * decide screen's navigation is still the newest one: a failed preload is made again only then.
 */
export async function settleDecidePreload<P, O>(
  preload: DecidePreload<P, O>,
  isCurrent: () => boolean,
): Promise<DecideHandOff<P, O>> {
  let play: P | undefined;
  try {
    play = await preload.play;
  } catch (error) {
    return isCurrent() ? { kind: 'reload', options: preload.options, error } : { kind: 'stale' };
  }
  return play !== undefined ? { kind: 'play', play } : { kind: 'stale' };
}

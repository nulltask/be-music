import { REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS } from './engine-clock.ts';

/**
 * The realtime audio of a play: time-sorted lists (volume changes, background sounds, AUTO play's note keysounds)
 * fired in order as the play reaches them.
 */

/** Walks a time-sorted list, firing each item once the reference time reaches it. */
export interface RealtimeAudioCursor<T = unknown> {
  /** Fires every item due by `referenceSeconds` (chart seconds), in order. */
  triggerUntil(referenceSeconds: number): void;
  /**
   * Moves the cursor to `referenceSeconds`, backwards or forwards (a seek): it starts over from the first item and passes
   * every item due by then, handing each to `passed` with how long ago it was due (to start what still sounds partway).
   * Without `passed` the items passed are fired, as {@link triggerUntil} fires them (state such as volume changes).
   */
  seek(referenceSeconds: number, passed?: (item: T, offsetSeconds: number) => void): void;
  /** Every item has fired. */
  readonly done: boolean;
}

/**
 * A cursor over `items` (sorted by `seconds`) that calls `fire` for each one due. `clamp` caps the reference time first
 * (AUTO play's keysounds freeze at an LR2 negative-BPM reversal, #134).
 */
export function createRealtimeAudioCursor<T extends { readonly seconds: number }>(
  items: readonly T[],
  fire: (item: T) => void,
  clamp?: (seconds: number) => number,
): RealtimeAudioCursor<T> {
  let index = 0;
  const walk = (referenceSeconds: number, visit: (item: T, reference: number) => void): void => {
    const reference = Math.max(0, clamp === undefined ? referenceSeconds : clamp(referenceSeconds));
    const safeReferenceSeconds = reference + REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS;
    while (index < items.length) {
      const item = items[index]!;
      if (item.seconds > safeReferenceSeconds) {
        break;
      }
      visit(item, reference);
      index += 1;
    }
  };
  return {
    triggerUntil(referenceSeconds: number): void {
      walk(referenceSeconds, fire);
    },
    seek(referenceSeconds: number, passed?: (item: T, offsetSeconds: number) => void): void {
      index = 0;
      walk(
        referenceSeconds,
        passed === undefined ? fire : (item, reference) => passed(item, Math.max(0, reference - item.seconds)),
      );
    },
    get done(): boolean {
      return index >= items.length;
    },
  };
}

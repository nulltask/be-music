import { REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS } from './engine-clock.ts';

/**
 * The realtime audio of a play: time-sorted lists (volume changes, background sounds, AUTO play's note keysounds)
 * fired in order as the play reaches them.
 */

/** Walks a time-sorted list, firing each item once the reference time reaches it. */
export interface RealtimeAudioCursor {
  /** Fires every item due by `referenceSeconds` (chart seconds), in order. */
  triggerUntil(referenceSeconds: number): void;
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
): RealtimeAudioCursor {
  let index = 0;
  return {
    triggerUntil(referenceSeconds: number): void {
      const reference = clamp === undefined ? referenceSeconds : clamp(referenceSeconds);
      const safeReferenceSeconds = Math.max(0, reference) + REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS;
      while (index < items.length) {
        const item = items[index]!;
        if (item.seconds > safeReferenceSeconds) {
          break;
        }
        fire(item);
        index += 1;
      }
    },
    get done(): boolean {
      return index >= items.length;
    },
  };
}

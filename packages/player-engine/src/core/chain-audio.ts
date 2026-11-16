import type { ResolvedChainSound } from '@be-music/chart-model';
import type { BeMusicEvent } from '@be-music/chart-source';
import { REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS } from './engine-clock.ts';

/**
 * LRX chain notes as a play sounds them: each press that sounds a note queues the chain notes tied to it, each its
 * `delaySeconds` after the press, and the play fires them as its clock reaches them. Pressing the note again queues
 * them again, as plugout does (`plugout4.exe` 0x43bcd0).
 */
export interface ChainSoundQueue {
  /** Queues `sounds` after a press at chart second `seconds`, firing at once what is due then. */
  schedule(seconds: number, sounds: readonly ResolvedChainSound[]): void;
  /** Fires every queued sound due by chart second `seconds`, in order. */
  triggerUntil(seconds: number): void;
  /** Drops every queued sound (a seek or a restarted practice loop). */
  clear(): void;
  /** Nothing is queued. */
  readonly done: boolean;
}

interface QueuedChainSound {
  seconds: number;
  event: BeMusicEvent;
}

export function createChainSoundQueue(fire: (event: BeMusicEvent, seconds: number) => void): ChainSoundQueue {
  const queue: QueuedChainSound[] = [];
  const triggerUntil = (seconds: number): void => {
    let due = 0;
    while (due < queue.length && queue[due]!.seconds <= seconds + REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS) due += 1;
    if (due === 0) return;
    for (const sound of queue.splice(0, due)) fire(sound.event, sound.seconds);
  };
  return {
    schedule(seconds, sounds) {
      for (const sound of sounds) {
        const entry = { seconds: seconds + sound.delaySeconds, event: sound.event };
        // Stable by time: a sound goes after every sound queued for the same moment.
        let index = queue.length;
        while (index > 0 && queue[index - 1]!.seconds > entry.seconds) index -= 1;
        queue.splice(index, 0, entry);
      }
      triggerUntil(seconds);
    },
    triggerUntil,
    clear() {
      queue.length = 0;
    },
    get done() {
      return queue.length === 0;
    },
  };
}

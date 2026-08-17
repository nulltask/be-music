import type { PlaylogNote } from '@be-music/player/playlog';

/**
 * Re-applies a recorded play-log's note arrangement onto a freshly prepared chart for replay playback.
 *
 * A playlog stores the RESOLVED chart the player saw — post lane-shuffle (RANDOM / MIRROR / S-RANDOM) and post
 * DP-flip. A fresh chart prepare (with those options off) yields the same notes at the same times but with the
 * ORIGINAL channels, so replaying against it would judge the inputs on the wrong lanes. Lane transforms never move
 * a note in time, only across channels, so the recorded arrangement can be re-applied by matching notes on
 * `(kind, timeUs, endTimeUs)` and assigning the recorded channels back — no shuffle seed needed.
 *
 * Mutates the `channel` field of the given note objects in place (they are the same instances the prepared-chart
 * bundle and the engine share). Returns an error string when the chart does not match the playlog — a different
 * `#RANDOM` control-flow roll, a different chart file, or an edited chart — in which case the notes are left
 * untouched (channels are only written after every bucket matched).
 */
export function applyPlaylogArrangement(
  playlogNotes: readonly PlaylogNote[],
  target: {
    /** Playable notes (freezone included) — `PreparedPlaybackChartData.notes`. */
    notes: Array<{ channel: string; seconds: number; endSeconds?: number }>;
    landmineNotes: Array<{ channel: string; seconds: number }>;
    invisibleNotes: Array<{ channel: string; seconds: number }>;
    activeFreeZoneChannels: ReadonlySet<string>;
  },
): { ok: true } | { ok: false; reason: string } {
  const buckets = new Map<string, string[]>();
  for (const note of playlogNotes) {
    const key = `${note.type}:${note.timeUs}:${note.endTimeUs ?? ''}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(note.channel);
    } else {
      buckets.set(key, [note.channel]);
    }
  }

  interface Assignment {
    note: { channel: string };
    channel: string;
  }
  const assignments: Assignment[] = [];
  const takeChannel = (key: string): string | undefined => {
    const bucket = buckets.get(key);
    if (!bucket || bucket.length === 0) {
      return undefined;
    }
    return bucket.shift();
  };

  for (const note of target.notes) {
    const timeUs = secondsToMicroseconds(note.seconds);
    const hasTail =
      typeof note.endSeconds === 'number' && Number.isFinite(note.endSeconds) && note.endSeconds > note.seconds;
    const endTimeUs = hasTail ? secondsToMicroseconds(note.endSeconds!) : undefined;
    const kind = target.activeFreeZoneChannels.has(note.channel) ? 'freezone' : hasTail ? 'long' : 'normal';
    const channel = takeChannel(`${kind}:${timeUs}:${endTimeUs ?? ''}`);
    if (channel === undefined) {
      return { ok: false, reason: `no recorded ${kind} note at ${timeUs}µs` };
    }
    assignments.push({ note, channel });
  }
  for (const mine of target.landmineNotes) {
    const channel = takeChannel(`mine:${secondsToMicroseconds(mine.seconds)}:`);
    if (channel === undefined) {
      return { ok: false, reason: `no recorded mine at ${secondsToMicroseconds(mine.seconds)}µs` };
    }
    assignments.push({ note: mine, channel });
  }
  for (const invisible of target.invisibleNotes) {
    const channel = takeChannel(`invisible:${secondsToMicroseconds(invisible.seconds)}:`);
    if (channel === undefined) {
      return { ok: false, reason: `no recorded invisible note at ${secondsToMicroseconds(invisible.seconds)}µs` };
    }
    assignments.push({ note: invisible, channel });
  }
  for (const [key, bucket] of buckets) {
    if (bucket.length > 0) {
      return { ok: false, reason: `recorded chart has ${bucket.length} unmatched note(s) at ${key}` };
    }
  }

  for (const { note, channel } of assignments) {
    note.channel = channel;
  }
  return { ok: true };
}

function secondsToMicroseconds(seconds: number): number {
  return Math.round(seconds * 1_000_000);
}

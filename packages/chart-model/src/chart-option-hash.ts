/**
 * Stable hashes the chart-authored display formulas use in place of randomness (#843, #931): the same note gets the same
 * value on every frame, seek, replay and host. Runtime-neutral and deterministic.
 */

/** Stable 32-bit integer hash of a lane channel (FNV-1a). */
export function chartChannelHash(channel: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < channel.length; index += 1) {
    hash ^= channel.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic value in [0, 1) from integer seeds (murmur3-style finaliser). */
export function chartVisualHash01(...seeds: number[]): number {
  let hash = 0x9e3779b9;
  for (const seed of seeds) {
    hash ^= Math.imul(seed | 0, 0x85ebca6b);
    hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
    hash ^= hash >>> 16;
  }
  return (hash >>> 0) / 4294967296;
}

/** A note's identity seed: its lane and its beat at microbeat precision. */
export function chartNoteSeed(note: { readonly channel: string; readonly beat: number }): [number, number] {
  return [chartChannelHash(note.channel), Math.round(note.beat * 1_000_000) | 0];
}

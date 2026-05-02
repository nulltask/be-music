import { describe, expect, it } from 'vitest';
import { findCaseInsensitivePath, lookupBytesCaseInsensitive } from './file-lookup.ts';

const BYTES_A = new Uint8Array([1, 2, 3]);
const BYTES_B = new Uint8Array([4, 5, 6]);

describe('findCaseInsensitivePath', () => {
  it('returns the candidate verbatim when it matches an existing key exactly', () => {
    const files = new Map([['Song/kick.wav', BYTES_A]]);
    expect(findCaseInsensitivePath(files, 'Song/kick.wav')).toBe('Song/kick.wav');
  });

  it('falls back to a case-insensitive match when the casing differs', () => {
    const files = new Map([['Song/Kick.WAV', BYTES_A]]);
    expect(findCaseInsensitivePath(files, 'song/kick.wav')).toBe('Song/Kick.WAV');
    expect(findCaseInsensitivePath(files, 'SONG/KICK.WAV')).toBe('Song/Kick.WAV');
  });

  it('returns undefined when no key matches under either comparison', () => {
    const files = new Map([['Song/kick.wav', BYTES_A]]);
    expect(findCaseInsensitivePath(files, 'Song/snare.wav')).toBeUndefined();
  });

  it('keeps the first key encountered when multiple keys collide on lowercase', () => {
    // Insertion order: `kick.wav` first → it wins. The map iterator
    // preserves insertion order, so the first-pass scan in
    // `getCaseInsensitiveIndex` gets locked in.
    const files = new Map([
      ['kick.wav', BYTES_A],
      ['KICK.WAV', BYTES_B],
    ]);
    expect(findCaseInsensitivePath(files, 'Kick.Wav')).toBe('kick.wav');
  });
});

describe('lookupBytesCaseInsensitive', () => {
  it('returns the bytes for a case-mismatched key', () => {
    const files = new Map([['Song/Kick.WAV', BYTES_A]]);
    expect(lookupBytesCaseInsensitive(files, 'song/kick.wav')).toBe(BYTES_A);
  });

  it('returns undefined when the key is absent under any casing', () => {
    const files = new Map([['Song/kick.wav', BYTES_A]]);
    expect(lookupBytesCaseInsensitive(files, 'song/snare.wav')).toBeUndefined();
  });

  it('reuses the lazy index across calls (smoke test)', () => {
    // Not a strict invariant test — just confirms a second lookup on
    // the same map works the same way (which would surface obvious
    // cache-key bugs even though we can't probe the WeakMap directly).
    const files = new Map([
      ['A.png', BYTES_A],
      ['B.png', BYTES_B],
    ]);
    expect(lookupBytesCaseInsensitive(files, 'a.png')).toBe(BYTES_A);
    expect(lookupBytesCaseInsensitive(files, 'b.png')).toBe(BYTES_B);
    expect(lookupBytesCaseInsensitive(files, 'A.PNG')).toBe(BYTES_A);
  });
});

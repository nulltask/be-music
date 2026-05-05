import { describe, expect, it } from 'vitest';
import { findCaseInsensitivePath, isMaliciousAssetPath, lookupBytesCaseInsensitive } from './file-lookup.ts';

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

describe('isMaliciousAssetPath', () => {
  it('rejects POSIX absolute paths', () => {
    expect(isMaliciousAssetPath('/etc/passwd')).toBe(true);
    expect(isMaliciousAssetPath('/var/www/html/config.php')).toBe(true);
  });

  it('rejects backslash absolute paths', () => {
    expect(isMaliciousAssetPath('\\etc\\passwd')).toBe(true);
  });

  it('rejects Windows drive-letter absolute paths', () => {
    expect(isMaliciousAssetPath('C:\\password.txt')).toBe(true);
    expect(isMaliciousAssetPath('D:/secrets.bin')).toBe(true);
    expect(isMaliciousAssetPath('z:\\foo.wav')).toBe(true);
  });

  it('rejects UNC / network share paths', () => {
    expect(isMaliciousAssetPath('//server/share/file.wav')).toBe(true);
    expect(isMaliciousAssetPath('\\\\server\\share\\file.wav')).toBe(true);
  });

  it('rejects parent-directory references', () => {
    expect(isMaliciousAssetPath('../../../var/www/html/config.php')).toBe(true);
    expect(isMaliciousAssetPath('safe/../escape.wav')).toBe(true);
    // Backslash separator variant
    expect(isMaliciousAssetPath('safe\\..\\escape.wav')).toBe(true);
  });

  it('rejects null-byte injections', () => {
    expect(isMaliciousAssetPath('safe.wav\0/etc/passwd')).toBe(true);
    expect(isMaliciousAssetPath('\0bad')).toBe(true);
  });

  it('accepts ordinary chart-relative paths', () => {
    expect(isMaliciousAssetPath('kick.wav')).toBe(false);
    expect(isMaliciousAssetPath('subdir/kick.wav')).toBe(false);
    expect(isMaliciousAssetPath('subdir\\kick.wav')).toBe(false);
    // `..` as part of a filename (not a dedicated segment) is fine.
    expect(isMaliciousAssetPath('Lab..rinth.wav')).toBe(false);
    // A leading `.` is fine — `./local.wav` is a valid relative path.
    expect(isMaliciousAssetPath('./local.wav')).toBe(false);
  });
});

describe('findCaseInsensitivePath malicious-path guard', () => {
  it('returns undefined for malicious candidates even when the map has matching bytes', () => {
    // Crafted a defensive map entry to prove the guard rejects
    // even when a pathological matcher would succeed.
    const files = new Map([['/etc/passwd', BYTES_A]]);
    expect(findCaseInsensitivePath(files, '/etc/passwd')).toBeUndefined();
    expect(lookupBytesCaseInsensitive(files, '/etc/passwd')).toBeUndefined();
  });
});

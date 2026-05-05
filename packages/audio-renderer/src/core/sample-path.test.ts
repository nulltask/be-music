import { describe, expect, test } from 'vitest';
import { createSamplePathCandidates } from './sample-path.ts';

describe('createSamplePathCandidates', () => {
  test('verbatim path is always first so an exact match short-circuits the codec walk', () => {
    const candidates = createSamplePathCandidates('Song/kick.wav');
    expect(candidates[0]).toBe('Song/kick.wav');
  });

  test('extensionless input walks every codec the bmson 1.0.0 spec lists', () => {
    // bmson 1.0.0 spec: "Try piano.wav, piano.ogg, piano.m4a, …".
    // We additionally include `.mp3` / `.opus` / `.oga` for
    // archive coverage. `.m4a` must appear since it's named
    // explicitly in the spec example.
    const candidates = createSamplePathCandidates('piano');
    const lower = candidates.map((entry) => entry.toLowerCase());
    expect(lower).toContain('piano.wav');
    expect(lower).toContain('piano.ogg');
    expect(lower).toContain('piano.mp3');
    expect(lower).toContain('piano.opus');
    expect(lower).toContain('piano.m4a');
  });

  test('explicit `.wav` falls through to the codec walk including `.m4a`', () => {
    const candidates = createSamplePathCandidates('snare.wav');
    expect(candidates).toContain('snare.wav');
    expect(candidates).toContain('snare.m4a');
    expect(candidates).toContain('snare.M4A');
  });

  test('explicit `.m4a` walks the rest of the codec list when the AAC file is absent', () => {
    const candidates = createSamplePathCandidates('voice.m4a');
    expect(candidates[0]).toBe('voice.m4a');
    // `.m4a` itself first, then alternative codecs follow.
    expect(candidates).toContain('voice.ogg');
    expect(candidates).toContain('voice.opus');
    expect(candidates).toContain('voice.mp3');
  });

  test('Windows-style backslash paths are normalised into forward-slash candidates too', () => {
    // Same path with backslashes converted to slashes is
    // appended so the resolver finds files on either form of
    // case-/separator-sensitive filesystem.
    const candidates = createSamplePathCandidates('subdir\\kick.wav');
    expect(candidates).toContain('subdir\\kick.wav');
    expect(candidates).toContain('subdir/kick.wav');
  });

  test('duplicate candidates are de-duplicated', () => {
    const candidates = createSamplePathCandidates('kick.WAV');
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  test('#PATH_WAV prefix joins the chart-declared path before the bare name', () => {
    // BMS spec — `#PATH_WAV wav/` + `#WAV01 kick.wav` should
    // resolve to `wav/kick.wav` first, falling back to
    // `kick.wav` when the prefix-joined path isn't on disk.
    const candidates = createSamplePathCandidates('kick.wav', { pathPrefix: 'wav/' });
    expect(candidates).toContain('wav/kick.wav');
    expect(candidates).toContain('kick.wav');
    // The prefixed form should appear before the bare path.
    expect(candidates.indexOf('wav/kick.wav')).toBeLessThan(candidates.indexOf('kick.wav'));
  });

  test('#PATH_WAV prefix without a trailing slash is normalised', () => {
    const candidates = createSamplePathCandidates('kick.wav', { pathPrefix: 'wav' });
    expect(candidates).toContain('wav/kick.wav');
  });

  test('#PATH_WAV prefix is skipped when the chart already includes it in the sample path', () => {
    // No double-prefixing: `wav/kick.wav` with `#PATH_WAV wav/`
    // should not produce `wav/wav/kick.wav` candidates.
    const candidates = createSamplePathCandidates('wav/kick.wav', { pathPrefix: 'wav/' });
    expect(candidates).toContain('wav/kick.wav');
    expect(candidates).not.toContain('wav/wav/kick.wav');
  });

  test('blank #PATH_WAV prefix is treated as no prefix', () => {
    const withBlank = createSamplePathCandidates('kick.wav', { pathPrefix: '' });
    const withSpaces = createSamplePathCandidates('kick.wav', { pathPrefix: '   ' });
    const withoutPrefix = createSamplePathCandidates('kick.wav');
    expect(withBlank).toEqual(withoutPrefix);
    expect(withSpaces).toEqual(withoutPrefix);
  });
});

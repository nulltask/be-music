import { describe, expect, it } from 'vitest';
import {
  buildDefaultSkinConfigFiles,
  expandBeatorajaWildcard,
  resolveBeatorajaPath,
  resolveSourcePath,
} from './beatoraja-skin-resolver.ts';
import type { BeatorajaSkinFileEntry } from './file-lookup.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

function makeFiles(entries: ReadonlyArray<readonly [string, string]>): Map<string, BeatorajaSkinFileEntry> {
  return new Map(entries.map(([k, v]) => [k, enc(v)]));
}

describe('resolveBeatorajaPath', () => {
  it('resolves paths relative to the entry file directory', () => {
    const files = makeFiles([
      ['skin/default/play24.json', '{}'],
      ['skin/default/system.png', 'data'],
    ]);
    expect(resolveBeatorajaPath(files, 'skin/default/play24.json', 'system.png')).toBe('skin/default/system.png');
  });

  it('walks up via `..` segments', () => {
    const files = makeFiles([
      ['skin/default/result/result.luaskin', '{}'],
      ['skin/default/system.png', 'data'],
    ]);
    expect(resolveBeatorajaPath(files, 'skin/default/result/result.luaskin', '../system.png')).toBe(
      'skin/default/system.png',
    );
  });

  it('is case-insensitive', () => {
    const files = makeFiles([
      ['skin/default/play24.json', '{}'],
      ['skin/default/System.PNG', 'data'],
    ]);
    expect(resolveBeatorajaPath(files, 'skin/default/play24.json', 'system.png')).toBe('skin/default/System.PNG');
  });

  it('returns undefined when nothing matches', () => {
    const files = makeFiles([['skin/default/play24.json', '{}']]);
    expect(resolveBeatorajaPath(files, 'skin/default/play24.json', 'nope.png')).toBeUndefined();
  });
});

describe('expandBeatorajaWildcard', () => {
  it('returns sorted matches for `*.png` in a sibling directory', () => {
    const files = makeFiles([
      ['skin/default/play.json', '{}'],
      ['skin/default/play/background/b.png', '1'],
      ['skin/default/play/background/a.png', '2'],
      ['skin/default/play/laser/x.png', '3'],
    ]);
    expect(expandBeatorajaWildcard(files, 'skin/default/play.json', 'play/background/*.png')).toEqual([
      'skin/default/play/background/a.png',
      'skin/default/play/background/b.png',
    ]);
  });

  it('handles non-wildcard paths via the single-match path', () => {
    const files = makeFiles([
      ['skin/default/play.json', '{}'],
      ['skin/default/system.png', 'x'],
    ]);
    expect(expandBeatorajaWildcard(files, 'skin/default/play.json', 'system.png')).toEqual(['skin/default/system.png']);
  });

  it('returns an empty array when no files match', () => {
    const files = makeFiles([['skin/default/play.json', '{}']]);
    expect(expandBeatorajaWildcard(files, 'skin/default/play.json', 'play/background/*.png')).toEqual([]);
  });
});

describe('resolveSourcePath', () => {
  it('honors a user filepath override over the wildcard', () => {
    const files = makeFiles([
      ['skin/default/play.json', '{}'],
      ['skin/default/play/background/a.png', '1'],
      ['skin/default/play/background/b.png', '2'],
      ['skin/default/play/lanecover/c.png', '3'],
    ]);
    const result = resolveSourcePath(
      files,
      'skin/default/play.json',
      'play/background/*.png',
      { Background: 'play/background/b.png' },
      [{ name: 'Background', path: 'play/background/*.png' }],
    );
    expect(result).toBe('skin/default/play/background/b.png');
  });

  it('falls back to the first wildcard match when no override is supplied', () => {
    const files = makeFiles([
      ['skin/default/play.json', '{}'],
      ['skin/default/play/background/a.png', '1'],
      ['skin/default/play/background/b.png', '2'],
    ]);
    const result = resolveSourcePath(files, 'skin/default/play.json', 'play/background/*.png');
    expect(result).toBe('skin/default/play/background/a.png');
  });

  it('ignores a non-array filepathSchema instead of crashing on `not iterable`', () => {
    // Some Lua skins (and JSON skins with hand-edited filepath tables) end up handing us an
    // object like `{}` instead of `[]`. Resolve gracefully by skipping the override path —
    // matches the "no override supplied" behavior.
    const files = makeFiles([
      ['skin/default/play.json', '{}'],
      ['skin/default/play/background/a.png', '1'],
    ]);
    const malformedSchema = {} as unknown as ReadonlyArray<{ name: string; path: string }>;
    const result = resolveSourcePath(
      files,
      'skin/default/play.json',
      'play/background/*.png',
      { Background: 'play/background/a.png' },
      malformedSchema,
    );
    expect(result).toBe('skin/default/play/background/a.png');
  });
});

describe('buildDefaultSkinConfigFiles', () => {
  it('resolves the entry whose stem matches `def` (lexicographic ordering bypassed)', () => {
    // ModernChic's `key` filepath ships `#default.png` AND `harf.png`; `def = "harf"` says the
    // author wants `harf.png` even though `#default.png` sorts first lexicographically (`#` =
    // 0x23 < `h` = 0x68). Without honoring `def`, the wildcard fallback picks `#default.png`
    // — the wrong file. Honoring it returns the canonical path of `harf.png`.
    const files = makeFiles([
      ['skin/play.json', '{}'],
      ['skin/parts/key/#default.png', '1'],
      ['skin/parts/key/harf.png', '2'],
    ]);
    const result = buildDefaultSkinConfigFiles(
      { filepath: [{ name: 'キーイメージ', path: 'parts/key/*.png', def: 'harf' }] },
      files,
      'skin/play.json',
    );
    expect(result).toEqual({ キーイメージ: 'skin/parts/key/harf.png' });
  });

  it('strips ONLY the last extension so trailing dots in stems still match', () => {
    // ModernChic's `bomb` folder ships `diamond SCUROed..png` (note the trailing dot in the
    // stem). `def = "diamond SCUROed."` includes that trailing dot — naive stem extraction
    // that strips at the FIRST dot would produce `diamond SCUROed` and miss the match.
    const files = makeFiles([
      ['skin/play.json', '{}'],
      ['skin/parts/bomb/Kakabomb.png', '1'],
      ['skin/parts/bomb/diamond SCUROed..png', '2'],
    ]);
    const result = buildDefaultSkinConfigFiles(
      { filepath: [{ name: 'ボム', path: 'parts/bomb/*.png', def: 'diamond SCUROed.' }] },
      files,
      'skin/play.json',
    );
    expect(result).toEqual({ ボム: 'skin/parts/bomb/diamond SCUROed..png' });
  });

  it('falls back to case-insensitive matching when exact case fails', () => {
    // Windows-authored themes occasionally drift case between `def` and the actual filename.
    // `def = "DEFAULT"` should still resolve `Default.png` (or any case variant).
    const files = makeFiles([
      ['skin/play.json', '{}'],
      ['skin/parts/x/Default.png', '1'],
      ['skin/parts/x/other.png', '2'],
    ]);
    const result = buildDefaultSkinConfigFiles(
      { filepath: [{ name: 'X', path: 'parts/x/*.png', def: 'DEFAULT' }] },
      files,
      'skin/play.json',
    );
    expect(result).toEqual({ X: 'skin/parts/x/Default.png' });
  });

  it('omits entries with no `def`, no candidates, or no stem match', () => {
    // Only entries with a successfully-resolved default appear in the output. The other
    // entries fall through to the wildcard fallback inside `resolveSourcePath` at render
    // time, matching beatoraja's "first sorted match" behavior for unset filepaths.
    const files = makeFiles([
      ['skin/play.json', '{}'],
      ['skin/parts/y/a.png', '1'],
      ['skin/parts/y/b.png', '2'],
    ]);
    const result = buildDefaultSkinConfigFiles(
      {
        filepath: [
          { name: 'NoDef', path: 'parts/y/*.png' }, // missing def
          { name: 'EmptyDef', path: 'parts/y/*.png', def: '' },
          { name: 'NoCandidates', path: 'parts/missing/*.png', def: 'a' },
          { name: 'NoMatch', path: 'parts/y/*.png', def: 'nonexistent' },
          { name: 'Matched', path: 'parts/y/*.png', def: 'b' },
        ],
      },
      files,
      'skin/play.json',
    );
    expect(result).toEqual({ Matched: 'skin/parts/y/b.png' });
  });

  it('returns an empty record when the header has no filepath array', () => {
    expect(buildDefaultSkinConfigFiles({}, makeFiles([]), 'skin/play.json')).toEqual({});
    // Also tolerates a non-array filepath value (defensive against malformed Lua tables).
    expect(
      buildDefaultSkinConfigFiles(
        { filepath: undefined },
        makeFiles([]),
        'skin/play.json',
      ),
    ).toEqual({});
  });
});

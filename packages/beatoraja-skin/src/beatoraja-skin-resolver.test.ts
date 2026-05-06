import { describe, expect, it } from 'vitest';
import { expandBeatorajaWildcard, resolveBeatorajaPath, resolveSourcePath } from './beatoraja-skin-resolver.ts';
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
});

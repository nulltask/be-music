import { describe, expect, it } from 'vitest';
import { bundleBeatorajaSources, listBeatorajaSourcePaths } from './beatoraja-skin-source.ts';
import type { BeatorajaSkinFileEntry } from './file-lookup.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

function makeFiles(entries: ReadonlyArray<readonly [string, string]>): Map<string, BeatorajaSkinFileEntry> {
  return new Map(entries.map(([k, v]) => [k, enc(v)]));
}

describe('bundleBeatorajaSources', () => {
  it('resolves explicit paths and builds a sorted asset map', () => {
    const files = makeFiles([
      ['skin/default/play24.json', '{}'],
      ['skin/default/system.png', 'sys-bytes'],
      ['skin/default/playbg.png', 'bg-bytes'],
    ]);
    const bundle = bundleBeatorajaSources({
      files,
      entryPath: 'skin/default/play24.json',
      sources: [
        { id: 0, path: 'system.png' },
        { id: 2, path: 'playbg.png' },
      ],
    });
    expect(bundle.unresolved).toEqual([]);
    expect(bundle.assets.map((a) => a.id)).toEqual([0, 2]);
    expect(bundle.byId.get(0)?.path).toBe('skin/default/system.png');
    expect(bundle.byId.get(2)?.path).toBe('skin/default/playbg.png');
    expect(new TextDecoder().decode(bundle.byId.get(0)!.bytes)).toBe('sys-bytes');
  });

  it('expands wildcard paths to the first sorted match', () => {
    const files = makeFiles([
      ['skin/default/play24.json', '{}'],
      ['skin/default/play/background/b.png', 'second'],
      ['skin/default/play/background/a.png', 'first'],
    ]);
    const bundle = bundleBeatorajaSources({
      files,
      entryPath: 'skin/default/play24.json',
      sources: [{ id: 1, path: 'play/background/*.png' }],
    });
    expect(bundle.byId.get(1)?.path).toBe('skin/default/play/background/a.png');
  });

  it('honors filepath[] user overrides when supplied', () => {
    const files = makeFiles([
      ['skin/default/play24.json', '{}'],
      ['skin/default/play/background/a.png', 'a'],
      ['skin/default/play/background/b.png', 'b'],
    ]);
    const bundle = bundleBeatorajaSources({
      files,
      entryPath: 'skin/default/play24.json',
      sources: [{ id: 1, path: 'play/background/*.png' }],
      filepathSchema: [{ name: 'Background', path: 'play/background/*.png' }],
      filepathOverrides: { Background: 'play/background/b.png' },
    });
    expect(bundle.byId.get(1)?.path).toBe('skin/default/play/background/b.png');
  });

  it('records unresolved entries with diagnostic reasons', () => {
    const files = makeFiles([['skin/default/play24.json', '{}']]);
    const bundle = bundleBeatorajaSources({
      files,
      entryPath: 'skin/default/play24.json',
      sources: [
        { id: 1, path: 'missing.png' },
        { id: 2, path: 'play/missing/*.png' },
      ],
    });
    expect(bundle.assets).toEqual([]);
    expect(bundle.unresolved).toHaveLength(2);
    expect(bundle.unresolved[0].reason).toMatch(/file not found/);
    expect(bundle.unresolved[1].reason).toMatch(/wildcard/);
  });

  it('drops malformed entries (missing id or path)', () => {
    const files = makeFiles([['skin/default/play24.json', '{}']]);
    const bundle = bundleBeatorajaSources({
      files,
      entryPath: 'skin/default/play24.json',
      sources: [{ id: 'not-a-number' }, { path: 42 }, {}] as ReadonlyArray<Readonly<Record<string, unknown>>>,
    });
    expect(bundle.assets).toEqual([]);
    expect(bundle.unresolved).toEqual([]);
  });

  it('reports deferred file handles as unresolved', () => {
    const deferredFile = {
      name: 'system.png',
      webkitRelativePath: 'skin/default/system.png',
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    };
    const files = new Map<string, BeatorajaSkinFileEntry>([
      ['skin/default/play24.json', enc('{}')],
      ['skin/default/system.png', deferredFile],
    ]);
    const bundle = bundleBeatorajaSources({
      files,
      entryPath: 'skin/default/play24.json',
      sources: [{ id: 0, path: 'system.png' }],
    });
    expect(bundle.unresolved[0].reason).toMatch(/deferred/);
  });
});

describe('listBeatorajaSourcePaths', () => {
  it('returns the resolved canonical path for each source entry', () => {
    const files = makeFiles([
      ['skin/default/play24.json', '{}'],
      ['skin/default/system.png', 'sys'],
    ]);
    const result = listBeatorajaSourcePaths(files, 'skin/default/play24.json', [
      { id: 0, path: 'system.png' },
      { id: 1, path: 'missing.png' },
    ]);
    expect(result).toEqual([
      { id: 0, path: 'system.png', resolved: 'skin/default/system.png' },
      { id: 1, path: 'missing.png', resolved: undefined },
    ]);
  });
});

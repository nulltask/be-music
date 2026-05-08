import { describe, expect, it } from 'vitest';
import {
  loadBeatorajaPlaySkinFromBundle,
  loadBeatorajaResultSkinFromBundle,
  loadBeatorajaSelectSkinFromBundle,
  loadBeatorajaThemeFromFiles,
  summarizeBeatorajaPlaySkins,
} from './beatoraja-theme.ts';

class FakeFile {
  constructor(
    public readonly webkitRelativePath: string,
    private readonly bytes: Uint8Array,
  ) {}
  get name(): string {
    return this.webkitRelativePath.split('/').at(-1) ?? this.webkitRelativePath;
  }
  arrayBuffer(): Promise<ArrayBuffer> {
    const ab = new ArrayBuffer(this.bytes.byteLength);
    new Uint8Array(ab).set(this.bytes);
    return Promise.resolve(ab);
  }
}

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

function jsonSkin(type: number, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ type, name: `skin-${type}`, w: 1280, h: 720, ...extra });
}

describe('loadBeatorajaThemeFromFiles', () => {
  it('reads files and discovers per-scene entries', async () => {
    const files = [
      new FakeFile('skin/default/play24.json', enc(jsonSkin(16))),
      new FakeFile('skin/default/select.json', enc(jsonSkin(5))),
      new FakeFile('skin/default/courseresult.json', enc(jsonSkin(15))),
      new FakeFile('skin/default/system.png', enc('not-a-skin')),
    ];
    const bundle = await loadBeatorajaThemeFromFiles(files);
    expect(bundle.theme.playSkins['24']?.entryPath).toBe('skin/default/play24.json');
    expect(bundle.theme.selectSkin?.entryPath).toBe('skin/default/select.json');
    expect(bundle.theme.courseResultSkin?.entryPath).toBe('skin/default/courseresult.json');
    expect(bundle.warnings).toEqual([]);
  });

  it('records warnings for malformed JSON skins without aborting discovery', async () => {
    const files = [
      new FakeFile('skin/default/play.json', enc('not json')),
      new FakeFile('skin/default/select.json', enc(jsonSkin(5))),
    ];
    const bundle = await loadBeatorajaThemeFromFiles(files);
    expect(bundle.theme.selectSkin?.entryPath).toBe('skin/default/select.json');
    expect(bundle.warnings.length).toBeGreaterThan(0);
  });
});

describe('loadBeatorajaPlaySkinFromBundle', () => {
  it('loads the requested play variant', async () => {
    const files = [new FakeFile('skin/default/play24.json', enc(jsonSkin(16)))];
    const bundle = await loadBeatorajaThemeFromFiles(files);
    const loaded = loadBeatorajaPlaySkinFromBundle(bundle, '24', { offset: 0 });
    expect(loaded?.entry.entryPath).toBe('skin/default/play24.json');
    expect(loaded?.result.ok).toBe(true);
  });

  it('falls back to a different variant when the desired one is missing', async () => {
    const files = [new FakeFile('skin/default/play7.json', enc(jsonSkin(0)))];
    const bundle = await loadBeatorajaThemeFromFiles(files);
    const loaded = loadBeatorajaPlaySkinFromBundle(bundle, '14');
    expect(loaded?.entry.entryPath).toBe('skin/default/play7.json');
  });

  it('returns undefined when no play skins are present', async () => {
    const files = [new FakeFile('skin/default/select.json', enc(jsonSkin(5)))];
    const bundle = await loadBeatorajaThemeFromFiles(files);
    expect(loadBeatorajaPlaySkinFromBundle(bundle, '7')).toBeUndefined();
  });
});

describe('loadBeatorajaSelectSkinFromBundle / loadBeatorajaResultSkinFromBundle', () => {
  it('loads the corresponding scene skins when present', async () => {
    const files = [
      new FakeFile('skin/default/select.json', enc(jsonSkin(5))),
      new FakeFile('skin/default/result.json', enc(jsonSkin(7))),
    ];
    const bundle = await loadBeatorajaThemeFromFiles(files);
    expect(loadBeatorajaSelectSkinFromBundle(bundle)?.entry.entryPath).toBe('skin/default/select.json');
    expect(loadBeatorajaResultSkinFromBundle(bundle)?.entry.entryPath).toBe('skin/default/result.json');
  });

  it('returns undefined when the scene skin is missing', async () => {
    const bundle = await loadBeatorajaThemeFromFiles([new FakeFile('skin/default/play24.json', enc(jsonSkin(16)))]);
    expect(loadBeatorajaSelectSkinFromBundle(bundle)).toBeUndefined();
    expect(loadBeatorajaResultSkinFromBundle(bundle)).toBeUndefined();
  });
});

describe('summarizeBeatorajaPlaySkins', () => {
  it('lists present variants in canonical order', async () => {
    const files = [
      new FakeFile('skin/default/play7.json', enc(jsonSkin(0))),
      new FakeFile('skin/default/play14.json', enc(jsonSkin(2))),
    ];
    const bundle = await loadBeatorajaThemeFromFiles(files);
    expect(summarizeBeatorajaPlaySkins(bundle.theme.playSkins)).toBe('7,14');
  });
});

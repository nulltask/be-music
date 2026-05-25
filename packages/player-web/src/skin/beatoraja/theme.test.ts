import { describe, expect, it } from 'vitest';
import { loadBeatorajaThemeFromFiles, summarizeBeatorajaPlaySkins } from './theme.ts';

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

  it('keeps unrelated beatoraja distribution binaries deferred', async () => {
    const files = [
      new FakeFile('skin/default/play7.json', enc(jsonSkin(0))),
      new FakeFile('skin/default/system.png', enc('image bytes')),
      new FakeFile('beatoraja/jre/lib/modules', new Uint8Array(1024)),
      new FakeFile('beatoraja/beatoraja.jar', new Uint8Array(2048)),
    ];
    const bundle = await loadBeatorajaThemeFromFiles(files);

    expect(bundle.theme.playSkins['7']?.entryPath).toBe('skin/default/play7.json');
    expect(bundle.files.get('skin/default/system.png')).toBeInstanceOf(Uint8Array);
    expect(bundle.files.get('beatoraja/jre/lib/modules')).toBe(files[2]);
    expect(bundle.files.get('beatoraja/beatoraja.jar')).toBe(files[3]);
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

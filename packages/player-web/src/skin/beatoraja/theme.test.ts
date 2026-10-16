import { describe, expect, it } from 'vite-plus/test';
import {
  chartPlayVariantForBeatorajaVariant,
  loadBeatorajaThemeFromFiles,
  pickBeatorajaPlayableSkinVariant,
  pickBeatorajaPlayableVariant,
  pickBeatorajaThemeBgmPaths,
  summarizeBeatorajaPlaySkins,
} from './theme.ts';

class FakeFile {
  public readonly webkitRelativePath: string;
  private readonly bytes: Uint8Array;
  constructor(webkitRelativePath: string, bytes: Uint8Array) {
    this.webkitRelativePath = webkitRelativePath;
    this.bytes = bytes;
  }
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

describe('24-key keyboard play variants', () => {
  it('maps the keyboard chart shapes onto beatorajas play24 / play24d skins', () => {
    expect(pickBeatorajaPlayableVariant({ keys: 24, isDouble: false, isPms: false })).toBe('24');
    expect(pickBeatorajaPlayableVariant({ keys: 24, isDouble: true, isPms: false })).toBe('24d');
    // The IIDX shapes are untouched.
    expect(pickBeatorajaPlayableVariant({ keys: 7, isDouble: false, isPms: false })).toBe('7');
    expect(pickBeatorajaPlayableVariant({ keys: 14, isDouble: true, isPms: false })).toBe('14');
  });

  it('translates the skin variant spelling into the engines ChartPlayVariant', () => {
    expect(chartPlayVariantForBeatorajaVariant('24')).toBe('24');
    expect(chartPlayVariantForBeatorajaVariant('24d')).toBe('48');
    expect(chartPlayVariantForBeatorajaVariant('7')).toBe('7');
  });

  it('prefers the other keyboard skin before falling back to the IIDX chains', () => {
    expect(pickBeatorajaPlayableSkinVariant({ '24d': {} as never, '7': {} as never }, '24')).toBe('24d');
    expect(pickBeatorajaPlayableSkinVariant({ '7': {} as never }, '24')).toBe('7');
    expect(pickBeatorajaPlayableSkinVariant({}, '24')).toBeUndefined();
    // A theme that only ships play24 can still render an IIDX chart.
    expect(pickBeatorajaPlayableSkinVariant({ '24': {} as never }, '7')).toBe('24');
  });
});

describe('pickBeatorajaThemeBgmPaths', () => {
  it('lets exact stems win over loose matches listed earlier', () => {
    expect(
      pickBeatorajaThemeBgmPaths([
        'sound/course_clear.wav',
        'sound/course_fail.ogg',
        'sound/resultclose.wav',
        'sound/clear.wav',
        'sound/fail.wav',
        'sound/result.wav',
        'readme.txt',
      ]),
    ).toEqual({
      clear: 'sound/clear.wav',
      fail: 'sound/fail.wav',
      result: 'sound/result.wav',
      courseClear: 'sound/course_clear.wav',
      courseFail: 'sound/course_fail.ogg',
    });
  });

  it('falls back to a stem containing the name, but never a course stem for the plain slots', () => {
    expect(pickBeatorajaThemeBgmPaths(['bgm/course_clear.wav', 'bgm/clear_loop.wav', 'bgm/decide_v2.mp3'])).toEqual({
      decide: 'bgm/decide_v2.mp3',
      clear: 'bgm/clear_loop.wav',
      courseClear: 'bgm/course_clear.wav',
    });
    expect(pickBeatorajaThemeBgmPaths(['bgm/course_clear.wav'])).toEqual({ courseClear: 'bgm/course_clear.wav' });
  });

  it('takes a stem from the sound set folder over the same stem elsewhere', () => {
    // ModernChic: a voice clip named clear.ogg sorts before the sound set's own clear.ogg.
    expect(
      pickBeatorajaThemeBgmPaths([
        'ModernChic/Root/sounds/vo/tsumugi/clear/clear.ogg',
        'ModernChic/Root/sounds/vo/tsumugi/clear/failed.ogg',
        'ModernChic/Sound/clear.ogg',
        'ModernChic/Sound/fail.ogg',
      ]),
    ).toEqual({ clear: 'ModernChic/Sound/clear.ogg', fail: 'ModernChic/Sound/fail.ogg' });
    // With no folder holding more of the slots, the shallowest file wins.
    expect(pickBeatorajaThemeBgmPaths(['a/b/c/clear.wav', 'a/clear.wav'])).toEqual({ clear: 'a/clear.wav' });
  });

  it('does not reuse one file for two slots', () => {
    expect(pickBeatorajaThemeBgmPaths(['sound/resultclose.wav'])).toEqual({ result: 'sound/resultclose.wav' });
  });
});

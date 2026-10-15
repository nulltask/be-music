import { describe, expect, test } from 'vite-plus/test';
import { parseLr2SoundSet, readLr2SoundSet, resolveLr2SoundSetPath } from './sound-set.ts';

// The stock `LR2files/Sound/lr2.lr2ss`, trimmed. Shift_JIS decodes its `¥` separators as `\`.
const STOCK = [
  '//,type=10,title,maker,thambnail',
  '#INFORMATION,10,LR2 standard,sta/yamajet/syatten,LR2files\\Sound\\lr2.png',
  '#CUSTOMFILE,SELECT BGM,LR2files\\Bgm\\*,LR2 ver sta,',
  '#SELECT,LR2files\\Bgm\\*\\select.wav,',
  '#DECIDE,LR2files\\Bgm\\*\\decide.wav,',
  '#CLEAR,LR2files\\Sound\\lr2\\clear.wav,',
  '#FAIL,LR2files\\Sound\\lr2\\fail.wav,',
  '#SCRATCH,LR2files\\Sound\\lr2\\scratch.wav,',
  '#COURSECLEAR,LR2files\\Sound\\lr2\\course_clear.wav,',
  '#COURSEFAIL,LR2files\\Sound\\lr2\\course_fail.wav,',
  'SELECT,LR2files\\Bgm\\LR2 ver sta\\select.wav',
].join('\r\n');

describe('parseLr2SoundSet', () => {
  test('reads each command path with forward slashes and the custom-file defaults', () => {
    const soundSet = parseLr2SoundSet(STOCK);
    expect(soundSet.paths.get('COURSECLEAR')).toEqual(['LR2files/Sound/lr2/course_clear.wav']);
    expect(soundSet.paths.get('SELECT')).toEqual(['LR2files/Bgm/*/select.wav']);
    expect(soundSet.paths.has('INFORMATION')).toBe(false);
    expect(soundSet.customFiles).toEqual([{ pattern: 'LR2files/Bgm/*', defaultValue: 'LR2 ver sta' }]);
  });

  test('keeps later definitions of a command as fallbacks, in file order', () => {
    const soundSet = parseLr2SoundSet('#CLEAR,a\\clear.wav\n#clear,b\\clear.wav');
    expect(soundSet.paths.get('CLEAR')).toEqual(['a/clear.wav', 'b/clear.wav']);
  });
});

describe('resolveLr2SoundSetPath', () => {
  const soundSet = parseLr2SoundSet(STOCK);

  test('resolves the stock course jingles whose names differ from the command', () => {
    const paths = [
      'LR2files/Sound/lr2/clear.wav',
      'LR2files/Sound/lr2/course_clear.wav',
      'LR2files/Sound/lr2/course_fail.wav',
    ];
    expect(resolveLr2SoundSetPath(paths, soundSet, 'COURSECLEAR')).toBe('LR2files/Sound/lr2/course_clear.wav');
    expect(resolveLr2SoundSetPath(paths, soundSet, 'COURSEFAIL')).toBe('LR2files/Sound/lr2/course_fail.wav');
    expect(resolveLr2SoundSetPath(paths, soundSet, 'CLEAR')).toBe('LR2files/Sound/lr2/clear.wav');
  });

  test('matches a drop rooted at Sound/ or above LR2files/, case-insensitively', () => {
    expect(resolveLr2SoundSetPath(['Sound/lr2/COURSE_CLEAR.WAV'], soundSet, 'COURSECLEAR')).toBe(
      'Sound/lr2/COURSE_CLEAR.WAV',
    );
    expect(resolveLr2SoundSetPath(['LR2beta3/LR2files/Sound/lr2/fail.wav'], soundSet, 'FAIL')).toBe(
      'LR2beta3/LR2files/Sound/lr2/fail.wav',
    );
    expect(resolveLr2SoundSetPath(['Songs/x/lr2/fail.wav'], soundSet, 'FAIL')).toBeUndefined();
  });

  test('prefers the named extension and takes another audio extension when it is missing', () => {
    expect(resolveLr2SoundSetPath(['Sound/lr2/clear.ogg', 'Sound/lr2/clear.wav'], soundSet, 'CLEAR')).toBe(
      'Sound/lr2/clear.wav',
    );
    expect(resolveLr2SoundSetPath(['Sound/lr2/clear.ogg'], soundSet, 'CLEAR')).toBe('Sound/lr2/clear.ogg');
    expect(resolveLr2SoundSetPath(['Sound/lr2/clear.png'], soundSet, 'CLEAR')).toBeUndefined();
  });

  test('fills a * folder with the custom-file default first, then any folder', () => {
    const paths = ['LR2files/Bgm/other/select.wav', 'LR2files/Bgm/LR2 ver sta/select.wav'];
    expect(resolveLr2SoundSetPath(paths, soundSet, 'SELECT')).toBe('LR2files/Bgm/LR2 ver sta/select.wav');
    expect(resolveLr2SoundSetPath(['LR2files/Bgm/other/decide.wav'], soundSet, 'DECIDE')).toBe(
      'LR2files/Bgm/other/decide.wav',
    );
  });

  test('returns undefined for a command the set does not define', () => {
    expect(resolveLr2SoundSetPath(['Sound/lr2/f-open.wav'], soundSet, 'FOLDER_OPEN')).toBeUndefined();
  });
});

describe('readLr2SoundSet', () => {
  const bytes = (text: string) => new TextEncoder().encode(text);

  test('prefers the stock lr2.lr2ss over other sets', () => {
    const files = new Map<string, Uint8Array>([
      ['Sound/custom.lr2ss', bytes('#CLEAR,LR2files\\Sound\\custom\\win.wav')],
      ['Sound/lr2.lr2ss', bytes('#CLEAR,LR2files\\Sound\\lr2\\clear.wav')],
    ]);
    expect(readLr2SoundSet(files, (path) => files.get(path))?.paths.get('CLEAR')).toEqual([
      'LR2files/Sound/lr2/clear.wav',
    ]);
  });

  test('falls back to the first set, and to undefined without one', () => {
    const files = new Map<string, Uint8Array>([['Sound/custom.lr2ss', bytes('#CLEAR,x\\win.wav')]]);
    expect(readLr2SoundSet(files, (path) => files.get(path))?.paths.get('CLEAR')).toEqual(['x/win.wav']);
    expect(readLr2SoundSet(new Map(), () => undefined)).toBeUndefined();
  });
});

import { describe, expect, it } from 'vite-plus/test';
import {
  discoverBeatorajaSelectBGMPath,
  discoverBeatorajaSystemSoundPaths,
  pickBeatorajaThemeBGMPaths,
} from './system-sounds.ts';

function fakeFiles(paths: ReadonlyArray<string>): Map<string, Uint8Array> {
  return new Map(paths.map((p) => [p, new Uint8Array(0)]));
}

describe('discoverBeatorajaSystemSoundPaths', () => {
  it('picks the first canonical filename it finds for each slot', () => {
    const files = fakeFiles([
      'sound/cursor.wav',
      'sound/decide.wav',
      'sound/cancel.wav',
      'sound/folder_open.wav',
      'sound/folder_close.wav',
      'sound/option.wav',
    ]);
    expect(discoverBeatorajaSystemSoundPaths(files)).toEqual({
      cursor: 'sound/cursor.wav',
      decide: 'sound/decide.wav',
      cancel: 'sound/cancel.wav',
      folderOpen: 'sound/folder_open.wav',
      folderClose: 'sound/folder_close.wav',
      optionChange: 'sound/option.wav',
    });
  });

  it('honors filename aliases when canonicals are absent', () => {
    // IIDX-style themes ship `scratch.wav` instead of `cursor.wav`; LR2-derived themes use
    // `f-open.wav` / `f-close.wav` / `o-change.wav`. The picker walks the alias list in
    // priority order until something matches.
    const files = fakeFiles([
      'sound/scratch.wav',
      'sound/select.ogg',
      'sound/back.wav',
      'sound/f-open.wav',
      'sound/f-close.wav',
      'sound/o-change.wav',
    ]);
    expect(discoverBeatorajaSystemSoundPaths(files)).toEqual({
      cursor: 'sound/scratch.wav',
      decide: 'sound/select.ogg',
      cancel: 'sound/back.wav',
      folderOpen: 'sound/f-open.wav',
      folderClose: 'sound/f-close.wav',
      optionChange: 'sound/o-change.wav',
    });
  });

  it('matches case-insensitively (themes mix Sound/ vs sound/ casings)', () => {
    const files = fakeFiles(['Sound/Cursor.WAV', 'SOUND/Decide.wav']);
    const out = discoverBeatorajaSystemSoundPaths(files);
    expect(out.cursor).toBe('Sound/Cursor.WAV');
    expect(out.decide).toBe('SOUND/Decide.wav');
  });

  it('returns an empty record when no slot has any candidate present', () => {
    const files = fakeFiles(['random/file.png', 'gauge/n.png']);
    expect(discoverBeatorajaSystemSoundPaths(files)).toEqual({});
  });

  it('discovers a looping select BGM at the canonical BGM/select.* path', () => {
    expect(discoverBeatorajaSelectBGMPath(fakeFiles(['BGM/select.wav']))).toBe('BGM/select.wav');
    expect(discoverBeatorajaSelectBGMPath(fakeFiles(['bgm/select.ogg']))).toBe('bgm/select.ogg');
    // Falls back to LR2-derived layout
    expect(discoverBeatorajaSelectBGMPath(fakeFiles(['LR2files/BGM/_common/select.wav']))).toBe(
      'LR2files/BGM/_common/select.wav',
    );
    // Returns undefined when no candidate matches
    expect(discoverBeatorajaSelectBGMPath(fakeFiles(['random/file.png']))).toBeUndefined();
  });

  it('falls back to LR2-compatible Sound/lr2 paths when the theme is LR2-derived', () => {
    const files = fakeFiles([
      'LR2files/Sound/lr2/scratch.wav',
      'LR2files/Sound/lr2/back.wav',
      'LR2files/Sound/lr2/f-open.wav',
      'LR2files/Sound/lr2/f-close.wav',
      'LR2files/Sound/lr2/o-change.wav',
    ]);
    const out = discoverBeatorajaSystemSoundPaths(files);
    expect(out.cursor).toBe('LR2files/Sound/lr2/scratch.wav');
    expect(out.cancel).toBe('LR2files/Sound/lr2/back.wav');
    expect(out.folderOpen).toBe('LR2files/Sound/lr2/f-open.wav');
    expect(out.folderClose).toBe('LR2files/Sound/lr2/f-close.wav');
    expect(out.optionChange).toBe('LR2files/Sound/lr2/o-change.wav');
    expect(out.decide).toBeUndefined(); // no LR2 fallback for decide
  });
});

describe('pickBeatorajaThemeBGMPaths', () => {
  it('lets exact stems win over loose matches listed earlier', () => {
    expect(
      pickBeatorajaThemeBGMPaths([
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
    expect(pickBeatorajaThemeBGMPaths(['bgm/course_clear.wav', 'bgm/clear_loop.wav', 'bgm/decide_v2.mp3'])).toEqual({
      decide: 'bgm/decide_v2.mp3',
      clear: 'bgm/clear_loop.wav',
      courseClear: 'bgm/course_clear.wav',
    });
    expect(pickBeatorajaThemeBGMPaths(['bgm/course_clear.wav'])).toEqual({ courseClear: 'bgm/course_clear.wav' });
  });

  it('takes a stem from the sound set folder over the same stem elsewhere', () => {
    // ModernChic: a voice clip named clear.ogg sorts before the sound set's own clear.ogg.
    expect(
      pickBeatorajaThemeBGMPaths([
        'ModernChic/Root/sounds/vo/tsumugi/clear/clear.ogg',
        'ModernChic/Root/sounds/vo/tsumugi/clear/failed.ogg',
        'ModernChic/Sound/clear.ogg',
        'ModernChic/Sound/fail.ogg',
      ]),
    ).toEqual({ clear: 'ModernChic/Sound/clear.ogg', fail: 'ModernChic/Sound/fail.ogg' });
    // With no folder holding more of the slots, the shallowest file wins.
    expect(pickBeatorajaThemeBGMPaths(['a/b/c/clear.wav', 'a/clear.wav'])).toEqual({ clear: 'a/clear.wav' });
  });

  it('does not reuse one file for two slots', () => {
    expect(pickBeatorajaThemeBGMPaths(['sound/resultclose.wav'])).toEqual({ result: 'sound/resultclose.wav' });
  });
});

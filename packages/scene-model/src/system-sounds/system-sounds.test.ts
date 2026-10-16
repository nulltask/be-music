import { describe, expect, test } from 'vite-plus/test';
import { makeChart, makeCourse } from '../test-support/library.ts';
import {
  browseSystemSound,
  hasResultJingle,
  LR2_SOUND_SET_SLOTS,
  resolveResultJingle,
  resolveResultJingles,
  startSystemSound,
  SYSTEM_SOUND_SLOTS,
  systemSoundSetFromBeatoraja,
  systemSoundSetFromLr2Theme,
  type SystemSoundSet,
} from './system-sounds.ts';

const bytes = (value: number): Uint8Array => new Uint8Array([value]);
const file = (path: string, value: number) => ({ path, bytes: bytes(value) });

describe('systemSoundSetFromLr2Theme', () => {
  test('fills a slot for each file the theme load read, by bytes', () => {
    const set = systemSoundSetFromLr2Theme({
      selectBgm: file('LR2files/Bgm/x/select.wav', 1),
      clearBgm: file('LR2files/Sound/lr2/clear.wav', 2),
      courseClearBgm: file('LR2files/Sound/lr2/course_clear.wav', 3),
      systemSounds: { cursorMove: file('LR2files/Sound/lr2/scratch.wav', 4), optionOpen: file('o-open.wav', 5) },
    });
    expect(Object.keys(set).sort()).toEqual(['clear', 'courseClear', 'cursor', 'optionOpen', 'selectBgm']);
    expect(set.cursor).toEqual({ bytes: bytes(4), path: 'LR2files/Sound/lr2/scratch.wav' });
  });

  test('maps each LR2 sound set command to a slot', () => {
    expect(LR2_SOUND_SET_SLOTS.SCRATCH).toBe('cursor');
    expect(LR2_SOUND_SET_SLOTS.PANEL_OPEN).toBe('optionOpen');
    expect(LR2_SOUND_SET_SLOTS.COURSEFAIL).toBe('courseFail');
    for (const slot of Object.values(LR2_SOUND_SET_SLOTS)) expect(SYSTEM_SOUND_SLOTS).toContain(slot);
  });
});

describe('systemSoundSetFromBeatoraja', () => {
  test('takes the cues and the select BGM by path, the jingles by bytes', () => {
    const set = systemSoundSetFromBeatoraja({
      paths: { cursor: 'sound/cursor.wav', cancel: 'sound/cancel.wav', decide: '' },
      selectBgmPath: 'Bgm/select.wav',
      bgm: { clear: bytes(1), courseFail: bytes(2) },
    });
    expect(set).toEqual({
      cursor: { path: 'sound/cursor.wav' },
      cancel: { path: 'sound/cancel.wav' },
      selectBgm: { path: 'Bgm/select.wav' },
      clear: { bytes: bytes(1) },
      courseFail: { bytes: bytes(2) },
    });
  });
});

describe('result jingles', () => {
  const lr2: SystemSoundSet = { clear: { bytes: bytes(1) }, fail: { bytes: bytes(2) }, result: { bytes: bytes(3) } };
  const beatoraja: SystemSoundSet = { clear: { bytes: bytes(11) }, courseClear: { bytes: bytes(12) } };

  test("plays the first set's jingles that has any, whole", () => {
    expect(resolveResultJingles([beatoraja, lr2], false)).toEqual({ clear: beatoraja.clear });
    expect(resolveResultJingles([lr2, beatoraja], false)).toEqual(lr2);
    expect(resolveResultJingles([{ cursor: { path: 'x' } }, lr2], false)).toEqual(lr2);
    expect(hasResultJingle({ cursor: { path: 'x' } })).toBe(false);
  });

  test("plays a course run's jingles, falling back to the clear and fail ones", () => {
    expect(resolveResultJingles([beatoraja], true)).toEqual({ clear: beatoraja.courseClear });
    expect(resolveResultJingles([lr2], true)).toEqual(lr2);
  });

  test('picks the clear or fail jingle by the verdict, else the generic one', () => {
    expect(resolveResultJingle({ clear: lr2.clear, result: lr2.result }, true)).toBe(lr2.clear);
    expect(resolveResultJingle({ clear: lr2.clear, result: lr2.result }, false)).toBe(lr2.result);
    expect(resolveResultJingle({}, false)).toBeUndefined();
  });
});

describe('select cues', () => {
  test('play the cursor, folder, cancel and option-change cues for what a browse command did', () => {
    const move = { type: 'move', delta: 1 } as const;
    expect(browseSystemSound(move, { kind: 'cursor', from: 0, to: 1, delta: 1 })).toBe('cursor');
    expect(browseSystemSound({ type: 'open' }, { kind: 'folder-opened', folder: { label: 'x', songs: [] } })).toBe(
      'folderOpen',
    );
    expect(browseSystemSound({ type: 'close' }, { kind: 'folder-closed', folder: { label: 'x', songs: [] } })).toBe(
      'folderClose',
    );
    expect(browseSystemSound({ type: 'close' }, { kind: 'at-root' })).toBe('cancel');
    expect(browseSystemSound({ type: 'list', options: { sort: 'TITLE' } }, { kind: 'list-changed' })).toBe(
      'optionChange',
    );
    expect(browseSystemSound({ type: 'search', text: 'a' }, { kind: 'list-changed' })).toBeUndefined();
    expect(browseSystemSound(move, { kind: 'none' })).toBeUndefined();
  });

  test('play the decide cue for a chart or a playable course and the cancel cue for a course with a stage missing', () => {
    expect(startSystemSound({ kind: 'song', song: makeChart('a', 'P') })).toBe('decide');
    expect(startSystemSound({ kind: 'course', course: makeCourse('ok') })).toBe('decide');
    expect(startSystemSound({ kind: 'course', course: makeCourse('missing', { playable: false }) })).toBe('cancel');
    expect(startSystemSound({ kind: 'folder', folder: { label: 'x', songs: [] } })).toBeUndefined();
  });
});

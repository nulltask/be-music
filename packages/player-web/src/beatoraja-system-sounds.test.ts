import { describe, expect, it } from 'vitest';
import {
  discoverBeatorajaSelectBgmPath,
  discoverBeatorajaSystemSoundPaths,
} from './beatoraja-system-sounds.ts';

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

  it('discovers a looping select BGM at the canonical Bgm/select.* path', () => {
    expect(discoverBeatorajaSelectBgmPath(fakeFiles(['Bgm/select.wav']))).toBe('Bgm/select.wav');
    expect(discoverBeatorajaSelectBgmPath(fakeFiles(['bgm/select.ogg']))).toBe('bgm/select.ogg');
    // Falls back to LR2-derived layout
    expect(discoverBeatorajaSelectBgmPath(fakeFiles(['LR2files/Bgm/_common/select.wav']))).toBe(
      'LR2files/Bgm/_common/select.wav',
    );
    // Returns undefined when no candidate matches
    expect(discoverBeatorajaSelectBgmPath(fakeFiles(['random/file.png']))).toBeUndefined();
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

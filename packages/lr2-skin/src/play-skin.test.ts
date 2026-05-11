import type { BeMusicEvent } from '@be-music/json';
import { describe, expect, test } from 'vitest';
import type { Lr2SkinInputFile } from './file-lookup.ts';
import {
  loadLr2ThemeSkinsFromFiles,
  pickLr2PlaySkin,
  pickLr2SystemSoundFile,
  pickLr2ThemeBgmFile,
  summarizeLr2PlaySkins,
  type Lr2PlaySkinMap,
  type Lr2PlaySkinSong,
  type Lr2ThemeLoadProgress,
} from './play-skin.ts';
import type { Lr2Skin } from './skin.ts';

function skin(name: string): Lr2Skin {
  return { name } as Lr2Skin;
}

/**
 * Builds a fake file carrying just the path metadata `pickLr2ThemeBgmFile` consults. The matcher only inspects
 * `webkitRelativePath` / `name`, so casting an object literal is enough — this avoids the `new File([...], ...)`
 * boilerplate that needs an actual Blob payload we don't use here.
 */
function pathFile(path: string): Lr2SkinInputFile {
  return {
    webkitRelativePath: path,
    name: path.split('/').pop() ?? path,
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

function songWithChannels(channels: string[]): Lr2PlaySkinSong {
  return {
    chartPath: 'Song/main.bms',
    chart: {
      bms: {},
      events: channels.map(
        (channel, index): BeMusicEvent => ({ measure: index, channel, position: [0, 1], value: '01' }),
      ),
    },
  };
}

describe('LR2 play-skin helpers', () => {
  test('pickLr2PlaySkin picks exact and nearest fallback variants', () => {
    const skins: Lr2PlaySkinMap = {
      '7': skin('7K'),
      '10': skin('10K'),
    };

    expect(pickLr2PlaySkin(skins, songWithChannels(['18']))?.name).toBe('7K');
    expect(pickLr2PlaySkin(skins, songWithChannels(['28']))?.name).toBe('10K');
  });

  test('pickLr2PlaySkin returns undefined when no play skin is available', () => {
    expect(pickLr2PlaySkin({}, songWithChannels(['11']))).toBeUndefined();
  });

  test('summarizeLr2PlaySkins formats loaded variants', () => {
    expect(summarizeLr2PlaySkins({ '7': skin('seven'), '14': skin('double') }, ' / ')).toBe('7K=seven / 14K=double');
  });
});

describe('pickLr2ThemeBgmFile', () => {
  test('picks select.wav inside an LR2files/Bgm path', () => {
    const files = [pathFile('LR2files/Bgm/LR2 ver sta/select.wav'), pathFile('LR2files/Bgm/LR2 ver sta/decide.wav')];
    expect(pickLr2ThemeBgmFile(files, 'select')?.webkitRelativePath).toBe('LR2files/Bgm/LR2 ver sta/select.wav');
    expect(pickLr2ThemeBgmFile(files, 'decide')?.webkitRelativePath).toBe('LR2files/Bgm/LR2 ver sta/decide.wav');
  });

  test('returns the first matching variant when several themes are bundled', () => {
    // The LR2 default ships three theme variants (`LR2 ver sta`, `LR2 ver Yamajet`, `LR2 ver syatten`). Picking the
    // first in input order keeps the choice deterministic without forcing an alphabetical sort that would surprise
    // users who expect their drag order to win.
    const files = [
      pathFile('LR2files/Bgm/LR2 ver sta/select.wav'),
      pathFile('LR2files/Bgm/LR2 ver Yamajet/select.wav'),
    ];
    expect(pickLr2ThemeBgmFile(files, 'select')?.webkitRelativePath).toBe('LR2files/Bgm/LR2 ver sta/select.wav');
  });

  test('matches case-insensitively on path and basename', () => {
    expect(pickLr2ThemeBgmFile([pathFile('LR2files/BGM/Theme/Select.WAV')], 'select')?.name).toBe('Select.WAV');
    expect(pickLr2ThemeBgmFile([pathFile('lr2files/bgm/foo/decide.wav')], 'decide')?.name).toBe('decide.wav');
  });

  test('accepts alternate audio extensions (ogg, mp3, opus, flac)', () => {
    expect(pickLr2ThemeBgmFile([pathFile('LR2files/Bgm/x/select.ogg')], 'select')?.name).toBe('select.ogg');
    expect(pickLr2ThemeBgmFile([pathFile('LR2files/Bgm/x/select.mp3')], 'select')?.name).toBe('select.mp3');
    expect(pickLr2ThemeBgmFile([pathFile('LR2files/Bgm/x/select.opus')], 'select')?.name).toBe('select.opus');
    expect(pickLr2ThemeBgmFile([pathFile('LR2files/Bgm/x/select.flac')], 'select')?.name).toBe('select.flac');
  });

  test('rejects non-Bgm paths', () => {
    // A file named `select.wav` outside an `Bgm/` directory could be a chart's keysound — must NOT be picked as theme
    // BGM.
    expect(pickLr2ThemeBgmFile([pathFile('Songs/MyChart/select.wav')], 'select')).toBeUndefined();
    expect(pickLr2ThemeBgmFile([pathFile('LR2files/Theme/LR2/Select/select.wav')], 'select')).toBeUndefined();
  });

  test('rejects unsupported extensions', () => {
    expect(pickLr2ThemeBgmFile([pathFile('LR2files/Bgm/x/select.txt')], 'select')).toBeUndefined();
    expect(pickLr2ThemeBgmFile([pathFile('LR2files/Bgm/x/select.exe')], 'select')).toBeUndefined();
  });

  test('rejects basenames that just contain the role substring', () => {
    // Strict basename match: `select.wav` matches, `selecting.wav` doesn't. Without this guard a song folder happening
    // to ship a `selecting_loop.wav` keysound would hijack the BGM slot.
    expect(pickLr2ThemeBgmFile([pathFile('LR2files/Bgm/x/selecting.wav')], 'select')).toBeUndefined();
    expect(pickLr2ThemeBgmFile([pathFile('LR2files/Bgm/x/decided.wav')], 'decide')).toBeUndefined();
  });

  test('returns undefined when the bundle has no BGM file', () => {
    expect(pickLr2ThemeBgmFile([], 'select')).toBeUndefined();
    expect(pickLr2ThemeBgmFile([pathFile('LR2files/Theme/LR2/Select/select.lr2skin')], 'select')).toBeUndefined();
  });
});

describe('pickLr2SystemSoundFile', () => {
  test('picks the LR2 default scratch / folder system effects', () => {
    // Standard LR2 layout: `LR2files/Sound/lr2/<stem>.wav`. The matcher should pull each effect out for any stem the
    // caller asks for.
    const files = [
      pathFile('LR2files/Sound/lr2/scratch.wav'),
      pathFile('LR2files/Sound/lr2/f-open.wav'),
      pathFile('LR2files/Sound/lr2/f-close.wav'),
      pathFile('LR2files/Sound/lr2/o-change.wav'),
    ];
    expect(pickLr2SystemSoundFile(files, 'scratch')?.name).toBe('scratch.wav');
    expect(pickLr2SystemSoundFile(files, 'f-open')?.name).toBe('f-open.wav');
    expect(pickLr2SystemSoundFile(files, 'f-close')?.name).toBe('f-close.wav');
    expect(pickLr2SystemSoundFile(files, 'o-change')?.name).toBe('o-change.wav');
  });

  test('matches case-insensitively on path and basename', () => {
    expect(pickLr2SystemSoundFile([pathFile('LR2FILES/SOUND/LR2/SCRATCH.WAV')], 'scratch')?.name).toBe('SCRATCH.WAV');
  });

  test('rejects scratch.wav outside the Sound/lr2 path', () => {
    // BMS chart keysounds occasionally use names that look like system effects. The strict path filter prevents a
    // song's `scratch.wav` from being misidentified as the cursor click.
    expect(pickLr2SystemSoundFile([pathFile('Songs/Foo/scratch.wav')], 'scratch')).toBeUndefined();
    // BGM-folder files mustn't qualify either — `decide.wav` belongs there but the picker's path filter is just
    // `Sound/lr2/`, so a BGM-folder match must be rejected by basename rather than colliding with this picker's allow-
    // list.
    expect(pickLr2SystemSoundFile([pathFile('LR2files/Bgm/x/decide.wav')], 'decide')).toBeUndefined();
  });

  test('accepts alternate audio extensions', () => {
    // Same as the BGM picker — themes occasionally ship .ogg / .mp3 mirrors of the WAV originals to save space.
    expect(pickLr2SystemSoundFile([pathFile('LR2files/Sound/lr2/scratch.ogg')], 'scratch')?.name).toBe('scratch.ogg');
    expect(pickLr2SystemSoundFile([pathFile('LR2files/Sound/lr2/scratch.opus')], 'scratch')?.name).toBe('scratch.opus');
  });

  test('returns undefined when the bundle has no matching effect', () => {
    expect(pickLr2SystemSoundFile([], 'scratch')).toBeUndefined();
    expect(pickLr2SystemSoundFile([pathFile('LR2files/Sound/lr2/clear.wav')], 'scratch')).toBeUndefined();
  });
});

describe('loadLr2ThemeSkinsFromFiles progress events', () => {
  test('fires a theme-phase event for every internal sub-task', async () => {
    // No real theme files supplied — every sub-task resolves with `undefined`, but the progress emitter must still tick
    // to completion so the host UI's "Theme: X / N" readout reaches the bottom-right corner of the bar.
    const events: Lr2ThemeLoadProgress[] = [];
    await loadLr2ThemeSkinsFromFiles([], { onProgress: (event) => events.push(event) });
    const themeEvents = events.filter((event) => event.phase === 'theme');
    // Initial 0 / N prelude + one per sub-task.
    expect(themeEvents.length).toBeGreaterThan(1);
    expect(themeEvents[0]).toMatchObject({ current: 0 });
    const last = themeEvents.at(-1)!;
    // Each event reports the same total, and the final one matches the running tally — i.e. the bar reaches 100 %.
    expect(last.current).toBe(last.total);
    // Every event after the prelude carries a sub-task label (`play/7K`, `select`, `bgm/decide`, …) — handy for the UI.
    const labeled = themeEvents.slice(1);
    expect(labeled.every((event) => typeof event.label === 'string' && event.label.length > 0)).toBe(true);
  });

  test('survives without an onProgress callback', async () => {
    await expect(loadLr2ThemeSkinsFromFiles([])).resolves.toBeDefined();
  });
});

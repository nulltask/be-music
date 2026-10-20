import type { BeMusicEvent } from '@be-music/json';
import { describe, expect, test } from 'vite-plus/test';
import type { LR2SkinInputFile } from './file-lookup.ts';
import {
  loadLR2ThemeSkinsFromFiles,
  pickLR2PlaySkin,
  pickLR2PlaySkinVariant,
  pickLR2SystemSoundFile,
  pickLR2ThemeBGMFile,
  summarizeLR2PlaySkins,
  type LR2PlaySkinMap,
  type LR2PlaySkinChart,
  type LR2ThemeLoadProgress,
} from './play-skin.ts';
import type { LR2Skin } from './skin.ts';

function skin(name: string): LR2Skin {
  return { name } as LR2Skin;
}

/**
 * Builds a fake file carrying just the path metadata `pickLR2ThemeBGMFile` consults. The matcher only inspects
 * `webkitRelativePath` / `name`, so casting an object literal is enough — this avoids the `new File([...], ...)`
 * boilerplate that needs an actual Blob payload we don't use here.
 */
function pathFile(path: string): LR2SkinInputFile {
  return {
    webkitRelativePath: path,
    name: path.split('/').pop() ?? path,
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

function chartWithChannels(channels: string[]): LR2PlaySkinChart {
  return {
    chartPath: 'Song/main.bms',
    chart: {
      bms: {},
      events: channels.map((channel, index): BeMusicEvent => ({
        measure: index,
        channel,
        position: [0, 1],
        value: '01',
      })),
    },
  };
}

describe('LR2 play-skin helpers', () => {
  test('pickLR2PlaySkin picks exact and nearest fallback variants', () => {
    const skins: LR2PlaySkinMap = {
      '7': skin('7K'),
      '10': skin('10K'),
    };

    expect(pickLR2PlaySkin(skins, chartWithChannels(['18']))?.name).toBe('7K');
    expect(pickLR2PlaySkin(skins, chartWithChannels(['28']))?.name).toBe('10K');
  });

  test('pickLR2PlaySkin falls back to the SP / DP IIDX skins for 24-key keyboard charts', () => {
    // LR2 never shipped a keyboard-mode skin. A 24-key chart still needs a frame / gauge / judge skin, so it
    // borrows the SP chain (`'7'` first) and its 26 lanes (24 keys + wheel) render through the host's fallback playfield; the
    // 48-key DP form borrows the DP chain (`'14'` first).
    const skins: LR2PlaySkinMap = { '7': skin('7K'), '14': skin('14K') };

    expect(pickLR2PlaySkin(skins, chartWithChannels(['11', '1A']))?.name).toBe('7K');
    expect(pickLR2PlaySkin(skins, chartWithChannels(['11', '1A', '21', '2O']))?.name).toBe('14K');
  });

  test('pickLR2PlaySkin returns undefined when no play skin is available', () => {
    expect(pickLR2PlaySkin({}, chartWithChannels(['11']))).toBeUndefined();
  });

  test('pickLR2PlaySkinVariant names the variant pickLR2PlaySkin plays on', () => {
    const skins: LR2PlaySkinMap = { '7': skin('7K'), '10': skin('10K') };
    expect(pickLR2PlaySkinVariant(skins, chartWithChannels(['18']))).toBe('7');
    expect(pickLR2PlaySkinVariant(skins, chartWithChannels(['28']))).toBe('10');
    expect(pickLR2PlaySkinVariant({}, chartWithChannels(['11']))).toBeUndefined();
  });

  test('summarizeLR2PlaySkins formats loaded variants', () => {
    expect(summarizeLR2PlaySkins({ '7': skin('seven'), '14': skin('double') }, ' / ')).toBe('7K=seven / 14K=double');
  });
});

describe('pickLR2ThemeBGMFile', () => {
  test('picks select.wav inside an LR2files/BGM path', () => {
    const files = [pathFile('LR2files/BGM/LR2 ver sta/select.wav'), pathFile('LR2files/BGM/LR2 ver sta/decide.wav')];
    expect(pickLR2ThemeBGMFile(files, 'select')?.webkitRelativePath).toBe('LR2files/BGM/LR2 ver sta/select.wav');
    expect(pickLR2ThemeBGMFile(files, 'decide')?.webkitRelativePath).toBe('LR2files/BGM/LR2 ver sta/decide.wav');
  });

  test('returns the first matching variant when several themes are bundled', () => {
    // The LR2 default ships three theme variants (`LR2 ver sta`, `LR2 ver Yamajet`, `LR2 ver syatten`). Picking the
    // first in input order keeps the choice deterministic without forcing an alphabetical sort that would surprise
    // users who expect their drag order to win.
    const files = [
      pathFile('LR2files/BGM/LR2 ver sta/select.wav'),
      pathFile('LR2files/BGM/LR2 ver Yamajet/select.wav'),
    ];
    expect(pickLR2ThemeBGMFile(files, 'select')?.webkitRelativePath).toBe('LR2files/BGM/LR2 ver sta/select.wav');
  });

  test('matches case-insensitively on path and basename', () => {
    expect(pickLR2ThemeBGMFile([pathFile('LR2files/BGM/Theme/Select.WAV')], 'select')?.name).toBe('Select.WAV');
    expect(pickLR2ThemeBGMFile([pathFile('lr2files/bgm/foo/decide.wav')], 'decide')?.name).toBe('decide.wav');
  });

  test('accepts alternate audio extensions (ogg, mp3, opus, flac)', () => {
    expect(pickLR2ThemeBGMFile([pathFile('LR2files/BGM/x/select.ogg')], 'select')?.name).toBe('select.ogg');
    expect(pickLR2ThemeBGMFile([pathFile('LR2files/BGM/x/select.mp3')], 'select')?.name).toBe('select.mp3');
    expect(pickLR2ThemeBGMFile([pathFile('LR2files/BGM/x/select.opus')], 'select')?.name).toBe('select.opus');
    expect(pickLR2ThemeBGMFile([pathFile('LR2files/BGM/x/select.flac')], 'select')?.name).toBe('select.flac');
  });

  test('rejects non-BGM paths', () => {
    // A file named `select.wav` outside an `BGM/` directory could be a chart's keysound — must NOT be picked as theme
    // BGM.
    expect(pickLR2ThemeBGMFile([pathFile('Songs/MyChart/select.wav')], 'select')).toBeUndefined();
    expect(pickLR2ThemeBGMFile([pathFile('LR2files/Theme/LR2/Select/select.wav')], 'select')).toBeUndefined();
  });

  test('rejects unsupported extensions', () => {
    expect(pickLR2ThemeBGMFile([pathFile('LR2files/BGM/x/select.txt')], 'select')).toBeUndefined();
    expect(pickLR2ThemeBGMFile([pathFile('LR2files/BGM/x/select.exe')], 'select')).toBeUndefined();
  });

  test('rejects basenames that just contain the role substring', () => {
    // Strict basename match: `select.wav` matches, `selecting.wav` doesn't. Without this guard a song folder happening
    // to ship a `selecting_loop.wav` keysound would hijack the BGM slot.
    expect(pickLR2ThemeBGMFile([pathFile('LR2files/BGM/x/selecting.wav')], 'select')).toBeUndefined();
    expect(pickLR2ThemeBGMFile([pathFile('LR2files/BGM/x/decided.wav')], 'decide')).toBeUndefined();
  });

  test('returns undefined when the bundle has no BGM file', () => {
    expect(pickLR2ThemeBGMFile([], 'select')).toBeUndefined();
    expect(pickLR2ThemeBGMFile([pathFile('LR2files/Theme/LR2/Select/select.lr2skin')], 'select')).toBeUndefined();
  });
});

describe('pickLR2SystemSoundFile', () => {
  test('picks the LR2 default scratch / folder system effects', () => {
    // Standard LR2 layout: `LR2files/Sound/lr2/<stem>.wav`. The matcher should pull each effect out for any stem the
    // caller asks for.
    const files = [
      pathFile('LR2files/Sound/lr2/scratch.wav'),
      pathFile('LR2files/Sound/lr2/f-open.wav'),
      pathFile('LR2files/Sound/lr2/f-close.wav'),
      pathFile('LR2files/Sound/lr2/o-change.wav'),
    ];
    expect(pickLR2SystemSoundFile(files, 'scratch')?.name).toBe('scratch.wav');
    expect(pickLR2SystemSoundFile(files, 'f-open')?.name).toBe('f-open.wav');
    expect(pickLR2SystemSoundFile(files, 'f-close')?.name).toBe('f-close.wav');
    expect(pickLR2SystemSoundFile(files, 'o-change')?.name).toBe('o-change.wav');
  });

  test('matches case-insensitively on path and basename', () => {
    expect(pickLR2SystemSoundFile([pathFile('LR2FILES/SOUND/LR2/SCRATCH.WAV')], 'scratch')?.name).toBe('SCRATCH.WAV');
  });

  test('rejects scratch.wav outside the Sound/lr2 path', () => {
    // BMS chart keysounds occasionally use names that look like system effects. The strict path filter prevents a
    // song's `scratch.wav` from being misidentified as the cursor click.
    expect(pickLR2SystemSoundFile([pathFile('Songs/Foo/scratch.wav')], 'scratch')).toBeUndefined();
    // BGM-folder files mustn't qualify either — `decide.wav` belongs there but the picker's path filter is just
    // `Sound/lr2/`, so a BGM-folder match must be rejected by basename rather than colliding with this picker's allow-
    // list.
    expect(pickLR2SystemSoundFile([pathFile('LR2files/BGM/x/decide.wav')], 'decide')).toBeUndefined();
  });

  test('accepts alternate audio extensions', () => {
    // Same as the BGM picker — themes occasionally ship .ogg / .mp3 mirrors of the WAV originals to save space.
    expect(pickLR2SystemSoundFile([pathFile('LR2files/Sound/lr2/scratch.ogg')], 'scratch')?.name).toBe('scratch.ogg');
    expect(pickLR2SystemSoundFile([pathFile('LR2files/Sound/lr2/scratch.opus')], 'scratch')?.name).toBe('scratch.opus');
  });

  test('returns undefined when the bundle has no matching effect', () => {
    expect(pickLR2SystemSoundFile([], 'scratch')).toBeUndefined();
    expect(pickLR2SystemSoundFile([pathFile('LR2files/Sound/lr2/clear.wav')], 'scratch')).toBeUndefined();
  });
});

describe('loadLR2ThemeSkinsFromFiles progress events', () => {
  test('fires a theme-phase event for every internal sub-task', async () => {
    // No real theme files supplied — every sub-task resolves with `undefined`, but the progress emitter must still tick
    // to completion so the host UI's "Theme: X / N" readout reaches the bottom-right corner of the bar.
    const events: LR2ThemeLoadProgress[] = [];
    await loadLR2ThemeSkinsFromFiles([], { onProgress: (event) => events.push(event) });
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

  test('loads the course-result skin and re-parses skins with extra parse ops', async () => {
    const text = (path: string, rows: string[]): LR2SkinInputFile => {
      const bytes = new TextEncoder().encode(rows.join('\n'));
      return { webkitRelativePath: path, name: path.split('/').pop()!, arrayBuffer: async () => bytes.buffer };
    };
    const image = (name: string): string[] => [
      `#IMAGE,${name}.png`,
      '#SRC_IMAGE,0,0,0,0,10,10,1,1,0,0',
      '#DST_IMAGE,0,0,0,0,10,10,0,255,255,255,255',
    ];
    const imagesOf = (loaded: LR2Skin | undefined): string[] =>
      loaded?.images.map((element) => element.source.imagePath) ?? [];
    const theme = await loadLR2ThemeSkinsFromFiles([
      text('LR2files/Theme/T/Play/play_7.lr2skin', [
        '#INFORMATION,0,T,a,t.bmp',
        '#IF,290',
        ...image('course'),
        '#ELSE',
        ...image('single'),
        '#ENDIF',
      ]),
      text('LR2files/Theme/T/CourseResult/courseresult.lr2skin', ['#INFORMATION,15,T,a,t.bmp', ...image('cr')]),
    ]);
    expect(imagesOf(theme.courseResultSkin)).toEqual(['cr.png']);
    expect(imagesOf(theme.resultSkin)).toEqual([]);
    expect(imagesOf(theme.playSkins['7'])).toEqual(['single.png']);
    expect(imagesOf(theme.loadSkin({ kind: 'play', playVariant: '7', parseOps: [290] }))).toEqual(['course.png']);
  });

  test('resolves the course jingles through the sound set, else by the stock stems', async () => {
    const file = (path: string, text = ''): LR2SkinInputFile => {
      const bytes = new TextEncoder().encode(text);
      return { webkitRelativePath: path, name: path.split('/').pop()!, arrayBuffer: async () => bytes.buffer };
    };
    const jingles = [
      file('LR2files/Sound/lr2/clear.wav'),
      file('LR2files/Sound/lr2/fail.wav'),
      file('LR2files/Sound/lr2/course_clear.wav'),
      file('LR2files/Sound/lr2/course_fail.wav'),
    ];
    const withoutSet = await loadLR2ThemeSkinsFromFiles(jingles);
    expect(withoutSet.courseClearBGM?.path).toBe('LR2files/Sound/lr2/course_clear.wav');
    expect(withoutSet.courseFailBGM?.path).toBe('LR2files/Sound/lr2/course_fail.wav');
    const withSet = await loadLR2ThemeSkinsFromFiles([
      ...jingles,
      file('LR2files/Sound/my/win.ogg'),
      file('LR2files/Sound/my/click.wav'),
      file(
        'LR2files/Sound/lr2.lr2ss',
        '#COURSECLEAR,LR2files\\Sound\\my\\win.wav,\n#SCRATCH,LR2files\\Sound\\my\\click.wav,',
      ),
    ]);
    expect(withSet.courseClearBGM?.path).toBe('LR2files/Sound/my/win.ogg');
    expect(withSet.systemSounds.cursorMove?.path).toBe('LR2files/Sound/my/click.wav');
    // Commands the set leaves out keep the stem lookup.
    expect(withSet.courseFailBGM?.path).toBe('LR2files/Sound/lr2/course_fail.wav');
    expect(withSet.clearBGM?.path).toBe('LR2files/Sound/lr2/clear.wav');
  });

  test('survives without an onProgress callback', async () => {
    await expect(loadLR2ThemeSkinsFromFiles([])).resolves.toBeDefined();
  });
});

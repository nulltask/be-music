import { createEmptyJSON } from '@be-music/chart-source';
import type { BeatorajaSkinEntry } from '@be-music/skin-beatoraja';
import type { LR2PlaySkinMap, LR2Skin } from '@be-music/skin-lr2';
import type { BeatorajaKit, BuiltInKit } from '@be-music/player-browser/host';
import type { BeatorajaThemeBundle } from '@be-music/player-browser/skin';
import { parseBeatorajaCourseData } from '@be-music/player-engine/course';
import {
  resolveCourseView,
  type LibraryChart,
  type LibraryCourse,
  type SystemSoundSet,
} from '@be-music/player-scene-model';
import type { BeMusicSkin } from '@be-music/player-skin-sdk';
import { describe, expect, test, vi } from 'vite-plus/test';
import type { CourseStagePlay } from '../course-flow.ts';
import type { SkinFamilyOverride } from '../types.ts';
import { FamilyKits, type FamilyKitsOptions } from './family-kits.ts';

function skin(name: string): LR2Skin {
  return { name } as unknown as LR2Skin;
}

/** A 7 KEY chart: a note on key 1 and one on key 6. */
function chart(): LibraryChart {
  const json = createEmptyJSON('bms');
  json.events.push(
    { measure: 1, channel: '11', position: [0, 1], value: '01' },
    { measure: 1, channel: '18', position: [0, 1], value: '01' },
  );
  return {
    id: 'chart',
    sourceId: 'src',
    sourceLabel: 'src',
    sourceKind: 'files',
    chartPath: 'chart.bms',
    directoryLabel: 'src',
    fileLabel: 'chart.bms',
    title: 'Chart',
    totalNotes: 2,
    chart: json,
  };
}

function course(): LibraryCourse {
  const definition = parseBeatorajaCourseData({ name: 'Dan', hash: [{ md5: '1'.repeat(32) }], constraint: [] })!;
  return { id: 'dan#0', definition, stages: [{ title: 'a' }], playable: true };
}

/** A beatoraja theme with a play skin for 7 KEY and the scene skins in `scenes`. */
function beatorajaTheme(scenes: { decide?: boolean } = {}): BeatorajaThemeBundle {
  const play7 = { entryPath: 'skin/play7.luaskin' } as BeatorajaSkinEntry;
  return {
    files: new Map(),
    theme: {
      entries: [play7],
      playSkins: { '7': play7 },
      ...(scenes.decide === true ? { decideSkin: { entryPath: 'skin/decide.luaskin' } } : {}),
    },
    warnings: [],
  } as unknown as BeatorajaThemeBundle;
}

const BUILT_IN_KIT: BuiltInKit = { family: 'built-in', skin: { id: 'synesthesia' } as BeMusicSkin };
const BEATORAJA_KIT = { family: 'beatoraja', kit: {} } as BeatorajaKit;
const LR2_SOUNDS: SystemSoundSet = { selectBGM: { bytes: new Uint8Array([1]) } };
const BEATORAJA_SOUNDS: SystemSoundSet = { selectBGM: { path: 'bgm/select.wav' } };

interface Fakes {
  kits: FamilyKits;
  lr2: { -readonly [K in keyof FamilyKitsOptions['lr2']]: FamilyKitsOptions['lr2'][K] };
  beatoraja: { -readonly [K in keyof FamilyKitsOptions['beatoraja']]: FamilyKitsOptions['beatoraja'][K] };
  builtIn: { beMusicSkin: BeMusicSkin; builtInKit: BuiltInKit };
  guiState: { skinFamilyOverride: SkinFamilyOverride };
}

function fakes(
  loaded: { playSkins?: LR2PlaySkinMap; decideSkin?: LR2Skin; beatoraja?: BeatorajaThemeBundle } = {},
): Fakes {
  const lr2: Fakes['lr2'] = {
    playSkins: loaded.playSkins ?? {},
    selectSkin: undefined,
    decideSkin: loaded.decideSkin,
    resultSkin: undefined,
    courseLR2Skin: vi.fn((mounted: LR2Skin | undefined) => mounted && skin(`${mounted.name} (course)`)),
    selectSoundSet: vi.fn(() => LR2_SOUNDS),
  };
  const beatoraja: Fakes['beatoraja'] = {
    beatorajaTheme: loaded.beatoraja,
    loadBeatorajaPlayKit: vi.fn(async () => ({
      kit: BEATORAJA_KIT,
      entryPath: 'skin/play7.luaskin',
      header: { type: 0 } as never,
      variant: '7' as const,
    })),
    loadBeatorajaDecideKit: vi.fn(async () => BEATORAJA_KIT),
    selectSoundSet: vi.fn(() => BEATORAJA_SOUNDS),
  };
  const builtIn: Fakes['builtIn'] = { beMusicSkin: BUILT_IN_KIT.skin, builtInKit: BUILT_IN_KIT };
  const guiState: Fakes['guiState'] = { skinFamilyOverride: 'auto' };
  return { kits: new FamilyKits({ lr2, beatoraja, builtIn, guiState }), lr2, beatoraja, builtIn, guiState };
}

describe('FamilyKits.familyDispatchState', () => {
  test("reads the theme services' skins and the Skin system pick as they are now", () => {
    const { kits, lr2, guiState } = fakes();
    expect(kits.familyDispatchState()).toMatchObject({ selectSkin: undefined, skinFamilyOverride: 'auto' });
    const select = skin('select');
    lr2.selectSkin = select;
    guiState.skinFamilyOverride = 'lr2';
    expect(kits.familyDispatchState()).toMatchObject({ selectSkin: select, skinFamilyOverride: 'lr2' });
  });
});

describe('FamilyKits.selectSoundSet', () => {
  test("a beatoraja select screen plays the beatoraja theme's sounds; the others the LR2 theme's", () => {
    const { kits } = fakes();
    expect(kits.selectSoundSet('beatoraja')).toBe(BEATORAJA_SOUNDS);
    expect(kits.selectSoundSet('lr2')).toBe(LR2_SOUNDS);
    expect(kits.selectSoundSet('built-in')).toBe(LR2_SOUNDS);
  });
});

describe('FamilyKits.decideKitFor', () => {
  test("each family's splash: the beatoraja entry, the LR2 decide skin, or the be-music skin's own", async () => {
    const decide = skin('decide');
    const { kits, beatoraja, builtIn } = fakes({ decideSkin: decide });
    const chartEntry = chart();
    expect(await kits.decideKitFor('beatoraja', chartEntry, true)).toBe(BEATORAJA_KIT);
    expect(beatoraja.loadBeatorajaDecideKit).toHaveBeenCalledWith(chartEntry);
    expect(await kits.decideKitFor('lr2', chartEntry, false)).toEqual({ family: 'lr2', skin: decide });
    // A be-music skin without a decide screen shows no splash.
    expect(await kits.decideKitFor('default', chartEntry, false)).toBeUndefined();
    builtIn.beMusicSkin = { ...BUILT_IN_KIT.skin, decide: {} } as BeMusicSkin;
    expect(await kits.decideKitFor('default', chartEntry, false)).toBe(BUILT_IN_KIT);
    // Its splash hands over to a built-in or LR2 play, so none is shown before a beatoraja play.
    expect(await kits.decideKitFor('default', chartEntry, true)).toBeUndefined();
  });

  test('no LR2 splash without a decide skin', async () => {
    const { kits } = fakes();
    expect(await kits.decideKitFor('lr2', chart(), false)).toBeUndefined();
  });
});

describe('FamilyKits.resolvePlayKit', () => {
  test('a chart the beatoraja theme can play plays on its play entry, handed with the kit', async () => {
    const { kits, beatoraja } = fakes({ beatoraja: beatorajaTheme() });
    const chartEntry = chart();
    expect(kits.playsOnBeatoraja(chartEntry)).toBe(true);
    // The entry goes with the kit: the play puts it in force as it takes the stage, not here.
    expect(await kits.resolvePlayKit(chartEntry, {})).toEqual({
      kit: BEATORAJA_KIT,
      beatorajaPlay: { entryPath: 'skin/play7.luaskin', header: { type: 0 }, variant: '7' },
    });
    // An entry that fails to load leaves no play kit.
    vi.mocked(beatoraja.loadBeatorajaPlayKit).mockResolvedValueOnce(undefined);
    expect(await kits.resolvePlayKit(chartEntry, {})).toBeUndefined();
  });

  test("an LR2 play skin for the chart's key mode, with the 9-keys skin for invisible notes", async () => {
    const play7 = skin('play7');
    const play9 = skin('play9');
    const { kits, beatoraja } = fakes({ playSkins: { '7': play7, '9': play9 } });
    expect(kits.playsOnBeatoraja(chart())).toBe(false);
    expect(await kits.resolvePlayKit(chart(), {})).toEqual({
      kit: { family: 'lr2', skin: play7, invisibleNoteSkin: play9 },
    });
    expect(beatoraja.loadBeatorajaPlayKit).not.toHaveBeenCalled();
  });

  test("a course stage and a NONSTOP run play on the LR2 skin parsed again with the course's ops", async () => {
    const play7 = skin('play7');
    const { kits, lr2 } = fakes({ playSkins: { '7': play7 } });
    const courseInfo = resolveCourseView(course(), 0);
    const courseStage = { courseInfo } as CourseStagePlay;
    expect(await kits.resolvePlayKit(chart(), { courseStage })).toEqual({
      kit: { family: 'lr2', skin: skin('play7 (course)') },
    });
    expect(lr2.courseLR2Skin).toHaveBeenLastCalledWith(play7, courseInfo, { kind: 'play', playVariant: '7' });

    const nonstop = course();
    await kits.resolvePlayKit(chart(), { nonstop: { course: nonstop } });
    expect(lr2.courseLR2Skin).toHaveBeenLastCalledWith(play7, resolveCourseView(nonstop, 0), {
      kind: 'play',
      playVariant: '7',
    });
  });

  test('the built-in kit with no LR2 skin loaded, or with Skin system on Built-in', async () => {
    const none = fakes();
    expect(await none.kits.resolvePlayKit(chart(), {})).toEqual({ kit: BUILT_IN_KIT });
    // LR2 picked with none loaded falls to the built-in family, not to the beatoraja theme.
    const beatorajaOnly = fakes({ beatoraja: beatorajaTheme() });
    beatorajaOnly.guiState.skinFamilyOverride = 'lr2';
    expect(beatorajaOnly.kits.playsOnBeatoraja(chart())).toBe(false);
    expect(await beatorajaOnly.kits.resolvePlayKit(chart(), {})).toEqual({ kit: BUILT_IN_KIT });
    const lr2 = fakes({ playSkins: { '7': skin('play7') } });
    lr2.guiState.skinFamilyOverride = 'default';
    expect(await lr2.kits.resolvePlayKit(chart(), {})).toEqual({ kit: BUILT_IN_KIT });
  });
});

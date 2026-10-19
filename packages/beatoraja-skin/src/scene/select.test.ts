import type { LibraryChart, LibraryCourse, LibraryEntry } from '@be-music/scene-model';
import { describe, expect, it } from 'vite-plus/test';
import { BEATORAJA_BUTTON, BEATORAJA_NUM, BEATORAJA_OP, BEATORAJA_TEXT } from '../runtime-ids.ts';
import {
  BEATORAJA_KEYS_FILTERS,
  BEATORAJA_SORTS,
  beatorajaDifficultyOps,
  beatorajaJudgeRankOp,
  beatorajaKeyModeIndex,
  beatorajaKeysFilterIndex,
  beatorajaLnModeIndex,
  beatorajaSortIndex,
  resolveBeatorajaSelectBarOps,
  resolveBeatorajaSelectNumber,
  resolveBeatorajaSelectRefValue,
  resolveBeatorajaSelectSliderValue,
  resolveBeatorajaSelectText,
  type BeatorajaSelectChartFacts,
  type BeatorajaSelectInput,
} from './select.ts';

const SONG: LibraryChart = {
  id: 'song-1',
  sourceId: 'src',
  sourceLabel: 'Source',
  sourceKind: 'directory',
  chartPath: 'Pack/song/a.bms',
  directoryLabel: 'Pack',
  fileLabel: 'a.bms',
  title: 'Song',
  subtitle: '[HYPER]',
  artist: 'Artist',
  genre: 'TECHNO',
  playLevel: '9',
  bpm: 149.6,
  totalNotes: 777,
  chart: { metadata: {} } as unknown as LibraryChart['chart'],
};

const FACTS: BeatorajaSelectChartFacts = {
  playVariant: '14',
  traits: { longNote: true, bga: false, bpmChange: true, random: false, stop: true, stageFile: true },
  difficulty: 3,
  judgeRank: 1,
  total: 312.9,
  lnMode: 2,
  subartist: 'obj: X',
  noteBreakdown: { normal: 600, ln: 100, scratch: 70, bss: 7 },
  density: { peak: { whole: 21, afterDot: 4 }, end: { whole: 9, afterDot: 0 }, average: { whole: 6, afterDot: 5 } },
  lengthSeconds: 125.8,
  bpmRange: { min: 75, max: 300 },
};

const COURSE: LibraryCourse = {
  id: 'Dan#0',
  definition: {
    name: 'Dan',
    kind: 'grade',
    stages: [],
    constraints: ['grade_mirror'],
    trophies: [],
    release: true,
    source: { format: 'beatoraja-json' },
  },
  stages: [{ title: 'One', chart: SONG }, { title: 'Two' }],
  playable: false,
};

function input(focused: LibraryEntry | undefined, overrides: Partial<BeatorajaSelectInput> = {}): BeatorajaSelectInput {
  return {
    focused,
    ...(focused?.kind === 'chart' ? { chart: FACTS } : {}),
    folderLabel: 'Pack',
    searchText: 'son',
    list: { keysFilter: 'KEYS_14', sort: 'BPM' },
    skin: { name: 'Select', author: 'Maker' },
    judgeTiming: -12,
    ...overrides,
  };
}

const SONG_BAR: LibraryEntry = { kind: 'chart', chart: SONG };
const FOLDER_BAR: LibraryEntry = { kind: 'folder', folder: { label: 'Folder', charts: [SONG, SONG] } };
const COURSE_BAR: LibraryEntry = { kind: 'course', course: COURSE };

describe('button orders', () => {
  it("follows beatoraja's MODE and SORT buttons", () => {
    expect(BEATORAJA_KEYS_FILTERS.map(beatorajaKeysFilterIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(BEATORAJA_SORTS.map(beatorajaSortIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(beatorajaSortIndex('CLEAR')).toBe(0);
    expect(['5', '7', '10', '14', '9', '24', '48', 'x', undefined].map(beatorajaKeyModeIndex)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 0, 0,
    ]);
    // `#LNMODE` counts from 1; a missing or out-of-range one reads as LN.
    expect([1, 2, 3, 0, 4, undefined].map(beatorajaLnModeIndex)).toEqual([0, 1, 2, 0, 0, 0]);
  });
});

describe('beatorajaDifficultyOps / beatorajaJudgeRankOp', () => {
  it('lights the LEVEL and DIFFICULTY ops of a difficulty, and the judge rank op', () => {
    expect(beatorajaDifficultyOps(1)).toEqual([BEATORAJA_OP.LEVEL_BEGINNER, BEATORAJA_OP.DIFFICULTY_BEGINNER]);
    expect(beatorajaDifficultyOps(5)).toEqual([BEATORAJA_OP.LEVEL_INSANE, BEATORAJA_OP.DIFFICULTY_INSANE]);
    expect(beatorajaDifficultyOps(undefined)).toEqual([BEATORAJA_OP.DIFFICULTY_UNDEFINED]);
    expect([0, 1, 2, 3, 4, undefined].map(beatorajaJudgeRankOp)).toEqual([
      BEATORAJA_OP.JUDGE_VERYHARD,
      BEATORAJA_OP.JUDGE_HARD,
      BEATORAJA_OP.JUDGE_NORMAL,
      BEATORAJA_OP.JUDGE_EASY,
      BEATORAJA_OP.JUDGE_VERYEASY,
      BEATORAJA_OP.JUDGE_NORMAL,
    ]);
  });
});

describe('resolveBeatorajaSelectBarOps', () => {
  const fixed = [
    BEATORAJA_OP.LOADED,
    BEATORAJA_OP.OFFLINE,
    BEATORAJA_OP.REPLAY_OFF,
    BEATORAJA_OP.DISABLE_SAVE_SCORE,
    BEATORAJA_OP.NO_SAVE_CLEAR,
    BEATORAJA_OP.BGA_ON,
  ];

  it('lights a chart bar with its key mode, traits, difficulty, judge rank and lamp', () => {
    expect(resolveBeatorajaSelectBarOps(input(SONG_BAR, { lampOp: BEATORAJA_OP.CLEAR_LAMP_HARD }))).toEqual([
      ...fixed,
      BEATORAJA_OP.SONGBAR,
      BEATORAJA_OP.PLAYABLEBAR,
      BEATORAJA_OP.KEYSONG_14K,
      BEATORAJA_OP.HAS_LN,
      BEATORAJA_OP.HAS_BPMCHANGE,
      BEATORAJA_OP.HAS_BPMSTOP,
      BEATORAJA_OP.NO_BGA,
      BEATORAJA_OP.NO_RANDOMSEQUENCE,
      BEATORAJA_OP.HAS_STAGEFILE,
      BEATORAJA_OP.LEVEL_HYPER,
      BEATORAJA_OP.DIFFICULTY_HYPER,
      BEATORAJA_OP.JUDGE_HARD,
      BEATORAJA_OP.CLEAR_LAMP_HARD,
    ]);
    expect(resolveBeatorajaSelectBarOps(input(SONG_BAR)).at(-1)).toBe(BEATORAJA_OP.CLEAR_LAMP_NOPLAY);
  });

  it('lights a folder bar and a course bar', () => {
    expect(resolveBeatorajaSelectBarOps(input(FOLDER_BAR))).toEqual([...fixed, BEATORAJA_OP.FOLDERBAR]);
    expect(resolveBeatorajaSelectBarOps(input(COURSE_BAR))).toEqual([
      ...fixed,
      BEATORAJA_OP.GRADEBAR,
      BEATORAJA_OP.GRADEBAR_MIRROR,
      BEATORAJA_OP.CLEAR_LAMP_NOPLAY,
    ]);
    expect(resolveBeatorajaSelectBarOps(input(undefined))).toEqual([]);
  });
});

describe('resolveBeatorajaSelectText', () => {
  it("reads a chart bar's song texts, the folder it sits in and the search text", () => {
    const bar = input(SONG_BAR);
    expect(resolveBeatorajaSelectText(BEATORAJA_TEXT.TITLE, bar)).toBe('Song');
    expect(resolveBeatorajaSelectText(BEATORAJA_TEXT.FULLTITLE, bar)).toBe('Song [HYPER]');
    expect(resolveBeatorajaSelectText(BEATORAJA_TEXT.FULLARTIST, bar)).toBe('Artist obj: X');
    expect(resolveBeatorajaSelectText(BEATORAJA_TEXT.GENRE, bar)).toBe('TECHNO');
    expect(resolveBeatorajaSelectText(BEATORAJA_TEXT.DIRECTORY, bar)).toBe('Pack');
    expect(resolveBeatorajaSelectText(BEATORAJA_TEXT.SEARCHWORD, bar)).toBe('son');
    expect(resolveBeatorajaSelectText(BEATORAJA_TEXT.TABLE_FULL, bar)).toBe('');
    expect(resolveBeatorajaSelectText(BEATORAJA_TEXT.SKIN_NAME, bar)).toBe('Select');
    expect(resolveBeatorajaSelectText(BEATORAJA_TEXT.RIVAL, bar)).toBeUndefined();
  });

  it("reads a folder bar's label as its title and empty song texts", () => {
    const bar = input(FOLDER_BAR, { folderLabel: '' });
    expect(resolveBeatorajaSelectText(BEATORAJA_TEXT.TITLE, bar)).toBe('Folder');
    expect(resolveBeatorajaSelectText(BEATORAJA_TEXT.FULLTITLE, bar)).toBe('Folder');
    expect(resolveBeatorajaSelectText(BEATORAJA_TEXT.SUBTITLE, bar)).toBe('');
    expect(resolveBeatorajaSelectText(BEATORAJA_TEXT.SUBARTIST, bar)).toBe('');
    expect(resolveBeatorajaSelectText(BEATORAJA_TEXT.DIRECTORY, bar)).toBe('');
  });

  it("names a course bar's stages, marking the ones the library lacks", () => {
    const bar = input(COURSE_BAR);
    expect(resolveBeatorajaSelectText(BEATORAJA_TEXT.COURSE1_TITLE, bar)).toBe('Song');
    expect(resolveBeatorajaSelectText(BEATORAJA_TEXT.COURSE1_TITLE + 1, bar)).toBe('(no song) Two');
    expect(resolveBeatorajaSelectText(BEATORAJA_TEXT.COURSE1_TITLE + 2, bar)).toBe('');
    expect(resolveBeatorajaSelectText(BEATORAJA_TEXT.TITLE, bar)).toBe('');
    expect(resolveBeatorajaSelectText(BEATORAJA_TEXT.DIRECTORY, bar)).toBe('Pack');
  });
});

describe('resolveBeatorajaSelectNumber', () => {
  it("reads a chart bar's facts", () => {
    const bar = input(SONG_BAR);
    const read = (id: number): number | undefined => resolveBeatorajaSelectNumber(id, bar);
    expect(read(BEATORAJA_NUM.BMS_TOTAL)).toBe(312);
    expect(
      [
        BEATORAJA_NUM.TOTALNOTE_NORMAL,
        BEATORAJA_NUM.TOTALNOTE_LN,
        BEATORAJA_NUM.TOTALNOTE_SCRATCH,
        BEATORAJA_NUM.TOTALNOTE_BSS,
      ].map(read),
    ).toEqual([600, 100, 70, 7]);
    expect(
      [
        BEATORAJA_NUM.DENSITY_PEAK,
        BEATORAJA_NUM.DENSITY_PEAK_AFTERDOT,
        BEATORAJA_NUM.DENSITY_END,
        BEATORAJA_NUM.DENSITY_END_AFTERDOT,
        BEATORAJA_NUM.DENSITY_AVERAGE,
        BEATORAJA_NUM.DENSITY_AVERAGE_AFTERDOT,
      ].map(read),
    ).toEqual([21, 4, 9, 0, 6, 5]);
    expect(read(BEATORAJA_NUM.TOTALNOTES)).toBe(777);
    expect(read(BEATORAJA_NUM.TOTALNOTES_LIVE)).toBe(777);
    expect(read(BEATORAJA_NUM.MAINBPM)).toBe(150);
    expect(read(BEATORAJA_NUM.NOWBPM)).toBe(150);
    expect(read(BEATORAJA_NUM.MAXBPM)).toBe(300);
    expect(read(BEATORAJA_NUM.MINBPM)).toBe(75);
    expect(read(BEATORAJA_NUM.PLAYLEVEL)).toBe(9);
    expect(read(BEATORAJA_NUM.JUDGETIMING)).toBe(-12);
    expect(read(BEATORAJA_NUM.SONGLENGTH_MINUTE)).toBe(2);
    expect(read(BEATORAJA_NUM.SONGLENGTH_SECOND)).toBe(5);
    expect(read(BEATORAJA_NUM.POINT)).toBe(0);
    expect(read(BEATORAJA_NUM.GROOVEGAUGE)).toBe(0);
    expect(read(BEATORAJA_NUM.FOLDER_TOTALSONGS)).toBeUndefined();
    expect(read(BEATORAJA_NUM.HISPEED)).toBeUndefined();
  });

  it('reads the main BPM a play shows on 92, the header BPM without one', () => {
    const read = (facts: BeatorajaSelectChartFacts, id: number): number | undefined =>
      resolveBeatorajaSelectNumber(id, input(SONG_BAR, { chart: facts }));
    expect(read({ ...FACTS, mainBpm: 180.4 }, BEATORAJA_NUM.MAINBPM)).toBe(180);
    // The header BPM stays on the current-BPM number.
    expect(read({ ...FACTS, mainBpm: 180.4 }, BEATORAJA_NUM.NOWBPM)).toBe(150);
    expect(read(FACTS, BEATORAJA_NUM.MAINBPM)).toBe(150);
    expect(read({ ...FACTS, mainBpm: 0 }, BEATORAJA_NUM.MAINBPM)).toBe(150);
  });

  it('reads the folder bar count and the clock on any bar, the chart numbers on a chart bar only', () => {
    const wallClock = { year: 2026, month: 1, day: 2, hour: 3, minute: 4, second: 5 };
    expect(resolveBeatorajaSelectNumber(BEATORAJA_NUM.FOLDER_TOTALSONGS, input(FOLDER_BAR))).toBe(2);
    expect(resolveBeatorajaSelectNumber(BEATORAJA_NUM.TIME_SECOND, input(FOLDER_BAR, { wallClock }))).toBe(5);
    expect(resolveBeatorajaSelectNumber(BEATORAJA_NUM.TIME_YEAR, input(undefined, { wallClock }))).toBe(2026);
    expect(resolveBeatorajaSelectNumber(BEATORAJA_NUM.TOTALNOTES, input(FOLDER_BAR))).toBeUndefined();
    expect(resolveBeatorajaSelectNumber(BEATORAJA_NUM.PLAYLEVEL, input(COURSE_BAR))).toBeUndefined();
    // A chart without facts or a readable level hides those numbers.
    const bare = input({ kind: 'chart', chart: { ...SONG, playLevel: 'x', bpm: undefined } }, { chart: undefined });
    expect(resolveBeatorajaSelectNumber(BEATORAJA_NUM.PLAYLEVEL, bare)).toBeUndefined();
    expect(resolveBeatorajaSelectNumber(BEATORAJA_NUM.MAINBPM, bare)).toBeUndefined();
    expect(resolveBeatorajaSelectNumber(BEATORAJA_NUM.BMS_TOTAL, bare)).toBeUndefined();
    expect(resolveBeatorajaSelectNumber(BEATORAJA_NUM.SONGLENGTH_MINUTE, bare)).toBeUndefined();
  });
});

describe('resolveBeatorajaSelectRefValue / resolveBeatorajaSelectSliderValue', () => {
  it('picks the MODE, SORT and LNMODE images and NO PLAY for the lamp', () => {
    const bar = input(SONG_BAR);
    expect(resolveBeatorajaSelectRefValue(BEATORAJA_BUTTON.MODE, bar)).toBe(4);
    expect(resolveBeatorajaSelectRefValue(BEATORAJA_BUTTON.SORT, bar)).toBe(5);
    expect(resolveBeatorajaSelectRefValue(BEATORAJA_BUTTON.LNMODE, bar)).toBe(1);
    expect(resolveBeatorajaSelectRefValue(BEATORAJA_BUTTON.LNMODE, input(SONG_BAR, { lnMode: 2 }))).toBe(2);
    expect(resolveBeatorajaSelectRefValue(BEATORAJA_BUTTON.LNMODE, input(FOLDER_BAR))).toBe(0);
    expect(resolveBeatorajaSelectRefValue(BEATORAJA_NUM.CLEAR, bar)).toBe(0);
    expect(resolveBeatorajaSelectRefValue(999, bar)).toBe(0);
  });

  it('puts the volume sliders at full', () => {
    expect([17, 18, 19].map(resolveBeatorajaSelectSliderValue)).toEqual([1, 1, 1]);
    expect(resolveBeatorajaSelectSliderValue(4)).toBeUndefined();
  });
});

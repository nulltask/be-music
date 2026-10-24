import { DEFAULT_PLAY_OPTIONS, type LibraryEntry } from '@be-music/player-scene-model';
import { describe, expect, it } from 'vite-plus/test';
import { LR2_BUTTON, LR2_NUM, LR2_OP, LR2_SLIDER, LR2_TEXT, LR2_TIMER } from '../ids/index.ts';
import type { LR2BarBodyKind, LR2BarBodySource } from '../skin.ts';
import {
  pickLR2BarBody,
  resolveLR2BarLevel,
  resolveLR2SelectButton,
  resolveLR2SelectState,
  resolveLR2SelectTimers,
} from './select.ts';
import { makeChart, makeChartWith, makeCourse } from './test-support.ts';

const CLOCK = { year: 2026, month: 10, day: 16, hour: 9, minute: 5, second: 30 };

function chartEntry(...args: Parameters<typeof makeChartWith>): LibraryEntry {
  return { kind: 'chart', chart: makeChartWith(...args) };
}

describe('resolveLR2SelectState ops', () => {
  it('lights the base, option and no-chart ops without a focused bar', () => {
    const { ops } = resolveLR2SelectState({ options: DEFAULT_PLAY_OPTIONS });
    for (const op of [
      LR2_OP.AUTOPLAY_OFF,
      LR2_OP.OFFLINE,
      LR2_OP.EXTRA_MODE_OFF,
      LR2_OP.LOADED,
      LR2_OP.BGA_ON,
      LR2_OP.BGA_EXTEND,
      LR2_OP.SCORE_GRAPH_ON,
      LR2_OP.GAUGE_1P_NORMAL,
      LR2_OP.DIFFICULTY_FILTER_OFF,
      LR2_OP.NO_BGA,
      LR2_OP.NO_LN,
      LR2_OP.NO_TEXT,
      LR2_OP.KEYS_7,
      LR2_OP.LAMP_NO_PLAY,
      LR2_OP.DIFFICULTY_UNDEFINED,
      LR2_OP.COURSE_STAGE_DIFFICULTY,
    ]) {
      expect(ops.has(op)).toBe(true);
    }
    expect(ops.has(LR2_OP.SONG_BAR)).toBe(false);
  });

  it('lights the focused chart’s ops: its bar, key mode, features, judge rank, difficulty and lamp', () => {
    const { ops } = resolveLR2SelectState({
      focused: chartEntry({ channels: ['11', '16', '51', '03'], difficulty: 3, rank: 1 }),
      options: DEFAULT_PLAY_OPTIONS,
      record: { lamp: 'HARD' },
      readme: true,
    });
    for (const op of [
      LR2_OP.SONG_BAR,
      LR2_OP.PLAYABLE_BAR,
      LR2_OP.KEYS_5,
      LR2_OP.HAS_LN,
      LR2_OP.HAS_BPM_CHANGE,
      LR2_OP.NO_BGA,
      LR2_OP.HAS_TEXT,
      LR2_OP.JUDGE_HARD,
      LR2_OP.DIFFICULTY_HYPER,
      LR2_OP.NO_STAGEFILE,
      LR2_OP.LAMP_HARD,
    ]) {
      expect(ops.has(op)).toBe(true);
    }
    expect(ops.has(LR2_OP.LAMP_NO_PLAY)).toBe(false);
  });

  it('lights a course bar’s ops: the course and its kind, its lamp and its stages’ difficulties', () => {
    const course = makeCourse({ stages: [{ title: 'a', chart: makeChartWith({ difficulty: 4 }) }] });
    const { ops } = resolveLR2SelectState({
      focused: { kind: 'course', course },
      options: DEFAULT_PLAY_OPTIONS,
      record: { lamp: 'NORMAL' },
    });
    for (const op of [
      LR2_OP.COURSE_BAR,
      LR2_OP.PLAYABLE_BAR,
      LR2_OP.COURSE,
      LR2_OP.COURSE_GRADE,
      LR2_OP.LAMP_NORMAL,
      LR2_OP.COURSE_STAGE_DIFFICULTY + 4,
      LR2_OP.COURSE_STAGE_DIFFICULTY + 10,
    ]) {
      expect(ops.has(op)).toBe(true);
    }
    expect(ops.has(LR2_OP.LAMP_NO_PLAY)).toBe(false);
    expect(
      resolveLR2SelectState({
        focused: { kind: 'course', course: { ...course, playable: false } },
        options: DEFAULT_PLAY_OPTIONS,
      }).ops.has(LR2_OP.PLAYABLE_BAR),
    ).toBe(false);
  });

  it('lights the play options’ ops and the skin’s custom options', () => {
    const { ops } = resolveLR2SelectState({
      options: {
        ...DEFAULT_PLAY_OPTIONS,
        bga: 'AUTOPLAY_ONLY',
        bgaSize: 'NORMAL',
        scoreGraph: false,
        autoScratch1P: true,
        gauge1P: 'HARD',
        gauge2P: 'DEATH',
        difficultyFilter: 'HYPER',
      },
      customOps: [901, 915],
    });
    for (const op of [
      LR2_OP.BGA_OFF,
      LR2_OP.BGA_NORMAL,
      LR2_OP.SCORE_GRAPH_OFF,
      LR2_OP.AUTO_SCRATCH_1P_ON,
      LR2_OP.AUTO_SCRATCH_2P_OFF,
      LR2_OP.GAUGE_1P_RED,
      LR2_OP.GAUGE_2P_RED,
      LR2_OP.DIFFICULTY_FILTER_ON,
      901,
      915,
    ]) {
      expect(ops.has(op)).toBe(true);
    }
  });

  it('lights LR2’s panel ops: 20 while no panel is open, 21-29 while panel 1-9 is, never the bar ops', () => {
    const closed = resolveLR2SelectState({ options: DEFAULT_PLAY_OPTIONS, openPanels: [] }).ops;
    expect(closed.has(LR2_OP.NO_PANEL)).toBe(true);
    expect(closed.has(LR2_OP.PANEL1)).toBe(false);
    const open = resolveLR2SelectState({ options: DEFAULT_PLAY_OPTIONS, openPanels: [1, 3] }).ops;
    expect(open.has(LR2_OP.PANEL1)).toBe(true);
    expect(open.has(LR2_OP.PANEL3)).toBe(true);
    expect(open.has(LR2_OP.NO_PANEL)).toBe(false);
    // Opening panel 1 or 3 lights neither the folder-bar op (1) nor the course-bar op (3).
    expect(open.has(LR2_OP.FOLDER_BAR)).toBe(false);
    expect(open.has(LR2_OP.COURSE_BAR)).toBe(false);
  });

  it('lights op 1 on a folder bar, and only there', () => {
    const folder: LibraryEntry = { kind: 'folder', folder: { label: 'Folder', charts: [] } };
    const onFolder = resolveLR2SelectState({ focused: folder, options: DEFAULT_PLAY_OPTIONS }).ops;
    expect(onFolder.has(LR2_OP.FOLDER_BAR)).toBe(true);
    expect(onFolder.has(LR2_OP.SONG_BAR)).toBe(false);
    expect(onFolder.has(LR2_OP.PLAYABLE_BAR)).toBe(false);
    const onSong = resolveLR2SelectState({ focused: chartEntry({}), options: DEFAULT_PLAY_OPTIONS }).ops;
    expect(onSong.has(LR2_OP.FOLDER_BAR)).toBe(false);
    expect(onSong.has(LR2_OP.SONG_BAR)).toBe(true);
    expect(resolveLR2SelectState({ options: DEFAULT_PLAY_OPTIONS }).ops.has(LR2_OP.FOLDER_BAR)).toBe(false);
  });

  it('lights the course maker’s ops', () => {
    const making = resolveLR2SelectState({
      options: DEFAULT_PLAY_OPTIONS,
      courseMaker: { draft: { kind: 'grade', name: '', stages: [] }, defaultConnection: 'fade' },
    });
    expect(making.ops.has(LR2_OP.COURSE_MAKING)).toBe(true);
    expect(making.ops.has(LR2_OP.COURSE_SONGS_ADDED)).toBe(true);
    const idle = resolveLR2SelectState({ options: DEFAULT_PLAY_OPTIONS, courseMaker: { defaultConnection: 'fade' } });
    expect(idle.ops.has(LR2_OP.COURSE_NOT_MAKING)).toBe(true);
  });
});

describe('resolveLR2SelectState numbers', () => {
  it('reads the clock, the frame rate, the options and the player totals', () => {
    const state = resolveLR2SelectState({
      options: { ...DEFAULT_PLAY_OPTIONS, hiSpeed: 2.3 },
      clock: CLOCK,
      fps: 60,
    });
    expect(state.number(LR2_NUM.YEAR)).toBe(2026);
    expect(state.number(LR2_NUM.MONTH)).toBe(10);
    expect(state.number(LR2_NUM.SECOND)).toBe(30);
    expect(state.number(LR2_NUM.FPS)).toBe(60);
    expect(state.number(LR2_NUM.HISPEED_1P)).toBe(230);
    expect(state.number(LR2_NUM.HISPEED_2P)).toBe(230);
    expect(state.number(LR2_NUM.TOTAL_PLAY_COUNT)).toBe(0);
    expect(state.number(LR2_NUM.TOTAL_NOTES)).toBeUndefined();
    expect(resolveLR2SelectState({ options: DEFAULT_PLAY_OPTIONS }).number(LR2_NUM.YEAR)).toBeUndefined();
  });

  it('reads the focused chart: its notes, BPM range, level under its difficulty and start BPM', () => {
    const state = resolveLR2SelectState({
      focused: {
        kind: 'chart',
        chart: makeChartWith({ difficulty: 2 }, { totalNotes: 500, playLevel: '7', bpm: 150 }),
      },
      options: DEFAULT_PLAY_OPTIONS,
      bpmRange: { min: 74.6, max: 300.4 },
    });
    expect(state.number(LR2_NUM.TOTAL_NOTES)).toBe(500);
    expect(state.number(LR2_NUM.EXSCORE_MAX)).toBe(1000);
    expect(state.number(LR2_NUM.BEST_EXSCORE)).toBe(0);
    expect(state.number(LR2_NUM.MIN_BPM)).toBe(75);
    expect(state.number(LR2_NUM.MAX_BPM)).toBe(300);
    expect(state.number(LR2_NUM.FOLDER_LEVEL_NORMAL)).toBe(7);
    expect(state.number(LR2_NUM.FOLDER_LEVEL_HYPER)).toBeUndefined();
    expect(state.number(LR2_NUM.BPM)).toBe(150);
    expect(state.number(LR2_NUM.IR_RANK)).toBeUndefined();
  });

  it('reads a course bar’s stage levels', () => {
    const course = makeCourse({ stages: [{ title: 'a', chart: makeChart({ playLevel: 12 }) }] });
    const state = resolveLR2SelectState({ focused: { kind: 'course', course }, options: DEFAULT_PLAY_OPTIONS });
    expect(state.number(LR2_NUM.COURSE_STAGE1_LEVEL)).toBe(12);
  });
});

describe('resolveLR2SelectState texts', () => {
  it('reads the search word, the player and the option panel', () => {
    const state = resolveLR2SelectState({
      focused: chartEntry({ channels: ['11', '18'] }),
      options: { ...DEFAULT_PLAY_OPTIONS, bga: 'AUTOPLAY_ONLY', autoScratch1P: true, laneCover: false },
      searchText: 'abc',
    });
    expect(state.text(LR2_TEXT.SEARCH_WORD)).toBe('abc');
    expect(state.text(LR2_TEXT.RIVAL)).toBe('NO TARGET');
    expect(state.text(LR2_TEXT.OPTION_PLAY_STYLE)).toBe('7KEYS');
    expect(state.text(LR2_TEXT.OPTION_BGA)).toBe('AUTOPLAY');
    expect(state.text(LR2_TEXT.OPTION_ASSIST_1P)).toBe('AUTOSCRATCH');
    expect(state.text(LR2_TEXT.OPTION_LANE_COVER)).toBe('OFF');
    expect(state.text(LR2_TEXT.OPTION_COLOR_DEPTH)).toBe('32 BIT');
    expect(resolveLR2SelectState({ options: DEFAULT_PLAY_OPTIONS }).text(LR2_TEXT.OPTION_PLAY_STYLE)).toBe('SINGLE');
  });

  it('reads the focused chart’s texts', () => {
    const state = resolveLR2SelectState({
      focused: chartEntry({ difficulty: 5 }, { title: 'T', subtitle: 'S', artist: 'A', genre: 'G', playLevel: 12 }),
      options: DEFAULT_PLAY_OPTIONS,
    });
    expect(state.text(LR2_TEXT.TITLE)).toBe('T');
    expect(state.text(LR2_TEXT.FULL_TITLE_ALT)).toBe('T S');
    expect(state.text(LR2_TEXT.GENRE)).toBe('G');
    expect(state.text(LR2_TEXT.ARTIST)).toBe('A');
    expect(state.text(LR2_TEXT.DIFFICULTY)).toBe('5');
    expect(state.text(LR2_TEXT.INSANE_LEVEL)).toBe('12');
    expect(state.text(LR2_TEXT.TAG)).toBe('');
    expect(state.text(LR2_TEXT.COURSE_CONNECTION1)).toBe('DISABLE');
  });

  it('reads the course bar, the course being made and the default connection', () => {
    const course = makeCourse({}, ['first', 'second']);
    const onCourse = resolveLR2SelectState({ focused: { kind: 'course', course }, options: DEFAULT_PLAY_OPTIONS });
    expect(onCourse.text(LR2_TEXT.COURSE_TITLE)).toBe('Dan');
    expect(onCourse.text(LR2_TEXT.COURSE_STAGE2_TITLE)).toBe('second');
    expect(onCourse.text(LR2_TEXT.TITLE)).toBeUndefined();
    const making = resolveLR2SelectState({
      focused: { kind: 'course', course },
      options: DEFAULT_PLAY_OPTIONS,
      courseMaker: {
        draft: { kind: 'nonstop', name: '', stages: [{ md5: 'x', keyMode: 7, title: 'picked' }] },
        defaultConnection: 'cut',
        namePrompt: 'Type a name',
      },
    });
    expect(making.text(LR2_TEXT.COURSE_TITLE)).toBe('Type a name');
    expect(making.text(LR2_TEXT.COURSE_STAGE1_TITLE)).toBe('picked');
    expect(making.text(LR2_TEXT.COURSE_DEFAULT_CONNECTION)).toBe('CUT');
  });
});

describe('resolveLR2SelectState sliders and buttons', () => {
  it('places the list position, hi-speed and lane cover sliders', () => {
    const state = resolveLR2SelectState({
      options: { ...DEFAULT_PLAY_OPTIONS, hiSpeed: 0.1, shutter: 0.4 },
      listPosition: 0.25,
    });
    expect(state.slider(LR2_SLIDER.SELECT_POSITION)).toBe(0.25);
    expect(state.slider(LR2_SLIDER.HISPEED_1P)).toBe(0);
    expect(state.slider(LR2_SLIDER.LANE_COVER_2P)).toBe(0.4);
    expect(state.slider(LR2_SLIDER.PLAY_PROGRESS)).toBeUndefined();
  });

  it('draws each option button’s cell in its LR2 cycle order', () => {
    const state = resolveLR2SelectState({
      options: {
        ...DEFAULT_PLAY_OPTIONS,
        bga: 'AUTOPLAY_ONLY',
        gauge1P: 'HARD',
        difficultyFilter: 'HYPER',
        dpFlip: true,
      },
    });
    expect(state.button(LR2_BUTTON.BGA)).toBe(2);
    expect(state.button(LR2_BUTTON.GAUGE_1P)).toBe(1);
    expect(state.button(LR2_BUTTON.DIFFICULTY_FILTER)).toBe(3);
    expect(state.button(LR2_BUTTON.DIFFICULTY_FILTER_HYPER)).toBe(1);
    expect(state.button(LR2_BUTTON.DIFFICULTY_FILTER_ALL)).toBe(0);
    expect(state.button(LR2_BUTTON.FLIP)).toBe(1);
    expect(state.button(LR2_BUTTON.PLAY)).toBeUndefined();
  });

  it('draws the course maker’s connection buttons', () => {
    const course = makeCourse();
    const nonstop = {
      ...course,
      definition: { ...course.definition, kind: 'nonstop' as const, connections: ['cut' as const] },
    };
    const state = resolveLR2SelectState({
      focused: { kind: 'course', course: nonstop },
      options: DEFAULT_PLAY_OPTIONS,
      courseMaker: { defaultConnection: 'blank1' },
    });
    expect(state.button(LR2_BUTTON.COURSE_CONNECTION1)).toBe(2);
    expect(state.button(LR2_BUTTON.COURSE_DEFAULT_CONNECTION)).toBe(4);
  });
});

describe('resolveLR2SelectButton', () => {
  it('maps the panel, hi-speed, option and play buttons to their actions', () => {
    expect(resolveLR2SelectButton(LR2_BUTTON.PANEL3)).toEqual({ kind: 'panel', panel: 3 });
    expect(resolveLR2SelectButton(LR2_BUTTON.HISPEED_2P)).toEqual({ kind: 'hi-speed', side: '2P' });
    expect(resolveLR2SelectButton(LR2_BUTTON.SORT)).toEqual({ kind: 'cycle-option', option: 'sort' });
    expect(resolveLR2SelectButton(LR2_BUTTON.EFFECT_2P)).toEqual({ kind: 'cycle-option', option: 'hiddenSudden2P' });
    expect(resolveLR2SelectButton(LR2_BUTTON.DIFFICULTY_FILTER_INSANE)).toEqual({
      kind: 'set-difficulty-filter',
      value: 'INSANE',
    });
    expect(resolveLR2SelectButton(LR2_BUTTON.AUTOPLAY)).toEqual({ kind: 'autoplay' });
    expect(resolveLR2SelectButton(LR2_BUTTON.READ_TEXT)).toEqual({ kind: 'read-text' });
  });

  it('leaves the course maker’s and unknown buttons to others', () => {
    expect(resolveLR2SelectButton(LR2_BUTTON.COURSE_FINISH)).toBeUndefined();
    expect(resolveLR2SelectButton(999)).toBeUndefined();
  });
});

describe('resolveLR2SelectTimers', () => {
  it('starts the scene and bar-change timers as the screen appears', () => {
    expect(resolveLR2SelectTimers({ kind: 'scene-start', at: 5 })).toEqual({
      start: new Map([
        [LR2_TIMER.SCENE_START, 5],
        [LR2_TIMER.SONG_BAR_CHANGE, 5],
      ]),
      stop: [],
    });
  });

  it('starts the bar timers and the direction’s timer as the cursor moves', () => {
    expect([...resolveLR2SelectTimers({ kind: 'cursor', delta: -1, at: 9 }).start.keys()]).toEqual([10, 11, 12]);
    expect([...resolveLR2SelectTimers({ kind: 'cursor', delta: 2, at: 9 }).start.keys()]).toEqual([10, 11, 13]);
  });

  it('runs a panel’s open timer while it is open and its close timer from when it closes', () => {
    expect(resolveLR2SelectTimers({ kind: 'panel', panel: 2, open: true, at: 1 })).toEqual({
      start: new Map([[LR2_TIMER.PANEL2_OPEN, 1]]),
      stop: [LR2_TIMER.PANEL2_CLOSE],
    });
    expect(resolveLR2SelectTimers({ kind: 'panel', panel: 2, open: false, at: 1 })).toEqual({
      start: new Map([[LR2_TIMER.PANEL2_CLOSE, 1]]),
      stop: [LR2_TIMER.PANEL2_OPEN],
    });
  });

  it('starts timer 17 as making a course starts and 18 as it ends', () => {
    expect(resolveLR2SelectTimers({ kind: 'course-making', making: true, at: 3 }).start.get(17)).toBe(3);
    expect(resolveLR2SelectTimers({ kind: 'course-making', making: false, at: 3 }).stop).toEqual([17]);
  });
});

function bodies(...kinds: LR2BarBodyKind[]): LR2BarBodySource[] {
  return kinds.map((kind) => ({ kind, source: { imagePath: `${kind}.png` } }) as unknown as LR2BarBodySource);
}

function courseEntry(extra: Partial<ReturnType<typeof makeCourse>> = {}): LibraryEntry {
  return { kind: 'course', course: makeCourse(extra) };
}

describe('pickLR2BarBody', () => {
  const all = bodies('song', 'folder', 'courseFolder', 'courseCreate', 'course', 'randomCourse');
  const random = {} as NonNullable<ReturnType<typeof makeCourse>['random']>;

  it('takes LR2’s NEW COURSE body (7) and random-course body (9)', () => {
    expect(pickLR2BarBody(all, courseEntry({ newCourse: true }))?.kind).toBe('courseCreate');
    expect(pickLR2BarBody(all, courseEntry({ random }))?.kind).toBe('randomCourse');
    expect(pickLR2BarBody(all, courseEntry())?.kind).toBe('course');
  });

  it('falls back to the course body (8), then the song body', () => {
    const plain = bodies('song', 'course');
    expect(pickLR2BarBody(plain, courseEntry({ newCourse: true }))?.kind).toBe('course');
    expect(pickLR2BarBody(plain, courseEntry({ random }))?.kind).toBe('course');
    expect(pickLR2BarBody(bodies('song'), courseEntry({ newCourse: true }))?.kind).toBe('song');
  });

  it('keeps the folder bodies and draws a body for an empty slot', () => {
    const courseFolder: LibraryEntry = { kind: 'folder', folder: { label: 'f', charts: [], courses: [] } };
    expect(pickLR2BarBody(all, courseFolder)?.kind).toBe('courseFolder');
    expect(pickLR2BarBody(bodies('song', 'folder'), courseFolder)?.kind).toBe('folder');
    expect(pickLR2BarBody(all, undefined)?.kind).toBe('song');
    expect(pickLR2BarBody([], undefined)).toBeUndefined();
  });
});

describe('resolveLR2BarLevel', () => {
  it('draws the play level in the level kind of the chart’s difficulty', () => {
    expect(resolveLR2BarLevel(makeChartWith({ difficulty: 4 }, { playLevel: '11' }))).toEqual({
      kind: 'another',
      level: 11,
    });
    expect(resolveLR2BarLevel(makeChart({ playLevel: 3 }))).toEqual({ kind: 'undefined', level: 3 });
    expect(resolveLR2BarLevel(makeChart({ playLevel: '?' }))).toBeUndefined();
  });
});

it('keeps LR2 HS-FIX sprite cells in range when START is selected externally', () => {
  const state = resolveLR2SelectState({ options: { ...DEFAULT_PLAY_OPTIONS, hsFix: 'STARTBPM' } });
  expect(state.button(LR2_BUTTON.HS_FIX)).toBe(0);
});

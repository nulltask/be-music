import { describe, expect, it } from 'vite-plus/test';
import {
  LR2_BAR_BODY,
  LR2_BAR_BODY_KINDS,
  LR2_BAR_LAMP,
  LR2_BAR_LAMP_KINDS,
  LR2_BUTTON,
  LR2_GR,
  LR2_LANE_INDEX_MAX,
  LR2_LANE_TIMER_BANK_SIZE,
  LR2_NUM,
  LR2_OP,
  LR2_SLIDER,
  LR2_TEXT,
  LR2_TIMER,
} from './index.ts';

const TABLES = { LR2_OP, LR2_TIMER, LR2_NUM, LR2_TEXT, LR2_BUTTON, LR2_SLIDER, LR2_BAR_BODY, LR2_BAR_LAMP, LR2_GR };

/** The ids `[first, first + count)`. */
function range(first: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => first + index);
}

describe('LR2 id tables', () => {
  it.each(Object.entries(TABLES))('%s names each id once', (_name, table) => {
    const values = Object.values(table);
    expect(new Set(values).size).toBe(values.length);
    for (const value of values) expect(Number.isInteger(value) && value >= 0).toBe(true);
  });

  it('names no other op inside the course-maker and course-stage ranges', () => {
    const ops = Object.values(LR2_OP);
    expect(ops.filter((op) => op >= 580 && op <= 599)).toEqual([LR2_OP.COURSE_STAGES_OVER, LR2_OP.COURSE_SONGS_ADDED]);
    expect(ops.filter((op) => op >= 700 && op <= 745)).toEqual([LR2_OP.COURSE_STAGE_DIFFICULTY]);
  });

  it('names no other timer inside a lane bank', () => {
    const banks = [
      LR2_TIMER.BOMB_1P,
      LR2_TIMER.BOMB_2P,
      LR2_TIMER.LN_HOLD_1P,
      LR2_TIMER.LN_HOLD_2P,
      LR2_TIMER.KEY_ON_1P,
      LR2_TIMER.KEY_ON_2P,
      LR2_TIMER.KEY_OFF_1P,
      LR2_TIMER.KEY_OFF_2P,
    ];
    for (const base of banks) {
      const inside = Object.values(LR2_TIMER).filter(
        (timer) => timer > base && timer < base + LR2_LANE_TIMER_BANK_SIZE,
      );
      expect(inside).toEqual([]);
    }
    expect(LR2_LANE_INDEX_MAX).toBe(LR2_LANE_TIMER_BANK_SIZE - 1);
  });
});

describe('LR2_OP anchors', () => {
  it('numbers the panel ops as LR2 lights them: 20 for none open, 21-29 for panels 1-9', () => {
    expect(LR2_OP.NO_PANEL).toBe(20);
    expect([
      LR2_OP.PANEL1,
      LR2_OP.PANEL2,
      LR2_OP.PANEL3,
      LR2_OP.PANEL4,
      LR2_OP.PANEL5,
      LR2_OP.PANEL6,
      LR2_OP.PANEL7,
      LR2_OP.PANEL8,
      LR2_OP.PANEL9,
    ]).toEqual(range(21, 9));
  });

  it('numbers the course ops as LR2 lights them (OpenLR2 L5403-L5444, the binary for 292 / 293)', () => {
    expect([LR2_OP.COURSE, LR2_OP.COURSE_NONSTOP, LR2_OP.COURSE_EXPERT, LR2_OP.COURSE_GRADE]).toEqual([
      290, 291, 292, 293,
    ]);
    expect([
      LR2_OP.COURSE_STAGE1,
      LR2_OP.COURSE_STAGE2,
      LR2_OP.COURSE_STAGE3,
      LR2_OP.COURSE_STAGE4,
      LR2_OP.COURSE_STAGE5,
      LR2_OP.COURSE_STAGE6,
      LR2_OP.COURSE_STAGE7,
      LR2_OP.COURSE_STAGE8,
      LR2_OP.COURSE_STAGE9,
      LR2_OP.COURSE_STAGE_FINAL,
    ]).toEqual(range(280, 10));
  });

  it('numbers the course-maker and course-stage difficulty ranges', () => {
    expect([LR2_OP.COURSE_MAKING, LR2_OP.COURSE_NOT_MAKING]).toEqual([571, 572]);
    expect(LR2_OP.COURSE_STAGES_OVER).toBe(580);
    expect(LR2_OP.COURSE_STAGES_OVER + 9).toBe(589);
    expect(LR2_OP.COURSE_SONGS_ADDED).toBe(590);
    expect(LR2_OP.COURSE_SONGS_ADDED + 9).toBe(599);
    // Stage i + 1 (i = 0-4) by `#DIFFICULTY` 0-5.
    expect(LR2_OP.COURSE_STAGE_DIFFICULTY).toBe(700);
    expect(LR2_OP.COURSE_STAGE_DIFFICULTY + 10 * 4 + 5).toBe(745);
  });

  it('keeps the lamp ops 100-105 in the bar-lamp order', () => {
    const lamps = [
      LR2_BAR_LAMP.NO_PLAY,
      LR2_BAR_LAMP.FAILED,
      LR2_BAR_LAMP.EASY,
      LR2_BAR_LAMP.CLEAR,
      LR2_BAR_LAMP.HARD,
      LR2_BAR_LAMP.FULL_COMBO,
    ];
    expect([
      LR2_OP.LAMP_NO_PLAY,
      LR2_OP.LAMP_FAILED,
      LR2_OP.LAMP_EASY,
      LR2_OP.LAMP_NORMAL,
      LR2_OP.LAMP_HARD,
      LR2_OP.LAMP_FULL_COMBO,
    ]).toEqual(lamps.map((lamp) => 100 + lamp));
  });

  it('numbers the chart ops by `#DIFFICULTY`, key mode and `#RANK`', () => {
    expect([
      LR2_OP.DIFFICULTY_UNDEFINED,
      LR2_OP.DIFFICULTY_BEGINNER,
      LR2_OP.DIFFICULTY_NORMAL,
      LR2_OP.DIFFICULTY_HYPER,
      LR2_OP.DIFFICULTY_ANOTHER,
      LR2_OP.DIFFICULTY_INSANE,
    ]).toEqual(range(150, 6));
    expect([LR2_OP.KEYS_7, LR2_OP.KEYS_5, LR2_OP.KEYS_14, LR2_OP.KEYS_10, LR2_OP.KEYS_9]).toEqual(range(160, 5));
    expect([LR2_OP.JUDGE_VERY_HARD, LR2_OP.JUDGE_HARD, LR2_OP.JUDGE_NORMAL, LR2_OP.JUDGE_EASY]).toEqual(range(180, 4));
  });

  it('numbers the gauge ranges 230-240 and the result ranks', () => {
    expect(LR2_OP.GAUGE_1P_0_9).toBe(230);
    expect(LR2_OP.GAUGE_1P_100).toBe(240);
    expect([LR2_OP.RESULT_RANK_AAA, LR2_OP.RESULT_RANK_F, LR2_OP.RESULT_RANK_0]).toEqual([300, 307, 308]);
    expect([LR2_OP.PREVIOUS_RANK_AAA, LR2_OP.PREVIOUS_RANK_0]).toEqual([320, 328]);
    expect([LR2_OP.UPDATED_RANK_AAA, LR2_OP.UPDATED_RANK_F]).toEqual([340, 347]);
  });
});

describe('LR2_TIMER anchors', () => {
  it('numbers the scene and play timers', () => {
    expect([LR2_TIMER.SCENE_START, LR2_TIMER.START_INPUT, LR2_TIMER.FADE_OUT, LR2_TIMER.FAILED]).toEqual(range(0, 4));
    expect([LR2_TIMER.READY, LR2_TIMER.PLAY, LR2_TIMER.JUDGE_1P, LR2_TIMER.FULL_COMBO_1P]).toEqual([40, 41, 46, 48]);
    expect([LR2_TIMER.RESULT_GRAPH_START, LR2_TIMER.RESULT_GRAPH_END, LR2_TIMER.RESULT_UPDATE]).toEqual(range(150, 3));
  });

  it('numbers the panel timers 21-29 / 31-39 and the course-maker timers 17 / 18', () => {
    expect(LR2_TIMER.PANEL1_OPEN).toBe(21);
    expect(LR2_TIMER.PANEL9_OPEN).toBe(29);
    expect(LR2_TIMER.PANEL1_CLOSE).toBe(31);
    expect(LR2_TIMER.PANEL9_CLOSE).toBe(39);
    expect([LR2_TIMER.COURSE_MAKING_START, LR2_TIMER.COURSE_MAKING_END]).toEqual([17, 18]);
  });

  it('starts each lane bank at its scratch', () => {
    expect([LR2_TIMER.BOMB_1P, LR2_TIMER.BOMB_2P, LR2_TIMER.LN_HOLD_1P, LR2_TIMER.LN_HOLD_2P]).toEqual([
      50, 60, 70, 80,
    ]);
    expect([LR2_TIMER.KEY_ON_1P, LR2_TIMER.KEY_ON_2P, LR2_TIMER.KEY_OFF_1P, LR2_TIMER.KEY_OFF_2P]).toEqual([
      100, 110, 120, 130,
    ]);
  });
});

describe('LR2 course numbers, texts and buttons', () => {
  it('numbers the stage levels 250-259', () => {
    expect(LR2_NUM.COURSE_STAGE1_LEVEL).toBe(250);
    expect(LR2_NUM.COURSE_STAGE10_LEVEL).toBe(259);
  });

  it('numbers the course texts (OpenLR2 L8400-L8420)', () => {
    expect([LR2_TEXT.COURSE_STAGE1_TITLE, LR2_TEXT.COURSE_STAGE5_TITLE]).toEqual([150, 154]);
    expect([LR2_TEXT.COURSE_STAGE1_SUBTITLE, LR2_TEXT.COURSE_STAGE5_SUBTITLE]).toEqual([160, 164]);
    expect([LR2_TEXT.COURSE_TITLE, LR2_TEXT.COURSE_CONNECTION1, LR2_TEXT.COURSE_CONNECTION9]).toEqual([170, 171, 179]);
    expect(LR2_TEXT.COURSE_DEFAULT_CONNECTION).toBe(198);
  });

  it('numbers the course-maker buttons (OpenLR2 L11063-L11137)', () => {
    expect([LR2_BUTTON.COURSE_FINISH, LR2_BUTTON.COURSE_CANCEL, LR2_BUTTON.COURSE_DELETE]).toEqual([230, 231, 233]);
    expect([LR2_BUTTON.COURSE_CONNECTION1, LR2_BUTTON.COURSE_CONNECTION9]).toEqual([240, 248]);
    expect(LR2_BUTTON.COURSE_DEFAULT_CONNECTION).toBe(268);
  });

  it('numbers the song texts after the stock skins', () => {
    expect([LR2_TEXT.TITLE, LR2_TEXT.FULL_TITLE, LR2_TEXT.ARTIST, LR2_TEXT.DIFFICULTY]).toEqual([10, 12, 14, 18]);
    expect(LR2_TEXT.TITLE_ALT - LR2_TEXT.TITLE).toBe(10);
    expect(LR2_TEXT.DIFFICULTY_ALT - LR2_TEXT.DIFFICULTY).toBe(10);
  });
});

describe('LR2 bar tables', () => {
  it('lists each bar body kind at its index', () => {
    expect(LR2_BAR_BODY_KINDS).toHaveLength(Object.keys(LR2_BAR_BODY).length);
    expect(LR2_BAR_BODY_KINDS[LR2_BAR_BODY.SONG]).toBe('song');
    expect(LR2_BAR_BODY_KINDS[LR2_BAR_BODY.COURSE_FOLDER]).toBe('courseFolder');
    expect(LR2_BAR_BODY_KINDS[LR2_BAR_BODY.COURSE_CREATE]).toBe('courseCreate');
    expect(LR2_BAR_BODY_KINDS[LR2_BAR_BODY.COURSE]).toBe('course');
    expect(LR2_BAR_BODY_KINDS[LR2_BAR_BODY.RANDOM_COURSE]).toBe('randomCourse');
  });

  it('lists each bar lamp kind at its index', () => {
    expect(LR2_BAR_LAMP_KINDS).toHaveLength(Object.keys(LR2_BAR_LAMP).length);
    expect(LR2_BAR_LAMP_KINDS[LR2_BAR_LAMP.CLEAR]).toBe('clear');
    expect(LR2_BAR_LAMP_KINDS[LR2_BAR_LAMP.FULL_COMBO]).toBe('fullcombo');
  });
});

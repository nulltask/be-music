/**
 * LR2's timers: the clocks a `#SRC_*` animation and a `#DST_*` keyframe run on (their `timer` column). A timer starts
 * when the host stamps it; an element on a timer that has not started stays hidden. beatoraja keeps these numbers.
 *
 * The lane banks (`BOMB_1P`, `KEY_ON_1P`, …) hold {@link LR2_LANE_TIMER_BANK_SIZE} timers each: the base is the scratch
 * and `base + N` key N (1-9).
 */
export const LR2_TIMER = {
  // ─── Every scene ────────────────────────────────────────────────────────────────────────────────────────────────
  /** The scene started; static elements run on it. */
  SCENE_START: 0,
  /** Input opens, `#STARTINPUT` ms after the scene starts. */
  START_INPUT: 1,
  /** The scene fades out (`#FADEOUT`). */
  FADE_OUT: 2,
  /** The play failed and the scene closes (`#CLOSE`); the stock skin's STAGE FAILED runs on it. */
  FAILED: 3,

  // ─── Select ─────────────────────────────────────────────────────────────────────────────────────────────────────
  /** The cursor moved on the bar list. */
  SONG_BAR_MOVE: 10,
  /** The selected bar changed; the stock skins slide their bars on it. */
  SONG_BAR_CHANGE: 11,
  /** The cursor moved up. */
  SONG_BAR_UP: 12,
  /** The cursor moved down. */
  SONG_BAR_DOWN: 13,
  /** Making a course started (OpenLR2 L12151). */
  COURSE_MAKING_START: 17,
  /** Making a course ended: saved or cancelled (OpenLR2 L11067, L11090). */
  COURSE_MAKING_END: 18,
  /** Panel 1 is open. Timers 21-29 run while panels 1-9 are open. */
  PANEL1_OPEN: 21,
  /** Panel 2 is open. */
  PANEL2_OPEN: 22,
  /** Panel 3 is open. */
  PANEL3_OPEN: 23,
  /** Panel 4 is open. */
  PANEL4_OPEN: 24,
  /** Panel 5 is open. */
  PANEL5_OPEN: 25,
  /** Panel 6 is open. */
  PANEL6_OPEN: 26,
  /** Panel 7 is open. */
  PANEL7_OPEN: 27,
  /** Panel 8 is open. */
  PANEL8_OPEN: 28,
  /** Panel 9 is open. */
  PANEL9_OPEN: 29,
  /** Panel 1 closed. Timers 31-39 start as panels 1-9 close. */
  PANEL1_CLOSE: 31,
  /** Panel 2 closed. */
  PANEL2_CLOSE: 32,
  /** Panel 3 closed. */
  PANEL3_CLOSE: 33,
  /** Panel 4 closed. */
  PANEL4_CLOSE: 34,
  /** Panel 5 closed. */
  PANEL5_CLOSE: 35,
  /** Panel 6 closed. */
  PANEL6_CLOSE: 36,
  /** Panel 7 closed. */
  PANEL7_CLOSE: 37,
  /** Panel 8 closed. */
  PANEL8_CLOSE: 38,
  /** Panel 9 closed. */
  PANEL9_CLOSE: 39,

  // ─── Play ───────────────────────────────────────────────────────────────────────────────────────────────────────
  /** The chart has loaded (READY), `#LOADSTART` + `#LOADEND` ms after the scene starts. */
  READY: 40,
  /** The chart starts playing (`#PLAYSTART`). */
  PLAY: 41,
  /** The 1P gauge went up. */
  GAUGE_UP_1P: 42,
  /** The 2P gauge went up. */
  GAUGE_UP_2P: 43,
  /** The 1P gauge reached 100 %; it runs while the gauge stays there. */
  GAUGE_MAX_1P: 44,
  /** The 2P gauge reached 100 %. */
  GAUGE_MAX_2P: 45,
  /** A 1P judgement; it restarts on each one (`#DST_NOWJUDGE` / `#DST_NOWCOMBO`). */
  JUDGE_1P: 46,
  /** A 2P judgement. */
  JUDGE_2P: 47,
  /** 1P reached a full combo. */
  FULL_COMBO_1P: 48,
  /** 2P reached a full combo. */
  FULL_COMBO_2P: 49,
  /** 1P bomb bank (50-59): a note on the lane was hit. */
  BOMB_1P: 50,
  /** 2P bomb bank (60-69). */
  BOMB_2P: 60,
  /** 1P long-note hold bank (70-79): runs while a long note on the lane is held. */
  LN_HOLD_1P: 70,
  /** 2P long-note hold bank (80-89). */
  LN_HOLD_2P: 80,
  /** 1P key-on bank (100-109): the lane's key went down. */
  KEY_ON_1P: 100,
  /** 2P key-on bank (110-119). */
  KEY_ON_2P: 110,
  /** 1P key-off bank (120-129): the lane's key went up. */
  KEY_OFF_1P: 120,
  /** 2P key-off bank (130-139). */
  KEY_OFF_2P: 130,
  /** The beat: one beat counts as 1000 ms whatever the BPM. */
  RHYTHM: 140,

  // ─── Result ─────────────────────────────────────────────────────────────────────────────────────────────────────
  /** The graphs start drawing. */
  RESULT_GRAPH_START: 150,
  /** The graphs finished drawing (or the player skipped them); the rank shows. */
  RESULT_GRAPH_END: 151,
  /** The player pressed on to the high-score update. */
  RESULT_UPDATE: 152,
} as const;

/** One of LR2's timers ({@link LR2_TIMER}); a lane bank names only its scratch timer. */
export type LR2Timer = (typeof LR2_TIMER)[keyof typeof LR2_TIMER];

/**
 * Timers in each lane bank: the scratch (index 0) and keys 1-9. A lane past that (the 24-key modes' lanes 10-24) has no
 * LR2 timer; `base + lane` would run into the next bank.
 */
export const LR2_LANE_TIMER_BANK_SIZE = 10;

/** The highest lane index a lane bank addresses (`LR2_LANE_TIMER_BANK_SIZE - 1`). */
export const LR2_LANE_INDEX_MAX = 9;

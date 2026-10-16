/**
 * LR2's ops (`dst_option`): the conditions a `#DST_*` row, `#IF` / `#ELSEIF` and a few other directives test. A skin
 * names an op by its number (negated to mean "not"); the host lights the ones that hold for the scene. beatoraja keeps
 * these numbers for LR2-compatible skins, so `@be-music/beatoraja-skin` names its copies after this table.
 *
 * Grouped by the screen that lights them. Ops 900-999 are the skin's own (`#CUSTOMOPTION`).
 */
export const LR2_OP = {
  // ─── Select: the bar under the cursor (also echoed on decide / result) ───────────────────────────────────────────
  /** The selected bar is a folder. */
  FOLDER_BAR: 1,
  /** The selected bar is a song. */
  SONG_BAR: 2,
  /** The selected bar is a course (LR2 shows grade courses here too). */
  COURSE_BAR: 3,
  /** The selected bar is the NEW COURSE bar, which starts making a course. */
  NEW_COURSE_BAR: 4,
  /** The selected bar can be played: a song, or a course whose stages are all present. */
  PLAYABLE_BAR: 5,

  // ─── Select: the option panels (OpenLR2 `LR2_skinobject.cpp` `GetOptionFlag_dst`) ───────────────────────────────
  /** No option panel is open. */
  NO_PANEL: 20,
  /** Option panel 1 is open. Ops 21-29 are panels 1-9. */
  PANEL1: 21,
  /** Option panel 2 is open. */
  PANEL2: 22,
  /** Option panel 3 is open. */
  PANEL3: 23,
  /** Option panel 4 is open. */
  PANEL4: 24,
  /** Option panel 5 is open. */
  PANEL5: 25,
  /** Option panel 6 is open. */
  PANEL6: 26,
  /** Option panel 7 is open. */
  PANEL7: 27,
  /** Option panel 8 is open. */
  PANEL8: 28,
  /** Option panel 9 is open. */
  PANEL9: 29,

  // ─── Play options (select, play, result) ────────────────────────────────────────────────────────────────────────
  /** BGA size NORMAL. */
  BGA_NORMAL: 30,
  /** BGA size EXTEND. */
  BGA_EXTEND: 31,
  /** AUTOPLAY is off. */
  AUTOPLAY_OFF: 32,
  /** AUTOPLAY is on. */
  AUTOPLAY_ON: 33,
  /** GHOST is off, or the judge is automatic (OpenLR2 `GetOptionFlag_dst`: `play_ghost` 0 or `autojudge` 2). */
  GHOST_OFF: 34,
  /** The score graph is off. */
  SCORE_GRAPH_OFF: 38,
  /** The score graph is on. */
  SCORE_GRAPH_ON: 39,
  /** The BGA is off. */
  BGA_OFF: 40,
  /** The BGA is on. */
  BGA_ON: 41,
  /** The 1P gauge is a normal one (GROOVE / EASY). */
  GAUGE_1P_NORMAL: 42,
  /** The 1P gauge is a red one (HARD / DEATH); LR2 also reports its course gauge here. */
  GAUGE_1P_RED: 43,
  /** The 2P gauge is a normal one. */
  GAUGE_2P_NORMAL: 44,
  /** The 2P gauge is a red one. */
  GAUGE_2P_RED: 45,
  /** The difficulty filter is on. */
  DIFFICULTY_FILTER_ON: 46,
  /** The difficulty filter is off. */
  DIFFICULTY_FILTER_OFF: 47,
  /** No internet-ranking connection. */
  OFFLINE: 50,
  /** Connected to the internet ranking. */
  ONLINE: 51,
  /** EXTRA MODE is off. */
  EXTRA_MODE_OFF: 52,
  /** EXTRA MODE is on. */
  EXTRA_MODE_ON: 53,
  /** 1P auto scratch is off. */
  AUTO_SCRATCH_1P_OFF: 54,
  /** 1P auto scratch is on. */
  AUTO_SCRATCH_1P_ON: 55,
  /** 2P auto scratch is off. */
  AUTO_SCRATCH_2P_OFF: 56,
  /** 2P auto scratch is on. */
  AUTO_SCRATCH_2P_ON: 57,
  /** The score of this play cannot be saved. */
  SCORE_SAVE_OFF: 60,
  /** The score of this play can be saved. */
  SCORE_SAVE_ON: 61,
  /** The clear lamp of this play cannot be saved. */
  CLEAR_SAVE_OFF: 62,
  /** The clear lamp is saved as at most EASY. */
  CLEAR_SAVE_EASY: 63,
  /** The clear lamp is saved as at most NORMAL. */
  CLEAR_SAVE_NORMAL: 64,
  /** The clear lamp is saved as at most HARD. */
  CLEAR_SAVE_HARD: 65,
  /** Only a FULL COMBO lamp is saved. */
  CLEAR_SAVE_FULL_COMBO: 66,

  // ─── Loading and replay (decide, play) ──────────────────────────────────────────────────────────────────────────
  /** The chart is loading. */
  LOADING: 80,
  /** The chart has loaded. */
  LOADED: 81,
  /** No replay. */
  REPLAY_OFF: 82,
  /** The play is being recorded as a replay. */
  REPLAY_RECORDING: 83,
  /** A replay is playing. */
  REPLAY_PLAYING: 84,

  // ─── Result: the outcome ────────────────────────────────────────────────────────────────────────────────────────
  /** The play cleared. */
  RESULT_CLEAR: 90,
  /** The play failed. */
  RESULT_FAIL: 91,

  // ─── Select: the selected bar's best record (result: this play's lamp) ─────────────────────────────────────────
  /** Clear lamp NO PLAY (`#SRC_BAR_LAMP` 0; the lamp ops follow the bar-lamp order). */
  LAMP_NO_PLAY: 100,
  /** Clear lamp FAILED. */
  LAMP_FAILED: 101,
  /** Clear lamp EASY. */
  LAMP_EASY: 102,
  /** Clear lamp NORMAL (LR2's CLEAR). */
  LAMP_NORMAL: 103,
  /** Clear lamp HARD. */
  LAMP_HARD: 104,
  /** Clear lamp FULL COMBO. */
  LAMP_FULL_COMBO: 105,
  /** Best rank AAA. */
  BEST_RANK_AAA: 110,
  /** Best rank AA. */
  BEST_RANK_AA: 111,
  /** Best rank A. */
  BEST_RANK_A: 112,
  /** Best rank B. */
  BEST_RANK_B: 113,
  /** Best rank C. */
  BEST_RANK_C: 114,
  /** Best rank D. */
  BEST_RANK_D: 115,
  /** Best rank E. */
  BEST_RANK_E: 116,
  /** Best rank F. */
  BEST_RANK_F: 117,

  // ─── The chart (select, decide, play, result) ───────────────────────────────────────────────────────────────────
  /** `#DIFFICULTY` is missing or 0. */
  DIFFICULTY_UNDEFINED: 150,
  /** `#DIFFICULTY 1` (BEGINNER). */
  DIFFICULTY_BEGINNER: 151,
  /** `#DIFFICULTY 2` (NORMAL). */
  DIFFICULTY_NORMAL: 152,
  /** `#DIFFICULTY 3` (HYPER). */
  DIFFICULTY_HYPER: 153,
  /** `#DIFFICULTY 4` (ANOTHER). */
  DIFFICULTY_ANOTHER: 154,
  /** `#DIFFICULTY 5` (INSANE). */
  DIFFICULTY_INSANE: 155,
  /** 7 KEYS. */
  KEYS_7: 160,
  /** 5 KEYS. */
  KEYS_5: 161,
  /** 14 KEYS. */
  KEYS_14: 162,
  /** 10 KEYS. */
  KEYS_10: 163,
  /** 9 KEYS (PMS). */
  KEYS_9: 164,
  /** The chart has no BGA. */
  NO_BGA: 170,
  /** The chart has a BGA. */
  HAS_BGA: 171,
  /** The chart has no long notes. */
  NO_LN: 172,
  /** The chart has long notes. */
  HAS_LN: 173,
  /** The chart's folder has no text (readme) file. */
  NO_TEXT: 174,
  /** The chart's folder has a text (readme) file. */
  HAS_TEXT: 175,
  /** The chart has no BPM change. */
  NO_BPM_CHANGE: 176,
  /** The chart has a BPM change. */
  HAS_BPM_CHANGE: 177,
  /** The chart has no `#RANDOM`. */
  NO_RANDOM: 178,
  /** The chart has a `#RANDOM`. */
  HAS_RANDOM: 179,
  /** Judge rank VERY HARD (`#RANK 0`). */
  JUDGE_VERY_HARD: 180,
  /** Judge rank HARD (`#RANK 1`). */
  JUDGE_HARD: 181,
  /** Judge rank NORMAL (`#RANK 2`). */
  JUDGE_NORMAL: 182,
  /** Judge rank EASY (`#RANK 3`). */
  JUDGE_EASY: 183,
  /** The chart has no `#STAGEFILE`. */
  NO_STAGEFILE: 190,
  /** The chart has a `#STAGEFILE`. */
  HAS_STAGEFILE: 191,
  /** The chart has no `#BANNER`. */
  NO_BANNER: 192,
  /** The chart has a `#BANNER`. */
  HAS_BANNER: 193,
  /** The chart has no `#BACKBMP`. */
  NO_BACKBMP: 194,
  /** The chart has a `#BACKBMP`. */
  HAS_BACKBMP: 195,
  /** The chart has no replay. */
  NO_REPLAY: 196,
  /** The chart has a replay. */
  HAS_REPLAY: 197,

  // ─── Play: the running score, gauge and judgement ───────────────────────────────────────────────────────────────
  /** 1P rank AAA so far. */
  RANK_1P_AAA: 200,
  /** 1P rank AA so far. */
  RANK_1P_AA: 201,
  /** 1P rank A so far. */
  RANK_1P_A: 202,
  /** 1P rank B so far. */
  RANK_1P_B: 203,
  /** 1P rank C so far. */
  RANK_1P_C: 204,
  /** 1P rank D so far. */
  RANK_1P_D: 205,
  /** 1P rank E so far. */
  RANK_1P_E: 206,
  /** 1P rank F so far. */
  RANK_1P_F: 207,
  /** 2P rank AAA so far. */
  RANK_2P_AAA: 210,
  /** 2P rank AA so far. */
  RANK_2P_AA: 211,
  /** 2P rank A so far. */
  RANK_2P_A: 212,
  /** 2P rank B so far. */
  RANK_2P_B: 213,
  /** 2P rank C so far. */
  RANK_2P_C: 214,
  /** 2P rank D so far. */
  RANK_2P_D: 215,
  /** 2P rank E so far. */
  RANK_2P_E: 216,
  /** 2P rank F so far. */
  RANK_2P_F: 217,
  /** The 1P gauge is at 0-9 %. Ops 230-240 are its ten-percent ranges. */
  GAUGE_1P_0_9: 230,
  /** The 1P gauge is at 10-19 %. */
  GAUGE_1P_10_19: 231,
  /** The 1P gauge is at 20-29 %. */
  GAUGE_1P_20_29: 232,
  /** The 1P gauge is at 30-39 %. */
  GAUGE_1P_30_39: 233,
  /** The 1P gauge is at 40-49 %. */
  GAUGE_1P_40_49: 234,
  /** The 1P gauge is at 50-59 %. */
  GAUGE_1P_50_59: 235,
  /** The 1P gauge is at 60-69 %. */
  GAUGE_1P_60_69: 236,
  /** The 1P gauge is at 70-79 %. */
  GAUGE_1P_70_79: 237,
  /** The 1P gauge is at 80-89 %. */
  GAUGE_1P_80_89: 238,
  /** The 1P gauge is at 90-99 %. */
  GAUGE_1P_90_99: 239,
  /** The 1P gauge is at 100 %. */
  GAUGE_1P_100: 240,
  /** The last 1P judgement was a PERFECT. */
  JUDGE_1P_PERFECT: 241,
  /** The last 1P judgement was a GREAT. */
  JUDGE_1P_GREAT: 242,
  /** The last 1P judgement was a GOOD. */
  JUDGE_1P_GOOD: 243,
  /** The last 1P judgement was a BAD. */
  JUDGE_1P_BAD: 244,
  /** The last 1P judgement was a POOR. */
  JUDGE_1P_POOR: 245,
  /** The last 1P judgement was an empty POOR (a miss). */
  JUDGE_1P_MISS: 246,
  /** The last 2P judgement was a PERFECT. */
  JUDGE_2P_PERFECT: 261,
  /** The last 2P judgement was a GREAT. */
  JUDGE_2P_GREAT: 262,
  /** The last 2P judgement was a GOOD. */
  JUDGE_2P_GOOD: 263,
  /** The last 2P judgement was a BAD. */
  JUDGE_2P_BAD: 264,
  /** The last 2P judgement was a POOR. */
  JUDGE_2P_POOR: 265,
  /** The last 2P judgement was an empty POOR (a miss). */
  JUDGE_2P_MISS: 266,

  // ─── Courses (select, play, result; OpenLR2 `LR2f.cpp` L5403-L5444) ─────────────────────────────────────────────
  /** Stage 1 of a course is played and is not the last one. Ops 280-288 are stages 1-9. */
  COURSE_STAGE1: 280,
  /** Stage 2 is played and is not the last one. */
  COURSE_STAGE2: 281,
  /** Stage 3 is played and is not the last one. */
  COURSE_STAGE3: 282,
  /** Stage 4 is played and is not the last one. */
  COURSE_STAGE4: 283,
  /** Stage 5 is played and is not the last one. */
  COURSE_STAGE5: 284,
  /** Stage 6 is played and is not the last one. */
  COURSE_STAGE6: 285,
  /** Stage 7 is played and is not the last one. */
  COURSE_STAGE7: 286,
  /** Stage 8 is played and is not the last one. */
  COURSE_STAGE8: 287,
  /** Stage 9 is played and is not the last one. */
  COURSE_STAGE9: 288,
  /** The last stage of a course is played. */
  COURSE_STAGE_FINAL: 289,
  /** A course: the selected bar on the select screen, the running course elsewhere. */
  COURSE: 290,
  /** The course is a NONSTOP course. */
  COURSE_NONSTOP: 291,
  /** The course is an EXPERT course (the stock `dst_option` doc swaps 292 / 293; the binary does not). */
  COURSE_EXPERT: 292,
  /** The course is a GRADE (dan) course. */
  COURSE_GRADE: 293,

  // ─── Result: ranks and updates ──────────────────────────────────────────────────────────────────────────────────
  /** This play's 1P rank is AAA. */
  RESULT_RANK_AAA: 300,
  /** This play's 1P rank is AA. */
  RESULT_RANK_AA: 301,
  /** This play's 1P rank is A. */
  RESULT_RANK_A: 302,
  /** This play's 1P rank is B. */
  RESULT_RANK_B: 303,
  /** This play's 1P rank is C. */
  RESULT_RANK_C: 304,
  /** This play's 1P rank is D. */
  RESULT_RANK_D: 305,
  /** This play's 1P rank is E. */
  RESULT_RANK_E: 306,
  /** This play's 1P rank is F. */
  RESULT_RANK_F: 307,
  /** This play scored nothing. */
  RESULT_RANK_0: 308,
  /** The best record's rank before this play is AAA. */
  PREVIOUS_RANK_AAA: 320,
  /** The best record's rank before this play is AA. */
  PREVIOUS_RANK_AA: 321,
  /** The best record's rank before this play is A. */
  PREVIOUS_RANK_A: 322,
  /** The best record's rank before this play is B. */
  PREVIOUS_RANK_B: 323,
  /** The best record's rank before this play is C. */
  PREVIOUS_RANK_C: 324,
  /** The best record's rank before this play is D. */
  PREVIOUS_RANK_D: 325,
  /** The best record's rank before this play is E. */
  PREVIOUS_RANK_E: 326,
  /** The best record's rank before this play is F. */
  PREVIOUS_RANK_F: 327,
  /** There was no best record before this play. */
  PREVIOUS_RANK_0: 328,
  /** This play updated the best score. */
  SCORE_UPDATED: 330,
  /** This play updated the best max combo. */
  MAX_COMBO_UPDATED: 331,
  /** This play updated the fewest BAD + POOR. */
  MIN_BP_UPDATED: 332,
  /** This play updated the best rank. */
  RANK_UPDATED: 335,
  /** The best record's rank after this play is AAA. */
  UPDATED_RANK_AAA: 340,
  /** The best record's rank after this play is AA. */
  UPDATED_RANK_AA: 341,
  /** The best record's rank after this play is A. */
  UPDATED_RANK_A: 342,
  /** The best record's rank after this play is B. */
  UPDATED_RANK_B: 343,
  /** The best record's rank after this play is C. */
  UPDATED_RANK_C: 344,
  /** The best record's rank after this play is D. */
  UPDATED_RANK_D: 345,
  /** The best record's rank after this play is E. */
  UPDATED_RANK_E: 346,
  /** The best record's rank after this play is F. */
  UPDATED_RANK_F: 347,
  /** The played skin has no `#FLIPRESULT`. */
  RESULT_FLIP_OFF: 350,
  /** The played skin has `#FLIPRESULT`: the result screen swaps its sides. */
  RESULT_FLIP_ON: 351,
  /**
   * The key-config screen is on its 7 / 14 KEYS page (OpenLR2 `config_keymode` 0, which persists to the screens after
   * it); the stock result skin gates its per-key-mode panels on 400-402.
   */
  KEY_CONFIG_7_14: 400,
  /** Key-config mode 9 KEYS. */
  KEY_CONFIG_9: 401,
  /** Key-config mode 5 / 10 KEYS. */
  KEY_CONFIG_5_10: 402,

  // ─── Select: making a course (OpenLR2 L5779-L5808) ──────────────────────────────────────────────────────────────
  /** A course is being made. (`LR2body.exe` falls through to 572, so it lights either way; be-music does not.) */
  COURSE_MAKING: 571,
  /** No course is being made. */
  COURSE_NOT_MAKING: 572,
  /** `580 + N` (N = 0-9): not making a course, and the selected course has more than N stages. */
  COURSE_STAGES_OVER: 580,
  /** `590 + N` (N = 0-9): making a course, with N songs added so far. */
  COURSE_SONGS_ADDED: 590,

  // ─── Select: the selected course's stages (OpenLR2 L5995-L6031) ─────────────────────────────────────────────────
  /**
   * `700 + 10 × i + difficulty` (700-745): stage i + 1 (i = 0-4) of the selected course has that `#DIFFICULTY` (0
   * undefined, 1 BEGINNER … 5 INSANE). A missing stage, an unowned chart and a bar that is not a course read 0.
   */
  COURSE_STAGE_DIFFICULTY: 700,
} as const;

/** One of LR2's ops ({@link LR2_OP}). */
export type Lr2Op = (typeof LR2_OP)[keyof typeof LR2_OP];

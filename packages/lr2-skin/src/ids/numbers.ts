/**
 * LR2's numbers: the value a `#SRC_NUMBER` draws (its `num` column). beatoraja keeps these numbers for its LR2-compatible
 * values (`value[].ref`). A rate is drawn as an integer part plus a separate after-dot number.
 *
 * Grouped by the screen that fills them; a play-screen number also reads on the result screen.
 */
export const LR2_NUM = {
  // ─── Options and the clock (every scene) ────────────────────────────────────────────────────────────────────────
  /** 1P hi-speed × 100 (2.30× reads 230). */
  HISPEED_1P: 10,
  /** 2P hi-speed × 100. */
  HISPEED_2P: 11,
  /** The judge timing offset. */
  JUDGE_TIMING: 12,
  /** The default target rate. */
  TARGET_RATE: 13,
  /** 1P lane cover (SUDDEN+). */
  LANE_COVER_1P: 14,
  /** 2P lane cover (SUDDEN+). */
  LANE_COVER_2P: 15,
  /** Frames per second. */
  FPS: 20,
  /** The year now. */
  YEAR: 21,
  /** The month now. */
  MONTH: 22,
  /** The day now. */
  DAY: 23,
  /** The hour now. */
  HOUR: 24,
  /** The minute now. */
  MINUTE: 25,
  /** The second now. */
  SECOND: 26,

  // ─── Select: the player's totals ────────────────────────────────────────────────────────────────────────────────
  /** Plays in total. */
  TOTAL_PLAY_COUNT: 30,
  /** Clears in total. */
  TOTAL_CLEAR_COUNT: 31,
  /** Failures in total. */
  TOTAL_FAIL_COUNT: 32,
  /** PERFECTs in total. */
  TOTAL_PERFECT: 33,
  /** GREATs in total. */
  TOTAL_GREAT: 34,
  /** GOODs in total. */
  TOTAL_GOOD: 35,
  /** BADs in total. */
  TOTAL_BAD: 36,
  /** POORs in total. */
  TOTAL_POOR: 37,
  /** The running combo across plays. */
  RUNNING_COMBO: 38,
  /** The longest running combo across plays. */
  RUNNING_COMBO_MAX: 39,
  /** The trial (dan) level. */
  TRIAL_LEVEL: 40,
  /** The trial (dan) level below it. */
  TRIAL_LEVEL_PREVIOUS: 41,

  // ─── Select: the selected chart ─────────────────────────────────────────────────────────────────────────────────
  /** The level of the BEGINNER chart in the same folder. Numbers 45-49 are BEGINNER … INSANE. */
  FOLDER_LEVEL_BEGINNER: 45,
  /** The level of the NORMAL chart in the same folder. */
  FOLDER_LEVEL_NORMAL: 46,
  /** The level of the HYPER chart in the same folder. */
  FOLDER_LEVEL_HYPER: 47,
  /** The level of the ANOTHER chart in the same folder. */
  FOLDER_LEVEL_ANOTHER: 48,
  /** The level of the INSANE chart in the same folder. */
  FOLDER_LEVEL_INSANE: 49,
  /** The best score (LR2's 200000-point score). */
  BEST_SCORE: 70,
  /** The best EX score. */
  BEST_EXSCORE: 71,
  /** The highest EX score the chart allows (notes × 2). */
  EXSCORE_MAX: 72,
  /** The best score rate (%). */
  BEST_RATE: 73,
  /** The chart's notes. */
  TOTAL_NOTES: 74,
  /** The best max combo. */
  BEST_MAX_COMBO: 75,
  /** The fewest BAD + POOR. */
  BEST_MIN_BP: 76,
  /** Plays of the chart. */
  PLAY_COUNT: 77,
  /** Clears of the chart. */
  CLEAR_COUNT: 78,
  /** Failures of the chart. */
  FAIL_COUNT: 79,
  /** The best record's PERFECTs. */
  BEST_PERFECT: 80,
  /** The best record's GREATs. */
  BEST_GREAT: 81,
  /** The best record's GOODs. */
  BEST_GOOD: 82,
  /** The best record's BADs. */
  BEST_BAD: 83,
  /** The best record's POORs. */
  BEST_POOR: 84,
  /** The best record's PERFECTs as a percentage of the notes. */
  BEST_PERFECT_RATE: 85,
  /** The best record's GREATs as a percentage. */
  BEST_GREAT_RATE: 86,
  /** The best record's GOODs as a percentage. */
  BEST_GOOD_RATE: 87,
  /** The best record's BADs as a percentage. */
  BEST_BAD_RATE: 88,
  /** The best record's POORs as a percentage. */
  BEST_POOR_RATE: 89,
  /** The chart's highest BPM. */
  MAX_BPM: 90,
  /** The chart's lowest BPM. */
  MIN_BPM: 91,
  /** The player's place in the internet ranking. */
  IR_RANK: 92,
  /** Players in the internet ranking. */
  IR_PLAYERS: 93,
  /** The internet ranking's clear rate. */
  IR_CLEAR_RATE: 94,

  // ─── Play: the running score ────────────────────────────────────────────────────────────────────────────────────
  /** The score (LR2's 200000-point score). */
  SCORE: 100,
  /** The EX score. */
  EXSCORE: 101,
  /** The EX score as a percentage of the highest one. */
  SCORE_RATE: 102,
  /** The digits after the dot of `SCORE_RATE`. */
  SCORE_RATE_AFTERDOT: 103,
  /** The combo. */
  COMBO: 104,
  /** The max combo. */
  MAX_COMBO: 105,
  /** The chart's notes. */
  NOTES: 106,
  /** The gauge (%). */
  GAUGE: 107,
  /** The EX score less the rival's. */
  EXSCORE_DIFF: 108,
  /** PERFECTs. */
  PERFECT: 110,
  /** GREATs. */
  GREAT: 111,
  /** GOODs. */
  GOOD: 112,
  /** BADs. */
  BAD: 113,
  /** POORs. */
  POOR: 114,
  /** The EX score as a percentage of the notes judged so far. */
  TOTAL_RATE: 115,
  /** The digits after the dot of `TOTAL_RATE`. */
  TOTAL_RATE_AFTERDOT: 116,
  /** The best EX score. */
  HIGH_SCORE: 150,
  /** The target's EX score. */
  TARGET_SCORE: 151,
  /** The EX score less the best one. */
  HIGH_SCORE_DIFF: 152,
  /** The EX score less the target's. */
  TARGET_SCORE_DIFF: 153,
  /** EX score still needed for the next rank. */
  NEXT_RANK_DIFF: 154,
  /** The BPM now. */
  BPM: 160,
  /** Minutes played. */
  PLAY_MINUTE: 161,
  /** Seconds played (past the minute). */
  PLAY_SECOND: 162,
  /** Minutes left. */
  REMAINING_MINUTE: 163,
  /** Seconds left (past the minute). */
  REMAINING_SECOND: 164,
  /** Loading progress (%). */
  LOADING_PROGRESS: 165,

  // ─── Result: before and after this play ─────────────────────────────────────────────────────────────────────────
  /** The best EX score before this play. */
  RESULT_EXSCORE_BEFORE: 170,
  /** This play's EX score. */
  RESULT_EXSCORE: 171,
  /** This play's EX score less the previous best. */
  RESULT_EXSCORE_DIFF: 172,
  /** The best max combo before this play. */
  RESULT_MAX_COMBO_BEFORE: 173,
  /** This play's max combo. */
  RESULT_MAX_COMBO: 174,
  /** This play's max combo less the previous best. */
  RESULT_MAX_COMBO_DIFF: 175,
  /** The fewest BAD + POOR before this play. */
  RESULT_MIN_BP_BEFORE: 176,
  /** This play's BAD + POOR. */
  RESULT_MIN_BP: 177,
  /** How many fewer BAD + POOR than the previous best. */
  RESULT_MIN_BP_DIFF: 178,
  /** The best score rate before this play. */
  RESULT_RATE_BEFORE: 183,
  /** The digits after the dot of `RESULT_RATE_BEFORE`. */
  RESULT_RATE_BEFORE_AFTERDOT: 184,

  // ─── Courses (select, play, result; OpenLR2 L923-L942) ──────────────────────────────────────────────────────────
  /** The play level of course stage 1. Numbers 250-259 are stages 1-10. */
  COURSE_STAGE1_LEVEL: 250,
  /** The play level of course stage 2. */
  COURSE_STAGE2_LEVEL: 251,
  /** The play level of course stage 3. */
  COURSE_STAGE3_LEVEL: 252,
  /** The play level of course stage 4. */
  COURSE_STAGE4_LEVEL: 253,
  /** The play level of course stage 5. */
  COURSE_STAGE5_LEVEL: 254,
  /** The play level of course stage 6. */
  COURSE_STAGE6_LEVEL: 255,
  /** The play level of course stage 7. */
  COURSE_STAGE7_LEVEL: 256,
  /** The play level of course stage 8. */
  COURSE_STAGE8_LEVEL: 257,
  /** The play level of course stage 9. */
  COURSE_STAGE9_LEVEL: 258,
  /** The play level of course stage 10. */
  COURSE_STAGE10_LEVEL: 259,
} as const;

/** One of LR2's numbers ({@link LR2_NUM}). */
export type Lr2Num = (typeof LR2_NUM)[keyof typeof LR2_NUM];

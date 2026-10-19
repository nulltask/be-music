/**
 * LR2's buttons: what a `#SRC_BUTTON` does when clicked (its `type` column). A value button draws the cell of the value
 * it edits and steps up on its right half, down on its left (`ButtonByInput`). beatoraja keeps these numbers for its
 * LR2-compatible click events (`act`).
 *
 * All of them are select-screen buttons.
 */
export const LR2_BUTTON = {
  // ─── Panels ─────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Opens / closes panel 1. Buttons 1-9 toggle panels 1-9. */
  PANEL1: 1,
  /** Opens / closes panel 2. */
  PANEL2: 2,
  /** Opens / closes panel 3. */
  PANEL3: 3,
  /** Opens / closes panel 4. */
  PANEL4: 4,
  /** Opens / closes panel 5. */
  PANEL5: 5,
  /** Opens / closes panel 6. */
  PANEL6: 6,
  /** Opens / closes panel 7. */
  PANEL7: 7,
  /** Opens / closes panel 8. */
  PANEL8: 8,
  /** Opens / closes panel 9. */
  PANEL9: 9,

  // ─── The bar list and starting a play ───────────────────────────────────────────────────────────────────────────
  /** Cycles the difficulty filter. */
  DIFFICULTY_FILTER: 10,
  /** Cycles the key-mode filter. */
  KEY_MODE_FILTER: 11,
  /** Cycles the sort. */
  SORT: 12,
  /** Opens the key config. */
  KEY_CONFIG: 13,
  /** Opens the skin select. */
  SKIN_SELECT: 14,
  /** Plays the selected bar. */
  PLAY: 15,
  /** Plays the selected bar with AUTOPLAY. */
  AUTOPLAY: 16,
  /** Shows the chart's text (readme) file. */
  READ_TEXT: 17,
  /** Plays the selected chart's replay. */
  REPLAY: 19,

  // ─── Play options ───────────────────────────────────────────────────────────────────────────────────────────────
  /** Cycles the 1P gauge. */
  GAUGE_1P: 40,
  /** Cycles the 2P gauge. */
  GAUGE_2P: 41,
  /** Cycles 1P RANDOM. */
  RANDOM_1P: 42,
  /** Cycles 2P RANDOM. */
  RANDOM_2P: 43,
  /** Toggles 1P auto scratch. */
  AUTO_SCRATCH_1P: 44,
  /** Toggles 2P auto scratch. */
  AUTO_SCRATCH_2P: 45,
  /** Toggles LANE COVER. */
  LANE_COVER: 46,
  /** Cycles the 1P effect (HIDDEN / SUDDEN). */
  EFFECT_1P: 50,
  /** Cycles the 2P effect. */
  EFFECT_2P: 51,
  /** Toggles DP FLIP. */
  FLIP: 54,
  /** Cycles HS-FIX. */
  HS_FIX: 55,
  /** Steps the 1P hi-speed (`plusOnly` picks the direction). */
  HISPEED_1P: 57,
  /** Steps the 2P hi-speed. */
  HISPEED_2P: 58,
  /** Toggles the score graph. */
  SCORE_GRAPH: 70,
  /** Cycles the BGA (OFF / ON / AUTOPLAY only). */
  BGA: 72,
  /** Toggles the BGA size (NORMAL / EXTEND). */
  BGA_SIZE: 73,
  /** Sets the difficulty filter to ALL. Buttons 91-96 set ALL, BEGINNER … INSANE. */
  DIFFICULTY_FILTER_ALL: 91,
  /** Sets the difficulty filter to BEGINNER. */
  DIFFICULTY_FILTER_BEGINNER: 92,
  /** Sets the difficulty filter to NORMAL. */
  DIFFICULTY_FILTER_NORMAL: 93,
  /** Sets the difficulty filter to HYPER. */
  DIFFICULTY_FILTER_HYPER: 94,
  /** Sets the difficulty filter to ANOTHER. */
  DIFFICULTY_FILTER_ANOTHER: 95,
  /** Sets the difficulty filter to INSANE. */
  DIFFICULTY_FILTER_INSANE: 96,

  // ─── Making courses (OpenLR2 L11063-L11137) ─────────────────────────────────────────────────────────────────────
  /** Saves the course being made. */
  COURSE_FINISH: 230,
  /** Cancels the course being made. */
  COURSE_CANCEL: 231,
  /** Deletes the selected course of the player's own (after a confirmation). */
  COURSE_DELETE: 233,
  /** Steps the connection after stage 1 of the selected NONSTOP course. Buttons 240-248 are stages 1-9. */
  COURSE_CONNECTION1: 240,
  /** Steps the connection after stage 2. */
  COURSE_CONNECTION2: 241,
  /** Steps the connection after stage 3. */
  COURSE_CONNECTION3: 242,
  /** Steps the connection after stage 4. */
  COURSE_CONNECTION4: 243,
  /** Steps the connection after stage 5. */
  COURSE_CONNECTION5: 244,
  /** Steps the connection after stage 6. */
  COURSE_CONNECTION6: 245,
  /** Steps the connection after stage 7. */
  COURSE_CONNECTION7: 246,
  /** Steps the connection after stage 8. */
  COURSE_CONNECTION8: 247,
  /** Steps the connection after stage 9. */
  COURSE_CONNECTION9: 248,
  /** Steps the connection a new NONSTOP course gets. */
  COURSE_DEFAULT_CONNECTION: 268,
} as const;

/** One of LR2's buttons ({@link LR2_BUTTON}). */
export type Lr2Button = (typeof LR2_BUTTON)[keyof typeof LR2_BUTTON];

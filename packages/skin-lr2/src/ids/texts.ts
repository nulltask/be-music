/**
 * LR2's texts: the string a `#SRC_TEXT` draws (its `st` column). beatoraja keeps these numbers for its LR2-compatible
 * strings (`text[].ref`).
 *
 * Texts 20-29 are the fields LR2's tag editor edits (OpenLR2 `textOp.txt` `TAGEDIT_*`): 20-28 repeat 10-18 (`*_ALT`),
 * except text 20 on the result screen, which LR2 reuses for the internet ranking's message.
 */
export const LR2_TEXT = {
  // ─── Every scene ────────────────────────────────────────────────────────────────────────────────────────────────
  /** The rival's (target's) name. */
  RIVAL: 1,
  /** The player's name. */
  PLAYER: 2,
  /** The chart's title. */
  TITLE: 10,
  /** The chart's subtitle. */
  SUBTITLE: 11,
  /** The title and the subtitle. */
  FULL_TITLE: 12,
  /** The chart's genre. */
  GENRE: 13,
  /** The chart's artist. */
  ARTIST: 14,
  /** The chart's subartist. */
  SUBARTIST: 15,
  /**
   * The chart's tag: a field of LR2's own song database, which a player edits (OpenLR2 `ProcS_Select` sets text 16
   * from `cur.tag`). be-music keeps no tags, so it reads empty. beatoraja draws the artist and subartist here
   * (`fullartist`).
   */
  TAG: 16,
  /** The chart's play level. */
  PLAY_LEVEL: 17,
  /**
   * The chart's `#DIFFICULTY` as a number, 0-5 (OpenLR2 `ProcS_Select` sets text 18 with `SetObjectStringInt`); the
   * difficulty ops (150-155) name it.
   */
  DIFFICULTY: 18,
  /**
   * Text 20: as `TITLE`; on the result screen, the internet ranking's message instead (OpenLR2 `SaveResult` /
   * `ProcI_Result`).
   */
  TITLE_ALT: 20,
  /** Text 21: as `SUBTITLE`. */
  SUBTITLE_ALT: 21,
  /** Text 22: as `FULL_TITLE`. */
  FULL_TITLE_ALT: 22,
  /** Text 23: as `GENRE`. */
  GENRE_ALT: 23,
  /** Text 24: as `ARTIST`. */
  ARTIST_ALT: 24,
  /** Text 25: as `SUBARTIST`. */
  SUBARTIST_ALT: 25,
  /** Text 26: as `TAG`. */
  TAG_ALT: 26,
  /** Text 27: as `PLAY_LEVEL`. */
  PLAY_LEVEL_ALT: 27,
  /** Text 28: as `DIFFICULTY`. */
  DIFFICULTY_ALT: 28,
  /**
   * LR2's ex level: a level a player sets in LR2's song database, which LR2 draws in the INSANE bar-level digits
   * (OpenLR2 `exlevel`). be-music keeps none and reads an INSANE chart's play level here.
   */
  INSANE_LEVEL: 29,

  // ─── Select ─────────────────────────────────────────────────────────────────────────────────────────────────────
  /** The search word being typed. */
  SEARCH_WORD: 30,
  /** The skin's name. */
  SKIN_NAME: 50,
  /** The skin's author. */
  SKIN_AUTHOR: 51,
  /** Option panel: the play style (`7KEYS`, …). Texts 60-85 name each option's setting. */
  OPTION_PLAY_STYLE: 60,
  /** Option panel: the sort. */
  OPTION_SORT: 61,
  /** Option panel: the difficulty filter. */
  OPTION_DIFFICULTY_FILTER: 62,
  /** Option panel: 1P RANDOM. */
  OPTION_RANDOM_1P: 63,
  /** Option panel: 2P RANDOM. */
  OPTION_RANDOM_2P: 64,
  /** Option panel: the 1P gauge. */
  OPTION_GAUGE_1P: 65,
  /** Option panel: the 2P gauge. */
  OPTION_GAUGE_2P: 66,
  /** Option panel: 1P assist (auto scratch). */
  OPTION_ASSIST_1P: 67,
  /** Option panel: 2P assist. */
  OPTION_ASSIST_2P: 68,
  /** Option panel: battle. */
  OPTION_BATTLE: 69,
  /** Option panel: DP FLIP. */
  OPTION_FLIP: 70,
  /** Option panel: the score graph. */
  OPTION_SCORE_GRAPH: 71,
  /** Option panel: GHOST. */
  OPTION_GHOST: 72,
  /** Option panel: LANE COVER. */
  OPTION_LANE_COVER: 73,
  /** Option panel: the scroll type. */
  OPTION_SCROLL_TYPE: 74,
  /** Option panel: the BGA size. */
  OPTION_BGA_SIZE: 75,
  /** Option panel: the BGA. */
  OPTION_BGA: 76,
  /** Option panel: the color depth. */
  OPTION_COLOR_DEPTH: 77,
  /** Option panel: VSYNC. */
  OPTION_VSYNC: 78,
  /** Option panel: the screen mode. */
  OPTION_SCREEN_MODE: 79,
  /** Option panel: judge auto-adjust. */
  OPTION_JUDGE_AUTO_ADJUST: 80,
  /** Option panel: the replay save mode. */
  OPTION_REPLAY_SAVE: 81,
  /** Option panel: trial line 1. */
  OPTION_TRIAL_LINE_1: 82,
  /** Option panel: trial line 2. */
  OPTION_TRIAL_LINE_2: 83,
  /** Option panel: the 1P effect (HIDDEN / SUDDEN). */
  OPTION_EFFECT_1P: 84,
  /** Option panel: the 2P effect. */
  OPTION_EFFECT_2P: 85,

  // ─── Courses (select, play, result; OpenLR2 L8400-L8420) ────────────────────────────────────────────────────────
  /** The title of course stage 1. Texts 150-154 are stages 1-5; a stage the course lacks reads empty. */
  COURSE_STAGE1_TITLE: 150,
  /** The title of course stage 2. */
  COURSE_STAGE2_TITLE: 151,
  /** The title of course stage 3. */
  COURSE_STAGE3_TITLE: 152,
  /** The title of course stage 4. */
  COURSE_STAGE4_TITLE: 153,
  /** The title of course stage 5. */
  COURSE_STAGE5_TITLE: 154,
  /** The subtitle of course stage 1. Texts 160-164 are stages 1-5. */
  COURSE_STAGE1_SUBTITLE: 160,
  /** The subtitle of course stage 2. */
  COURSE_STAGE2_SUBTITLE: 161,
  /** The subtitle of course stage 3. */
  COURSE_STAGE3_SUBTITLE: 162,
  /** The subtitle of course stage 4. */
  COURSE_STAGE4_SUBTITLE: 163,
  /** The subtitle of course stage 5. */
  COURSE_STAGE5_SUBTITLE: 164,
  /** The course's title; while making a course, the name being typed. */
  COURSE_TITLE: 170,
  /** The connection after stage 1 of the selected NONSTOP course (`FADE` … `BLANK2`), else `DISABLE`. Texts 171-179. */
  COURSE_CONNECTION1: 171,
  /** The connection after stage 2. */
  COURSE_CONNECTION2: 172,
  /** The connection after stage 3. */
  COURSE_CONNECTION3: 173,
  /** The connection after stage 4. */
  COURSE_CONNECTION4: 174,
  /** The connection after stage 5. */
  COURSE_CONNECTION5: 175,
  /** The connection after stage 6. */
  COURSE_CONNECTION6: 176,
  /** The connection after stage 7. */
  COURSE_CONNECTION7: 177,
  /** The connection after stage 8. */
  COURSE_CONNECTION8: 178,
  /** The connection after stage 9. */
  COURSE_CONNECTION9: 179,
  /** The selected course's IR flag: `ON` or `OFF` (`optionstr.csv` `#COURSE_IR`); `OFF` on any other bar. */
  COURSE_IR: 183,
  /** The RANDOM MIX preferred level: `OFF` or `LEVEL n`. */
  RANDOM_MIX_PREFERRED_LEVEL: 190,
  /** The RANDOM MIX max level: `NO LIMIT` or `LEVEL n`. */
  RANDOM_MIX_MAX_LEVEL: 191,
  /** The RANDOM MIX min level: `NO LIMIT` or `LEVEL n`. */
  RANDOM_MIX_MIN_LEVEL: 192,
  /** The RANDOM MIX BPM range: `NO LIMIT` or `+- nBPM`. */
  RANDOM_MIX_BPM_RANGE: 193,
  /** The RANDOM MIX max BPM: `NO LIMIT` or `n BPM`. */
  RANDOM_MIX_MAX_BPM: 194,
  /** The RANDOM MIX min BPM: `NO LIMIT` or `n BPM`. */
  RANDOM_MIX_MIN_BPM: 195,
  /** The RANDOM MIX stage count: `RANDOM` or `n STAGE`. */
  RANDOM_MIX_STAGE_COUNT: 196,
  /** The connection a new NONSTOP course gets (`config.course.defaultconnection`). */
  COURSE_DEFAULT_CONNECTION: 198,
} as const;

/** One of LR2's texts ({@link LR2_TEXT}). */
export type LR2Text = (typeof LR2_TEXT)[keyof typeof LR2_TEXT];

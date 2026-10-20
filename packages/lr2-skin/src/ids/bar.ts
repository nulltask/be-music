import type { LR2BarBodyKind, LR2BarLampKind } from '../skin.ts';

/** LR2's select bar bodies: which bar a `#SRC_BAR_BODY` draws (its index column). */
export const LR2_BAR_BODY = {
  /** A song. */
  SONG: 0,
  /** A folder. */
  FOLDER: 1,
  /** A custom folder. */
  CUSTOM_FOLDER: 2,
  /** The new-songs folder. */
  NEW_SONG_FOLDER: 3,
  /** A rival's folder. */
  RIVAL_FOLDER: 4,
  /** A song in rival mode. */
  RIVAL_SONG: 5,
  /** A folder of courses. */
  COURSE_FOLDER: 6,
  /** The NEW COURSE bar, which starts making a course. */
  COURSE_CREATE: 7,
  /** A course. */
  COURSE: 8,
  /** A random course (beatoraja). */
  RANDOM_COURSE: 9,
} as const;

/** One of LR2's bar bodies ({@link LR2_BAR_BODY}). */
export type LR2BarBody = (typeof LR2_BAR_BODY)[keyof typeof LR2_BAR_BODY];

/** The parsed kind of each bar body, by its {@link LR2_BAR_BODY} index. */
export const LR2_BAR_BODY_KINDS: readonly LR2BarBodyKind[] = [
  'song',
  'folder',
  'customFolder',
  'newSongFolder',
  'rivalFolder',
  'rivalSong',
  'courseFolder',
  'courseCreate',
  'course',
  'randomCourse',
];

/**
 * LR2's clear lamps as a `#SRC_BAR_LAMP` draws them (its index column). The select lamp ops follow the same order
 * (`LR2_OP.LAMP_NO_PLAY + index`).
 */
export const LR2_BAR_LAMP = {
  /** NO PLAY. */
  NO_PLAY: 0,
  /** FAILED. */
  FAILED: 1,
  /** EASY CLEAR (be-music's ASSIST EASY and EASY). */
  EASY: 2,
  /** CLEAR (be-music's NORMAL). */
  CLEAR: 3,
  /** HARD CLEAR (be-music's HARD and EX HARD). */
  HARD: 4,
  /** FULL COMBO (be-music's FULL COMBO, PERFECT and MAX). */
  FULL_COMBO: 5,
} as const;

/** One of LR2's bar lamps ({@link LR2_BAR_LAMP}). */
export type LR2BarLamp = (typeof LR2_BAR_LAMP)[keyof typeof LR2_BAR_LAMP];

/** The parsed kind of each bar lamp, by its {@link LR2_BAR_LAMP} index. */
export const LR2_BAR_LAMP_KINDS: readonly LR2BarLampKind[] = ['noplay', 'failed', 'easy', 'clear', 'hard', 'fullcombo'];

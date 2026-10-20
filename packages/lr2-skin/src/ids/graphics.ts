/**
 * The image (`gr`) ids a `#SRC_*` row uses for graphics LR2 binds at run time instead of an `#IMAGE` declaration. The
 * parser marks them with the `LR2_SPECIAL_GRAPHIC` sentinel paths.
 */
export const LR2_GR = {
  /** The chart's `#STAGEFILE`. */
  STAGEFILE: 100,
  /** The chart's `#BACKBMP`. */
  BACKBMP: 101,
  /** The chart's `#BANNER`. */
  BANNER: 102,
  /** The skin-select thumbnail. */
  SKIN_THUMBNAIL: 105,
  /** Solid black. */
  BLACK: 110,
  /** Solid white. */
  WHITE: 111,
} as const;

/** One of LR2's runtime-bound image ids ({@link LR2_GR}). */
export type LR2Gr = (typeof LR2_GR)[keyof typeof LR2_GR];

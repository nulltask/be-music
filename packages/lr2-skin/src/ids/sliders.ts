/** LR2's sliders: the value a `#SRC_SLIDER` knob follows along its range (its `type` column). */
export const LR2_SLIDER = {
  /** Select: the cursor's place in the bar list. */
  SELECT_POSITION: 1,
  /** The 1P hi-speed. */
  HISPEED_1P: 2,
  /** The 2P hi-speed. */
  HISPEED_2P: 3,
  /** The 1P lane cover. */
  LANE_COVER_1P: 4,
  /** The 2P lane cover. */
  LANE_COVER_2P: 5,
  /** Play: how far the chart has played. */
  PLAY_PROGRESS: 6,
} as const;

/** One of LR2's sliders ({@link LR2_SLIDER}). */
export type Lr2Slider = (typeof LR2_SLIDER)[keyof typeof LR2_SLIDER];

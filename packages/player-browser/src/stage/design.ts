// The play stage's design space and timing defaults: values the play session and the views both use.

export const PIXELS_PER_BEAT = 72;
/** Baseline design units for built-in layouts and hi-speed. LR2 views use their skin's authored canvas. */
export const DESIGN_WIDTH = 640;
export const DESIGN_HEIGHT = 480;

/**
 * Fallback time-to-chart-start (in ms) used when the active skin doesn't author a `#PLAYSTART` directive. The skin's
 * timing wins when it specifies one.
 */
export const FALLBACK_INTRO_DELAY_MS = 3000;

/**
 * Fallback lane-laser release fade duration in ms. Themes can author a per-lane span (the LR2 family derives it from the
 * skin's key-on keyframes); this constant kicks in when a key-on slot has no themed span (a be-music skin, or a slot
 * the skin doesn't author). 120 ms matches the LR2 default skin's typical key-on keyframe span and is a perceptually
 * comfortable decay for auto-judge feedback.
 */
export const KEY_ON_FADE_OUT_MS = 120;

import { Color } from 'pixi.js';

// Fallback palette (skin-less demo only). Once a skin supplies its own
// atlas every visible pixel comes from the skin.
export const BG = new Color('#05070b');
export const PANEL = new Color('#10141d');
export const WHITE = new Color('#edf2f7');
export const BLUE = new Color('#56b6f7');
export const RED = new Color('#ff6b6b');
export const YELLOW = new Color('#ffd166');
export const MUTED = new Color('#98a5b3');

export const PIXELS_PER_BEAT = 72;
/**
 * Design canvas the gameplay path renders into. 640×480 matches
 * the LR2 default skin's authored canvas (LR2 default `play_*.lr2skin`
 * doesn't carry a `#RESOLUTION` directive, so the loader's seed at
 * `lr2-skin.ts` width=640 / height=480 wins). Keeping the design
 * space aligned with the skin's native width/height lets
 * `renderLanes`' `skinX + lr2Lane.x * scale` resolve to scale=1.0
 * with no horizontal offset — the skin paints at its authored
 * coordinates 1:1.
 *
 * Bumping this to 1280×720 (matching `pixi-select` /
 * `pixi-result` / `pixi-decide`'s fallback) would force every
 * 640×480 skin to render at scale=1.5 inside an off-centre
 * letterbox, mis-positioning notes and chart chrome — a regression
 * that was caught immediately when an LR2 default skin was
 * dropped during gameplay.
 */
export const DESIGN_WIDTH = 640;
export const DESIGN_HEIGHT = 480;

export const BOMB_DIVX = 8;
export const BOMB_DIVY = 4;
export const BOMB_CYCLE_MS = 30;

export const HISPEED_MIN = 0.1;
export const HISPEED_MAX = 6.0;
export const HISPEED_STEP = 0.1;

/**
 * Fallback time-to-chart-start (in ms) used when the active LR2
 * skin doesn't author a `#PLAYSTART` directive. The skin's
 * timing wins when it specifies one — see `Lr2SkinTiming.playStart`.
 * 3 s leaves enough breathing room for the slide-in chrome of
 * skinless / non-LR2 demos before notes begin.
 */
export const FALLBACK_INTRO_DELAY_MS = 3000;

export const LR2_1P_KEYON_TIMER_BASE = 100;
export const LR2_2P_KEYON_TIMER_BASE = 110;
export const LR2_1P_BOMB_TIMER_BASE = 50;
export const LR2_2P_BOMB_TIMER_BASE = 60;
/**
 * LR2 long-note hold-effect timers — fire at LN press, stop at LN
 * release. Per-lane: `70 = 1P SC, 71..77 = 1P key1..7, 78 / 79 =
 * 1P key8 / 9; 80 / 81..87 / 88..89` for the 2P side. Used by
 * skins to drive LN-specific overlays (sustain glow, sparkles)
 * that are independent of the regular key-on lasers.
 */
export const LR2_1P_LN_HOLD_TIMER_BASE = 70;
export const LR2_2P_LN_HOLD_TIMER_BASE = 80;

/**
 * Playfield rectangle for the no-skin path. Coordinates come
 * directly from LR2's default 7K skin (`Theme/LR2/Play/7keys/
 * 7_LL0.csv`):
 *
 *   - `#DST_JUDGELINE,...,33,315,194,6,...` — judge bar at
 *     (33, 315) 194×6.
 *   - `#DST_NOTE,0..7` — note rectangles spanning x=33..227 at
 *     y=315 (top of judge bar).
 *
 * `judgementY: 321` is the bottom edge of the judge bar
 * (315 + 6) — that's the line notes "land on", and the same
 * convention used elsewhere when reading `lr2Lane.y + lr2Lane.h`.
 * `y: 0` lets notes scroll from the very top of the design
 * canvas; LR2's authored chrome over-paints the parts above the
 * judge area, but the playfield itself extends full-height.
 */
export const PLAYFIELD = { x: 33, y: 0, w: 194, judgementY: 321 } as const;
/**
 * BGA rectangle (LR2 op 30 NORMAL gating). LR2 also defines an
 * EXTEND variant at (230, 0) 392×392 (op 31), but the fallback
 * skin defaults to NORMAL — the `BgaSize` toggle on the LR2
 * skin path picks between them at runtime.
 *
 * Source: `7_LL0.csv` `#DST_BGA,...,291,56,256,256,...,30,...`.
 */
export const BGA = { x: 291, y: 56, w: 256, h: 256 } as const;
/**
 * Groove gauge bar. LR2 authors the gauge as a 4-frame sprite
 * (`#SRC_GROOVEGAUGE,...,407,339,16,14,4,1,...`) tiled across
 * 50 cells; the `#DST_GROOVEGAUGE,...,44,387,4,14,...` rect is
 * the SINGLE-cell footprint, so the on-screen bar is 4×50 = 200
 * wide and 14 tall starting at (44, 387). The fallback frame
 * draws the full bar inline at this rectangle.
 */
export const GROOVE = { x: 44, y: 387, w: 200, h: 14 } as const;

export const SPEC_BGA_CANVAS_SIZE = 256;

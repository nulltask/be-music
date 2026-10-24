import type { GaugeType } from '@be-music/player-engine/ruleset';
import type { BrowseSort, DifficultyFilter, KeysFilter } from '../browse/list-options.ts';

/**
 * Per-session gameplay tweaks the player picks on the select screen: hi-speed, autoplay, note arrangement, gauge type,
 * HIDDEN / SUDDEN and the lane cover, BGA display, and the list's sort and filters. The host owns the live values and
 * hands them to every play it launches; be-music skins read them from `BeMusicSelectFrame.playOptions` /
 * `BeMusicDecideFrame.playOptions` and change them through `BeMusicSelectActions.setPlayOption` / `cyclePlayOption`.
 * Several fields mirror an LR2 `#SRC_BUTTON` type, noted per field.
 */
export interface PlayOptions {
  /**
   * Visual scroll-speed multiplier. The chart's note-to-second mapping is unchanged; only the on-screen pixels-per-beat
   * scaling moves. Range matches gameplay's runtime adjust hotkeys (`ArrowUp` / `ArrowDown` during play).
   */
  hiSpeed: number;
  /** AC 34 CLASSIC HI-SPEED; false retains the source default controls. */
  classicHiSpeed: boolean;
  /** AC 32 measured normal level 1..20; 0 leaves the existing multiplier API active. */
  normalHiSpeedLevel: number;
  /** beatoraja display timing in integer milliseconds, -500..500; positive advances note drawing. */
  judgeTimingMs: number;
  /** beatoraja visual CONSTANT, distinct from HS-FIX CONSTANT and chart scroll modifiers. */
  visualConstant: boolean;
  noteDurationMs: number;
  constantFadeMs: number;
  /** beatoraja BPM GUIDE shows BPM-change and STOP markers on the lane. */
  bpmGuide: boolean;
  /**
   * When `true`, every note auto-judges as PERFECT at its scheduled time. Mirrors the LR2 AUTOPLAY skin button
   * (`#SRC_BUTTON type=16`). Starting a chart in AUTO from the select screen (its `start` with `autoPlay`, such as a
   * be-music skin's `autoPlay` action) also forces this on for that one play, whatever is stored here.
   */
  autoPlay: boolean;
  /**
   * BGA (background animation) display mode. Mirrors the LR2 `#SRC_BUTTON,type=72` cycle (OFF / ON / AUTOPLAY ONLY).
   * When `'AUTOPLAY_ONLY'` the BGA renders only when {@link autoPlay} (or a start in AUTO) is also active — matches
   * LR2 behavior where AUTOPLAY ONLY hides BGA during regular human-played sessions.
   */
  bga: BGAMode;
  /**
   * BGA frame size — `'NORMAL'` uses the skin's default `#DST_BGA` rect (op 30), `'EXTEND'` uses the larger variant
   * gated on op 31. Mirrors `#SRC_BUTTON,type=73`.
   */
  bgaSize: BGASize;
  /**
   * Score-graph (per-judge prediction line) display flag. Mirrors `#SRC_BUTTON,type=70` and ops 38 (off) / 39 (on). The
   * LR2 default skin gates its score-graph chrome on op 39 — toggling this on reveals those elements without needing a
   * dedicated renderer in the gameplay scene.
   */
  scoreGraph: boolean;
  /**
   * Difficulty filter for the bar list. `'ALL'` shows every chart; the named values restrict the list to charts whose
   * `#DIFFICULTY` matches the corresponding LR2 enum (1=BEGINNER.. 5=INSANE). Mirrors `#SRC_BUTTON,type=10` (cycling)
   * and types 91..96 (direct set).
   */
  difficultyFilter: DifficultyFilter;
  /**
   * Key-mode filter for the bar list. `'ALL'` shows every chart; the named values restrict the list to the charts of
   * that key mode. Mirrors `#SRC_BUTTON,type=11` cycling (LR2's ops 160=7K..164=9K); beatoraja's MODE button adds the
   * 24-key modes.
   */
  keysFilter: KeysFilter;
  /**
   * Sort order for the bar list. Mirrors `#SRC_BUTTON,type=12` cycling (off / level / title / clear); beatoraja's SORT
   * button adds artist, genre, BPM, notes and last play (see `BrowseSort`).
   */
  sort: BrowseSort;
  /**
   * HS-FIX mode picked from `#SRC_BUTTON,type=55`. Without HS-FIX (`'OFF'`) the visual scroll rate scales with the
   * chart's BPM, so high-BPM sections fly past while low-BPM sections crawl. The other modes apply a one-time HS
   * multiplier so the user's chosen HS feels consistent across the chart:
   *
   * - `'MAXBPM'` — pegs the user's HS to the chart's MAX BPM (slower segments scroll proportionally slower).
   * - `'STARTBPM'` — pegs to the chart's starting BPM (the header BPM, independently of `#BASEBPM`).
   * - `'MINBPM'` — pegs to MIN BPM (faster segments scroll faster).
   * - `'AVERAGE'` — pegs to the main BPM, the BPM the most notes sit at (beatoraja's MAINBPM), which BPM × N + STOP
   *   gimmicks do not skew the way a time average is.
   * - `'CONSTANT'` — adjusts HS at every BPM change so visual scroll is exactly constant. Falls back to `'AVERAGE'`
   *   behavior for now (per-frame BPM-aware scroll requires a render-pipeline change that hasn't landed yet).
   */
  hsFix: HSFix;
  /** AC 34 display-area information visibility; OFF keeps readouts controlled by the skin. */
  displayAreaInfo: 'OFF' | 'ON' | 'SUDDEN_ONLY' | 'HIDDEN_LIFT_ONLY';
  /**
   * 1P-side HIDDEN / SUDDEN effect picked from `#SRC_BUTTON,type=50`. Cycles OFF → HIDDEN → SUDDEN → HID+SUD on each
   * click. Drives the opaque mask over the 1P keyboard / scratch lanes. SP charts only render this side; DP charts pair
   * it with {@link hiddenSudden2P}.
   */
  hiddenSudden1P: HiddenSuddenMode;
  /**
   * 2P-side HIDDEN / SUDDEN effect picked from `#SRC_BUTTON,type=51`. Independent from the 1P value — LR2's panel UI
   * exposes per-side cycle buttons because real players sometimes want, e.g., HIDDEN on their dominant side and OFF on
   * the other.
   */
  hiddenSudden2P: HiddenSuddenMode;
  /**
   * Shutter / LANE COVER coverage (0..1) — the fraction of the playfield the LANE COVER (and any active HIDDEN / SUDDEN
   * masks) occupies. Drives slider `type=4 / 5` on the panel-1 shutter track. Adjustable via the 1P 4-key / 6-key
   * (`KeyD` / `KeyF`) when panel 1 is open. Independent from {@link laneCover} — height is preserved across ON/OFF
   * toggles so the user doesn't have to redial it after re-enabling the cover.
   */
  shutter: number;
  /**
   * LANE COVER ON / OFF toggle. In LR2's SYSTEM OPTION panel this is the binary state shown next to the "LANE COVER"
   * label — distinct from {@link shutter} (which is the height). When OFF, the gameplay-side mask is hidden regardless
   * of `shutter`. When ON, the mask renders at the `shutter`-derived height.
   */
  laneCover: boolean;
  /** beatoraja LIFT: stored fraction retained while disabled, independently per play side. */
  lift1P: number;
  lift2P: number;
  liftOn1P: boolean;
  liftOn2P: boolean;
  /** beatoraja 0.8.9's three launcher choices. */
  judgeAlgorithm: 'combo' | 'duration' | 'lowest';
  /** AC LEGACY NOTE removes CN/BSS; beatoraja REMOVE removes every long note. */
  longNoteModifier: 'OFF' | 'LEGACY' | 'REMOVE';
  /**
   * 1P side auto-scratch flag picked from `#SRC_BUTTON,type=44`. When true the scratch lane (channel 16) auto-judges as
   * PERFECT at every note's scheduled time, so the player only has to play the keys.
   */
  autoScratch1P: boolean;
  /** 2P side auto-scratch (`#SRC_BUTTON,type=45`, channel 26). */
  autoScratch2P: boolean;
  /**
   * DP FLIP toggle picked from `#SRC_BUTTON,type=54`. When true, 1P and 2P lane channels are swapped at chart-prepare
   * time. Only DP charts have lanes on both sides, so SP charts are unaffected. LR2 has no dedicated op for DP FLIP —
   * it's a pure gameplay-side transformation.
   */
  dpFlip: boolean;
  /**
   * Note-arrangement mode for the 1P keyboard lanes (channels 11..15 + 18 + 19). Mirrors `#SRC_BUTTON,type=42`. Scratch
   * (channel 16) is never touched.
   *
   * - `OFF` — original chart layout
   * - `MIRROR` — reverse the lane order (1↔7, 2↔6, 3↔5)
   * - `RANDOM` — chart-wide random permutation of the lanes
   * - `R-RANDOM` — chart-wide cyclic rotation, optionally reflected, excluding regular and mirror
   * - `S-RANDOM` — per-chord random assignment (chord shapes are NOT preserved)
   * - `H-RANDOM` — beatoraja per-row random assignment with a configurable jack threshold
   * - `SPIRAL` — beatoraja row rotations, frozen during active holds
   * - `CONVERGE` — LR2 concentration onto the selected lane with free-key collision fallback
   * - `SCATTER` — legacy value, disabled until placement and assist policy are implemented
   */
  random1P: RandomMode;
  /** beatoraja H-RANDOM jack threshold in 16th-note BPM units (1..1000, default 120). */
  hRandomThresholdBPM: number;
  /** LR2 randFix key index: 0 uses the mode default (scratch, or key 5 for PMS). */
  randomFixedLane1P: number;
  randomFixedLane2P: number;
  /** 2P side note arrangement (channels 21..25 + 28 + 29). */
  random2P: RandomMode;
  /**
   * 1P gauge variant (`#SRC_BUTTON,type=40`):
   *
   * - `GROOVE` — LR2 default cumulative gauge (start 20 %, clear 80 %)
   * - `HARD` — survival gauge (start 100 %, fail at 0 %)
   * - `DEATH` — instant-death (start 100 %, any miss = 0)
   * - `EASY` — gentler GROOVE (clear 60 %)
   */
  gauge1P: GaugeType;
  /** 2P gauge variant (`#SRC_BUTTON,type=41`). */
  gauge2P: GaugeType;
}

/** Allowed values for {@link PlayOptions.hsFix}. */
export type HSFix = 'OFF' | 'MAXBPM' | 'MINBPM' | 'AVERAGE' | 'CONSTANT' | 'STARTBPM';

/** Allowed values for {@link PlayOptions.hiddenSudden1P} / `hiddenSudden2P`: which ends of the lanes are covered. */
export type HiddenSuddenMode = 'OFF' | 'HIDDEN' | 'SUDDEN' | 'HID+SUD';

/** Lane-option names. Legacy SCATTER stays representable but is not an accepted new play choice. */
export type RandomMode =
  | 'OFF'
  | 'MIRROR'
  | 'RANDOM'
  | 'R-RANDOM'
  | 'S-RANDOM'
  | 'SPIRAL'
  | 'H-RANDOM'
  | 'CONVERGE'
  | 'SCATTER';

/** Allowed values for {@link PlayOptions.bga}. */
export type BGAMode = 'OFF' | 'ON' | 'AUTOPLAY_ONLY';

/** Allowed values for {@link PlayOptions.bgaSize}. */
export type BGASize = 'NORMAL' | 'EXTEND';

/** The choices of each enum / on-off play option, in their LR2 button cycle order: what a skin can pick from. */
export type PlayOptionChoices = {
  readonly [K in keyof PlayOptions]?: readonly PlayOptions[K][];
};

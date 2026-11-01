import type { BattleMode, LR2ExtraLevel } from '@be-music/player-engine/lanes';
import type { MineModifier, LongNoteModifier, ScrollModifier } from '@be-music/player-engine/lanes';
import type { GaugeType, GaugeAutoShift, QualifiedOptionValue } from '@be-music/player-engine/ruleset';
import type { JudgeTimingAutoAdjust } from '@be-music/player-engine/display';
import type { BrowseSort, DifficultyFilter, KeysFilter } from '../browse/list-options.ts';

/**
 * Per-session gameplay tweaks the player picks on the select screen: hi-speed, autoplay, note arrangement, gauge type,
 * HIDDEN / SUDDEN and the lane cover, BGA display, and the list's sort and filters. The host owns the live values and
 * hands them to every play it launches; be-music skins read them from `BeMusicSelectFrame.playOptions` /
 * `BeMusicDecideFrame.playOptions` and change them through `BeMusicSelectActions.setPlayOption` / `cyclePlayOption`.
 * Several fields mirror an LR2 `#SRC_BUTTON` type, noted per field.
 */
export interface PlayOptions {
  /** bmson zero-total recovery policy, shared by every skin family. */
  bmsonTotalMode: import('@be-music/player-engine/ruleset').BmsonTotalMode;
  /**
   * Visual scroll-speed multiplier. The chart's note-to-second mapping is unchanged; only the on-screen pixels-per-beat
   * scaling moves. Range matches gameplay's runtime adjust hotkeys (`ArrowUp` / `ArrowDown` during play).
   */
  hiSpeed: number;
  /** AC 34 CLASSIC HI-SPEED; false retains the source default controls. */
  classicHiSpeed: boolean;
  /** AC 32 measured FLOATING HI-SPEED, with source cover coupling and 0.5 keyboard steps. */
  floatingHiSpeed: boolean;
  /** AC 34 locks cover/LIFT geometry; floating START-double restores the initial visible time. */
  fixedDisplayArea: boolean;
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
   * AC 34 BPM-change warning: `<current> » <next>` in a framed box on the lanes, from 2 s of chart time before each BPM
   * change until the change (blue when the tempo rises, red when it falls).
   */
  bpmChangeWarning: boolean;
  /**
   * The automatic judge-timing adjustment of a manual play: beatoraja 0.8.9's calibration on PG/GR/GD, or LR2's ON /
   * SILENT (`autojudge` 1 / 2: a 1 ms step per ten hits; SILENT also loads no keysounds, BGM or BGA and hides the judge
   * display). Display-only; AUTO and replays never adjust. Stored settings and replays from before the modes hold a
   * boolean, read as `'BEATORAJA'` / `'OFF'`.
   */
  judgeTimingAutoAdjust: JudgeTimingAutoAdjust;
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
   * - `'CONSTANT'` — LR2's fixed 150-BPM distance map, pausing on STOP and ignoring unsupported #SCROLL/#SPEED.
   *   Distinct from beatoraja visual CONSTANT, which limits note visibility instead.
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
  longNoteModifier: LongNoteModifier;
  /** beatoraja ADD probability, 0..1, default 1. */
  longNoteRate: number;
  /** beatoraja EXTRA; source type selector is unimplemented upstream. */
  extraNoteDepth: number;
  extraNoteScratch: boolean;
  sevenToNinePattern: import('@be-music/player-engine/lanes').SevenToNinePattern;
  sevenToNineType: import('@be-music/player-engine/lanes').SevenToNineType;
  battleMode: BattleMode;
  /** LR2 D-BATTLE: hold the scratch key through the decide animation to keep scratch objects playable. */
  dBattleScratch: boolean;
  /**
   * That-Which-Must-Not-Be-Named M-RAN per player (two-player play only): MIRROR applied after a RANDOM-type arrangement,
   * so a player with it plays the mirror image of the other's chart.
   */
  mRan1P: boolean;
  mRan2P: boolean;
  /** beatoraja CUSTOM JUDGE (`PlayerConfig.customJudge`) and its window / long-note margin rates in percent. */
  /** beatoraja LN MODE (`PlayerConfig.lnmode`): the mode of a chart whose long-note mode is undefined. */
  longNoteMode: 'LN' | 'CN' | 'HCN';
  customJudge: boolean;
  /**
   * beatoraja PRACTICE (`PracticeProperty`): play only `practiceStartMs`..`practiceEndMs` (0 = the chart's end) and
   * play the range again when it ends. A 0 judgerank or TOTAL keeps the chart's; `MODE` keeps the play mode's gauge
   * category.
   */
  practice: boolean;
  practiceStartMs: number;
  practiceEndMs: number;
  practiceGauge: PracticeGaugeType;
  practiceGaugeCategory: PracticeGaugeCategory;
  practiceStartGauge: number;
  practiceJudgeRank: number;
  practiceTotal: number;
  customJudgeKeyPerfectGreat: number;
  customJudgeKeyGreat: number;
  customJudgeKeyGood: number;
  customJudgeScratchPerfectGreat: number;
  customJudgeScratchGreat: number;
  customJudgeScratchGood: number;
  customJudgeLongNoteMargin: number;
  lr2ExtraMode: boolean;
  lr2ExtraLevel: LR2ExtraLevel;
  mineModifier: MineModifier;
  /** beatoraja timeline BPM/STOP/SCROLL removal or generated SCROLL, independent of visual CONSTANT. */
  scrollModifier: ScrollModifier;
  /** beatoraja ADD: change every 1..1024 section lines (default 4), with width 0..1 (default 0.5). */
  scrollSection: number;
  scrollRate: number;
  /** beatoraja: continue judging with the selected dead gauge, or stop on failure. */
  gaugeAutoShift: GaugeAutoShift;
  bottomShiftableGauge: import('@be-music/player-engine/ruleset').GaugeShiftBottom;
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
   * - `RANDOM-EX` — beatoraja chart-wide permutation including scratches/wheels
   * - `ALL-SCR` — beatoraja scratch priority with time-based fallback
   * - `CONVERGE` — LR2 selected-lane concentration, or beatoraja PMS streak-based concentration
   * - `SCATTER` — LR2 previous-row avoidance, with active-LN reservations
   * - `SCATTER-CORRECTED` — explicitly corrected 9KEY SCATTER, excluding LR2 beta3's tenth destination
   * - `SYNCHRONIZE-RANDOM` — That-Which-Must-Not-Be-Named BATTLE: one RANDOM draw, identical on both sides
   * - `SYMMETRY-RANDOM` — That-Which-Must-Not-Be-Named BATTLE: one RANDOM draw, mirrored on the 2P side
   *
   * RANDOM, S-RANDOM and CONVERGE name a different algorithm in each source, so they carry it (`lr2:RANDOM`,
   * `beatoraja:S-RANDOM`); a bare one runs the judge ruleset's own (ADR 0019).
   */
  random1P: RandomMode;
  /** beatoraja H-RANDOM jack threshold in 16th-note BPM units (1..1000, default 120). */
  hRandomThresholdBPM: number;
  /** LR2 randFix key index: 0 uses the mode default (scratch, or key 5 for PMS). */
  randomSeed1P: string;
  randomSeed2P: string;
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

/**
 * Lane-option values; resolveRandomModes supplies the choices. A source-qualified RANDOM, S-RANDOM or CONVERGE runs its
 * source's algorithm under every ruleset, and a bare one the judge ruleset's own (ADR 0019).
 */
export type RandomMode =
  | QualifiedOptionValue<'RANDOM' | 'S-RANDOM' | 'CONVERGE'>
  | 'OFF'
  | 'MIRROR'
  | 'RANDOM'
  | 'R-RANDOM'
  | 'S-RANDOM'
  | 'SPIRAL'
  | 'H-RANDOM'
  | 'ALL-SCR'
  | 'RANDOM-EX'
  | 'S-RANDOM-EX'
  | 'RANDOM_PLAYABLE'
  | 'S_RANDOM_PLAYABLE'
  | 'CONVERGE'
  | 'SCATTER'
  | 'SCATTER-CORRECTED'
  | 'SYNCHRONIZE-RANDOM'
  | 'SYMMETRY-RANDOM';

/** Allowed values for {@link PlayOptions.practiceGauge}: beatoraja PRACTICE's GAUGE TYPE. */
export type PracticeGaugeType =
  (typeof import('@be-music/player-engine/ruleset').BEATORAJA_PRACTICE_GAUGE_TYPES)[number];

/** Allowed values for {@link PlayOptions.practiceGaugeCategory}: `MODE` or a beatoraja GAUGE CATEGORY. */
export type PracticeGaugeCategory = 'MODE' | import('@be-music/player-engine/ruleset').BeatorajaGaugeCategory;

/** Allowed values for {@link PlayOptions.bga}. */
export type BGAMode = 'OFF' | 'ON' | 'AUTOPLAY_ONLY';

/** Allowed values for {@link PlayOptions.bgaSize}. */
export type BGASize = 'NORMAL' | 'EXTEND';

/** The choices of each enum / on-off play option, in their LR2 button cycle order: what a skin can pick from. */
export type PlayOptionChoices = {
  readonly [K in keyof PlayOptions]?: readonly PlayOptions[K][];
};

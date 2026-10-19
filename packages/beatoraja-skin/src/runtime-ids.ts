// Named beatoraja runtime timer IDs, op-codes, and text references.
//
// Skins reference engine state through four numeric ID spaces:
//   - `timer` IDs (per-element animation clock; element fades / cycles relative to when the timer fires)
//   - `op` IDs (visibility gate via `if[]` / `op[]` — boolean engine state codes)
//   - `ref` IDs on `image[]` (frame index inside the cell strip)
//   - `ref` IDs on `text[]` (string content the runtime resolves)
//
// All IDs in this file are verified against ovnz/blanket's `prop.lua`
// (https://github.com/ovnz/blanket/blob/main/prop.lua), the de-facto authoritative reference for
// beatoraja's `SkinPropertyMapper` enumeration. `prop.lua` is the same table community skins import
// when they want named access to op / timer / text codes; tracking it keeps us in lockstep with what the
// reference theme and most third-party themes actually emit.
//
// IMPORTANT — DO NOT make up values. An earlier draft of this file used best-guess constants that
// silently collided with unrelated codes (e.g. our `P1_JUDGE_PG: 50` was beatoraja's `bomb_1p_scratch`
// timer; our `LOAD_END: 2` was `fadeout`). Skins that gated chrome on those slots would either show the
// wrong thing or stay invisible during gameplay. Every entry below quotes its `prop.lua` name in the
// JSDoc so future additions stay verifiable.
//
// beatoraja keeps LR2's numbers for its LR2-compatible ids, so those entries take their value from
// `@be-music/lr2-skin/ids` (`LR2_OP` / `LR2_TIMER` / `LR2_NUM` / `LR2_TEXT` / `LR2_BUTTON`) under the beatoraja name;
// only beatoraja's own ids are numbered here. (`X as typeof X` keeps the literal type under `isolatedDeclarations`.)

import { LR2_BUTTON, LR2_LANE_INDEX_MAX, LR2_NUM, LR2_OP, LR2_TEXT, LR2_TIMER } from '@be-music/lr2-skin/ids';

/**
 * Discriminator for a beatoraja "side" — single-play / 1P-side of double / first-half of 9key uses `1`;
 * 2P side of double / second half of 9key uses `2`. The 9key extension (PMS) collapses both physical
 * sides onto side `1` from beatoraja's perspective; the renderer-side resolver translates lane channels
 * into the corresponding side before calling these helpers.
 */
/**
 * Identifies which judge / combo plate index a given judgement belongs to.
 *
 * For SP / DP variants this maps 1-to-1 onto the 1P / 2P player concept:
 *   - `1` — 1P side (channels `1X`, plate index 0 in skin authoring).
 *   - `2` — 2P side (channels `2X`, plate index 1).
 *
 * For POPN-9 (`chartPlayVariant === '9'`) the skin authors THREE judge / combo plates over the
 * single playfield — one per 3-lane group — and upstream's `JudgeManager.notifyJudge`
 * (`JudgeManager.java:700`) dispatches each judgement to a plate via
 * `judgeindex = state.lane / (lanelength / judgenow.length)`. The third plate uses dedicated
 * upstream timer / op constants (`TIMER_JUDGE_3P = 247`, `TIMER_COMBO_3P = 448`, `OPTION_3P_*`
 * = 361 / 362 / 363 / 1362 / 1363), so we extend the side enum to `3` here. Lane-timer banks
 * (bomb / key-on / LN-hold) still only use sides `1` / `2` and collapse onto `1` under POPN-9.
 */
export type BeatorajaSide = 1 | 2 | 3;

// ─── Built-in scene timers ──────────────────────────────────────────────────────────────────────────
// Sources: prop.lua `local timer = { ... }`. Names mirror prop.lua's; we keep the `TIMER_` prefix for
// import readability.

/** Anchored at the moment the play scene mounts. Always-on for elements with `timer = 0`. */
export const TIMER_SCENE_START: typeof LR2_TIMER.SCENE_START = LR2_TIMER.SCENE_START;
/** prop.lua `startinput` — fires when input becomes responsive (during loading lead-in). */
export const TIMER_STARTINPUT: typeof LR2_TIMER.START_INPUT = LR2_TIMER.START_INPUT;
/** prop.lua `fadeout` — fires when the result fade-out starts. NOT a load-end signal! */
export const TIMER_FADEOUT: typeof LR2_TIMER.FADE_OUT = LR2_TIMER.FADE_OUT;
/** prop.lua `failed` — fires on the failed verdict (gauge below clear threshold at chart end). */
export const TIMER_FAILED: typeof LR2_TIMER.FAILED = LR2_TIMER.FAILED;
/** prop.lua `ready` — fires when the READY display flashes (≈ LR2 PLAY START − N ms). */
export const TIMER_READY: typeof LR2_TIMER.READY = LR2_TIMER.READY;
/** prop.lua `play` — fires when the chart begins audible playback. */
export const TIMER_PLAY: typeof LR2_TIMER.PLAY = LR2_TIMER.PLAY;

/**
 * prop.lua `songbar_change = 11` — restarts every time the focused song bar changes (cursor
 * up / down / page jump / folder enter-leave). Select-scene chrome whose authoring keys
 * `timer = MAIN.TIMER.SONGBAR_CHANGE` (e.g., ModernChic's `musicdisplay.lua` for title /
 * genre / artist text panels) needs this stamp re-fired on every cursor move so the
 * destination's loop animation replays from t=0.
 *
 * Without re-stamping, destinations keyed on the timer return `undefined` from
 * `getTimerStart` and stay hidden — visible to the user as "the left-side song info panel
 * (title / artist / genre) never appears".
 */
export const TIMER_SONGBAR_CHANGE: typeof LR2_TIMER.SONG_BAR_CHANGE = LR2_TIMER.SONG_BAR_CHANGE;

/** prop.lua `judge_1p` — restarts on every judgement on side 1. */
export const TIMER_JUDGE_1P: typeof LR2_TIMER.JUDGE_1P = LR2_TIMER.JUDGE_1P;
/** prop.lua `judge_2p` — restarts on every judgement on side 2. */
export const TIMER_JUDGE_2P: typeof LR2_TIMER.JUDGE_2P = LR2_TIMER.JUDGE_2P;
/**
 * prop.lua `judge_3p = 247` — restarts on every judgement on side 3. Only POPN-9 (and any
 * other layout with `judgenow.length >= 3` in the skin's `judge[]` declarations) addresses
 * this slot; the upstream `play9.json` default skin authors its right-most judge plate
 * (`id: 2012, index: 2`) against it.
 */
export const TIMER_JUDGE_3P = 247;

/** prop.lua `combo_1p` / `combo_2p` / `combo_3p` — restarts when the combo counter advances. */
export const TIMER_COMBO_1P = 446;
export const TIMER_COMBO_2P = 447;
/** prop.lua `combo_3p = 448` — POPN-9 third combo plate. See {@link TIMER_JUDGE_3P}. */
export const TIMER_COMBO_3P = 448;

/** prop.lua `endofnote_1p` / `endofnote_2p` — fires at the last note of each side. */
export const TIMER_ENDOFNOTE_1P = 143;
export const TIMER_ENDOFNOTE_2P = 144;

/** prop.lua `rhythm` — beat-pulse timer the skin uses for "every beat" glow effects. */
export const TIMER_RHYTHM: typeof LR2_TIMER.RHYTHM = LR2_TIMER.RHYTHM;

/**
 * prop.lua `preview = 141` — fires when the chart's "preview" state begins (post-decode,
 * pre-audible-playback). ModernChic gates its lane chrome reveal on this so the playfield
 * fades in once the chart has finished loading. Stamped at scene-start in our runtime since
 * we don't have a separate preview phase.
 */
export const TIMER_PREVIEW = 141;

/** prop.lua `fullcombo_1p = 48` — fires once at end-of-chart when 1P side has a full combo. */
export const TIMER_FULLCOMBO_1P: typeof LR2_TIMER.FULL_COMBO_1P = LR2_TIMER.FULL_COMBO_1P;
/** prop.lua `fullcombo_2p = 49`. */
export const TIMER_FULLCOMBO_2P: typeof LR2_TIMER.FULL_COMBO_2P = LR2_TIMER.FULL_COMBO_2P;

/**
 * prop.lua `gauge_inclease_1p = 42` (note: beatoraja's actual spelling is "INCLEASE", a typo
 * of "INCREASE" preserved for skin-author compatibility). Re-stamped on every judge that
 * gains gauge — skins author a brief sparkle / flash animation gated on it.
 */
export const TIMER_GAUGE_INCREASE_1P: typeof LR2_TIMER.GAUGE_UP_1P = LR2_TIMER.GAUGE_UP_1P;
/** prop.lua `gauge_inclease_2p = 43`. */
export const TIMER_GAUGE_INCREASE_2P: typeof LR2_TIMER.GAUGE_UP_2P = LR2_TIMER.GAUGE_UP_2P;
/**
 * prop.lua `gauge_max_1p = 44` — fires once when 1P gauge first reaches 100%. Skins author
 * a "max gauge" celebration lamp gated on it.
 */
export const TIMER_GAUGE_MAX_1P: typeof LR2_TIMER.GAUGE_MAX_1P = LR2_TIMER.GAUGE_MAX_1P;
/** prop.lua `gauge_max_2p = 45`. */
export const TIMER_GAUGE_MAX_2P: typeof LR2_TIMER.GAUGE_MAX_2P = LR2_TIMER.GAUGE_MAX_2P;

// ─── Per-lane timer bases (1P side) ──────────────────────────────────────────────────────────────
//
// The `0` slot is SCRATCH on every category; keys 1..9 follow. So `bombTimerId(1, 0) = 50` is
// `bomb_1p_scratch`, `bombTimerId(1, 1) = 51` is `bomb_1p_key1`, … (matches prop.lua exactly).

/** prop.lua `bomb_1p_scratch = 50` … `bomb_1p_key9 = 59`. */
export const TIMER_BOMB_1P_BASE: typeof LR2_TIMER.BOMB_1P = LR2_TIMER.BOMB_1P;
/** prop.lua `bomb_2p_scratch = 60` … `bomb_2p_key9 = 69`. */
export const TIMER_BOMB_2P_BASE: typeof LR2_TIMER.BOMB_2P = LR2_TIMER.BOMB_2P;

/** prop.lua `hold_1p_scratch = 70` … `hold_1p_key9 = 79` (LN hold-effect timer). */
export const TIMER_LN_HOLD_1P_BASE: typeof LR2_TIMER.LN_HOLD_1P = LR2_TIMER.LN_HOLD_1P;
/** prop.lua `hold_2p_scratch = 80` … `hold_2p_key9 = 89`. */
export const TIMER_LN_HOLD_2P_BASE: typeof LR2_TIMER.LN_HOLD_2P = LR2_TIMER.LN_HOLD_2P;

/** prop.lua `keyon_1p_scratch = 100` … `keyon_1p_key9 = 109`. */
export const TIMER_KEY_ON_1P_BASE: typeof LR2_TIMER.KEY_ON_1P = LR2_TIMER.KEY_ON_1P;
/** prop.lua `keyon_2p_scratch = 110` … `keyon_2p_key9 = 119`. */
export const TIMER_KEY_ON_2P_BASE: typeof LR2_TIMER.KEY_ON_2P = LR2_TIMER.KEY_ON_2P;

/** prop.lua `keyoff_1p_scratch = 120` … `keyoff_1p_key9 = 129`. */
export const TIMER_KEY_OFF_1P_BASE: typeof LR2_TIMER.KEY_OFF_1P = LR2_TIMER.KEY_OFF_1P;
/** prop.lua `keyoff_2p_scratch = 130` … `keyoff_2p_key9 = 139`. */
export const TIMER_KEY_OFF_2P_BASE: typeof LR2_TIMER.KEY_OFF_2P = LR2_TIMER.KEY_OFF_2P;

// ─── 24-key extensions ─────────────────────────────────────────────────────────────────────────
//
// Lane indices ≥ 10 fall outside the single-digit range. prop.lua names the bases via `bomb_1p_key10 =
// 1010` etc., consistent with `play24main.lua`'s `index <= 9 ? 50 + index : 1000 + index` formula.

export const TIMER_BOMB_EXT_BASE = 1000;
export const TIMER_LN_HOLD_EXT_BASE = 1200;
export const TIMER_KEY_ON_EXT_BASE = 1400;
export const TIMER_KEY_OFF_EXT_BASE = 1600;

/**
 * Offset of the 2P bank within each 1000-block extension: upstream `SkinPropertyMapper` adds `player * 100` to the
 * `*_1P_KEY10` base, so 2P key 10 is `1110`, and the 48 KEY 2P wheel (lanes 25 / 26) `1125` / `1126`.
 */
const TIMER_EXT_2P_OFFSET = 100;

/** Maximum lane index addressable by the 1P / 2P bases (inclusive). Above this falls into 1000+ space. */
export { LR2_LANE_INDEX_MAX };

/**
 * Per-side base for a given timer category, returning the value to which a 0..N lane index is added.
 * Lanes 0..9 use the side-relative base; 10+ uses the 1000-block extension, offset by 100 for 2P.
 *
 * Lane-timer banks only distinguish 1P / 2P (there is no per-plate `bomb_3p_keyN` bank in
 * upstream — POPN-9's bombs / key-on / LN-hold all share the 1P-side bank), so a `side === 3`
 * caller falls through to the 1P bank. In practice the adapter's `resolveSide` collapses every
 * channel onto side 1 under POPN-9 so this fallback is defensive — the side-3 plate is only
 * meaningful for `judgeTimerId` / `comboTimerId` / `judgeOpForKind`.
 */
function timerBase(category: 'bomb' | 'lnHold' | 'keyOn' | 'keyOff', side: BeatorajaSide, isExt: boolean): number {
  const usePlayer2 = side === 2;
  if (isExt) {
    const sideOffset = usePlayer2 ? TIMER_EXT_2P_OFFSET : 0;
    switch (category) {
      case 'bomb':
        return TIMER_BOMB_EXT_BASE + sideOffset;
      case 'lnHold':
        return TIMER_LN_HOLD_EXT_BASE + sideOffset;
      case 'keyOn':
        return TIMER_KEY_ON_EXT_BASE + sideOffset;
      case 'keyOff':
        return TIMER_KEY_OFF_EXT_BASE + sideOffset;
    }
  }
  switch (category) {
    case 'bomb':
      return usePlayer2 ? TIMER_BOMB_2P_BASE : TIMER_BOMB_1P_BASE;
    case 'lnHold':
      return usePlayer2 ? TIMER_LN_HOLD_2P_BASE : TIMER_LN_HOLD_1P_BASE;
    case 'keyOn':
      return usePlayer2 ? TIMER_KEY_ON_2P_BASE : TIMER_KEY_ON_1P_BASE;
    case 'keyOff':
      return usePlayer2 ? TIMER_KEY_OFF_2P_BASE : TIMER_KEY_OFF_1P_BASE;
  }
}

function laneTimerId(
  category: 'bomb' | 'lnHold' | 'keyOn' | 'keyOff',
  side: BeatorajaSide,
  lane: number,
): number | undefined {
  // `lane === 0` is scratch — explicitly accepted. Negative or non-integer lanes are rejected so a stray
  // engine event that produces an out-of-range slot doesn't quietly stamp the wrong timer.
  if (!Number.isInteger(lane) || lane < 0) return undefined;
  return timerBase(category, side, lane > LR2_LANE_INDEX_MAX) + lane;
}

/** Bomb timer for `(side, lane)` — `lane === 0` is scratch. Returns `undefined` for negative / non-int lanes. */
export function bombTimerId(side: BeatorajaSide, lane: number): number | undefined {
  return laneTimerId('bomb', side, lane);
}

/** LN hold-effect timer for `(side, lane)`. */
export function lnHoldTimerId(side: BeatorajaSide, lane: number): number | undefined {
  return laneTimerId('lnHold', side, lane);
}

/** Key-on (lane laser) timer for `(side, lane)`. */
export function keyOnTimerId(side: BeatorajaSide, lane: number): number | undefined {
  return laneTimerId('keyOn', side, lane);
}

/** Key-off (release fade) timer for `(side, lane)`. */
export function keyOffTimerId(side: BeatorajaSide, lane: number): number | undefined {
  return laneTimerId('keyOff', side, lane);
}

/** Per-side judge timer (`46` for 1P, `47` for 2P, `247` for the POPN-9 third plate). */
export function judgeTimerId(side: BeatorajaSide): number {
  return side === 1 ? TIMER_JUDGE_1P : side === 2 ? TIMER_JUDGE_2P : TIMER_JUDGE_3P;
}

/**
 * Per-side combo timer (prop.lua `combo_1p = 446`, `combo_2p = 447`, `combo_3p = 448`). Restarts
 * when the combo advances on this plate. POPN-9 uses three plates, so the third entry is real
 * runtime state — not a skin-only constant.
 */
export function comboTimerId(side: BeatorajaSide): number {
  return side === 1 ? TIMER_COMBO_1P : side === 2 ? TIMER_COMBO_2P : TIMER_COMBO_3P;
}

/**
 * Per-side end-of-note timer (prop.lua `endofnote_1p = 143`, `endofnote_2p = 144`). No upstream
 * `endofnote_3p` — POPN-9's "end of chart" cue collapses onto 1P, so a `side === 3` caller falls
 * through to the 1P slot.
 */
export function endOfNoteTimerId(side: BeatorajaSide): number {
  return side === 2 ? TIMER_ENDOFNOTE_2P : TIMER_ENDOFNOTE_1P;
}

// ─── Runtime op-codes ──────────────────────────────────────────────────────────────────────────────
// Sources: prop.lua `local op = { ... }`. The codes below are the runtime-only ops the adapter sets
// during gameplay; option ops (the user's confirmed `skin_config.option` picks) flow separately through
// `buildBaseOpSet`.

export const BEATORAJA_OP = {
  /** prop.lua `now_loading = 80`. */
  NOW_LOADING: LR2_OP.LOADING as typeof LR2_OP.LOADING,
  /** prop.lua `loaded = 81`. */
  LOADED: LR2_OP.LOADED as typeof LR2_OP.LOADED,

  // ─── IR / save-state / replay ops (50, 51, 60-66, 82-84) ──────────────────────────────────
  // SkinProperty: OFFLINE / ONLINE — IR (online ranking) connection state. We have no IR
  // integration today so the select scene fires OFFLINE; chrome that gates on ONLINE stays
  // hidden, OFFLINE-gated chrome shows.
  OFFLINE: LR2_OP.OFFLINE as typeof LR2_OP.OFFLINE,
  ONLINE: LR2_OP.ONLINE as typeof LR2_OP.ONLINE,
  // Save-state ops — declare whether the DB will save this run's score / clear lamp. Without a
  // score DB we permanently fire DISABLE_SAVE_SCORE / NO_SAVE_CLEAR; chrome that gates on the
  // ENABLE_* / *_SAVE_CLEAR variants stays hidden.
  DISABLE_SAVE_SCORE: LR2_OP.SCORE_SAVE_OFF as typeof LR2_OP.SCORE_SAVE_OFF,
  ENABLE_SAVE_SCORE: LR2_OP.SCORE_SAVE_ON as typeof LR2_OP.SCORE_SAVE_ON,
  NO_SAVE_CLEAR: LR2_OP.CLEAR_SAVE_OFF as typeof LR2_OP.CLEAR_SAVE_OFF,
  EASY_SAVE_CLEAR: LR2_OP.CLEAR_SAVE_EASY as typeof LR2_OP.CLEAR_SAVE_EASY,
  NORMAL_SAVE_CLEAR: LR2_OP.CLEAR_SAVE_NORMAL as typeof LR2_OP.CLEAR_SAVE_NORMAL,
  HARD_SAVE_CLEAR: LR2_OP.CLEAR_SAVE_HARD as typeof LR2_OP.CLEAR_SAVE_HARD,
  FULLCOMBO_SAVE_CLEAR: LR2_OP.CLEAR_SAVE_FULL_COMBO as typeof LR2_OP.CLEAR_SAVE_FULL_COMBO,
  // Replay system state — we have no replay capture / playback today, so REPLAY_OFF fires
  // permanently. Chrome that gates on REPLAY_RECORDING / REPLAY_PLAYING stays hidden.
  REPLAY_OFF: LR2_OP.REPLAY_OFF as typeof LR2_OP.REPLAY_OFF,
  REPLAY_RECORDING: LR2_OP.REPLAY_RECORDING as typeof LR2_OP.REPLAY_RECORDING,
  REPLAY_PLAYING: LR2_OP.REPLAY_PLAYING as typeof LR2_OP.REPLAY_PLAYING,

  /** prop.lua `autoplayoff = 32` / `autoplayon = 33`. */
  AUTOPLAY_OFF: LR2_OP.AUTOPLAY_OFF as typeof LR2_OP.AUTOPLAY_OFF,
  AUTOPLAY_ON: LR2_OP.AUTOPLAY_ON as typeof LR2_OP.AUTOPLAY_ON,

  /** prop.lua `bgaoff = 40` / `bgaon = 41`. */
  BGA_OFF: LR2_OP.BGA_OFF as typeof LR2_OP.BGA_OFF,
  BGA_ON: LR2_OP.BGA_ON as typeof LR2_OP.BGA_ON,

  // ─── 1P last-judge op (prop.lua `_1p_*`) ─────────────────────────────────────────────────────
  /** prop.lua `_1p_perfect = 241`. */
  P1_JUDGE_PERFECT: LR2_OP.JUDGE_1P_PERFECT as typeof LR2_OP.JUDGE_1P_PERFECT,
  /** prop.lua `_1p_great = 242`. */
  P1_JUDGE_GREAT: LR2_OP.JUDGE_1P_GREAT as typeof LR2_OP.JUDGE_1P_GREAT,
  /** prop.lua `_1p_good = 243`. */
  P1_JUDGE_GOOD: LR2_OP.JUDGE_1P_GOOD as typeof LR2_OP.JUDGE_1P_GOOD,
  /** prop.lua `_1p_bad = 244`. */
  P1_JUDGE_BAD: LR2_OP.JUDGE_1P_BAD as typeof LR2_OP.JUDGE_1P_BAD,
  /** prop.lua `_1p_poor = 245`. */
  P1_JUDGE_POOR: LR2_OP.JUDGE_1P_POOR as typeof LR2_OP.JUDGE_1P_POOR,
  /** prop.lua `_1p_miss = 246`. */
  P1_JUDGE_MISS: LR2_OP.JUDGE_1P_MISS as typeof LR2_OP.JUDGE_1P_MISS,

  /** prop.lua `_1p_early = 1242` (current judge was on the early side of its window). */
  P1_JUDGE_EARLY: 1242,
  /** prop.lua `_1p_late = 1243` (current judge was on the late side of its window). */
  P1_JUDGE_LATE: 1243,

  // ─── 2P last-judge op (prop.lua `_2p_*`) ─────────────────────────────────────────────────────
  P2_JUDGE_PERFECT: LR2_OP.JUDGE_2P_PERFECT as typeof LR2_OP.JUDGE_2P_PERFECT,
  P2_JUDGE_GREAT: LR2_OP.JUDGE_2P_GREAT as typeof LR2_OP.JUDGE_2P_GREAT,
  P2_JUDGE_GOOD: LR2_OP.JUDGE_2P_GOOD as typeof LR2_OP.JUDGE_2P_GOOD,
  P2_JUDGE_BAD: LR2_OP.JUDGE_2P_BAD as typeof LR2_OP.JUDGE_2P_BAD,
  P2_JUDGE_POOR: LR2_OP.JUDGE_2P_POOR as typeof LR2_OP.JUDGE_2P_POOR,
  P2_JUDGE_MISS: LR2_OP.JUDGE_2P_MISS as typeof LR2_OP.JUDGE_2P_MISS,

  /** prop.lua `_2p_early = 1262`. */
  P2_JUDGE_EARLY: 1262,
  /** prop.lua `_2p_late = 1263`. */
  P2_JUDGE_LATE: 1263,

  // ─── 3P last-judge op (prop.lua `_3p_*`) ─────────────────────────────────────────────────────
  // Only addressed under POPN-9 (`judgenow.length >= 3` in the upstream sense). Upstream
  // `SkinProperty.java:830-834` defines PERFECT / GREAT / EARLY / GOOD / LATE for the 3P plate;
  // BAD / POOR / MISS are intentionally OMITTED upstream (they only exist on `_1p_*` — those
  // verdicts are treated as global combo-breaks and aren't routed to the per-plate flash slot).
  /** prop.lua `_3p_perfect = 361`. */
  P3_JUDGE_PERFECT: 361,
  /** prop.lua `_3p_great = 362`. */
  P3_JUDGE_GREAT: 362,
  /** prop.lua `_3p_good = 363`. */
  P3_JUDGE_GOOD: 363,
  /** prop.lua `_3p_early = 1362`. */
  P3_JUDGE_EARLY: 1362,
  /** prop.lua `_3p_late = 1363`. */
  P3_JUDGE_LATE: 1363,

  // ─── Live rank ops (prop.lua `_1p_aaa = 200` ... `_1p_f = 207`) ────────────────────────────
  // Set live during gameplay from the EX score over the notes judged so far (beatoraja
  // `createNowRank`, `resolveBeatorajaPlayScoreOps`); `computeRankOp` ranks a finished run over
  // every note. Beatoraja's IIDX-derived rank thresholds are (max = notes × 2):
  //
  //   AAA = exScore / max >= 8/9   (~88.9%)
  //   AA  = exScore / max >= 7/9   (~77.8%)
  //   A   = exScore / max >= 6/9   (~66.7%)
  //   B   = exScore / max >= 5/9   (~55.6%)
  //   C   = exScore / max >= 4/9   (~44.4%)
  //   D   = exScore / max >= 3/9   (~33.3%)
  //   E   = exScore / max >= 2/9   (~22.2%)
  //   F   = otherwise
  //
  // Exactly one of these is active at any given moment; the renderer toggles them mutually
  // exclusively via `computeRankOp`.
  P1_RANK_AAA: LR2_OP.RANK_1P_AAA as typeof LR2_OP.RANK_1P_AAA,
  P1_RANK_AA: LR2_OP.RANK_1P_AA as typeof LR2_OP.RANK_1P_AA,
  P1_RANK_A: LR2_OP.RANK_1P_A as typeof LR2_OP.RANK_1P_A,
  P1_RANK_B: LR2_OP.RANK_1P_B as typeof LR2_OP.RANK_1P_B,
  P1_RANK_C: LR2_OP.RANK_1P_C as typeof LR2_OP.RANK_1P_C,
  P1_RANK_D: LR2_OP.RANK_1P_D as typeof LR2_OP.RANK_1P_D,
  P1_RANK_E: LR2_OP.RANK_1P_E as typeof LR2_OP.RANK_1P_E,
  P1_RANK_F: LR2_OP.RANK_1P_F as typeof LR2_OP.RANK_1P_F,

  P2_RANK_AAA: LR2_OP.RANK_2P_AAA as typeof LR2_OP.RANK_2P_AAA,
  P2_RANK_AA: LR2_OP.RANK_2P_AA as typeof LR2_OP.RANK_2P_AA,
  P2_RANK_A: LR2_OP.RANK_2P_A as typeof LR2_OP.RANK_2P_A,
  P2_RANK_B: LR2_OP.RANK_2P_B as typeof LR2_OP.RANK_2P_B,
  P2_RANK_C: LR2_OP.RANK_2P_C as typeof LR2_OP.RANK_2P_C,
  P2_RANK_D: LR2_OP.RANK_2P_D as typeof LR2_OP.RANK_2P_D,
  P2_RANK_E: LR2_OP.RANK_2P_E as typeof LR2_OP.RANK_2P_E,
  P2_RANK_F: LR2_OP.RANK_2P_F as typeof LR2_OP.RANK_2P_F,

  /** Generic active-player rank — most skins use these instead of the side-specific ones. */
  RANK_AAA: 220,
  RANK_AA: 221,
  RANK_A: 222,
  RANK_B: 223,
  RANK_C: 224,
  RANK_D: 225,
  RANK_E: 226,
  RANK_F: 227,

  // ─── Result-scene rank ops (prop.lua `result_*_1p = 300` ... `result_0_1p = 308`) ─────────
  // Same letter-rank logic as the live ops above, but only set on the result scene. Authors
  // typically gate result-screen visuals on these to swap rank graphics by outcome.
  RESULT_RANK_AAA_1P: LR2_OP.RESULT_RANK_AAA as typeof LR2_OP.RESULT_RANK_AAA,
  RESULT_RANK_AA_1P: LR2_OP.RESULT_RANK_AA as typeof LR2_OP.RESULT_RANK_AA,
  RESULT_RANK_A_1P: LR2_OP.RESULT_RANK_A as typeof LR2_OP.RESULT_RANK_A,
  RESULT_RANK_B_1P: LR2_OP.RESULT_RANK_B as typeof LR2_OP.RESULT_RANK_B,
  RESULT_RANK_C_1P: LR2_OP.RESULT_RANK_C as typeof LR2_OP.RESULT_RANK_C,
  RESULT_RANK_D_1P: LR2_OP.RESULT_RANK_D as typeof LR2_OP.RESULT_RANK_D,
  RESULT_RANK_E_1P: LR2_OP.RESULT_RANK_E as typeof LR2_OP.RESULT_RANK_E,
  RESULT_RANK_F_1P: LR2_OP.RESULT_RANK_F as typeof LR2_OP.RESULT_RANK_F,
  /** prop.lua `result_0_1p = 308` — no score (POOR everything). */
  RESULT_RANK_ZERO_1P: LR2_OP.RESULT_RANK_0 as typeof LR2_OP.RESULT_RANK_0,

  // ─── Per-judge "exists" gates (prop.lua `perfect_exist = 2241` …) ─────────────────────────
  // Active when at least one judgement of that kind has been observed this run. Skins use these
  // to fade in judge-count badges only after the first occurrence.
  PERFECT_EXIST: 2241,
  GREAT_EXIST: 2242,
  GOOD_EXIST: 2243,
  BAD_EXIST: 2244,
  POOR_EXIST: 2245,
  MISS_EXIST: 2246,

  // ─── Result outcome (prop.lua `result_clear = 90`, `result_fail = 91`) ────────────────────
  /** Run cleared. Set when `summary.gauge.cleared === true`. */
  RESULT_CLEAR: LR2_OP.RESULT_CLEAR as typeof LR2_OP.RESULT_CLEAR,
  /** Run failed. The complement of {@link RESULT_CLEAR}; one or the other is active. */
  RESULT_FAIL: LR2_OP.RESULT_FAIL as typeof LR2_OP.RESULT_FAIL,

  // ─── Clear-lamp ops (prop.lua `clear_easy = 121` etc.) ────────────────────────────────────
  // We only set the most-fitting one for the live run's outcome. NO_PLAY / FAILED / EASY /
  // NORMAL / HARD / FULLCOMBO are mutually exclusive — picking the highest classification
  // matches beatoraja's "best-of-this-run" semantics.
  CLEAR_LAMP_NOPLAY: LR2_OP.LAMP_NO_PLAY as typeof LR2_OP.LAMP_NO_PLAY,
  CLEAR_LAMP_FAILED: LR2_OP.LAMP_FAILED as typeof LR2_OP.LAMP_FAILED,
  CLEAR_LAMP_ASSIST_EASY: 1100,
  CLEAR_LAMP_LIGHT_ASSIST_EASY: 1101,
  CLEAR_LAMP_EASY: LR2_OP.LAMP_EASY as typeof LR2_OP.LAMP_EASY,
  CLEAR_LAMP_NORMAL: LR2_OP.LAMP_NORMAL as typeof LR2_OP.LAMP_NORMAL,
  CLEAR_LAMP_HARD: LR2_OP.LAMP_HARD as typeof LR2_OP.LAMP_HARD,
  CLEAR_LAMP_EXHARD: 1102,
  CLEAR_LAMP_FULLCOMBO: LR2_OP.LAMP_FULL_COMBO as typeof LR2_OP.LAMP_FULL_COMBO,
  CLEAR_LAMP_PERFECT: 1103,
  CLEAR_LAMP_MAX: 1104,

  // ─── Gauge type ops (prop.lua `gauge_groove = 42` etc.) ───────────────────────────────────
  // The active gauge variant. Beatoraja sets exactly one of these (1P side); skins gate the
  // gauge graphic / clear-threshold marker on the matching op.
  GAUGE_GROOVE: LR2_OP.GAUGE_1P_NORMAL as typeof LR2_OP.GAUGE_1P_NORMAL,
  GAUGE_HARD: LR2_OP.GAUGE_1P_RED as typeof LR2_OP.GAUGE_1P_RED,
  GAUGE_GROOVE_2P: LR2_OP.GAUGE_2P_NORMAL as typeof LR2_OP.GAUGE_2P_NORMAL,
  GAUGE_HARD_2P: LR2_OP.GAUGE_2P_RED as typeof LR2_OP.GAUGE_2P_RED,
  GAUGE_EX: 1046,
  GAUGE_EX_2P: 1047,

  // ─── Chart difficulty ops (SkinProperty `LEVEL_*`, codes 70-79) ───────────────────────────
  // Set per-frame on the select scene based on the focused chart's `#DIFFICULTY` header value
  // (1=BEGINNER, 2=NORMAL, 3=HYPER, 4=ANOTHER, 5=INSANE). The `_EXCEED` variants light up when
  // the chart's playLevel exceeds the slot's typical max (e.g. an INSANE chart at level 12+ lights
  // INSANE_EXCEED on top of INSANE itself); we don't surface that distinction yet.
  LEVEL_BEGINNER: 70,
  LEVEL_NORMAL: 71,
  LEVEL_HYPER: 72,
  LEVEL_ANOTHER: 73,
  LEVEL_INSANE: 74,
  LEVEL_BEGINNER_EXCEED: 75,
  LEVEL_NORMAL_EXCEED: 76,
  LEVEL_HYPER_EXCEED: 77,
  LEVEL_ANOTHER_EXCEED: 78,
  LEVEL_INSANE_EXCEED: 79,

  // ─── LR2-style difficulty ops (SkinProperty `DIFFICULTY_*`, codes 150-155) ────────────────
  // Beatoraja keeps the LR2 dst_option block (150 = UNDEFINED, 151..155 = EASY/NORMAL/HYPER/
  // ANOTHER/INSANE) as aliases for the native LEVEL_* (70-74) block — LR2-derived skins
  // (GdbG_Skin, ModernChic's decide pane via `MAIN.OP.DIFFICULTY1..5/0`) gate per-difficulty
  // chrome on these. We fire BOTH op blocks simultaneously so either flavour of skin renders.
  /** LR2 `OP_DIFFICULTY_UNDEFINED` — `#DIFFICULTY` header missing or 0. */
  DIFFICULTY_UNDEFINED: LR2_OP.DIFFICULTY_UNDEFINED as typeof LR2_OP.DIFFICULTY_UNDEFINED,
  /** LR2 `OP_DIFFICULTY_BEGINNER` (= EASY in some skins) — `#DIFFICULTY 1`. */
  DIFFICULTY_BEGINNER: LR2_OP.DIFFICULTY_BEGINNER as typeof LR2_OP.DIFFICULTY_BEGINNER,
  /** LR2 `OP_DIFFICULTY_NORMAL` — `#DIFFICULTY 2`. */
  DIFFICULTY_NORMAL: LR2_OP.DIFFICULTY_NORMAL as typeof LR2_OP.DIFFICULTY_NORMAL,
  /** LR2 `OP_DIFFICULTY_HYPER` — `#DIFFICULTY 3`. */
  DIFFICULTY_HYPER: LR2_OP.DIFFICULTY_HYPER as typeof LR2_OP.DIFFICULTY_HYPER,
  /** LR2 `OP_DIFFICULTY_ANOTHER` — `#DIFFICULTY 4`. */
  DIFFICULTY_ANOTHER: LR2_OP.DIFFICULTY_ANOTHER as typeof LR2_OP.DIFFICULTY_ANOTHER,
  /** LR2 `OP_DIFFICULTY_INSANE` — `#DIFFICULTY 5`. */
  DIFFICULTY_INSANE: LR2_OP.DIFFICULTY_INSANE as typeof LR2_OP.DIFFICULTY_INSANE,

  // ─── Music-select bar ops (SkinProperty: FOLDERBAR=1, SONGBAR=2, GRADEBAR=3, PLAYABLEBAR=5) ─
  // Set per-frame on the select scene based on what the cursor's focused bar is. Skins gate
  // per-bar chrome on these — songs_font/count behind FOLDERBAR (it's the "X songs" footer
  // shown on a folder bar), bpm / playlevel / score readouts behind SONGBAR, course-mod chrome
  // behind GRADEBAR. Without these the entire song-info panel stays hidden.
  /** Cursor is on a folder bar — show "X songs in this folder" chrome. */
  FOLDERBAR: LR2_OP.FOLDER_BAR as typeof LR2_OP.FOLDER_BAR,
  /** Cursor is on a song bar — show per-song info (BPM / level / title / score). */
  SONGBAR: LR2_OP.SONG_BAR as typeof LR2_OP.SONG_BAR,
  /** Cursor is on a grade / course bar — show course mods + score chrome. */
  GRADEBAR: LR2_OP.COURSE_BAR as typeof LR2_OP.COURSE_BAR,
  /** Cursor is on a playable bar (song OR grade). Used by chrome that's the same across both. */
  PLAYABLEBAR: LR2_OP.PLAYABLE_BAR as typeof LR2_OP.PLAYABLE_BAR,

  // ─── Course ops (SkinProperty `OPTION_GRADEBAR_*` / `OPTION_COURSE_*` / `OPTION_MODE_COURSE`) ──
  // The `GRADEBAR_*` ops light on the select screen for the focused course's constraints
  // (`BooleanPropertyFactory.createCourseDataConstraintProperty`); the stage ops and `MODE_COURSE`
  // light outside the select screen while a course runs (`createCourseStageProperty`,
  // `createCourseFinalStageProperty`, `mode_course`).
  /** SkinProperty `OPTION_GRADEBAR_CLASS` — the focused course has the `CLASS` constraint. */
  GRADEBAR_CLASS: 1002,
  /** SkinProperty `OPTION_GRADEBAR_MIRROR`. */
  GRADEBAR_MIRROR: 1003,
  /** SkinProperty `OPTION_GRADEBAR_RANDOM`. */
  GRADEBAR_RANDOM: 1004,
  /** SkinProperty `OPTION_GRADEBAR_NOSPEED`. */
  GRADEBAR_NOSPEED: 1005,
  /** SkinProperty `OPTION_GRADEBAR_NOGOOD`. */
  GRADEBAR_NOGOOD: 1006,
  /** SkinProperty `OPTION_GRADEBAR_NOGREAT`. */
  GRADEBAR_NOGREAT: 1007,
  /** SkinProperty `OPTION_GRADEBAR_GAUGE_LR2`. */
  GRADEBAR_GAUGE_LR2: 1010,
  /** SkinProperty `OPTION_GRADEBAR_GAUGE_5KEYS`. */
  GRADEBAR_GAUGE_5KEYS: 1011,
  /** SkinProperty `OPTION_GRADEBAR_GAUGE_7KEYS`. */
  GRADEBAR_GAUGE_7KEYS: 1012,
  /** SkinProperty `OPTION_GRADEBAR_GAUGE_9KEYS`. */
  GRADEBAR_GAUGE_9KEYS: 1013,
  /** SkinProperty `OPTION_GRADEBAR_GAUGE_24KEYS`. */
  GRADEBAR_GAUGE_24KEYS: 1014,
  /** SkinProperty `OPTION_GRADEBAR_LN`. */
  GRADEBAR_LN: 1015,
  /** SkinProperty `OPTION_GRADEBAR_CN`. */
  GRADEBAR_CN: 1016,
  /** SkinProperty `OPTION_GRADEBAR_HCN`. */
  GRADEBAR_HCN: 1017,
  /** SkinProperty `OPTION_RANDOMCOURSEBAR` — the cursor is on a random-course bar. */
  RANDOMCOURSEBAR: 1031,
  /** SkinProperty `OPTION_COURSE_STAGE1` — stage 1 of a course is played and is not the last one. */
  COURSE_STAGE1: LR2_OP.COURSE_STAGE1 as typeof LR2_OP.COURSE_STAGE1,
  /** SkinProperty `OPTION_COURSE_STAGE2`. */
  COURSE_STAGE2: LR2_OP.COURSE_STAGE2 as typeof LR2_OP.COURSE_STAGE2,
  /** SkinProperty `OPTION_COURSE_STAGE3`. */
  COURSE_STAGE3: LR2_OP.COURSE_STAGE3 as typeof LR2_OP.COURSE_STAGE3,
  /** SkinProperty `OPTION_COURSE_STAGE4`. */
  COURSE_STAGE4: LR2_OP.COURSE_STAGE4 as typeof LR2_OP.COURSE_STAGE4,
  /** SkinProperty `OPTION_COURSE_STAGE_FINAL` — the last stage of a course. */
  COURSE_STAGE_FINAL: LR2_OP.COURSE_STAGE_FINAL as typeof LR2_OP.COURSE_STAGE_FINAL,
  /** SkinProperty `OPTION_MODE_COURSE` — a course is running. */
  MODE_COURSE: LR2_OP.COURSE as typeof LR2_OP.COURSE,

  // ─── Chart keys ops (prop.lua `_*keysong = 160-164` etc.) ─────────────────────────────────
  // Set to indicate which chart variant is being played. Skins use these to gate per-keys
  // chrome elements (e.g. show 7K-specific lane backgrounds only on _7keysong).
  KEYSONG_7K: LR2_OP.KEYS_7 as typeof LR2_OP.KEYS_7,
  KEYSONG_5K: LR2_OP.KEYS_5 as typeof LR2_OP.KEYS_5,
  KEYSONG_14K: LR2_OP.KEYS_14 as typeof LR2_OP.KEYS_14,
  KEYSONG_10K: LR2_OP.KEYS_10 as typeof LR2_OP.KEYS_10,
  KEYSONG_9K: LR2_OP.KEYS_9 as typeof LR2_OP.KEYS_9,
  KEYSONG_24K: 1160,
  KEYSONG_24K_DP: 1161,

  // ─── Chart judge-rank ops (SkinProperty `JUDGE_*`, codes 180-184) ─────────────────────────
  // Set per-frame on the select scene based on the focused chart's `#RANK` header value
  // (0=VERYHARD, 1=HARD, 2=NORMAL, 3=EASY, 4=VERYEASY). Default skin's "judge" image swap
  // chrome (GdbG_Skin / ModernChic both gate per-rank judgment-window labels) gates on these.
  JUDGE_VERYHARD: LR2_OP.JUDGE_VERY_HARD as typeof LR2_OP.JUDGE_VERY_HARD,
  JUDGE_HARD: LR2_OP.JUDGE_HARD as typeof LR2_OP.JUDGE_HARD,
  JUDGE_NORMAL: LR2_OP.JUDGE_NORMAL as typeof LR2_OP.JUDGE_NORMAL,
  JUDGE_EASY: LR2_OP.JUDGE_EASY as typeof LR2_OP.JUDGE_EASY,
  JUDGE_VERYEASY: 184,

  // ─── Chart trait ops (prop.lua `bgaoff = 40` ... `randomsequence = 179`) ──────────────────
  // Set based on chart content + user options. Skins use these to gate optional chrome
  // (e.g. show LN-specific tracks only on `OPTION_LN`).
  NO_BGA: LR2_OP.NO_BGA as typeof LR2_OP.NO_BGA,
  HAS_BGA: LR2_OP.HAS_BGA as typeof LR2_OP.HAS_BGA,
  NO_LN: LR2_OP.NO_LN as typeof LR2_OP.NO_LN,
  HAS_LN: LR2_OP.HAS_LN as typeof LR2_OP.HAS_LN,
  NO_TEXT: LR2_OP.NO_TEXT as typeof LR2_OP.NO_TEXT,
  HAS_TEXT: LR2_OP.HAS_TEXT as typeof LR2_OP.HAS_TEXT,
  NO_BPMCHANGE: LR2_OP.NO_BPM_CHANGE as typeof LR2_OP.NO_BPM_CHANGE,
  HAS_BPMCHANGE: LR2_OP.HAS_BPM_CHANGE as typeof LR2_OP.HAS_BPM_CHANGE,
  HAS_BPMSTOP: 1177,
  NO_RANDOMSEQUENCE: LR2_OP.NO_RANDOM as typeof LR2_OP.NO_RANDOM,
  HAS_RANDOMSEQUENCE: LR2_OP.HAS_RANDOM as typeof LR2_OP.HAS_RANDOM,
  NO_STAGEFILE: LR2_OP.NO_STAGEFILE as typeof LR2_OP.NO_STAGEFILE,
  HAS_STAGEFILE: LR2_OP.HAS_STAGEFILE as typeof LR2_OP.HAS_STAGEFILE,
  NO_BANNER: LR2_OP.NO_BANNER as typeof LR2_OP.NO_BANNER,
  HAS_BANNER: LR2_OP.HAS_BANNER as typeof LR2_OP.HAS_BANNER,
  NO_BACKBMP: LR2_OP.NO_BACKBMP as typeof LR2_OP.NO_BACKBMP,
  HAS_BACKBMP: LR2_OP.HAS_BACKBMP as typeof LR2_OP.HAS_BACKBMP,

  // ─── Lanecover / lift / hidden state (prop.lua `lanecover1_changing = 270` etc.) ──────────
  LANECOVER1_CHANGING: 270,
  LANECOVER1_ON: 271,
  LIFT1_ON: 272,
  HIDDEN1_ON: 273,

  // ─── Now-playing rank ops (prop.lua `now_aaa_1p = 340` ... `now_f_1p = 347`) ──────────────
  // Set based on the active run's EX-score band (DIFFERENT from the live `_1p_*` rank ops at
  // 200-207, which are the same data but a separate op block beatoraja maintains for the result
  // scene's "during play" indicator).
  NOW_AAA_1P: LR2_OP.UPDATED_RANK_AAA as typeof LR2_OP.UPDATED_RANK_AAA,
  NOW_AA_1P: LR2_OP.UPDATED_RANK_AA as typeof LR2_OP.UPDATED_RANK_AA,
  NOW_A_1P: LR2_OP.UPDATED_RANK_A as typeof LR2_OP.UPDATED_RANK_A,
  NOW_B_1P: LR2_OP.UPDATED_RANK_B as typeof LR2_OP.UPDATED_RANK_B,
  NOW_C_1P: LR2_OP.UPDATED_RANK_C as typeof LR2_OP.UPDATED_RANK_C,
  NOW_D_1P: LR2_OP.UPDATED_RANK_D as typeof LR2_OP.UPDATED_RANK_D,
  NOW_E_1P: LR2_OP.UPDATED_RANK_E as typeof LR2_OP.UPDATED_RANK_E,
  NOW_F_1P: LR2_OP.UPDATED_RANK_F as typeof LR2_OP.UPDATED_RANK_F,

  // ─── 1P gauge range ops (prop.lua `_1p_0_9 = 230` ... `_1p_100 = 240`, `_1p_border_or_more = 1240`) ──
  // The 1P gauge's tenth: exactly one of 230-240 is lit during a play, 240 for a full gauge (beatoraja
  // `GaugeDrawCondition`, LR2's `LR2_OP.GAUGE_1P_*`). 1240 is lit while the gauge would clear: above 0 and at its
  // border or more (`Gauge.isQualified`). Skins swap gauge-dependent chrome (a character's mood, a FEVER cue) on them.
  P1_BAND_0_9: LR2_OP.GAUGE_1P_0_9 as typeof LR2_OP.GAUGE_1P_0_9,
  P1_BAND_10_19: LR2_OP.GAUGE_1P_10_19 as typeof LR2_OP.GAUGE_1P_10_19,
  P1_BAND_20_29: LR2_OP.GAUGE_1P_20_29 as typeof LR2_OP.GAUGE_1P_20_29,
  P1_BAND_30_39: LR2_OP.GAUGE_1P_30_39 as typeof LR2_OP.GAUGE_1P_30_39,
  P1_BAND_40_49: LR2_OP.GAUGE_1P_40_49 as typeof LR2_OP.GAUGE_1P_40_49,
  P1_BAND_50_59: LR2_OP.GAUGE_1P_50_59 as typeof LR2_OP.GAUGE_1P_50_59,
  P1_BAND_60_69: LR2_OP.GAUGE_1P_60_69 as typeof LR2_OP.GAUGE_1P_60_69,
  P1_BAND_70_79: LR2_OP.GAUGE_1P_70_79 as typeof LR2_OP.GAUGE_1P_70_79,
  P1_BAND_80_89: LR2_OP.GAUGE_1P_80_89 as typeof LR2_OP.GAUGE_1P_80_89,
  P1_BAND_90_99: LR2_OP.GAUGE_1P_90_99 as typeof LR2_OP.GAUGE_1P_90_99,
  P1_BAND_100: LR2_OP.GAUGE_1P_100 as typeof LR2_OP.GAUGE_1P_100,
  P1_BAND_BORDER_OR_MORE: 1240,

  // ─── Synthetic op codes (player-web only, not in beatoraja's prop.lua) ────────────────────────
  // High integers (90100+) chosen to dodge any future expansion of beatoraja's pool. The runtime
  // adapter sets / clears these per frame to match a Java-side `gauge.isMax()` check that
  // beatoraja itself only exposes through SkinJudge's prepare() method, not through an op gate.
  /**
   * `true` while the 1P groove gauge is currently at >= 100%. Used to gate the
   * `judge[6]` "fullgauge PG substitute" sprite (audit 1.2) — beatoraja's
   * `SkinJudge.prepare()` runs:
   *
   *   if (judgenow == 0 && gauge.isMax()) { nowJudge = judge[6] != null ? judge[6] : judge[0]; }
   *   else                                 { nowJudge = judge[judgenow]; }
   *
   * so the standard `judgef-pg` (index 0) and the fullgauge `judgef-pg2` (index 6) are
   * mutually exclusive — one or the other paints, never both. `expandBeatorajaJudgeDestinations`
   * uses this op (and its negation) to express that mutual exclusion through the standard
   * op-gate machinery without needing a special-case substitute path.
   *
   * Synthetic — not present in beatoraja's prop.lua. The adapter populates / removes the op
   * each frame from the live gauge state.
   */
  GAUGE_NOW_AT_MAX_1P: 90100,
  /** Same as {@link GAUGE_NOW_AT_MAX_1P} but for the 2P side. Synthetic. */
  GAUGE_NOW_AT_MAX_2P: 90101,
} as const;

/**
 * Button action codes (audit 2.1). Mirrors beatoraja's `SkinProperty.BUTTON_*` constants —
 * each integer is both the click-event code (forwarded through `image.act` / `imageset.act`
 * to `onButtonAction`) AND an op code that destinations gate on for "pressed state" visual
 * feedback. The host's adapter / scene populator transiently activates the matching op when
 * a click fires so skins gating press-state chrome on `op = {15}` (= BUTTON_PLAY) see the
 * highlight while the click is in flight.
 */
export const BEATORAJA_BUTTON = {
  /** Cycle keymode filter (5K / 7K / 9K / 10K / 14K / 24K / 24K-DP / ALL). */
  MODE: LR2_BUTTON.KEY_MODE_FILTER as typeof LR2_BUTTON.KEY_MODE_FILTER,
  /** Cycle sort order (default / title / artist / level / bpm / etc.). */
  SORT: LR2_BUTTON.SORT as typeof LR2_BUTTON.SORT,
  /** Open key-config dialog. */
  KEYCONFIG: LR2_BUTTON.KEY_CONFIG as typeof LR2_BUTTON.KEY_CONFIG,
  /** Open skin-select picker. */
  SKINSELECT: LR2_BUTTON.SKIN_SELECT as typeof LR2_BUTTON.SKIN_SELECT,
  /** Start play with the user's default mode. */
  PLAY: LR2_BUTTON.PLAY as typeof LR2_BUTTON.PLAY,
  /** Start play in autoplay mode. */
  AUTOPLAY: LR2_BUTTON.AUTOPLAY as typeof LR2_BUTTON.AUTOPLAY,
  /** Show chart's accompanying readme/text content. */
  READTEXT: LR2_BUTTON.READ_TEXT as typeof LR2_BUTTON.READ_TEXT,
  /** Start replay slot 1. */
  REPLAY: LR2_BUTTON.REPLAY as typeof LR2_BUTTON.REPLAY,
  /** Open IR ranking website for the focused chart. */
  OPEN_IR_WEBSITE: 210,
  /** Start practice mode (currently routes as plain play in player-web). */
  PRACTICE: 315,
  /** Replay slots 2-4. */
  REPLAY2: 316,
  REPLAY3: 317,
  REPLAY4: 318,
  /** Toggle BGA (background animation) overlay. */
  BGA: LR2_BUTTON.BGA as typeof LR2_BUTTON.BGA,
  /** Adjust note offset by ±1 ms (Shift = decrement). */
  JUDGE_TIMING: 74,
  /** Open target-score picker. */
  TARGET: 77,
  /** Cycle hispeed-fix mode. */
  HSFIX: LR2_BUTTON.HS_FIX as typeof LR2_BUTTON.HS_FIX,
  /** Adjust lanecover percentage. */
  LANECOVER: 330,
  /** Adjust lift percentage. */
  LIFT: 331,
  /** Adjust hidden-cover percentage. */
  HIDDEN: 332,
  /** Cycle assist options — exjudge / constant / judgearea / legacy / marknote / bpmguide / nomine. */
  ASSIST_EXJUDGE: 301,
  ASSIST_CONSTANT: 302,
  ASSIST_JUDGEAREA: 303,
  ASSIST_LEGACY: 304,
  ASSIST_MARKNOTE: 305,
  ASSIST_BPMGUIDE: 306,
  ASSIST_NOMINE: 307,
  /** Cycle LN mode (LN / CN / HCN). */
  LNMODE: 308,
  /** Toggle the focused song's "favorite song" flag. */
  FAVORITTE_SONG: 89,
  /** Toggle the focused chart's "favorite chart" flag. */
  FAVORITTE_CHART: 90,
} as const;

export type BeatorajaButtonCode = (typeof BEATORAJA_BUTTON)[keyof typeof BEATORAJA_BUTTON];

/**
 * Letter-rank classification from `(exScore, maxExScore)`. Returns the matching `BEATORAJA_OP`
 * code (`P1_RANK_*` for `side: 1`, `P2_RANK_*` for `side: 2`). Beatoraja's IIDX-derived rank
 * thresholds are 8/9, 7/9, ... down to 2/9 of the theoretical max EX-score (= `total * 2`).
 *
 * Returns `BEATORAJA_OP.P1_RANK_F` when `maxExScore <= 0` (no scorable notes — degenerate chart);
 * this matches beatoraja's "no rank" fallback rather than producing a NaN-driven gate that's
 * neither active nor inactive.
 */
export function computeRankOp(exScore: number, maxExScore: number, side: BeatorajaSide = 1): number {
  // `side === 2` is the only "this is the 2P side" case; everything else (including the POPN-9
  // third plate) shares the 1P rank bank because upstream has no `_3p_rank_*` ops.
  const usePlayer2 = side === 2;
  const ratio = maxExScore > 0 ? exScore / maxExScore : 0;
  const thresholds: ReadonlyArray<readonly [number, number]> = [
    [8 / 9, usePlayer2 ? BEATORAJA_OP.P2_RANK_AAA : BEATORAJA_OP.P1_RANK_AAA],
    [7 / 9, usePlayer2 ? BEATORAJA_OP.P2_RANK_AA : BEATORAJA_OP.P1_RANK_AA],
    [6 / 9, usePlayer2 ? BEATORAJA_OP.P2_RANK_A : BEATORAJA_OP.P1_RANK_A],
    [5 / 9, usePlayer2 ? BEATORAJA_OP.P2_RANK_B : BEATORAJA_OP.P1_RANK_B],
    [4 / 9, usePlayer2 ? BEATORAJA_OP.P2_RANK_C : BEATORAJA_OP.P1_RANK_C],
    [3 / 9, usePlayer2 ? BEATORAJA_OP.P2_RANK_D : BEATORAJA_OP.P1_RANK_D],
    [2 / 9, usePlayer2 ? BEATORAJA_OP.P2_RANK_E : BEATORAJA_OP.P1_RANK_E],
  ];
  for (const [t, op] of thresholds) {
    if (ratio >= t) return op;
  }
  return usePlayer2 ? BEATORAJA_OP.P2_RANK_F : BEATORAJA_OP.P1_RANK_F;
}

/**
 * Generic-rank version of {@link computeRankOp} — surfaces the no-side-prefix `RANK_*` op.
 * Skins that author rank graphics typically use this rather than the side-specific block.
 */
export function computeGenericRankOp(exScore: number, maxExScore: number): number {
  const ratio = maxExScore > 0 ? exScore / maxExScore : 0;
  const thresholds: ReadonlyArray<readonly [number, number]> = [
    [8 / 9, BEATORAJA_OP.RANK_AAA],
    [7 / 9, BEATORAJA_OP.RANK_AA],
    [6 / 9, BEATORAJA_OP.RANK_A],
    [5 / 9, BEATORAJA_OP.RANK_B],
    [4 / 9, BEATORAJA_OP.RANK_C],
    [3 / 9, BEATORAJA_OP.RANK_D],
    [2 / 9, BEATORAJA_OP.RANK_E],
  ];
  for (const [t, op] of thresholds) {
    if (ratio >= t) return op;
  }
  return BEATORAJA_OP.RANK_F;
}

/**
 * Result-scene letter-rank (`RESULT_RANK_*_1P`). Same thresholds as {@link computeRankOp} but
 * targets the result-only op block. The dedicated `RESULT_RANK_ZERO_1P` op fires on a literal
 * 0-EX run (`exScore === 0`) — a separate state from F (`> 0` but below 2/9).
 */
export function computeResultRankOp(exScore: number, maxExScore: number): number {
  if (exScore <= 0) return BEATORAJA_OP.RESULT_RANK_ZERO_1P;
  const ratio = maxExScore > 0 ? exScore / maxExScore : 0;
  const thresholds: ReadonlyArray<readonly [number, number]> = [
    [8 / 9, BEATORAJA_OP.RESULT_RANK_AAA_1P],
    [7 / 9, BEATORAJA_OP.RESULT_RANK_AA_1P],
    [6 / 9, BEATORAJA_OP.RESULT_RANK_A_1P],
    [5 / 9, BEATORAJA_OP.RESULT_RANK_B_1P],
    [4 / 9, BEATORAJA_OP.RESULT_RANK_C_1P],
    [3 / 9, BEATORAJA_OP.RESULT_RANK_D_1P],
    [2 / 9, BEATORAJA_OP.RESULT_RANK_E_1P],
  ];
  for (const [t, op] of thresholds) {
    if (ratio >= t) return op;
  }
  return BEATORAJA_OP.RESULT_RANK_F_1P;
}

/** Per-judge "this judge has occurred at least once" op set. Returns the active subset of
 * `*_EXIST` ops based on `summary` counters. Pure helper so the runtime adapter and the result
 * scene can share the same classification logic.
 */
export function computeJudgeExistOps(args: {
  perfect: number;
  great: number;
  good: number;
  bad: number;
  poor: number;
}): ReadonlyArray<number> {
  const ops: number[] = [];
  if (args.perfect > 0) ops.push(BEATORAJA_OP.PERFECT_EXIST);
  if (args.great > 0) ops.push(BEATORAJA_OP.GREAT_EXIST);
  if (args.good > 0) ops.push(BEATORAJA_OP.GOOD_EXIST);
  if (args.bad > 0) ops.push(BEATORAJA_OP.BAD_EXIST);
  if (args.poor > 0) {
    // We don't separate "miss" from "poor" — the live engine surfaces empty-press POORs as the
    // generic POOR judge. Light up both ops so skins gated on either side reveal correctly.
    ops.push(BEATORAJA_OP.POOR_EXIST);
    ops.push(BEATORAJA_OP.MISS_EXIST);
  }
  return ops;
}

/**
 * Per-lane "last judgement" image-ref base. The default skin's keybeam imageset references this
 * via `value_judge(i)` returning `500 + lane` (lane 0 = scratch, lane 1..7 = keys 1..7), expecting
 * a frame index that picks between `keybeam-w` (frame 0, neutral) and `keybeam-w-pg` (frame 1,
 * perfect-flash) as the player hits notes:
 *
 *   { id = "keybeam1", ref = 501, images = { "keybeam-w", "keybeam-w-pg" } }
 *
 * Beatoraja's reference theme returns `0` when there's been no recent judgement on the lane and
 * `1` (= "perfect flash") only when the latest verdict on that lane was PERFECT within a short
 * window (~500 ms). Values are clamped against `images.length - 1` by the renderer, so 2-frame
 * imagesets collapse to a binary "neutral" / "perfect" toggle. Imagesets with more frames could
 * use the same ref to distinguish PERFECT vs GREAT, but neither default nor the surveyed
 * community skins exercise that path today.
 */
export const JUDGE_LANE_REF_1P_BASE = 500;
export const JUDGE_LANE_REF_2P_BASE = 510;
/**
 * Inclusive upper bound for either side's lane-judge ref range. Matches beatoraja's 9-key
 * extension layout (lanes 0..9 ⇒ refs 500..509 / 510..519). Used by the adapter to short-circuit
 * the per-lane resolver before the generic ref-table lookup.
 */
export const JUDGE_LANE_REF_RANGE = 10;

/**
 * Op-code corresponding to a parsed engine judge string. Values come from `prop.lua`'s `_1p_*` /
 * `_2p_*` block. Returns `undefined` for unrecognized kinds (FAST / SLOW are surfaced through the
 * separate {@link BEATORAJA_OP.P1_JUDGE_EARLY} / `_LATE` ops).
 *
 * The mapping mirrors the engine's judge-state strings — `'PERFECT'` / `'GREAT'` / `'GOOD'` / `'BAD'` /
 * `'POOR'` / `'MISS'` (case-insensitive).
 */
export function judgeOpForKind(side: BeatorajaSide, kind: string): number | undefined {
  const upper = kind.toUpperCase();
  if (side === 1) {
    switch (upper) {
      case 'PERFECT':
        return BEATORAJA_OP.P1_JUDGE_PERFECT;
      case 'GREAT':
        return BEATORAJA_OP.P1_JUDGE_GREAT;
      case 'GOOD':
        return BEATORAJA_OP.P1_JUDGE_GOOD;
      case 'BAD':
        return BEATORAJA_OP.P1_JUDGE_BAD;
      case 'POOR':
        return BEATORAJA_OP.P1_JUDGE_POOR;
      case 'MISS':
        return BEATORAJA_OP.P1_JUDGE_MISS;
      default:
        return undefined;
    }
  }
  if (side === 2) {
    switch (upper) {
      case 'PERFECT':
        return BEATORAJA_OP.P2_JUDGE_PERFECT;
      case 'GREAT':
        return BEATORAJA_OP.P2_JUDGE_GREAT;
      case 'GOOD':
        return BEATORAJA_OP.P2_JUDGE_GOOD;
      case 'BAD':
        return BEATORAJA_OP.P2_JUDGE_BAD;
      case 'POOR':
        return BEATORAJA_OP.P2_JUDGE_POOR;
      case 'MISS':
        return BEATORAJA_OP.P2_JUDGE_MISS;
      default:
        return undefined;
    }
  }
  // side === 3 — POPN-9 third plate. Upstream `SkinProperty.java` only defines PERFECT / GREAT /
  // GOOD / EARLY / LATE for this plate; BAD / POOR / MISS aren't routed per-plate (combo-breaks
  // are treated as global) so we fall through to `undefined` and let `applyJudgeCombo`'s previous-
  // op cleanup retire the prior verdict without setting a new one.
  switch (upper) {
    case 'PERFECT':
      return BEATORAJA_OP.P3_JUDGE_PERFECT;
    case 'GREAT':
      return BEATORAJA_OP.P3_JUDGE_GREAT;
    case 'GOOD':
      return BEATORAJA_OP.P3_JUDGE_GOOD;
    default:
      return undefined;
  }
}

/**
 * Whether a parsed engine judge string is a PERFECT verdict. Drives the per-lane keybeam
 * "perfect flash" gate (refs {@link JUDGE_LANE_REF_1P_BASE}..) — only PERFECT lights the
 * highlighted frame; every other verdict (including GREAT) keeps the keybeam neutral.
 * Case-insensitive — the engine emits upper-case strings but this stays defensive.
 */
export function isPerfectJudge(kind: string): boolean {
  return kind.toUpperCase() === 'PERFECT';
}

// ─── Text references (`text[].ref`) ────────────────────────────────────────────────────────────────
// Sources: prop.lua `local text = { ... }`. Used by `BeatorajaPlaySkinView` text destinations to look
// up the dynamic string the skin should display. Values not listed here resolve to `undefined` and the
// text node renders empty.

/**
 * Numeric value references (`value[].ref`). Values are pulled directly from prop.lua's `local num = { ... }`
 * dump (https://github.com/ovnz/blanket/blob/main/prop.lua) — the canonical authority for beatoraja's
 * numeric op IDs. Skin authors point a `value[].ref` at one of these to display the matching number on
 * screen (score, combo, BPM, judge counts, gauge percent, etc.).
 *
 * Categories (mirroring prop.lua's grouping):
 *
 * - **Live-play** — `POINT` … `COMBOBREAK`, `*_RATE`, `*_AFTERDOT`. Sourced from the engine's
 *   per-frame `summary` payload + the adapter's running-combo latch.
 * - **Hispeed / lanecover** — `HISPEED`, `HISPEED_AFTERDOT`, `DURATION`, `LIFT1`, `HIDDEN1`. Sourced
 *   from the adapter's hispeed latch (others default to 0 until the host wires a setter).
 * - **Time / clock** — `PLAYTIME_*`, `TIMELEFT_*`, `SONGLENGTH_*`, `TIME_*` (wallclock), `CURRENT_FPS`.
 *   Time-based ones come from `frame.currentSeconds` / `frame.totalSeconds`; wallclock from `Date.now()`.
 * - **Chart metadata** — `MAXBPM` / `MINBPM` / `MAINBPM`, `PLAYLEVEL`. Sourced from `chart.metadata`.
 * - **Best-record / DB-backed** — `SCORE` (best, NOT live), `MAXSCORE`, `MAXCOMBO` (best across runs),
 *   `MISSCOUNT`, `PLAYCOUNT`, `CLEARCOUNT`, etc. Return 0 until the score DB layer ships.
 * - **IR / rival / folder stats** — Online and per-folder aggregates. Return 0 (no IR / DB layer yet).
 *
 * Codes not represented here resolve to `undefined` and the matching `value[]` renders 0 — same fallback
 * behavior as for codes that ARE represented but lack live data (best-record block).
 */
export const BEATORAJA_NUM = {
  // ─── Hispeed / lanecover (10, 12-14, 310-315, 1312-1327) ──────────────────────────────────────
  /** prop.lua `hispeed_lr2 = 10` — hispeed × 100, LR2-compatible slot. */
  HISPEED_LR2: LR2_NUM.HISPEED_1P as typeof LR2_NUM.HISPEED_1P,
  /** prop.lua `judgetiming = 12` — manual judge offset (skin config). */
  JUDGETIMING: LR2_NUM.JUDGE_TIMING as typeof LR2_NUM.JUDGE_TIMING,
  /** prop.lua `lanecover1 = 14` — 1P lanecover percentage (skin config). */
  LANECOVER1: LR2_NUM.LANE_COVER_1P as typeof LR2_NUM.LANE_COVER_1P,
  /** prop.lua `hispeed = 310` — current hispeed × 100 (e.g. 1.5× → 150). */
  HISPEED: 310,
  /** prop.lua `hispeed_afterdot = 311` — fractional digits of hispeed (e.g. 1.5× → 50). */
  HISPEED_AFTERDOT: 311,
  /** prop.lua `duration = 312` — green-number; ms a note takes from spawn to judgement. */
  DURATION: 312,
  /** prop.lua `duration_green = 313` — duration colored green (current variant). */
  DURATION_GREEN: 313,
  /** prop.lua `lift1 = 314` — 1P lanecover lift percentage. */
  LIFT1: 314,
  /** prop.lua `hidden1 = 315` — 1P lanecover hidden percentage. */
  HIDDEN1: 315,

  // ─── Wallclock / system (17-29) ───────────────────────────────────────────────────────────────
  /** prop.lua `totalplaytime_hour = 17` — accumulated play time, hour part. */
  TOTALPLAYTIME_HOUR: 17,
  /** prop.lua `totalplaytime_minute = 18`. */
  TOTALPLAYTIME_MINUTE: 18,
  /** prop.lua `totalplaytime_second = 19`. */
  TOTALPLAYTIME_SECOND: 19,
  /** prop.lua `current_fps = 20` — moving-average FPS. */
  CURRENT_FPS: LR2_NUM.FPS as typeof LR2_NUM.FPS,
  /** prop.lua `time_year = 21`. */
  TIME_YEAR: LR2_NUM.YEAR as typeof LR2_NUM.YEAR,
  /** prop.lua `time_month = 22`. */
  TIME_MONTH: LR2_NUM.MONTH as typeof LR2_NUM.MONTH,
  /** prop.lua `time_day = 23`. */
  TIME_DAY: LR2_NUM.DAY as typeof LR2_NUM.DAY,
  /** prop.lua `time_hour = 24`. */
  TIME_HOUR: LR2_NUM.HOUR as typeof LR2_NUM.HOUR,
  /** prop.lua `time_minute = 25`. */
  TIME_MINUTE: LR2_NUM.MINUTE as typeof LR2_NUM.MINUTE,
  /** prop.lua `time_second = 26`. */
  TIME_SECOND: LR2_NUM.SECOND as typeof LR2_NUM.SECOND,
  /** prop.lua `operating_time_hour = 27` — beatoraja runtime hour part. */
  OPERATING_TIME_HOUR: 27,
  /** prop.lua `operating_time_minute = 28`. */
  OPERATING_TIME_MINUTE: 28,
  /** prop.lua `operating_time_second = 29`. */
  OPERATING_TIME_SECOND: 29,

  // ─── Best-record block (71-89) ────────────────────────────────────────────────────────────────
  /** prop.lua `score = 71` — best-ever score for this chart. */
  BEST_SCORE: LR2_NUM.BEST_EXSCORE as typeof LR2_NUM.BEST_EXSCORE,
  /** prop.lua `maxscore = 72`. */
  BEST_MAXSCORE: LR2_NUM.EXSCORE_MAX as typeof LR2_NUM.EXSCORE_MAX,
  /** prop.lua `totalnotes = 74` — total scorable notes (also exposed as live `totalnotes2 = 106`). */
  TOTALNOTES: LR2_NUM.TOTAL_NOTES as typeof LR2_NUM.TOTAL_NOTES,
  /**
   * prop.lua `maxcombo = 75` (upstream `NUMBER_MAXCOMBO`). Context-dependent:
   *
   * - **During play**: running max-combo of the CURRENT run —
   *   `JudgeManager.getScoreData().getCombo()` refreshed via `score.setCombo(max(score, live))`
   *   on every judge.
   * - **Music select**: stored best-run combo for this chart
   *   (`BarManager.getSelected().getScore().getCombo()`).
   *
   * Skins commonly author `value[].ref = MAIN.NUM.MAXCOMBO` on the judge popup's combo digits
   * (`judgen-*`), but per `SkinJudge.prepare()` (`SkinJudge.java:108`) upstream OVERRIDES that
   * ref with `JudgeManager.getNowCombo(player)` — the per-side live combo at the time of the
   * latest judge — via SkinNumber's explicit-value `prepare(time, state, value, ox, oy)`
   * overload. The judge expansion thus rewrites the matching `value[].ref` to
   * {@link SYNTHETIC_NUM_JUDGE_COMBO_1P} / `_2P` (resolved against the adapter's
   * `lastJudgeCombo[side]` latch); the running-max-combo interpretation of `MAXCOMBO` is
   * preserved for non-judge readouts (score boards, result screen, etc.).
   *
   * The `BEST_*` prefix in this enum is a naming holdover from the music-select interpretation.
   */
  BEST_MAXCOMBO: LR2_NUM.BEST_MAX_COMBO as typeof LR2_NUM.BEST_MAX_COMBO,
  /** prop.lua `misscount = 76`. */
  BEST_MISSCOUNT: LR2_NUM.BEST_MIN_BP as typeof LR2_NUM.BEST_MIN_BP,
  /** prop.lua `playcount = 77`. */
  PLAYCOUNT: LR2_NUM.PLAY_COUNT as typeof LR2_NUM.PLAY_COUNT,
  /** prop.lua `clearcount = 78`. */
  CLEARCOUNT: LR2_NUM.CLEAR_COUNT as typeof LR2_NUM.CLEAR_COUNT,
  /** prop.lua `failcount = 79`. */
  FAILCOUNT: LR2_NUM.FAIL_COUNT as typeof LR2_NUM.FAIL_COUNT,
  /** prop.lua `perfect2 = 80` — best run's perfect count. */
  BEST_PERFECT: LR2_NUM.BEST_PERFECT as typeof LR2_NUM.BEST_PERFECT,
  /** prop.lua `great2 = 81`. */
  BEST_GREAT: LR2_NUM.BEST_GREAT as typeof LR2_NUM.BEST_GREAT,
  /** prop.lua `good2 = 82`. */
  BEST_GOOD: LR2_NUM.BEST_GOOD as typeof LR2_NUM.BEST_GOOD,
  /** prop.lua `bad2 = 83`. */
  BEST_BAD: LR2_NUM.BEST_BAD as typeof LR2_NUM.BEST_BAD,
  /** prop.lua `poor2 = 84`. */
  BEST_POOR: LR2_NUM.BEST_POOR as typeof LR2_NUM.BEST_POOR,

  // ─── Chart metadata (90-92, 96) ───────────────────────────────────────────────────────────────
  /** prop.lua `maxbpm = 90`. */
  MAXBPM: LR2_NUM.MAX_BPM as typeof LR2_NUM.MAX_BPM,
  /** prop.lua `minbpm = 91`. */
  MINBPM: LR2_NUM.MIN_BPM as typeof LR2_NUM.MIN_BPM,
  /** prop.lua `mainbpm = 92`. */
  MAINBPM: 92,
  /** prop.lua `playlevel = 96` — chart difficulty rating from `#PLAYLEVEL`. */
  PLAYLEVEL: 96,

  // ─── Live-play block (100-116, 121-128, 135-136, 407, 410-427) ────────────────────────────────
  /** prop.lua `point = 100` — current run's score (NOT the best-ever record). */
  POINT: LR2_NUM.SCORE as typeof LR2_NUM.SCORE,
  /**
   * prop.lua `score2 = 101` — the current run's EX score (`IntegerPropertyFactory.createScoreProperty`: the play's
   * `getNowEXScore`, the result's new EX score), LR2's number 101.
   */
  SCORE2: LR2_NUM.EXSCORE as typeof LR2_NUM.EXSCORE,
  /** prop.lua `score_rate = 102` — EX-score percentage integer part. */
  SCORE_RATE: LR2_NUM.SCORE_RATE as typeof LR2_NUM.SCORE_RATE,
  /** prop.lua `score_rate_afterdot = 103` — EX-score percentage post-decimal digits. */
  SCORE_RATE_AFTERDOT: LR2_NUM.SCORE_RATE_AFTERDOT as typeof LR2_NUM.SCORE_RATE_AFTERDOT,
  /** prop.lua `combo = 104` — running combo. */
  COMBO: LR2_NUM.COMBO as typeof LR2_NUM.COMBO,
  /** prop.lua `maxcombo2 = 105` — max combo this run. */
  MAXCOMBO_LIVE: LR2_NUM.MAX_COMBO as typeof LR2_NUM.MAX_COMBO,
  /** prop.lua `totalnotes2 = 106`. */
  TOTALNOTES_LIVE: LR2_NUM.NOTES as typeof LR2_NUM.NOTES,
  /** prop.lua `groovegauge = 107` — gauge % (integer). */
  GROOVEGAUGE: LR2_NUM.GAUGE as typeof LR2_NUM.GAUGE,
  /** prop.lua `diff_exscore = 108`. */
  DIFF_EXSCORE: LR2_NUM.EXSCORE_DIFF as typeof LR2_NUM.EXSCORE_DIFF,
  /** prop.lua `perfect = 110`. */
  PERFECT: LR2_NUM.PERFECT as typeof LR2_NUM.PERFECT,
  /** prop.lua `great = 111`. */
  GREAT: LR2_NUM.GREAT as typeof LR2_NUM.GREAT,
  /** prop.lua `good = 112`. */
  GOOD: LR2_NUM.GOOD as typeof LR2_NUM.GOOD,
  /** prop.lua `bad = 113`. */
  BAD: LR2_NUM.BAD as typeof LR2_NUM.BAD,
  /** prop.lua `poor = 114`. */
  POOR: LR2_NUM.POOR as typeof LR2_NUM.POOR,
  /** prop.lua `total_rate = 115`. */
  TOTAL_RATE: LR2_NUM.TOTAL_RATE as typeof LR2_NUM.TOTAL_RATE,
  /** prop.lua `total_rate_afterdot = 116`. */
  TOTAL_RATE_AFTERDOT: LR2_NUM.TOTAL_RATE_AFTERDOT as typeof LR2_NUM.TOTAL_RATE_AFTERDOT,
  /** prop.lua `target_score = 121`. */
  TARGET_SCORE: 121,
  /** prop.lua `target_score_rate = 122`. */
  TARGET_SCORE_RATE: 122,
  /** prop.lua `target_score_rate_afterdot = 123`. */
  TARGET_SCORE_RATE_AFTERDOT: 123,
  /** prop.lua `groovegauge_afterdot = 407`. */
  GROOVEGAUGE_AFTERDOT: 407,
  /** prop.lua `early_perfect = 410`. */
  EARLY_PERFECT: 410,
  /** prop.lua `late_perfect = 411`. */
  LATE_PERFECT: 411,
  /** prop.lua `early_great = 412`. */
  EARLY_GREAT: 412,
  /** prop.lua `late_great = 413`. */
  LATE_GREAT: 413,
  /** prop.lua `early_good = 414`. */
  EARLY_GOOD: 414,
  /** prop.lua `late_good = 415`. */
  LATE_GOOD: 415,
  /** prop.lua `early_bad = 416`. */
  EARLY_BAD: 416,
  /** prop.lua `late_bad = 417`. */
  LATE_BAD: 417,
  /** prop.lua `early_poor = 418`. */
  EARLY_POOR: 418,
  /** prop.lua `late_poor = 419`. */
  LATE_POOR: 419,
  /** prop.lua `miss = 420` — empty-press POOR count (engine treats miss == poor). */
  MISS: 420,
  /** prop.lua `early_miss = 421`. */
  EARLY_MISS: 421,
  /** prop.lua `late_miss = 422`. */
  LATE_MISS: 422,
  /** prop.lua `totalearly = 423` — running fast tally. */
  TOTALEARLY: 423,
  /** prop.lua `totallate = 424` — running slow tally. */
  TOTALLATE: 424,
  /** prop.lua `combobreak = 425` — combo-break count = bad + poor. */
  COMBOBREAK: 425,
  /** prop.lua `poor_plus_miss = 426`. */
  POOR_PLUS_MISS: 426,
  /** prop.lua `bad_plus_poor_plus_miss = 427`. */
  BAD_PLUS_POOR_PLUS_MISS: 427,
  /**
   * prop.lua `judge_duration1 = 525` — SIGNED milliseconds offset of the most recent 1P
   * hit. Positive = early (fast), negative = late (slow). Backed by upstream's
   * `JudgeManager.getRecentJudgeTiming(0)` which is `judgefast[0]` in microseconds /
   * 1000 (= ms with sign).
   *
   * Despite the upstream name "duration", this is NOT a fade-out timer (ms elapsed since
   * the judgement). It's a hit-quality readout — beatoraja's default `play5.json` declares
   * `judgems-1pp` with `divx:12, divy:2` so positive offsets render from row 0 and
   * negative offsets from row 1 (the digit strip carries `+/-` signs alongside 0-9).
   * Returns 0 before the first judgement.
   *
   * Refs 526 (2P) and 527 (3P / battle) are the per-player variants; we only surface 525
   * since we're single-player.
   */
  JUDGE_1P_OFFSET_MS: 525,
  /**
   * Community-extended `total = 368` — the chart's `#TOTAL` header value (gauge total per
   * BMS spec). Not in beatoraja's stock public prop.lua but ModernChic / GdbG_Skin both
   * surface it through `value[]` ref 368. Sourced from `chart.metadata.total`.
   */
  BMS_TOTAL: 368,
  /** SkinProperty `NUMBER_FOLDER_TOTALSONGS = 300`: the charts in the focused folder bar (select screen). */
  FOLDER_TOTALSONGS: 300,
  /** SkinProperty `NUMBER_TOTALNOTE_NORMAL = 350`: the focused chart's key taps. */
  TOTALNOTE_NORMAL: 350,
  /** SkinProperty `NUMBER_TOTALNOTE_LN = 351`: the focused chart's long notes on the keys. */
  TOTALNOTE_LN: 351,
  /** SkinProperty `NUMBER_TOTALNOTE_SCRATCH = 352`: the focused chart's scratch taps. */
  TOTALNOTE_SCRATCH: 352,
  /** SkinProperty `NUMBER_TOTALNOTE_BSS = 353`: the focused chart's long scratches. */
  TOTALNOTE_BSS: 353,
  /** SkinProperty `NUMBER_DENSITY_PEAK = 360` / `_AFTERDOT = 361`: the busiest second's notes. */
  DENSITY_PEAK: 360,
  DENSITY_PEAK_AFTERDOT: 361,
  /** SkinProperty `NUMBER_DENSITY_END = 362` / `_AFTERDOT = 363`: the notes of the second with the last note. */
  DENSITY_END: 362,
  DENSITY_END_AFTERDOT: 363,
  /** SkinProperty `NUMBER_DENSITY_AVERAGE = 364` / `_AFTERDOT = 365`: notes per second over the chart. */
  DENSITY_AVERAGE: 364,
  DENSITY_AVERAGE_AFTERDOT: 365,
  /** SkinProperty `NUMBER_CLEAR = 370`: the focused chart's best clear lamp (0 NO PLAY … 10 MAX). */
  CLEAR: 370,
  /**
   * Result-scene timing-statistics block (374-377). GdbG_Skin's result authors
   * `Avg X ms` / `Stdev X ms` text labels backed by these refs. ModernChic surfaces them on
   * its impression panel.
   *
   * The split between integer (`AVERAGE_TIMING`) and the post-decimal helper
   * (`AVERAGE_TIMING_AFTERDOT`) lets skins compose `M.NN` displays from two digit strips.
   * Negative deltas (= early on net) get flipped to positive on the readout — beatoraja
   * convention is to show magnitude, with the sign communicated through label icons.
   */
  AVERAGE_TIMING: 374,
  AVERAGE_TIMING_AFTERDOT: 375,
  STDDEV_TIMING: 376,
  STDDEV_TIMING_AFTERDOT: 377,

  // ─── ModernChic-extended duration / green-number variants (1312-1327) ────────────────────
  // The "white number" (= visual scroll time, ms-to-traverse) and "green number" (= BPM-
  // invariant equivalent) for every combination of:
  //   - LANECOVER {ON = current cover state, OFF = no cover (raw scroll)}
  //   - BPM source {current / MAINBPM / MINBPM / MAXBPM}
  // ModernChic's `Play/lua/sp/cover.lua` surfaces all 16 so the player can read both
  // "what's my current scroll speed" AND "what would it be without cover / at min BPM" from
  // the cover-adjustment panel. Beatoraja's stock prop.lua doesn't define these; they live
  // in ModernChic's own `mainnumber.lua` extension.
  DURATION_LANECOVER_ON: 1312,
  DURATION_GREEN_LANECOVER_ON: 1313,
  DURATION_LANECOVER_OFF: 1314,
  DURATION_GREEN_LANECOVER_OFF: 1315,
  MAINBPM_DURATION_LANECOVER_ON: 1316,
  MAINBPM_DURATION_GREEN_LANECOVER_ON: 1317,
  MAINBPM_DURATION_LANECOVER_OFF: 1318,
  MAINBPM_DURATION_GREEN_LANECOVER_OFF: 1319,
  MINBPM_DURATION_LANECOVER_ON: 1320,
  MINBPM_DURATION_GREEN_LANECOVER_ON: 1321,
  MINBPM_DURATION_LANECOVER_OFF: 1322,
  MINBPM_DURATION_GREEN_LANECOVER_OFF: 1323,
  MAXBPM_DURATION_LANECOVER_ON: 1324,
  MAXBPM_DURATION_GREEN_LANECOVER_ON: 1325,
  MAXBPM_DURATION_LANECOVER_OFF: 1326,
  MAXBPM_DURATION_GREEN_LANECOVER_OFF: 1327,

  // ─── Time-based readouts (160-165, 1163-1164) ─────────────────────────────────────────────────
  /** prop.lua `nowbpm = 160` — current BPM (best effort: chart's canonical BPM). */
  NOWBPM: LR2_NUM.BPM as typeof LR2_NUM.BPM,
  /** prop.lua `playtime_minute = 161`. */
  PLAYTIME_MINUTE: LR2_NUM.PLAY_MINUTE as typeof LR2_NUM.PLAY_MINUTE,
  /** prop.lua `playtime_second = 162`. */
  PLAYTIME_SECOND: LR2_NUM.PLAY_SECOND as typeof LR2_NUM.PLAY_SECOND,
  /** prop.lua `timeleft_minute = 163`. */
  TIMELEFT_MINUTE: LR2_NUM.REMAINING_MINUTE as typeof LR2_NUM.REMAINING_MINUTE,
  /** prop.lua `timeleft_second = 164`. */
  TIMELEFT_SECOND: LR2_NUM.REMAINING_SECOND as typeof LR2_NUM.REMAINING_SECOND,
  /** prop.lua `loading_progress = 165` — 0..100. */
  LOADING_PROGRESS: LR2_NUM.LOADING_PROGRESS as typeof LR2_NUM.LOADING_PROGRESS,
  /** prop.lua `songlength_minute = 1163`. */
  SONGLENGTH_MINUTE: 1163,
  /** prop.lua `songlength_second = 1164`. */
  SONGLENGTH_SECOND: 1164,
} as const;

export const BEATORAJA_TEXT = {
  /** prop.lua `rival = 1`. DB-backed; not wired. */
  RIVAL: LR2_TEXT.RIVAL as typeof LR2_TEXT.RIVAL,
  /** prop.lua `player = 2`. DB-backed; not wired. */
  PLAYER: LR2_TEXT.PLAYER as typeof LR2_TEXT.PLAYER,
  /** prop.lua `title = 10`. */
  TITLE: LR2_TEXT.TITLE as typeof LR2_TEXT.TITLE,
  /** prop.lua `subtitle = 11`. */
  SUBTITLE: LR2_TEXT.SUBTITLE as typeof LR2_TEXT.SUBTITLE,
  /** prop.lua `fulltitle = 12` (`title` + `" "` + `subtitle`). */
  FULLTITLE: LR2_TEXT.FULL_TITLE as typeof LR2_TEXT.FULL_TITLE,
  /** prop.lua `genre = 13`. */
  GENRE: LR2_TEXT.GENRE as typeof LR2_TEXT.GENRE,
  /** prop.lua `artist = 14`. */
  ARTIST: LR2_TEXT.ARTIST as typeof LR2_TEXT.ARTIST,
  /** prop.lua `subartist = 15`. */
  SUBARTIST: LR2_TEXT.SUBARTIST as typeof LR2_TEXT.SUBARTIST,
  /**
   * prop.lua `fullartist = 16` (`artist` + `" "` + `subartist`): beatoraja's own meaning of the number, where LR2 draws
   * the chart's tag (`LR2_TEXT.TAG`).
   */
  FULLARTIST: 16,
  /**
   * SkinProperty `STRING_COURSE1_TITLE = 150`: the title of course stage 1. Stages 2-10 follow at 151-159
   * (`STRING_COURSE10_TITLE = 159`), on the select screen for the focused course and elsewhere for the running one.
   */
  COURSE1_TITLE: LR2_TEXT.COURSE_STAGE1_TITLE as typeof LR2_TEXT.COURSE_STAGE1_TITLE,
  /** SkinProperty `STRING_COURSE10_TITLE = 159`: the last course stage title slot. */
  COURSE10_TITLE: 159,
  /** prop.lua `searchword = 30`. The select scene's current search query. */
  SEARCHWORD: LR2_TEXT.SEARCH_WORD as typeof LR2_TEXT.SEARCH_WORD,
  /** prop.lua `skin_name = 50`. The mounted skin's `header.name`. */
  SKIN_NAME: LR2_TEXT.SKIN_NAME as typeof LR2_TEXT.SKIN_NAME,
  /** prop.lua `skin_author = 51`. The mounted skin's `header.author`. */
  SKIN_AUTHOR: LR2_TEXT.SKIN_AUTHOR as typeof LR2_TEXT.SKIN_AUTHOR,
  /** prop.lua `directory = 1000`. The current song's parent directory label. */
  DIRECTORY: 1000,
  /** prop.lua `tablename = 1001`. Difficulty-table name (e.g. `"★1"`) for table / dan-grade play. */
  TABLE_NAME: 1001,
  /** prop.lua `tablelevel = 1002`. Difficulty-table level value (e.g. `"1"`). */
  TABLE_LEVEL: 1002,
  /** prop.lua `tablefull = 1003`. `TABLE_NAME` + `" "` + `TABLE_LEVEL` joined. */
  TABLE_FULL: 1003,
} as const;

// ─── User-adjustable destination offsets ─────────────────────────────────────────────────────────
// Sources: `bms.player.beatoraja.skin.SkinProperty.OFFSET_*` constants. Skins reference these via
// `destination[].offsets[]` (the destination's offset shifts are summed across the listed ids) and
// via `image.disapearLine` linkage (`isDisapearLineLinkLift = true` reads OFFSET_LIFT.y). Each id
// resolves to a `(x, y, w, h, r, a)` 6-tuple at runtime — adjusted by the player through in-game
// sliders (lift / lanecover position, judge offset, …).

/** SkinProperty `OFFSET_SCRATCHANGLE_1P` — 1P scratch wheel rotation offset. */
export const OFFSET_SCRATCHANGLE_1P = 1;
/** SkinProperty `OFFSET_SCRATCHANGLE_2P` — 2P scratch wheel rotation offset. */
export const OFFSET_SCRATCHANGLE_2P = 2;
/** SkinProperty `OFFSET_LIFT` — vertical lift slider; reveals the bottom portion of the lane chrome. */
export const OFFSET_LIFT = 3;
/** SkinProperty `OFFSET_LANECOVER` — vertical lanecover slider; covers the top portion of the lane. */
export const OFFSET_LANECOVER = 4;
/** SkinProperty `OFFSET_HIDDEN_COVER` — vertical hidden-cover slider; refines hidden-mode coverage. */
export const OFFSET_HIDDEN_COVER = 5;
/** SkinProperty `OFFSET_ALL` — chart-area full-rect shift the player applies in skin-config. */
export const OFFSET_ALL = 10;
/** SkinProperty `OFFSET_NOTES_1P` — per-side notes shift (1P). */
export const OFFSET_NOTES_1P = 30;
/** SkinProperty `OFFSET_JUDGE_1P` — judge feedback shift (shared id across 1P/2P/3P in beatoraja). */
export const OFFSET_JUDGE_1P = 32;
/** SkinProperty `OFFSET_JUDGEDETAIL_1P` — judge detail (timing graph) shift. */
export const OFFSET_JUDGEDETAIL_1P = 33;

/**
 * Synthetic offset ids the renderer appends to each `judgef-*` destination when the matching
 * `judge[]` entry has `shift = true`. Mirrors upstream `SkinJudge.prepare()`'s
 * `nowJudge.region.x += -nowCount.getLength() / 2` — the judge word slides LEFT by half the
 * rendered combo's pixel width so the (word + combo) pair stays centred on the authored
 * anchor regardless of digit count.
 *
 * The host's runtime adapter resolves these to a per-frame `{x: -shift, ...}` dynamic offset
 * computed from `digitCount(combo) * slotWidth / 2`. Picked from a high range (20000+) so they
 * don't collide with `SkinProperty.OFFSET_*` standard ids (sparse, all under 100).
 */
export const SYNTHETIC_OFFSET_JUDGE_WORD_SHIFT_1P = 20001;
export const SYNTHETIC_OFFSET_JUDGE_WORD_SHIFT_2P = 20002;

/**
 * Synthetic `value[].ref` codes the judge expansion swaps in for `judgen-*` combo digits so
 * the renderer paints the per-side LIVE combo at the time of the most recent judge — mirroring
 * upstream `SkinJudge.prepare()`'s explicit value override at `SkinJudge.java:108`:
 *
 *     nowCount.prepare(time, state, ((BMSPlayer)state).getJudgeManager().getNowCombo(player),
 *                      nowJudge.region.x, nowJudge.region.y);
 *
 * `SkinNumber.prepare(time, state, value, ox, oy)` consumes the explicit `value` arg in place
 * of `ref.get(state)`, so whatever the JSON authored (`ref = MAIN.NUM.MAXCOMBO` is the
 * convention; ModernChic / default both use it) is intentionally discarded in favor of
 * `JudgeManager.getNowCombo(player)`. Without this swap every skin renders the running max
 * combo in the judge popup — visible to the user as "the combo digit stays at the max even
 * after the player breaks combo" because `BEAT_MAXCOMBO` (= prop.lua `maxcombo = 75`) only
 * grows monotonically.
 *
 * Picked from the same 20000+ synthetic range as the offset codes above so it never collides
 * with prop.lua's standard refs (every documented ref is < 2000).
 */
export const SYNTHETIC_NUM_JUDGE_COMBO_1P = 20101;
export const SYNTHETIC_NUM_JUDGE_COMBO_2P = 20102;
/**
 * POPN-9 third judge plate's combo readout. Mirrors `SkinJudge.prepare`'s
 * `nowCount.prepare(time, state, getNowCombo(player=2), …)` for the plate at `judge.index === 2`
 * — the same explicit-value override mechanism as 1P / 2P, but reading the third plate's
 * `judgecombo[2]` latch.
 */
export const SYNTHETIC_NUM_JUDGE_COMBO_3P = 20103;

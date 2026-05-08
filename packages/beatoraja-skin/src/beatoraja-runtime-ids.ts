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

/**
 * Discriminator for a beatoraja "side" — single-play / 1P-side of double / first-half of 9key uses `1`;
 * 2P side of double / second half of 9key uses `2`. The 9key extension (PMS) collapses both physical
 * sides onto side `1` from beatoraja's perspective; the renderer-side resolver translates lane channels
 * into the corresponding side before calling these helpers.
 */
export type BeatorajaSide = 1 | 2;

// ─── Built-in scene timers ──────────────────────────────────────────────────────────────────────────
// Sources: prop.lua `local timer = { ... }`. Names mirror prop.lua's; we keep the `TIMER_` prefix for
// import readability.

/** Anchored at the moment the play scene mounts. Always-on for elements with `timer = 0`. */
export const TIMER_SCENE_START = 0;
/** prop.lua `startinput` — fires when input becomes responsive (during loading lead-in). */
export const TIMER_STARTINPUT = 1;
/** prop.lua `fadeout` — fires when the result fade-out starts. NOT a load-end signal! */
export const TIMER_FADEOUT = 2;
/** prop.lua `failed` — fires on the failed verdict (gauge below clear threshold at chart end). */
export const TIMER_FAILED = 3;
/** prop.lua `ready` — fires when the READY display flashes (≈ LR2 PLAY START − N ms). */
export const TIMER_READY = 40;
/** prop.lua `play` — fires when the chart begins audible playback. */
export const TIMER_PLAY = 41;

/** prop.lua `judge_1p` — restarts on every judgement on side 1. */
export const TIMER_JUDGE_1P = 46;
/** prop.lua `judge_2p` — restarts on every judgement on side 2. */
export const TIMER_JUDGE_2P = 47;

/** prop.lua `combo_1p` / `combo_2p` — restarts when the combo counter advances. */
export const TIMER_COMBO_1P = 446;
export const TIMER_COMBO_2P = 447;

/** prop.lua `endofnote_1p` / `endofnote_2p` — fires at the last note of each side. */
export const TIMER_ENDOFNOTE_1P = 143;
export const TIMER_ENDOFNOTE_2P = 144;

/** prop.lua `rhythm` — beat-pulse timer the skin uses for "every beat" glow effects. */
export const TIMER_RHYTHM = 140;

/** prop.lua `fullcombo_1p = 48` — fires once at end-of-chart when 1P side has a full combo. */
export const TIMER_FULLCOMBO_1P = 48;
/** prop.lua `fullcombo_2p = 49`. */
export const TIMER_FULLCOMBO_2P = 49;

// ─── Per-lane timer bases (1P side) ──────────────────────────────────────────────────────────────
//
// The `0` slot is SCRATCH on every category; keys 1..9 follow. So `bombTimerId(1, 0) = 50` is
// `bomb_1p_scratch`, `bombTimerId(1, 1) = 51` is `bomb_1p_key1`, … (matches prop.lua exactly).

/** prop.lua `bomb_1p_scratch = 50` … `bomb_1p_key9 = 59`. */
export const TIMER_BOMB_1P_BASE = 50;
/** prop.lua `bomb_2p_scratch = 60` … `bomb_2p_key9 = 69`. */
export const TIMER_BOMB_2P_BASE = 60;

/** prop.lua `hold_1p_scratch = 70` … `hold_1p_key9 = 79` (LN hold-effect timer). */
export const TIMER_LN_HOLD_1P_BASE = 70;
/** prop.lua `hold_2p_scratch = 80` … `hold_2p_key9 = 89`. */
export const TIMER_LN_HOLD_2P_BASE = 80;

/** prop.lua `keyon_1p_scratch = 100` … `keyon_1p_key9 = 109`. */
export const TIMER_KEY_ON_1P_BASE = 100;
/** prop.lua `keyon_2p_scratch = 110` … `keyon_2p_key9 = 119`. */
export const TIMER_KEY_ON_2P_BASE = 110;

/** prop.lua `keyoff_1p_scratch = 120` … `keyoff_1p_key9 = 129`. */
export const TIMER_KEY_OFF_1P_BASE = 120;
/** prop.lua `keyoff_2p_scratch = 130` … `keyoff_2p_key9 = 139`. */
export const TIMER_KEY_OFF_2P_BASE = 130;

// ─── 24-key extensions ─────────────────────────────────────────────────────────────────────────
//
// Lane indices ≥ 10 fall outside the single-digit range. prop.lua names the bases via `bomb_1p_key10 =
// 1010` etc., consistent with `play24main.lua`'s `index <= 9 ? 50 + index : 1000 + index` formula.

export const TIMER_BOMB_EXT_BASE = 1000;
export const TIMER_LN_HOLD_EXT_BASE = 1200;
export const TIMER_KEY_ON_EXT_BASE = 1400;
export const TIMER_KEY_OFF_EXT_BASE = 1600;

/** Maximum lane index addressable by the 1P / 2P bases (inclusive). Above this falls into 1000+ space. */
export const LR2_LANE_INDEX_MAX = 9;

/**
 * Per-side base for a given timer category, returning the value to which a 0..N lane index is added.
 * Lanes 0..9 use the side-relative base; 10+ uses the 1000-block extension regardless of side.
 */
function timerBase(category: 'bomb' | 'lnHold' | 'keyOn' | 'keyOff', side: BeatorajaSide, isExt: boolean): number {
  if (isExt) {
    switch (category) {
      case 'bomb':
        return TIMER_BOMB_EXT_BASE;
      case 'lnHold':
        return TIMER_LN_HOLD_EXT_BASE;
      case 'keyOn':
        return TIMER_KEY_ON_EXT_BASE;
      case 'keyOff':
        return TIMER_KEY_OFF_EXT_BASE;
    }
  }
  switch (category) {
    case 'bomb':
      return side === 1 ? TIMER_BOMB_1P_BASE : TIMER_BOMB_2P_BASE;
    case 'lnHold':
      return side === 1 ? TIMER_LN_HOLD_1P_BASE : TIMER_LN_HOLD_2P_BASE;
    case 'keyOn':
      return side === 1 ? TIMER_KEY_ON_1P_BASE : TIMER_KEY_ON_2P_BASE;
    case 'keyOff':
      return side === 1 ? TIMER_KEY_OFF_1P_BASE : TIMER_KEY_OFF_2P_BASE;
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

/** Per-side judge timer (`46` for 1P, `47` for 2P). */
export function judgeTimerId(side: BeatorajaSide): number {
  return side === 1 ? TIMER_JUDGE_1P : TIMER_JUDGE_2P;
}

/** Per-side combo timer (prop.lua `combo_1p = 446`, `combo_2p = 447`). Restarts when the combo advances. */
export function comboTimerId(side: BeatorajaSide): number {
  return side === 1 ? TIMER_COMBO_1P : TIMER_COMBO_2P;
}

/** Per-side end-of-note timer (prop.lua `endofnote_1p = 143`, `endofnote_2p = 144`). */
export function endOfNoteTimerId(side: BeatorajaSide): number {
  return side === 1 ? TIMER_ENDOFNOTE_1P : TIMER_ENDOFNOTE_2P;
}

// ─── Runtime op-codes ──────────────────────────────────────────────────────────────────────────────
// Sources: prop.lua `local op = { ... }`. The codes below are the runtime-only ops the adapter sets
// during gameplay; option ops (the user's confirmed `skin_config.option` picks) flow separately through
// `buildBaseOpSet`.

export const BEATORAJA_OP = {
  /** prop.lua `now_loading = 80`. */
  NOW_LOADING: 80,
  /** prop.lua `loaded = 81`. */
  LOADED: 81,

  // ─── IR / save-state / replay ops (50, 51, 60-66, 82-84) ──────────────────────────────────
  // SkinProperty: OFFLINE / ONLINE — IR (online ranking) connection state. We have no IR
  // integration today so the select scene fires OFFLINE; chrome that gates on ONLINE stays
  // hidden, OFFLINE-gated chrome shows.
  OFFLINE: 50,
  ONLINE: 51,
  // Save-state ops — declare whether the DB will save this run's score / clear lamp. Without a
  // score DB we permanently fire DISABLE_SAVE_SCORE / NO_SAVE_CLEAR; chrome that gates on the
  // ENABLE_* / *_SAVE_CLEAR variants stays hidden.
  DISABLE_SAVE_SCORE: 60,
  ENABLE_SAVE_SCORE: 61,
  NO_SAVE_CLEAR: 62,
  EASY_SAVE_CLEAR: 63,
  NORMAL_SAVE_CLEAR: 64,
  HARD_SAVE_CLEAR: 65,
  FULLCOMBO_SAVE_CLEAR: 66,
  // Replay system state — we have no replay capture / playback today, so REPLAY_OFF fires
  // permanently. Chrome that gates on REPLAY_RECORDING / REPLAY_PLAYING stays hidden.
  REPLAY_OFF: 82,
  REPLAY_RECORDING: 83,
  REPLAY_PLAYING: 84,

  /** prop.lua `autoplayoff = 32` / `autoplayon = 33`. */
  AUTOPLAY_OFF: 32,
  AUTOPLAY_ON: 33,

  /** prop.lua `bgaoff = 40` / `bgaon = 41`. */
  BGA_OFF: 40,
  BGA_ON: 41,

  // ─── 1P last-judge op (prop.lua `_1p_*`) ─────────────────────────────────────────────────────
  /** prop.lua `_1p_perfect = 241`. */
  P1_JUDGE_PERFECT: 241,
  /** prop.lua `_1p_great = 242`. */
  P1_JUDGE_GREAT: 242,
  /** prop.lua `_1p_good = 243`. */
  P1_JUDGE_GOOD: 243,
  /** prop.lua `_1p_bad = 244`. */
  P1_JUDGE_BAD: 244,
  /** prop.lua `_1p_poor = 245`. */
  P1_JUDGE_POOR: 245,
  /** prop.lua `_1p_miss = 246`. */
  P1_JUDGE_MISS: 246,

  /** prop.lua `_1p_early = 1242` (current judge was on the early side of its window). */
  P1_JUDGE_EARLY: 1242,
  /** prop.lua `_1p_late = 1243` (current judge was on the late side of its window). */
  P1_JUDGE_LATE: 1243,

  // ─── 2P last-judge op (prop.lua `_2p_*`) ─────────────────────────────────────────────────────
  P2_JUDGE_PERFECT: 261,
  P2_JUDGE_GREAT: 262,
  P2_JUDGE_GOOD: 263,
  P2_JUDGE_BAD: 264,
  P2_JUDGE_POOR: 265,
  P2_JUDGE_MISS: 266,

  /** prop.lua `_2p_early = 1262`. */
  P2_JUDGE_EARLY: 1262,
  /** prop.lua `_2p_late = 1263`. */
  P2_JUDGE_LATE: 1263,

  // ─── Live rank ops (prop.lua `_1p_aaa = 200` ... `_1p_f = 207`) ────────────────────────────
  // Set live during gameplay, recomputed every frame from `summary.exScore` vs the chart's
  // theoretical EX-score max. Beatoraja's IIDX-derived rank thresholds are (max = `total * 2`):
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
  P1_RANK_AAA: 200,
  P1_RANK_AA: 201,
  P1_RANK_A: 202,
  P1_RANK_B: 203,
  P1_RANK_C: 204,
  P1_RANK_D: 205,
  P1_RANK_E: 206,
  P1_RANK_F: 207,

  P2_RANK_AAA: 210,
  P2_RANK_AA: 211,
  P2_RANK_A: 212,
  P2_RANK_B: 213,
  P2_RANK_C: 214,
  P2_RANK_D: 215,
  P2_RANK_E: 216,
  P2_RANK_F: 217,

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
  RESULT_RANK_AAA_1P: 300,
  RESULT_RANK_AA_1P: 301,
  RESULT_RANK_A_1P: 302,
  RESULT_RANK_B_1P: 303,
  RESULT_RANK_C_1P: 304,
  RESULT_RANK_D_1P: 305,
  RESULT_RANK_E_1P: 306,
  RESULT_RANK_F_1P: 307,
  /** prop.lua `result_0_1p = 308` — no score (POOR everything). */
  RESULT_RANK_ZERO_1P: 308,

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
  RESULT_CLEAR: 90,
  /** Run failed. The complement of {@link RESULT_CLEAR}; one or the other is active. */
  RESULT_FAIL: 91,

  // ─── Clear-lamp ops (prop.lua `clear_easy = 121` etc.) ────────────────────────────────────
  // We only set the most-fitting one for the live run's outcome. NO_PLAY / FAILED / EASY /
  // NORMAL / HARD / FULLCOMBO are mutually exclusive — picking the highest classification
  // matches beatoraja's "best-of-this-run" semantics.
  CLEAR_LAMP_NOPLAY: 100,
  CLEAR_LAMP_FAILED: 101,
  CLEAR_LAMP_ASSIST_EASY: 1100,
  CLEAR_LAMP_LIGHT_ASSIST_EASY: 1101,
  CLEAR_LAMP_EASY: 102,
  CLEAR_LAMP_NORMAL: 103,
  CLEAR_LAMP_HARD: 104,
  CLEAR_LAMP_EXHARD: 1102,
  CLEAR_LAMP_FULLCOMBO: 105,
  CLEAR_LAMP_PERFECT: 1103,
  CLEAR_LAMP_MAX: 1104,

  // ─── Gauge type ops (prop.lua `gauge_groove = 42` etc.) ───────────────────────────────────
  // The active gauge variant. Beatoraja sets exactly one of these (1P side); skins gate the
  // gauge graphic / clear-threshold marker on the matching op.
  GAUGE_GROOVE: 42,
  GAUGE_HARD: 43,
  GAUGE_GROOVE_2P: 44,
  GAUGE_HARD_2P: 45,
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
  DIFFICULTY_UNDEFINED: 150,
  /** LR2 `OP_DIFFICULTY_BEGINNER` (= EASY in some skins) — `#DIFFICULTY 1`. */
  DIFFICULTY_BEGINNER: 151,
  /** LR2 `OP_DIFFICULTY_NORMAL` — `#DIFFICULTY 2`. */
  DIFFICULTY_NORMAL: 152,
  /** LR2 `OP_DIFFICULTY_HYPER` — `#DIFFICULTY 3`. */
  DIFFICULTY_HYPER: 153,
  /** LR2 `OP_DIFFICULTY_ANOTHER` — `#DIFFICULTY 4`. */
  DIFFICULTY_ANOTHER: 154,
  /** LR2 `OP_DIFFICULTY_INSANE` — `#DIFFICULTY 5`. */
  DIFFICULTY_INSANE: 155,

  // ─── Music-select bar ops (SkinProperty: FOLDERBAR=1, SONGBAR=2, GRADEBAR=3, PLAYABLEBAR=5) ─
  // Set per-frame on the select scene based on what the cursor's focused bar is. Skins gate
  // per-bar chrome on these — songs_font/count behind FOLDERBAR (it's the "X songs" footer
  // shown on a folder bar), bpm / playlevel / score readouts behind SONGBAR, course-mod chrome
  // behind GRADEBAR. Without these the entire song-info panel stays hidden.
  /** Cursor is on a folder bar — show "X songs in this folder" chrome. */
  FOLDERBAR: 1,
  /** Cursor is on a song bar — show per-song info (BPM / level / title / score). */
  SONGBAR: 2,
  /** Cursor is on a grade / course bar — show course mods + score chrome. */
  GRADEBAR: 3,
  /** Cursor is on a playable bar (song OR grade). Used by chrome that's the same across both. */
  PLAYABLEBAR: 5,

  // ─── Chart keys ops (prop.lua `_*keysong = 160-164` etc.) ─────────────────────────────────
  // Set to indicate which chart variant is being played. Skins use these to gate per-keys
  // chrome elements (e.g. show 7K-specific lane backgrounds only on _7keysong).
  KEYSONG_7K: 160,
  KEYSONG_5K: 161,
  KEYSONG_14K: 162,
  KEYSONG_10K: 163,
  KEYSONG_9K: 164,
  KEYSONG_24K: 1160,
  KEYSONG_24K_DP: 1161,

  // ─── Chart judge-rank ops (SkinProperty `JUDGE_*`, codes 180-184) ─────────────────────────
  // Set per-frame on the select scene based on the focused chart's `#RANK` header value
  // (0=VERYHARD, 1=HARD, 2=NORMAL, 3=EASY, 4=VERYEASY). Default skin's "judge" image swap
  // chrome (GdbG_Skin / ModernChic both gate per-rank judgment-window labels) gates on these.
  JUDGE_VERYHARD: 180,
  JUDGE_HARD: 181,
  JUDGE_NORMAL: 182,
  JUDGE_EASY: 183,
  JUDGE_VERYEASY: 184,

  // ─── Chart trait ops (prop.lua `bgaoff = 40` ... `randomsequence = 179`) ──────────────────
  // Set based on chart content + user options. Skins use these to gate optional chrome
  // (e.g. show LN-specific tracks only on `OPTION_LN`).
  NO_BGA: 170,
  HAS_BGA: 171,
  NO_LN: 172,
  HAS_LN: 173,
  NO_TEXT: 174,
  HAS_TEXT: 175,
  NO_BPMCHANGE: 176,
  HAS_BPMCHANGE: 177,
  HAS_BPMSTOP: 1177,
  NO_RANDOMSEQUENCE: 178,
  HAS_RANDOMSEQUENCE: 179,
  NO_STAGEFILE: 190,
  HAS_STAGEFILE: 191,
  NO_BANNER: 192,
  HAS_BANNER: 193,
  NO_BACKBMP: 194,
  HAS_BACKBMP: 195,

  // ─── Lanecover / lift / hidden state (prop.lua `lanecover1_changing = 270` etc.) ──────────
  LANECOVER1_CHANGING: 270,
  LANECOVER1_ON: 271,
  LIFT1_ON: 272,
  HIDDEN1_ON: 273,

  // ─── Now-playing rank ops (prop.lua `now_aaa_1p = 340` ... `now_f_1p = 347`) ──────────────
  // Set based on the active run's EX-score band (DIFFERENT from the live `_1p_*` rank ops at
  // 200-207, which are the same data but a separate op block beatoraja maintains for the result
  // scene's "during play" indicator).
  NOW_AAA_1P: 340,
  NOW_AA_1P: 341,
  NOW_A_1P: 342,
  NOW_B_1P: 343,
  NOW_C_1P: 344,
  NOW_D_1P: 345,
  NOW_E_1P: 346,
  NOW_F_1P: 347,

  // ─── Score band ops (prop.lua `_1p_0_9 = 230` ... `_1p_100 = 240`, `_1p_border_or_more = 1240`) ──
  // The active EX-score band. Many score-readout chrome elements gate on these. We set exactly
  // one based on the EX-score percentage.
  P1_BAND_0_9: 230,
  P1_BAND_10_19: 231,
  P1_BAND_20_29: 232,
  P1_BAND_30_39: 233,
  P1_BAND_40_49: 234,
  P1_BAND_50_59: 235,
  P1_BAND_60_69: 236,
  P1_BAND_70_79: 237,
  P1_BAND_80_89: 238,
  P1_BAND_90_99: 239,
  P1_BAND_100: 240,
  P1_BAND_BORDER_OR_MORE: 1240,
} as const;

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
  const ratio = maxExScore > 0 ? exScore / maxExScore : 0;
  const thresholds: ReadonlyArray<readonly [number, number]> = [
    [8 / 9, side === 1 ? BEATORAJA_OP.P1_RANK_AAA : BEATORAJA_OP.P2_RANK_AAA],
    [7 / 9, side === 1 ? BEATORAJA_OP.P1_RANK_AA : BEATORAJA_OP.P2_RANK_AA],
    [6 / 9, side === 1 ? BEATORAJA_OP.P1_RANK_A : BEATORAJA_OP.P2_RANK_A],
    [5 / 9, side === 1 ? BEATORAJA_OP.P1_RANK_B : BEATORAJA_OP.P2_RANK_B],
    [4 / 9, side === 1 ? BEATORAJA_OP.P1_RANK_C : BEATORAJA_OP.P2_RANK_C],
    [3 / 9, side === 1 ? BEATORAJA_OP.P1_RANK_D : BEATORAJA_OP.P2_RANK_D],
    [2 / 9, side === 1 ? BEATORAJA_OP.P1_RANK_E : BEATORAJA_OP.P2_RANK_E],
  ];
  for (const [t, op] of thresholds) {
    if (ratio >= t) return op;
  }
  return side === 1 ? BEATORAJA_OP.P1_RANK_F : BEATORAJA_OP.P2_RANK_F;
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

/**
 * Best-fit clear-lamp op for a run's outcome. Beatoraja's lamps form a partial order:
 *
 *   PERFECT > FULLCOMBO > EXHARD > HARD > NORMAL > EASY > FAILED > NOPLAY
 *
 * Resolution order:
 *
 * 1. `!cleared` → FAILED
 * 2. `bad === 0 && poor === 0` (no combo break) AND every note was PERFECT → PERFECT
 * 3. `bad === 0 && poor === 0` (no combo break) → FULLCOMBO
 * 4. Else map by gauge type:
 *    - `'EASY'`  → EASY lamp
 *    - `'HARD'`  → HARD lamp
 *    - `'DEATH'` → EXHARD (closest match — DEATH is "any miss = fail")
 *    - `'GROOVE'` / unspecified → NORMAL lamp
 *
 * Beatoraja additionally has `LIGHT_ASSIST_EASY` / `ASSIST_EASY` / `MAX` lamps for assist-mode
 * runs and pure max-EX clears; we don't surface those (no assist mode in our engine, and a
 * pure-MAX run already routes through PERFECT above when every judge was a PERFECT).
 */
export function computeClearLampOp(args: {
  cleared: boolean;
  perfect: number;
  great: number;
  good: number;
  bad: number;
  poor: number;
  total: number;
  /** Gauge variant the run used. Defaults to `'GROOVE'` when unspecified. */
  gaugeType?: 'GROOVE' | 'EASY' | 'HARD' | 'DEATH';
}): number {
  if (!args.cleared) return BEATORAJA_OP.CLEAR_LAMP_FAILED;
  // FULLCOMBO / PERFECT — these don't depend on gauge type. A no-break run with all PERFECTs is
  // a PERFECT regardless of which gauge it ran on.
  if (args.bad === 0 && args.poor === 0) {
    if (args.great === 0 && args.good === 0 && args.perfect === args.total) {
      return BEATORAJA_OP.CLEAR_LAMP_PERFECT;
    }
    return BEATORAJA_OP.CLEAR_LAMP_FULLCOMBO;
  }
  // Cleared with breaks — gauge type decides the lamp tier. A clear under HARD gauge survived a
  // chunk-loss-on-miss curve, which is harder than a GROOVE clear; the lamp surfaces that.
  switch (args.gaugeType) {
    case 'EASY':
      return BEATORAJA_OP.CLEAR_LAMP_EASY;
    case 'HARD':
      return BEATORAJA_OP.CLEAR_LAMP_HARD;
    case 'DEATH':
      return BEATORAJA_OP.CLEAR_LAMP_EXHARD;
    default:
      return BEATORAJA_OP.CLEAR_LAMP_NORMAL;
  }
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
  HISPEED_LR2: 10,
  /** prop.lua `judgetiming = 12` — manual judge offset (skin config). */
  JUDGETIMING: 12,
  /** prop.lua `lanecover1 = 14` — 1P lanecover percentage (skin config). */
  LANECOVER1: 14,
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
  CURRENT_FPS: 20,
  /** prop.lua `time_year = 21`. */
  TIME_YEAR: 21,
  /** prop.lua `time_month = 22`. */
  TIME_MONTH: 22,
  /** prop.lua `time_day = 23`. */
  TIME_DAY: 23,
  /** prop.lua `time_hour = 24`. */
  TIME_HOUR: 24,
  /** prop.lua `time_minute = 25`. */
  TIME_MINUTE: 25,
  /** prop.lua `time_second = 26`. */
  TIME_SECOND: 26,
  /** prop.lua `operating_time_hour = 27` — beatoraja runtime hour part. */
  OPERATING_TIME_HOUR: 27,
  /** prop.lua `operating_time_minute = 28`. */
  OPERATING_TIME_MINUTE: 28,
  /** prop.lua `operating_time_second = 29`. */
  OPERATING_TIME_SECOND: 29,

  // ─── Best-record block (71-89) ────────────────────────────────────────────────────────────────
  /** prop.lua `score = 71` — best-ever score for this chart. */
  BEST_SCORE: 71,
  /** prop.lua `maxscore = 72`. */
  BEST_MAXSCORE: 72,
  /** prop.lua `totalnotes = 74` — total scorable notes (also exposed as live `totalnotes2 = 106`). */
  TOTALNOTES: 74,
  /** prop.lua `maxcombo = 75` — best max-combo across runs. */
  BEST_MAXCOMBO: 75,
  /** prop.lua `misscount = 76`. */
  BEST_MISSCOUNT: 76,
  /** prop.lua `playcount = 77`. */
  PLAYCOUNT: 77,
  /** prop.lua `clearcount = 78`. */
  CLEARCOUNT: 78,
  /** prop.lua `failcount = 79`. */
  FAILCOUNT: 79,
  /** prop.lua `perfect2 = 80` — best run's perfect count. */
  BEST_PERFECT: 80,
  /** prop.lua `great2 = 81`. */
  BEST_GREAT: 81,
  /** prop.lua `good2 = 82`. */
  BEST_GOOD: 82,
  /** prop.lua `bad2 = 83`. */
  BEST_BAD: 83,
  /** prop.lua `poor2 = 84`. */
  BEST_POOR: 84,

  // ─── Chart metadata (90-92, 96) ───────────────────────────────────────────────────────────────
  /** prop.lua `maxbpm = 90`. */
  MAXBPM: 90,
  /** prop.lua `minbpm = 91`. */
  MINBPM: 91,
  /** prop.lua `mainbpm = 92`. */
  MAINBPM: 92,
  /** prop.lua `playlevel = 96` — chart difficulty rating from `#PLAYLEVEL`. */
  PLAYLEVEL: 96,

  // ─── Live-play block (100-116, 121-128, 135-136, 407, 410-427) ────────────────────────────────
  /** prop.lua `point = 100` — current run's score (NOT the best-ever record). */
  POINT: 100,
  /** prop.lua `score2 = 101` — alias of `point` for skins that prefer the legacy name. */
  SCORE2: 101,
  /** prop.lua `score_rate = 102` — EX-score percentage integer part. */
  SCORE_RATE: 102,
  /** prop.lua `score_rate_afterdot = 103` — EX-score percentage post-decimal digits. */
  SCORE_RATE_AFTERDOT: 103,
  /** prop.lua `combo = 104` — running combo. */
  COMBO: 104,
  /** prop.lua `maxcombo2 = 105` — max combo this run. */
  MAXCOMBO_LIVE: 105,
  /** prop.lua `totalnotes2 = 106`. */
  TOTALNOTES_LIVE: 106,
  /** prop.lua `groovegauge = 107` — gauge % (integer). */
  GROOVEGAUGE: 107,
  /** prop.lua `diff_exscore = 108`. */
  DIFF_EXSCORE: 108,
  /** prop.lua `perfect = 110`. */
  PERFECT: 110,
  /** prop.lua `great = 111`. */
  GREAT: 111,
  /** prop.lua `good = 112`. */
  GOOD: 112,
  /** prop.lua `bad = 113`. */
  BAD: 113,
  /** prop.lua `poor = 114`. */
  POOR: 114,
  /** prop.lua `total_rate = 115`. */
  TOTAL_RATE: 115,
  /** prop.lua `total_rate_afterdot = 116`. */
  TOTAL_RATE_AFTERDOT: 116,
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
   * prop.lua `judge_1p_duration = 525` — milliseconds elapsed since the most recent 1P
   * judgement. Skins gate fade-out timing on this so the judge "PERFECT" / "GREAT" badge
   * dims as the duration grows. Returns 0 before the first judgement.
   */
  JUDGE_1P_DURATION: 525,
  /**
   * Community-extended `total = 368` — the chart's `#TOTAL` header value (gauge total per
   * BMS spec). Not in beatoraja's stock public prop.lua but ModernChic / GdbG_Skin both
   * surface it through `value[]` ref 368. Sourced from `chart.metadata.total`.
   */
  BMS_TOTAL: 368,

  // ─── Time-based readouts (160-165, 1163-1164) ─────────────────────────────────────────────────
  /** prop.lua `nowbpm = 160` — current BPM (best effort: chart's canonical BPM). */
  NOWBPM: 160,
  /** prop.lua `playtime_minute = 161`. */
  PLAYTIME_MINUTE: 161,
  /** prop.lua `playtime_second = 162`. */
  PLAYTIME_SECOND: 162,
  /** prop.lua `timeleft_minute = 163`. */
  TIMELEFT_MINUTE: 163,
  /** prop.lua `timeleft_second = 164`. */
  TIMELEFT_SECOND: 164,
  /** prop.lua `loading_progress = 165` — 0..100. */
  LOADING_PROGRESS: 165,
  /** prop.lua `songlength_minute = 1163`. */
  SONGLENGTH_MINUTE: 1163,
  /** prop.lua `songlength_second = 1164`. */
  SONGLENGTH_SECOND: 1164,
} as const;

export const BEATORAJA_TEXT = {
  /** prop.lua `rival = 1`. DB-backed; not wired. */
  RIVAL: 1,
  /** prop.lua `player = 2`. DB-backed; not wired. */
  PLAYER: 2,
  /** prop.lua `title = 10`. */
  TITLE: 10,
  /** prop.lua `subtitle = 11`. */
  SUBTITLE: 11,
  /** prop.lua `fulltitle = 12` (`title` + `" "` + `subtitle`). */
  FULLTITLE: 12,
  /** prop.lua `genre = 13`. */
  GENRE: 13,
  /** prop.lua `artist = 14`. */
  ARTIST: 14,
  /** prop.lua `subartist = 15`. */
  SUBARTIST: 15,
  /** prop.lua `fullartist = 16` (`artist` + `" "` + `subartist`). */
  FULLARTIST: 16,
  /** prop.lua `searchword = 30`. The select scene's current search query. */
  SEARCHWORD: 30,
  /** prop.lua `skin_name = 50`. The mounted skin's `header.name`. */
  SKIN_NAME: 50,
  /** prop.lua `skin_author = 51`. The mounted skin's `header.author`. */
  SKIN_AUTHOR: 51,
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

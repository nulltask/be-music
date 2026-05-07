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

// ─── Runtime op-codes ──────────────────────────────────────────────────────────────────────────────
// Sources: prop.lua `local op = { ... }`. The codes below are the runtime-only ops the adapter sets
// during gameplay; option ops (the user's confirmed `skin_config.option` picks) flow separately through
// `buildBaseOpSet`.

export const BEATORAJA_OP = {
  /** prop.lua `now_loading = 80`. */
  NOW_LOADING: 80,
  /** prop.lua `loaded = 81`. */
  LOADED: 81,

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
} as const;

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
  /** prop.lua `rival = 1`. */
  RIVAL: 1,
  /** prop.lua `player = 2`. */
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
} as const;

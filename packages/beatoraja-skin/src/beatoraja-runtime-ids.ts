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

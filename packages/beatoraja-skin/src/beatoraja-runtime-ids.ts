// Named beatoraja runtime timer IDs and op-codes.
//
// Skins reference engine state through three numeric ID spaces:
//   - `timer` IDs (per-element animation clock; element fades / cycles relative to when the timer fires)
//   - `op` IDs (visibility gate via `if[]` / `op[]` — boolean engine state codes)
//   - `ref` IDs (frame index inside an `image[]` cell strip, or text content via `text[].ref`)
//
// beatoraja inherits LR2's numeric base layout for the conventional cases (1P side: 50..59 bombs, 70..79 LN
// hold, 100..109 key-on, 120..129 key-off, judge timer 46), and reserves 1000+ ID extensions for the 24-key
// and 9-key (PMS) variants the LR2 layout can't address. The exact layout used here is verified against
// beatoraja's own `play24main.lua` reference theme (under `__fixtures__/lua-skin/`):
//
//     local function timer_key_bomb(index) -- 50..59 / 1000+
//     local function timer_key_hold(index) -- 70..79 / 1200+
//     local function timer_key_on(index)   -- 100..109 / 1400+
//     local function timer_key_off(index)  -- 120..129 / 1600+
//     local function value_judge(index)    -- 500..509 / 1500+   (per-lane judge ms)
//
// The engine adapter (`beatoraja-runtime-adapter.ts` in `player-web`) uses the helpers below to stamp the
// matching slot when the engine raises the corresponding event — `flash-lane` → `keyOnTimerId(side, lane)`,
// `flash-judge` → `judgeTimerId(side)`, etc. Each helper returns `undefined` when the side / lane index is
// out of range so the adapter can simply skip the stamp.
//
// Op-codes are documented as ranges rather than enumerated — beatoraja's full set is multiple hundreds of
// codes (lamp / clear-state / chart-info / option pick / judge-detail / etc.), but the Web renderer only
// needs to reproduce the codes the engine can actually emit. The `BEATORAJA_OP` namespace below lists the
// runtime ops the adapter currently sets; option ops keep flowing through `buildBaseOpSet` from the user's
// `skin_config.option` selection without needing a name here.

/**
 * Discriminator for a beatoraja "side" — single-play / 1P-side of double / first-half of 9key uses `1`;
 * 2P side of double / second half of 9key uses `2`. The 9key extension (PMS) collapses both physical
 * sides onto side `1` from beatoraja's perspective; the renderer-side resolver translates lane channels
 * into the corresponding side before calling these helpers.
 */
export type BeatorajaSide = 1 | 2;

// ─── Built-in scene timers ──────────────────────────────────────────────────────────────────────────

/** Anchored at the moment the play scene mounts. Always-on for elements with `timer = 0`. */
export const TIMER_SCENE_START = 0;
/** Fires when the loader starts decoding chart resources. */
export const TIMER_LOAD_START = 1;
/** Fires when the loader finishes; skins use this to fade in chrome before notes scroll. */
export const TIMER_LOAD_END = 2;
/** Fires when the engine begins audible playback (after `playstart` lead-in elapses). */
export const TIMER_PLAY_START = 3;
/** Fires when the chart ends (note timeline drained). */
export const TIMER_FADEOUT_START = 4;

/** Per-side judge timer — restarts on every judgement on that side. */
export const TIMER_JUDGE_1P = 46;
/** Per-side judge timer — restarts on every judgement on that side. */
export const TIMER_JUDGE_2P = 47;

// ─── LR2-compatible per-lane timer bases ────────────────────────────────────────────────────────────

/** Bomb / explosion timer — `50 + lane` for 1P keys 1..9, `60 + lane` for 2P. */
export const TIMER_BOMB_1P_BASE = 50;
export const TIMER_BOMB_2P_BASE = 60;

/** LN hold timer — `70 + lane` for 1P, `80 + lane` for 2P. */
export const TIMER_LN_HOLD_1P_BASE = 70;
export const TIMER_LN_HOLD_2P_BASE = 80;

/** Key-on (lane laser) timer — `100 + lane` for 1P, `110 + lane` for 2P. */
export const TIMER_KEY_ON_1P_BASE = 100;
export const TIMER_KEY_ON_2P_BASE = 110;

/** Key-off (release fade) timer — `120 + lane` for 1P, `130 + lane` for 2P. */
export const TIMER_KEY_OFF_1P_BASE = 120;
export const TIMER_KEY_OFF_2P_BASE = 130;

// ─── 24-key / 9-key extensions ──────────────────────────────────────────────────────────────────────
//
// Lane indices > 9 fall outside the LR2 single-digit range, so beatoraja allocates `1000+` blocks for
// each timer category. The play24 reference theme is the authoritative source for these values.

export const TIMER_BOMB_EXT_BASE = 1000;
export const TIMER_LN_HOLD_EXT_BASE = 1200;
export const TIMER_KEY_ON_EXT_BASE = 1400;
export const TIMER_KEY_OFF_EXT_BASE = 1600;

/** Per-lane judge-ms value (`500..509` / `1510..` for 24-key) — `value_judge(i)` in play24main.lua. */
export const VALUE_JUDGE_BASE = 500;
export const VALUE_JUDGE_EXT_BASE = 1500;

/** Maximum lane index addressable by the LR2 / 1P / 2P bases (inclusive). Above this falls into 1000+ space. */
export const LR2_LANE_INDEX_MAX = 9;

/**
 * Per-side base for a given timer category. Returns the value to which a 1..N lane index is added.
 * Lanes 1..9 use the LR2 base; 10+ uses the 1000-block extension regardless of side (matching beatoraja's
 * own `index <= 9` branch).
 */
function lr2OrExtBase(category: 'bomb' | 'lnHold' | 'keyOn' | 'keyOff', side: BeatorajaSide, isExt: boolean): number {
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
  if (!Number.isInteger(lane) || lane < 1) return undefined;
  const base = lr2OrExtBase(category, side, lane > LR2_LANE_INDEX_MAX);
  return base + lane;
}

/** Bomb timer for `(side, lane)`. Returns `undefined` if `lane` is out of range. */
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

// ─── Runtime op-codes (engine-driven boolean state) ────────────────────────────────────────────────
//
// Skins reference these via `if[]` / `op[]` to gate visibility on engine state. Option ops (the user's
// confirmed picks from `skin_config.option`) are surfaced through `buildBaseOpSet`; the codes below are
// the runtime-only ops the adapter sets every frame from the engine's UI signals.
//
// The values match beatoraja's `SkinPropertyMapper` / `SkinPropertyMapper.optionMap()` definitions; the
// subset here covers exactly what the Web engine adapter emits so far. Adding new ops is additive — the
// adapter just inserts the code into `activeOps` and the skin's existing gates pick it up.

export const BEATORAJA_OP = {
  /** Most-recent judgement on side 1 was PERFECT GREAT (PG, the best window). */
  P1_JUDGE_PG: 50,
  /** Most-recent judgement on side 1 was GREAT. */
  P1_JUDGE_GR: 51,
  /** Most-recent judgement on side 1 was GOOD. */
  P1_JUDGE_GD: 52,
  /** Most-recent judgement on side 1 was BAD. */
  P1_JUDGE_BD: 53,
  /** Most-recent judgement on side 1 was POOR (no-judge / passthrough). */
  P1_JUDGE_PR: 54,
  /** Most-recent judgement on side 1 was a MISS (zero-window POOR). */
  P1_JUDGE_MS: 55,

  /** Same as the `P1_JUDGE_*` group, on side 2. */
  P2_JUDGE_PG: 60,
  P2_JUDGE_GR: 61,
  P2_JUDGE_GD: 62,
  P2_JUDGE_BD: 63,
  P2_JUDGE_PR: 64,
  P2_JUDGE_MS: 65,

  /** "Last judge was FAST" — pairs with `P1_JUDGE_LATE` for the early/late readout. */
  P1_JUDGE_FAST: 240,
  /** "Last judge was LATE". */
  P1_JUDGE_LATE: 241,
  /** "Last judge was FAST" on 2P side. */
  P2_JUDGE_FAST: 242,
  /** "Last judge was LATE" on 2P side. */
  P2_JUDGE_LATE: 243,

  /** Loader is still running (`#LOADSTART` fired but `#LOADEND` hasn't). */
  LOADING_IN_PROGRESS: 80,

  /** Auto-play is running (the host configured `mode: 'auto'`). */
  AUTO_PLAY_ON: 70,

  /** Single-play, double-play, battle-play distinguishers — used by skins to swap layout banks. */
  PLAY_MODE_SINGLE: 1,
  PLAY_MODE_BATTLE: 2,
  PLAY_MODE_DOUBLE: 3,

  /** "Currently in an LN-hold" gate — set on side 1 while any LN is held; cleared on release. */
  P1_LN_HOLDING: 78,
  /** Same on side 2. */
  P2_LN_HOLDING: 79,
} as const;

/**
 * Op-code corresponding to a parsed engine judge string. `undefined` for `MISS` slip-throughs the engine
 * uses internally — those don't contribute to the skin's last-judge gate (they're rendered through the
 * dedicated POOR BGA path).
 *
 * The mapping mirrors `pixi-gameplay.ts`'s LR2 judge-state latch — engine-side judge strings are
 * uppercase: `'PERFECT'` / `'GREAT'` / `'GOOD'` / `'BAD'` / `'POOR'` / `'MISS'` / `'FAST'` / `'SLOW'`.
 */
export function judgeOpForKind(side: BeatorajaSide, kind: string): number | undefined {
  const upper = kind.toUpperCase();
  if (side === 1) {
    switch (upper) {
      case 'PERFECT':
        return BEATORAJA_OP.P1_JUDGE_PG;
      case 'GREAT':
        return BEATORAJA_OP.P1_JUDGE_GR;
      case 'GOOD':
        return BEATORAJA_OP.P1_JUDGE_GD;
      case 'BAD':
        return BEATORAJA_OP.P1_JUDGE_BD;
      case 'POOR':
        return BEATORAJA_OP.P1_JUDGE_PR;
      case 'MISS':
        return BEATORAJA_OP.P1_JUDGE_MS;
      default:
        return undefined;
    }
  }
  switch (upper) {
    case 'PERFECT':
      return BEATORAJA_OP.P2_JUDGE_PG;
    case 'GREAT':
      return BEATORAJA_OP.P2_JUDGE_GR;
    case 'GOOD':
      return BEATORAJA_OP.P2_JUDGE_GD;
    case 'BAD':
      return BEATORAJA_OP.P2_JUDGE_BD;
    case 'POOR':
      return BEATORAJA_OP.P2_JUDGE_PR;
    case 'MISS':
      return BEATORAJA_OP.P2_JUDGE_MS;
    default:
      return undefined;
  }
}

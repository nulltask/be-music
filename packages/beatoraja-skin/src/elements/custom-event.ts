// `customEvents[]` / `customTimers[]` parser + per-frame evaluator (audit 2.2).
//
// Beatoraja's `JsonSkin.CustomEvent` pairs a `condition` (BooleanProperty — Lua function or
// numeric op id) with an `action` (Event / Lua function fired when condition flips true)
// and a `minInterval` rate-limiter. The reference renderer iterates `skin.customEvents` each
// frame: when a condition just turned `false → true` AND enough ms have passed since the
// last fire (per `minInterval`), invoke the action. Skin authors use this to bridge the gap
// between engine state and skin-side side effects (full-combo voice, IR-rank update SE,
// section-win/lose jingles, panel-toggle transitions).
//
// `customTimers[]` is the timer-shaped sibling — each entry's `timer` Lua function returns
// the desired timer start (microseconds) per frame; when the value differs from the engine's
// current stamp the host updates the timer slot.

import {
  isBeatorajaLuaFunctionValue,
  type BeatorajaLuaFunctionValue,
  type BeatorajaLuaRuntimeContext,
} from '../lua.ts';
import { evaluateBeatorajaLuaBoolean, evaluateBeatorajaLuaNumber } from '../lua.ts';

/**
 * Normalized custom-event entry. The host's per-frame evaluator (see
 * {@link evaluateBeatorajaCustomEvents}) tracks the per-entry edge-detection state in a
 * separate map — the entry itself stays read-only.
 */
export interface BeatorajaCustomEvent {
  /** Authoring id (mostly informational; the evaluator keys on declaration order). */
  id: number;
  /**
   * Boolean predicate evaluated each frame. Either:
   *
   *   - A numeric op-code id — true when `runtimeContext.option(id)` returns true.
   *   - A `BeatorajaLuaFunctionValue` — true when the Lua function returns a truthy value.
   *
   * `undefined` means "no condition authored" — the action never fires.
   */
  condition?: number | BeatorajaLuaFunctionValue;
  /**
   * Action fired when {@link condition} flips false → true (and the rate-limit window has
   * elapsed). A `BeatorajaLuaFunctionValue`; the host invokes it without arguments. Beatoraja
   * also accepts numeric event ids (= "fire button-action N") but those are exotic — the
   * common case is a Lua closure that calls `main_state.audio_play(...)` etc.
   */
  action?: BeatorajaLuaFunctionValue;
  /**
   * Minimum ms between successive fires. `0` (default) means "no rate limit". Higher values
   * suppress the action when the condition pulses repeatedly (judge thresholds in dense
   * streams, etc.).
   */
  minInterval: number;
}

/** Normalized custom-timer entry — see file header. */
export interface BeatorajaCustomTimer {
  id: number;
  /**
   * Lua function returning the timer's microsecond start (or `timer_off_value` for "not
   * active"). The host's evaluator stamps the matching engine timer slot when the returned
   * value differs from the prior frame's value.
   */
  timer?: BeatorajaLuaFunctionValue;
}

/**
 * Convert a raw `customEvents[]` array (typed as `Record<string, unknown>[]` after JSON
 * parse / Lua eval) into typed entries. Drops entries that have neither a numeric id nor a
 * Lua function in `condition` / `action`.
 */
export function normalizeBeatorajaCustomEvents(input: unknown): BeatorajaCustomEvent[] {
  if (!Array.isArray(input)) return [];
  const out: BeatorajaCustomEvent[] = [];
  for (let i = 0; i < input.length; i += 1) {
    const entry = input[i];
    if (entry === null || typeof entry !== 'object') continue;
    const obj = entry as Readonly<Record<string, unknown>>;
    const id = typeof obj.id === 'number' && Number.isFinite(obj.id) ? obj.id : i;
    const condition = booleanPropertyField(obj.condition);
    const action = isBeatorajaLuaFunctionValue(obj.action) ? obj.action : undefined;
    const minInterval = typeof obj.minInterval === 'number' && Number.isFinite(obj.minInterval) ? obj.minInterval : 0;
    if (condition === undefined && action === undefined) continue;
    out.push({
      id,
      ...(condition !== undefined ? { condition } : {}),
      ...(action !== undefined ? { action } : {}),
      minInterval,
    });
  }
  return out;
}

export function normalizeBeatorajaCustomTimers(input: unknown): BeatorajaCustomTimer[] {
  if (!Array.isArray(input)) return [];
  const out: BeatorajaCustomTimer[] = [];
  for (let i = 0; i < input.length; i += 1) {
    const entry = input[i];
    if (entry === null || typeof entry !== 'object') continue;
    const obj = entry as Readonly<Record<string, unknown>>;
    const id = typeof obj.id === 'number' && Number.isFinite(obj.id) ? obj.id : i;
    const timer = isBeatorajaLuaFunctionValue(obj.timer) ? obj.timer : undefined;
    if (timer === undefined) continue;
    out.push({ id, timer });
  }
  return out;
}

function booleanPropertyField(value: unknown): number | BeatorajaLuaFunctionValue | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (isBeatorajaLuaFunctionValue(value)) return value;
  return undefined;
}

/**
 * Per-event edge-detection state maintained ACROSS frames by the host. The host owns the
 * map's lifetime — typically allocated once per scene mount and discarded on tear-down. The
 * evaluator reads / writes via the entry's array index.
 */
export interface BeatorajaCustomEventState {
  /** True when the previous frame's condition was true. Edge detection compares against this. */
  lastConditionWasTrue: boolean;
  /** Wall-clock ms timestamp of the last action fire. `0` means "never fired". */
  lastFireMs: number;
}

/**
 * Walk the parsed `customEvents` and fire any whose condition just flipped false → true AND
 * whose `minInterval` has elapsed. Returns the count of actions fired (mostly for tests /
 * diagnostics).
 *
 * `state` is a per-evaluator array indexed by `events[i]` position — the host allocates it
 * once and re-uses across frames so the edge-detection logic stays consistent. Resizes
 * automatically when the events array grows (rare in practice).
 *
 * `nowMs` is the host's monotonic clock reading. The function reads / writes
 * `state[i].lastFireMs` against it for rate limiting.
 */
export function evaluateBeatorajaCustomEvents(
  events: ReadonlyArray<BeatorajaCustomEvent>,
  state: BeatorajaCustomEventState[],
  context: BeatorajaLuaRuntimeContext | undefined,
  nowMs: number,
): number {
  let fired = 0;
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i]!;
    let entryState = state[i];
    if (entryState === undefined) {
      entryState = { lastConditionWasTrue: false, lastFireMs: 0 };
      state[i] = entryState;
    }
    // Resolve the condition. Numeric ids consult `context.option`; Lua functions evaluate
    // through `evaluateBeatorajaLuaBoolean` (which already returns boolean | undefined).
    let conditionValue = false;
    if (typeof event.condition === 'number') {
      conditionValue = context?.option?.(event.condition) === true;
    } else if (event.condition !== undefined) {
      conditionValue = evaluateBeatorajaLuaBoolean(event.condition, context) === true;
    }
    const justFlipped = conditionValue && !entryState.lastConditionWasTrue;
    entryState.lastConditionWasTrue = conditionValue;
    if (!justFlipped) continue;
    if (event.action === undefined) continue;
    // Rate-limit. `lastFireMs > 0` distinguishes "never fired" from "fired at t=0" — the
    // latter is rare in practice (host clock starts above 0 once the scene has mounted) but
    // the guard keeps the first-fire path unambiguous regardless. Subsequent fires are
    // suppressed when their `nowMs - lastFireMs` falls below `minInterval`.
    if (event.minInterval > 0 && entryState.lastFireMs > 0 && nowMs - entryState.lastFireMs < event.minInterval) {
      continue;
    }
    // Fire — invoke the action without args. Action's return value is discarded.
    event.action.evaluate(context);
    entryState.lastFireMs = nowMs > 0 ? nowMs : 1;
    fired += 1;
  }
  return fired;
}

/**
 * Evaluate `customTimers[]` and call `setTimer(id, value)` on the host whenever the timer's
 * Lua function returns a value differing from the previous frame's. The host wires the
 * `setTimer` callback into its engine adapter so the timer slot stays live.
 */
export function evaluateBeatorajaCustomTimers(
  timers: ReadonlyArray<BeatorajaCustomTimer>,
  state: number[],
  context: BeatorajaLuaRuntimeContext | undefined,
  setTimer: (id: number, value: number) => void,
): void {
  for (let i = 0; i < timers.length; i += 1) {
    const timer = timers[i]!;
    if (timer.timer === undefined) continue;
    const value = evaluateBeatorajaLuaNumber(timer.timer, context);
    if (value === undefined) continue;
    if (state[i] === value) continue;
    state[i] = value;
    setTimer(timer.id, value);
  }
}

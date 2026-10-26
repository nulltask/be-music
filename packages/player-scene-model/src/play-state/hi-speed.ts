import {
  captureFloatingHiSpeed,
  clampFloatingHiSpeed,
  resolveFloatingHiSpeed,
  resolveFloatingHiSpeedExit,
  stepFloatingHiSpeed,
  type FloatingHiSpeedAnchor,
} from '../play-options/floating-hi-speed.ts';
import { resolveNormalHiSpeed, resolveNormalHiSpeedLevel } from '../play-options/normal-hi-speed.ts';
import { DEFAULT_HISPEED, snapHiSpeed, snapClassicHiSpeed, stepPlayerHiSpeed } from '../play-options/hi-speed.ts';
import type { HSFix } from '../play-options/options.ts';

/**
 * The hi-speed of a play: the player's, on their own scale (what the select panel, the readouts and the host show and
 * the hi-speed keys step), and the drawn one the notes scroll with: the player's times the chart's HS-FIX multiplier.
 * `locked` while a course forbids the player changing it (`no_speed`).
 */
export interface HiSpeedState {
  readonly player: number;
  readonly drawn: number;
  /** The chart's HS-FIX multiplier ({@link resolveHSFixMultiplier}); 1 without HS-FIX. */
  readonly multiplier: number;
  readonly locked: boolean;
  readonly classic?: true;
  readonly normalLevel?: number;
  readonly normalBPM?: number;
  readonly floating?: FloatingHiSpeedAnchor;
  readonly floatingInitial?: FloatingHiSpeedAnchor;
}

/** The tempo facts HS-FIX reads off a chart. */
export interface HSFixTempo {
  /** The BPM the player's hi-speed is meant at: the chart's `#BASEBPM`, else its start BPM. */
  readonly referenceBPM?: number;
  /** Every BPM of the chart's tempo map (negative ones count at their magnitude). */
  readonly bpms: readonly number[];
  /** The BPM most notes sit at (beatoraja's MAINBPM). */
  readonly mainBPM?: number;
  /** The chart header BPM, independent of the reference (#BASEBPM) and any beat-zero tempo change. */
  readonly startBPM?: number;
}

/**
 * The multiplier HS-FIX scales the player's hi-speed by, so the scroll at another BPM of the chart feels like the
 * player's hi-speed at the reference BPM, as beatoraja's fixed hi-speed modes do (`LaneRenderer.init`): `MAXBPM` keeps
 * the maximum BPM at that speed, `MINBPM` the minimum, `AVERAGE` the main BPM (the BPM most notes sit at, which BPM × N
 * + STOP gimmicks do not skew the way a time average is). LR2 `CONSTANT` uses its separate 150-BPM distance map
 * with multiplier 1. Also 1 without HS-FIX, without a reference BPM or without a positive BPM.
 */
export function resolveHSFixMultiplier(mode: HSFix, tempo: HSFixTempo): number {
  if (mode === 'OFF' || mode === 'CONSTANT') return 1;
  const referenceBPM = tempo.referenceBPM !== undefined && tempo.referenceBPM > 0 ? tempo.referenceBPM : undefined;
  if (referenceBPM === undefined) return 1;
  const bpms = tempo.bpms.map((bpm) => Math.abs(bpm)).filter((bpm) => Number.isFinite(bpm) && bpm > 0);
  if (bpms.length === 0) return 1;
  const target =
    mode === 'STARTBPM'
      ? (tempo.startBPM ?? bpms[0]!)
      : mode === 'MAXBPM'
        ? Math.max(...bpms)
        : mode === 'MINBPM'
          ? Math.min(...bpms)
          : (tempo.mainBPM ?? referenceBPM);
  const multiplier = referenceBPM / target;
  return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
}

/** The hi-speed a play starts with: the player's (the default when none or an invalid one), drawn under HS-FIX. */
export function createHiSpeedState(
  init: {
    hiSpeed?: number;
    multiplier?: number;
    locked?: boolean;
    classic?: boolean;
    normalLevel?: number;
    bpm?: number;
    floating?: boolean;
    visibleFraction?: number;
  } = {},
): HiSpeedState {
  const normal =
    !init.floating && init.normalLevel !== undefined
      ? resolveNormalHiSpeed(init.normalLevel, init.bpm ?? 120)
      : undefined;
  const player =
    normal ??
    (init.floating ? clampFloatingHiSpeed : init.classic ? snapClassicHiSpeed : snapHiSpeed)(
      init.hiSpeed ?? DEFAULT_HISPEED,
    ) ??
    DEFAULT_HISPEED;
  const multiplier = init.multiplier !== undefined && init.multiplier > 0 ? init.multiplier : 1;
  return {
    player,
    drawn: sourceDrawn(player, multiplier, init.classic === true || normal !== undefined || init.floating === true),
    multiplier,
    locked: init.locked === true,
    ...(init.classic ? { classic: true as const } : {}),
    ...(normal !== undefined || (init.floating && (init.normalLevel ?? 0) > 0)
      ? { normalLevel: init.normalLevel!, normalBPM: init.bpm ?? 120 }
      : {}),
    ...(init.floating
      ? {
          floating: captureFloatingHiSpeed(player, init.bpm ?? 120, init.visibleFraction ?? 1),
          floatingInitial: captureFloatingHiSpeed(player, init.bpm ?? 120, init.visibleFraction ?? 1),
        }
      : {}),
  };
}

/** A change of the hi-speed during a play. */
export type HiSpeedCommand =
  /** The player's hi-speed keys: step the player's hi-speed (ignored while locked). */
  | { type: 'hi-speed-step'; delta: number; bpm?: number }
  /** The host sets the player's hi-speed (a settings menu); HS-FIX applies on top. */
  | { type: 'hi-speed-set'; value: number; bpm?: number }
  | { type: 'hi-speed-scale'; multiplier: number }
  | { type: 'floating-speed-mode'; enabled: boolean; bpm: number; visibleFraction: number }
  | { type: 'floating-speed-restore'; bpm: number; visibleFraction: number }
  | { type: 'floating-speed-recalculate'; bpm: number; visibleFraction: number }
  | { type: 'hi-speed-fine'; direction: number; bpm?: number; visibleFraction?: number }
  /**
   * A drawn hi-speed from elsewhere — a replay's recorded view — taken as it is, the player's worked back from it.
   * Taken while locked too, as the replay's recorded covers are (`cover-set`): the lock stops the player changing the
   * view, and a replay shows the view that was played, which a course's lock held where it started.
   */
  | { type: 'hi-speed-drawn'; value: number };

/**
 * Applies a hi-speed change. Returns the same state when nothing changes: a non-finite value, a step past either end
 * of the range, or the player's step while the course locks the hi-speed. The host's own setting and a replay's
 * recorded hi-speed are taken even then.
 */
export function reduceHiSpeed(state: HiSpeedState, command: HiSpeedCommand): HiSpeedState {
  switch (command.type) {
    case 'floating-speed-mode': {
      if (state.locked || command.enabled === (state.floating !== undefined)) return state;
      if (command.enabled) {
        const floating = captureFloatingHiSpeed(state.player, command.bpm, command.visibleFraction);
        const player = clampFloatingHiSpeed(state.player);
        return !floating || player === undefined
          ? state
          : { ...state, floating, floatingInitial: floating, player, drawn: player * state.multiplier };
      }
      const next = resolveFloatingHiSpeedExit(state.player, command.bpm, state.classic === true);
      if (!next) return state;
      const { floating: _floating, floatingInitial: _initial, normalLevel: _normal, ...kept } = state;
      return {
        ...kept,
        player: next.hiSpeed,
        drawn: next.hiSpeed * state.multiplier,
        ...(next.normalLevel !== undefined ? { normalLevel: next.normalLevel, normalBPM: command.bpm } : {}),
      };
    }
    case 'floating-speed-restore':
    case 'floating-speed-recalculate': {
      if (state.locked || !state.floating) return state;
      const anchor =
        command.type === 'floating-speed-restore' ? (state.floatingInitial ?? state.floating) : state.floating;
      const player = resolveFloatingHiSpeed(anchor, command.bpm, command.visibleFraction);
      return player === undefined || player === state.player
        ? state
        : { ...state, player, drawn: player * state.multiplier };
    }
    case 'hi-speed-fine': {
      if (state.locked || !state.floating) return state;
      const player = stepFloatingHiSpeed(state.player, command.direction, true);
      if (player === undefined || player === state.player) return state;
      // An uncovered scratch edits the saved reference, unlike a keyboard step.
      const floating = captureFloatingHiSpeed(
        player,
        command.bpm ?? state.floating.bpm,
        command.visibleFraction ?? state.floating.visibleFraction,
      );
      return { ...state, player, drawn: player * state.multiplier, floating: floating ?? state.floating };
    }
    case 'hi-speed-scale': {
      if (!(command.multiplier > 0) || !Number.isFinite(command.multiplier) || command.multiplier === state.multiplier)
        return state;
      return { ...state, multiplier: command.multiplier, drawn: sourceDrawn(state.player, command.multiplier, true) };
    }
    case 'hi-speed-step': {
      if (state.locked) return state;
      if (state.floating) {
        const player = stepFloatingHiSpeed(state.player, command.delta);
        return player === undefined || player === state.player
          ? state
          : { ...state, player, drawn: player * state.multiplier };
      }
      if (state.normalLevel !== undefined) {
        if (!Number.isFinite(command.delta) || command.delta === 0) return state;
        const level = Math.max(1, Math.min(20, state.normalLevel + Math.sign(command.delta)));
        if (level === state.normalLevel) return state;
        return setNormalLevel(state, level, command.bpm ?? state.normalBPM ?? 120);
      }
      const next = stepPlayerHiSpeed(state.player, command.delta, state.multiplier, state.classic);
      return next === undefined || (next.player === state.player && next.drawn === state.drawn)
        ? state
        : { ...state, player: next.player, drawn: next.drawn };
    }
    case 'hi-speed-set': {
      if (state.floating) {
        const player = clampFloatingHiSpeed(command.value);
        return player === undefined || player === state.player
          ? state
          : { ...state, player, drawn: player * state.multiplier };
      }
      if (state.normalLevel !== undefined) {
        const bpm = command.bpm ?? state.normalBPM ?? 120;
        const level = resolveNormalHiSpeedLevel(command.value, bpm);
        return level === undefined ? state : setNormalLevel(state, level, bpm);
      }
      const next = stepPlayerHiSpeed(command.value, 0, state.multiplier, state.classic);
      return next === undefined || (next.player === state.player && next.drawn === state.drawn)
        ? state
        : { ...state, player: next.player, drawn: next.drawn };
    }
    case 'hi-speed-drawn': {
      const source = state.floating !== undefined || state.classic || state.normalLevel !== undefined;
      const drawn = source ? validSourceSpeed(command.value) : snapHiSpeed(command.value);
      if (drawn === undefined || drawn === state.drawn) return state;
      return {
        ...state,
        drawn,
        player:
          (source ? validSourceSpeed(drawn / state.multiplier) : snapHiSpeed(drawn / state.multiplier)) ?? state.player,
      };
    }
  }
}

function validSourceSpeed(value: number): number | undefined {
  return Number.isFinite(value) && value > 0 ? value : undefined;
}
function sourceDrawn(player: number, multiplier: number, source: boolean): number {
  return (source ? validSourceSpeed(player * multiplier) : snapHiSpeed(player * multiplier)) ?? player;
}
function setNormalLevel(state: HiSpeedState, level: number, bpm: number): HiSpeedState {
  const player = resolveNormalHiSpeed(level, bpm);
  if (player === undefined) return state;
  return { ...state, normalLevel: level, normalBPM: bpm, player, drawn: sourceDrawn(player, state.multiplier, true) };
}

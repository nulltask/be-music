import { DEFAULT_HISPEED, snapHiSpeed, stepPlayerHiSpeed } from '../play-options/hi-speed.ts';
import type { HsFix } from '../play-options/options.ts';

/**
 * The hi-speed of a play: the player's, on their own scale (what the select panel, the readouts and the host show and
 * the hi-speed keys step), and the drawn one the notes scroll with: the player's times the chart's HS-FIX multiplier.
 * `locked` while a course forbids changing it (`no_speed`).
 */
export interface HiSpeedState {
  readonly player: number;
  readonly drawn: number;
  /** The chart's HS-FIX multiplier ({@link resolveHsFixMultiplier}); 1 without HS-FIX. */
  readonly multiplier: number;
  readonly locked: boolean;
}

/** The tempo facts HS-FIX reads off a chart. */
export interface HsFixTempo {
  /** The BPM the player's hi-speed is meant at: the chart's `#BASEBPM`, else its start BPM. */
  readonly referenceBpm?: number;
  /** Every BPM of the chart's tempo map (negative ones count at their magnitude). */
  readonly bpms: readonly number[];
  /** The BPM most notes sit at (beatoraja's MAINBPM). */
  readonly mainBpm?: number;
}

/**
 * The multiplier HS-FIX scales the player's hi-speed by, so the scroll at another BPM of the chart feels like the
 * player's hi-speed at the reference BPM, as beatoraja's fixed hi-speed modes do (`LaneRenderer.init`): `MAXBPM` keeps
 * the maximum BPM at that speed, `MINBPM` the minimum, `AVERAGE` the main BPM (the BPM most notes sit at, which BPM × N
 * + STOP gimmicks do not skew the way a time average is), and `CONSTANT`, until the scroll can follow every BPM change,
 * the main BPM too. 1 without HS-FIX, without a reference BPM or without a positive BPM.
 */
export function resolveHsFixMultiplier(mode: HsFix, tempo: HsFixTempo): number {
  if (mode === 'OFF') return 1;
  const referenceBpm = tempo.referenceBpm !== undefined && tempo.referenceBpm > 0 ? tempo.referenceBpm : undefined;
  if (referenceBpm === undefined) return 1;
  const bpms = tempo.bpms.map((bpm) => Math.abs(bpm)).filter((bpm) => Number.isFinite(bpm) && bpm > 0);
  if (bpms.length === 0) return 1;
  const target =
    mode === 'MAXBPM' ? Math.max(...bpms) : mode === 'MINBPM' ? Math.min(...bpms) : (tempo.mainBpm ?? referenceBpm);
  const multiplier = referenceBpm / target;
  return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
}

/** The hi-speed a play starts with: the player's (the default when none or an invalid one), drawn under HS-FIX. */
export function createHiSpeedState(
  init: { hiSpeed?: number; multiplier?: number; locked?: boolean } = {},
): HiSpeedState {
  const player = snapHiSpeed(init.hiSpeed ?? DEFAULT_HISPEED) ?? DEFAULT_HISPEED;
  const multiplier = init.multiplier !== undefined && init.multiplier > 0 ? init.multiplier : 1;
  return { player, drawn: snapHiSpeed(player * multiplier) ?? player, multiplier, locked: init.locked === true };
}

/** A change of the hi-speed during a play. */
export type HiSpeedCommand =
  /** The player's hi-speed keys: step the player's hi-speed (ignored while locked). */
  | { type: 'hi-speed-step'; delta: number }
  /** The host sets the player's hi-speed (a settings menu); HS-FIX applies on top. */
  | { type: 'hi-speed-set'; value: number }
  /**
   * A drawn hi-speed from elsewhere — a replay's recorded view — taken as it is, the player's worked back from it
   * (ignored while locked).
   */
  | { type: 'hi-speed-drawn'; value: number };

/**
 * Applies a hi-speed change. Returns the same state when nothing changes: a non-finite value, a step past either end
 * of the range, or a player change while the course locks the hi-speed. The host's own setting is taken even then.
 */
export function reduceHiSpeed(state: HiSpeedState, command: HiSpeedCommand): HiSpeedState {
  switch (command.type) {
    case 'hi-speed-step': {
      if (state.locked) return state;
      const next = stepPlayerHiSpeed(state.player, command.delta, state.multiplier);
      return next === undefined || (next.player === state.player && next.drawn === state.drawn)
        ? state
        : { ...state, player: next.player, drawn: next.drawn };
    }
    case 'hi-speed-set': {
      const next = stepPlayerHiSpeed(command.value, 0, state.multiplier);
      return next === undefined || (next.player === state.player && next.drawn === state.drawn)
        ? state
        : { ...state, player: next.player, drawn: next.drawn };
    }
    case 'hi-speed-drawn': {
      if (state.locked) return state;
      const drawn = snapHiSpeed(command.value);
      if (drawn === undefined || drawn === state.drawn) return state;
      return { ...state, drawn, player: snapHiSpeed(drawn / state.multiplier) ?? state.player };
    }
  }
}

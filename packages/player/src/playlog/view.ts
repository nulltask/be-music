import { expectFiniteNumber, expectRecord, PlaylogParseError } from './parse.ts';

/**
 * What the player saw and how fast the play ran, apart from what was judged: the hi-speed, the lane covers (SUDDEN+,
 * HIDDEN+, LIFT) and the tempo, at the start and every change during the play. None of it changes a judgment (inputs
 * and notes are in chart time), so a re-simulation ignores it; a replay or a ghost reads it to show the play as it
 * looked, as far as its viewer asks ({@link PlaylogViewReplay}).
 */

/** One play side's lane cover, each part as a fraction (0 to 1) of the lane height; 0 = off. */
export interface PlaylogLaneCover {
  side: '1P' | '2P';
  /** SUDDEN+: the cover over the top of the lanes. */
  sudden: number;
  /** HIDDEN+: the cover just above the judgement line. */
  hidden: number;
  /** LIFT: how far the judgement line is raised. */
  lift: number;
}

/** The view settings in force, or the ones that changed: every field is optional in a change. */
export interface PlaylogViewState {
  /** The scroll speed multiplier the scene drew with (its own hi-speed scale). */
  hiSpeed?: number;
  /** The hi-speed fix (`OFF`, `START`, `MAX`, `MAIN`, `MIN`, …) the scene kept the scroll with. */
  hsFix?: string;
  /** How long a note stays visible below SUDDEN+, in ms (the "green number"), to show the speed across scenes. */
  visibleMs?: number;
  /** The lane covers per play side that has lanes. A change lists only the sides that changed. */
  covers?: PlaylogLaneCover[];
}

/** A view change during the play, at a chart time (µs, the play log's clock). */
export interface PlaylogViewChange extends PlaylogViewState {
  timeUs: number;
}

/** A tempo change during the play (`PlayerOptions.speed`), at a chart time (µs). */
export interface PlaylogTempoChange {
  timeUs: number;
  tempo: number;
}

/**
 * Which recorded settings a replay or ghost reproduces; the rest stay the viewer's own. Hosts offer these as options.
 * All on by default.
 */
export interface PlaylogViewReplay {
  tempo: boolean;
  hiSpeed: boolean;
  /** SUDDEN+ and HIDDEN+. */
  covers: boolean;
  lift: boolean;
}

export const DEFAULT_PLAYLOG_VIEW_REPLAY: Readonly<PlaylogViewReplay> = {
  tempo: true,
  hiSpeed: true,
  covers: true,
  lift: true,
};

/**
 * The view settings in force at `timeUs`: `initial` with every change at or before it applied in order (a cover change
 * replaces that side's cover).
 */
export function resolvePlaylogViewAt(
  initial: PlaylogViewState | undefined,
  changes: readonly PlaylogViewChange[] | undefined,
  timeUs: number,
): PlaylogViewState {
  const state: PlaylogViewState = cloneView(initial ?? {});
  for (const change of changes ?? []) {
    if (change.timeUs > timeUs) break;
    const { timeUs: _timeUs, covers, ...rest } = change;
    Object.assign(state, rest);
    if (covers !== undefined) {
      const merged = new Map((state.covers ?? []).map((cover) => [cover.side, cover]));
      for (const cover of covers) merged.set(cover.side, { ...cover });
      state.covers = [...merged.values()].sort((left, right) => left.side.localeCompare(right.side));
    }
  }
  return state;
}

/** The tempo in force at `timeUs`: `initial` (1 when absent), then the last change at or before it. */
export function resolvePlaylogTempoAt(
  initial: number | undefined,
  changes: readonly PlaylogTempoChange[] | undefined,
  timeUs: number,
): number {
  let tempo = initial ?? 1;
  for (const change of changes ?? []) {
    if (change.timeUs > timeUs) break;
    tempo = change.tempo;
  }
  return tempo;
}

/** Whether a play ran at any tempo other than 1, at its start or after a change. */
export function playedAtAnotherTempo(play: { tempo?: number; tempoChanges?: readonly PlaylogTempoChange[] }): boolean {
  return (play.tempo ?? 1) !== 1 || (play.tempoChanges ?? []).some((change) => change.tempo !== 1);
}

/**
 * The view a replay or ghost shows at `timeUs`: the recorded view for what `replay` reproduces, the viewer's own
 * (`own`) for the rest. The tempo is resolved apart ({@link resolvePlaylogTempoAt}).
 */
export function resolveReplayView(
  recorded: PlaylogViewState,
  own: PlaylogViewState,
  replay: Readonly<PlaylogViewReplay>,
): PlaylogViewState {
  const view: PlaylogViewState = cloneView(own);
  if (replay.hiSpeed) {
    if (recorded.hiSpeed !== undefined) view.hiSpeed = recorded.hiSpeed;
    if (recorded.hsFix !== undefined) view.hsFix = recorded.hsFix;
    if (recorded.visibleMs !== undefined) view.visibleMs = recorded.visibleMs;
  }
  if ((replay.covers || replay.lift) && recorded.covers !== undefined) {
    const ownCovers = new Map((own.covers ?? []).map((cover) => [cover.side, cover]));
    view.covers = recorded.covers.map((cover) => {
      const mine = ownCovers.get(cover.side) ?? { side: cover.side, sudden: 0, hidden: 0, lift: 0 };
      return {
        side: cover.side,
        sudden: replay.covers ? cover.sudden : mine.sudden,
        hidden: replay.covers ? cover.hidden : mine.hidden,
        lift: replay.lift ? cover.lift : mine.lift,
      };
    });
  }
  return view;
}

function cloneView(view: PlaylogViewState): PlaylogViewState {
  const copy: PlaylogViewState = { ...view };
  if (view.covers !== undefined) copy.covers = view.covers.map((cover) => ({ ...cover }));
  return copy;
}

const SIDES: ReadonlySet<string> = new Set(['1P', '2P']);

function parseFraction(value: unknown, path: string): number {
  const fraction = expectFiniteNumber(value, path);
  if (fraction < 0 || fraction > 1) throw new PlaylogParseError(`${path}: expected a fraction from 0 to 1`);
  return fraction;
}

/** Reads a recorded view state (`play.view`, or a change without its `timeUs`). */
export function parsePlaylogViewState(raw: Record<string, unknown>, path: string): PlaylogViewState {
  const view: PlaylogViewState = {};
  if (raw.hiSpeed !== undefined) {
    const hiSpeed = expectFiniteNumber(raw.hiSpeed, `${path}.hiSpeed`);
    if (!(hiSpeed > 0)) throw new PlaylogParseError(`${path}.hiSpeed: expected a positive number`);
    view.hiSpeed = hiSpeed;
  }
  if (raw.hsFix !== undefined) {
    if (typeof raw.hsFix !== 'string') throw new PlaylogParseError(`${path}.hsFix: expected a string`);
    view.hsFix = raw.hsFix;
  }
  if (raw.visibleMs !== undefined) {
    const visibleMs = expectFiniteNumber(raw.visibleMs, `${path}.visibleMs`);
    if (visibleMs < 0) throw new PlaylogParseError(`${path}.visibleMs: expected a non-negative number`);
    view.visibleMs = visibleMs;
  }
  if (raw.covers !== undefined) {
    if (!Array.isArray(raw.covers)) throw new PlaylogParseError(`${path}.covers: expected an array`);
    view.covers = raw.covers.map((entry, index) => {
      const coverPath = `${path}.covers[${index}]`;
      const cover = expectRecord(entry, coverPath);
      if (typeof cover.side !== 'string' || !SIDES.has(cover.side)) {
        throw new PlaylogParseError(`${coverPath}.side: expected '1P' | '2P'`);
      }
      return {
        side: cover.side as '1P' | '2P',
        sudden: parseFraction(cover.sudden, `${coverPath}.sudden`),
        hidden: parseFraction(cover.hidden, `${coverPath}.hidden`),
        lift: parseFraction(cover.lift, `${coverPath}.lift`),
      };
    });
  }
  return view;
}

/** Reads `play.viewChanges`: changes in chart-time order. */
export function parsePlaylogViewChanges(raw: unknown, path: string): PlaylogViewChange[] {
  if (!Array.isArray(raw)) throw new PlaylogParseError(`${path}: expected an array`);
  let last = -Infinity;
  return raw.map((entry, index) => {
    const changePath = `${path}[${index}]`;
    const record = expectRecord(entry, changePath);
    const timeUs = expectFiniteNumber(record.timeUs, `${changePath}.timeUs`);
    if (timeUs < last) throw new PlaylogParseError(`${changePath}.timeUs: expected changes in time order`);
    last = timeUs;
    return { timeUs, ...parsePlaylogViewState(record, changePath) };
  });
}

/** Reads `play.tempoChanges`: positive tempos in chart-time order. */
export function parsePlaylogTempoChanges(raw: unknown, path: string): PlaylogTempoChange[] {
  if (!Array.isArray(raw)) throw new PlaylogParseError(`${path}: expected an array`);
  let last = -Infinity;
  return raw.map((entry, index) => {
    const changePath = `${path}[${index}]`;
    const record = expectRecord(entry, changePath);
    const timeUs = expectFiniteNumber(record.timeUs, `${changePath}.timeUs`);
    if (timeUs < last) throw new PlaylogParseError(`${changePath}.timeUs: expected changes in time order`);
    last = timeUs;
    const tempo = expectFiniteNumber(record.tempo, `${changePath}.tempo`);
    if (!(tempo > 0)) throw new PlaylogParseError(`${changePath}.tempo: expected a positive number`);
    return { timeUs, tempo };
  });
}

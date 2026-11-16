import type { TimedPlayableNote } from '../playable-notes.ts';
import type { JudgeCoreState } from './judge-core-types.ts';

/**
 * The sound a press plays on a lane with nothing to judge, as plugout4 -ARCADE EDITION- picks it (`plugout4.exe`
 * 0x43bcd0). Each lane keeps a sound cursor: a judged press moves it to the note it judges (0x43bd44), and letting go
 * of a long note moves it to the lane's next note (0x43be96). A hidden (`dmg="0"`) note that plays on the lane takes
 * over until the next judged press (0x43f430, 0x43bd1b). A missed note moves nothing.
 *
 * Before any of that the cursor holds whatever its memory held: `operator new` leaves it uninitialized (0x4077d8,
 * 0x43b9d0). Be-Music starts it at the lane's first note.
 */
export interface PlugoutLaneSoundState {
  /** The note each lane's cursor points at. */
  readonly cursor: Map<string, TimedPlayableNote>;
  /** The hidden note that played last on each lane since its last judged press. */
  readonly hidden: Map<string, TimedPlayableNote>;
  /** How far into `config.invisibleNotes` the hidden notes have played. */
  hiddenIndex: number;
}

export function createPlugoutLaneSoundState(): PlugoutLaneSoundState {
  return { cursor: new Map(), hidden: new Map(), hiddenIndex: 0 };
}

/** A press judged `note` on `channel`: the cursor moves to it and a hidden note's sound gives way. */
export function notePlugoutLaneJudged(state: JudgeCoreState, channel: string, note: TimedPlayableNote): void {
  const lanes = state.plugoutLaneSounds;
  if (lanes === undefined) return;
  lanes.cursor.set(channel, note);
  lanes.hidden.delete(channel);
}

/** A long note on `channel` was let go: the cursor moves to the lane's next note, or stays on its last one. */
export function notePlugoutLaneReleased(state: JudgeCoreState, channel: string): void {
  const lanes = state.plugoutLaneSounds;
  if (lanes === undefined) return;
  let last: TimedPlayableNote | undefined;
  for (const note of state.config.scorableNotes) {
    if (note.channel !== channel) continue;
    if (!note.judged) {
      lanes.cursor.set(channel, note);
      return;
    }
    last = note;
  }
  if (last !== undefined) lanes.cursor.set(channel, last);
}

/** The hidden notes that have played by chart second `seconds` become their lanes' sound. */
export function advancePlugoutHiddenSounds(state: JudgeCoreState, seconds: number): void {
  const lanes = state.plugoutLaneSounds;
  if (lanes === undefined) return;
  const hidden = state.config.invisibleNotes;
  while (lanes.hiddenIndex < hidden.length && hidden[lanes.hiddenIndex]!.seconds <= seconds) {
    const note = hidden[lanes.hiddenIndex]!;
    lanes.hidden.set(note.channel, note);
    lanes.hiddenIndex += 1;
  }
}

/**
 * The note whose sound a press at chart second `seconds` with nothing to judge plays on `channels` (the first lane
 * that has one).
 */
export function resolvePlugoutLaneSound(
  state: JudgeCoreState,
  channels: ReadonlySet<string>,
  seconds: number,
): TimedPlayableNote | undefined {
  const lanes = state.plugoutLaneSounds;
  if (lanes === undefined) return undefined;
  advancePlugoutHiddenSounds(state, seconds);
  for (const channel of channels) {
    const note =
      lanes.hidden.get(channel) ??
      lanes.cursor.get(channel) ??
      state.config.scorableNotes.find((candidate) => candidate.channel === channel);
    if (note !== undefined) return note;
  }
  return undefined;
}

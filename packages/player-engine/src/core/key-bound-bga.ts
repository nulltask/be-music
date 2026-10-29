import { pickKeyBoundBGAFrame, type BmsARGB, type KeyBoundBGACue } from '@be-music/chart-model';
import type { TimedPlayableNote } from '../playable-notes.ts';
import { pickActiveBGACue } from './bga-timeline.ts';

export interface KeyBoundBGAInput {
  seconds: number;
  action: 'down' | 'up';
  channels: readonly string[];
}

/** Presentation state only; it never changes judging, audio or the recorded input stream. */
export interface KeyBoundBGAFrame {
  definitionId: string;
  channel: string;
  bmpKey: string;
  startedSeconds: number;
  /** Start of this displayed frame, for hosts that play a movie as an animation frame. */
  frameStartSeconds: number;
  /** Source movie rate relative to chart seconds, e.g. a NONSTOP FIT stage. */
  playbackRate?: number;
  argb: BmsARGB;
}

/**
 * Deterministic input-driven SWBGA state. Times and input edges are supplied by the caller, with no runtime clock.
 * New matching presses replace the visible animation. Unrelated keys and expired newer animations never revive an
 * older one. Queries may rewind; preloaded replay/AUTO inputs and late-arriving live edges use the same fold.
 */
export class KeyBoundBGAController {
  private readonly cues: KeyBoundBGACue[];
  private readonly initialInputs: KeyBoundBGAInput[];
  private inputs: KeyBoundBGAInput[];
  private cursor = 0;
  private through = Number.NEGATIVE_INFINITY;
  private readonly held = new Set<string>();
  private active: { cue: KeyBoundBGACue; seconds: number } | undefined;

  constructor(
    cues: readonly KeyBoundBGACue[],
    options: {
      inputs?: readonly KeyBoundBGAInput[];
      freezeSeconds?: number;
    } = {},
  ) {
    this.cues = cues
      .filter((cue) => Number.isFinite(cue.seconds) && cue.seconds <= (options.freezeSeconds ?? Infinity))
      .map((cue) => ({
        ...cue,
        definition: { ...cue.definition, argb: { ...cue.definition.argb }, frames: [...cue.definition.frames] },
      }))
      .sort((left, right) => left.seconds - right.seconds);
    this.initialInputs = (options.inputs ?? [])
      .filter((input) => Number.isFinite(input.seconds))
      .map(copyInput)
      .sort((left, right) => left.seconds - right.seconds);
    this.inputs = [...this.initialInputs];
  }

  /** Copy a live input, preserving arrival order among equal timestamps. */
  addInput(input: KeyBoundBGAInput): void {
    if (!Number.isFinite(input.seconds)) return;
    let low = 0,
      high = this.inputs.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.inputs[middle]!.seconds <= input.seconds) low = middle + 1;
      else high = middle;
    }
    this.inputs.splice(low, 0, copyInput(input));
    if (low < this.cursor) this.rewind();
  }

  /** Drop live input history on a manual seek, retaining preloaded AUTO/replay inputs. */
  reset(): void {
    this.inputs = [...this.initialInputs];
    this.rewind();
  }

  read(seconds: number): KeyBoundBGAFrame | undefined {
    if (!Number.isFinite(seconds)) return undefined;
    if (seconds < this.through) this.rewind();
    while (this.cursor < this.inputs.length && this.inputs[this.cursor]!.seconds <= seconds) {
      const input = this.inputs[this.cursor++]!;
      if (input.action === 'up') {
        for (const channel of input.channels) this.held.delete(channel);
        if (this.active?.cue.definition.durationMs === 0 && input.channels.includes(this.active.cue.definition.channel))
          this.active = undefined;
      } else {
        const cue = pickActiveBGACue(this.cues, input.seconds);
        if (
          cue &&
          input.seconds < (cue.endSeconds ?? Infinity) &&
          input.channels.includes(cue.definition.channel) &&
          !this.held.has(cue.definition.channel)
        )
          this.active = { cue, seconds: input.seconds };
        for (const channel of input.channels) this.held.add(channel);
      }
    }
    this.through = seconds;
    const active = this.active;
    if (!active || seconds >= (active.cue.endSeconds ?? Infinity)) return undefined;
    const definition = active.cue.definition;
    const elapsedMs = (seconds - active.seconds) * 1000;
    const bmpKey = pickKeyBoundBGAFrame(definition, elapsedMs);
    if (bmpKey === undefined) return undefined;
    const step = Math.floor((elapsedMs + 1e-6) / definition.frameIntervalMs);
    return {
      definitionId: active.cue.definitionId,
      ...(active.cue.playbackRate !== undefined ? { playbackRate: active.cue.playbackRate } : {}),
      channel: definition.channel,
      bmpKey,
      startedSeconds: active.seconds,
      frameStartSeconds:
        active.seconds +
        ((definition.loop ? step : Math.min(step, definition.frames.length - 1)) * definition.frameIntervalMs) / 1000,
      argb: { ...definition.argb },
    };
  }

  private rewind(): void {
    this.cursor = 0;
    this.through = Number.NEGATIVE_INFINITY;
    this.held.clear();
    this.active = undefined;
  }
}

function copyInput(input: KeyBoundBGAInput): KeyBoundBGAInput {
  return { seconds: input.seconds, action: input.action, channels: [...input.channels] };
}

/** AUTO's visual key edges: tap keys hold for 100 ms; long notes hold through their authored tail. */
export function buildAutoKeyBoundBGAInputs(
  notes: readonly Pick<TimedPlayableNote, 'channel' | 'seconds' | 'endSeconds'>[],
): KeyBoundBGAInput[] {
  const lanes = new Map<string, Array<Pick<TimedPlayableNote, 'channel' | 'seconds' | 'endSeconds'>>>();
  for (const note of notes) {
    if (!Number.isFinite(note.seconds)) continue;
    const lane = lanes.get(note.channel) ?? [];
    lane.push(note);
    lanes.set(note.channel, lane);
  }
  const inputs: KeyBoundBGAInput[] = [];
  for (const [channel, lane] of lanes) {
    lane.sort((left, right) => left.seconds - right.seconds);
    for (let index = 0; index < lane.length;) {
      const note = lane[index]!;
      let next = index;
      let tail = note.seconds;
      while (lane[next]?.seconds === note.seconds) {
        const end = lane[next]!.endSeconds;
        if (end !== undefined && Number.isFinite(end) && end > note.seconds) tail = Math.max(tail, end);
        next++;
      }
      if (tail === note.seconds) tail += 0.1;
      const end = Math.min(tail, lane[next]?.seconds ?? Infinity);
      inputs.push(
        { seconds: note.seconds, action: 'down', channels: [channel] },
        { seconds: end, action: 'up', channels: [channel] },
      );
      index = next;
    }
  }
  // Releases precede a same-lane retrigger at the same timestamp, including chords on other lanes.
  return inputs.sort(
    (left, right) => left.seconds - right.seconds || (left.action === right.action ? 0 : left.action === 'up' ? -1 : 1),
  );
}

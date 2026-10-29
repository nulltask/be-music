import { pickBmsonBGASequenceFrame, type BmsonBGAEventCue } from '@be-music/chart-model';
import type { JudgeCoreEffect } from './judge-core-types.ts';

export interface BmsonBGAEventInput {
  seconds: number;
  condition: 'play' | 'miss';
  /** Optional zero-based alternative choice supplied by a host; otherwise accepted triggers cycle in source order. */
  choice?: number;
}

export interface BmsonBGAFrame {
  plane: 'layer' | 'poor';
  key?: string;
  startedSeconds: number;
  frameStartSeconds: number;
}

/** Shared by live judging and silent replay/AUTO seek reconstruction. */
export function resolveBmsonBGAEventInput(effect: JudgeCoreEffect): BmsonBGAEventInput | undefined {
  if (effect.kind === 'poor-bga' && effect.action === 'trigger') {
    return { seconds: effect.seconds, condition: 'miss' };
  }
  if (effect.kind === 'combo' && ['PERFECT', 'GREAT', 'GOOD'].includes(effect.judge ?? '')) {
    return { seconds: effect.seconds, condition: 'play' };
  }
  return undefined;
}

/**
 * Be-Music event-layer policy: PLAY/MISS trigger on judgments, interval throttles starts in milliseconds,
 * ALWAYS starts at selection and repeats at a positive interval, and alternatives cycle deterministically.
 * A new selection ends the previous animation; successful judgment clears an active MISS animation.
 */
export class BmsonBGAController {
  private readonly cues: BmsonBGAEventCue[];
  private readonly freezeSeconds: number;
  private inputs: BmsonBGAEventInput[] = [];
  private cueCursor = 0;
  private inputCursor = 0;
  private through = -Infinity;
  private selection: BmsonBGAEventCue | undefined;
  private active: { cue: BmsonBGAEventCue; seconds: number; choice: number } | undefined;
  private lastTrigger = -Infinity;
  private ordinal = 0;

  constructor(cues: readonly BmsonBGAEventCue[], freezeSeconds: number = Infinity) {
    this.freezeSeconds = freezeSeconds;
    this.cues = cues
      .filter((cue) => Number.isFinite(cue.seconds) && cue.seconds <= freezeSeconds)
      .map((cue) => ({
        ...cue,
        sequences: cue.sequences.map((sequence) => ({
          ...sequence,
          frames: sequence.frames.map((frame) => ({ ...frame })),
        })),
      }))
      .sort((left, right) => left.seconds - right.seconds);
  }

  addInput(input: BmsonBGAEventInput): void {
    if (!Number.isFinite(input.seconds) || input.seconds > this.freezeSeconds) return;
    let low = 0,
      high = this.inputs.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.inputs[middle]!.seconds <= input.seconds) low = middle + 1;
      else high = middle;
    }
    this.inputs.splice(low, 0, { ...input });
    if (input.seconds <= this.through) this.rewind();
  }

  /** A seek replaces live history with the exact judgments rebuilt by the selected judge strategy. */
  reset(inputs: readonly BmsonBGAEventInput[] = []): void {
    this.inputs = inputs
      .filter((input) => Number.isFinite(input.seconds) && input.seconds <= this.freezeSeconds)
      .map((input) => ({ ...input }))
      .sort((left, right) => left.seconds - right.seconds);
    this.rewind();
  }

  read(seconds: number): BmsonBGAFrame | undefined {
    if (!Number.isFinite(seconds)) return undefined;
    seconds = Math.min(seconds, this.freezeSeconds);
    if (seconds < this.through) this.rewind();
    while (true) {
      const cue = this.cues[this.cueCursor];
      const input = this.inputs[this.inputCursor];
      if (cue && cue.seconds <= seconds && (!input || cue.seconds <= input.seconds)) {
        this.cueCursor++;
        this.selection = cue;
        this.active = undefined;
        this.lastTrigger = -Infinity;
        this.ordinal = 0;
      } else if (input && input.seconds <= seconds) {
        this.inputCursor++;
        if (input.condition === 'play' && this.active?.cue.condition === 'miss') this.active = undefined;
        const selected = this.selection;
        if (
          selected?.condition === input.condition &&
          input.seconds - this.lastTrigger + 1e-9 >= Math.max(0, selected.interval) / 1000
        ) {
          this.active = { cue: selected, seconds: input.seconds, choice: input.choice ?? this.ordinal++ };
          this.lastTrigger = input.seconds;
        }
      } else break;
    }
    this.through = seconds;
    let active = this.active;
    if (this.selection?.condition === 'always') {
      const cue = this.selection;
      const interval = Math.max(0, cue.interval) / 1000;
      const cycle = interval > 0 ? Math.floor((seconds - cue.seconds + 1e-9) / interval) : 0;
      active = { cue, seconds: cue.seconds + cycle * interval, choice: cycle };
    }
    if (!active || active.cue.sequences.length === 0) return undefined;
    const choice = Number.isFinite(active.choice) ? Math.trunc(active.choice) : 0;
    const count = active.cue.sequences.length;
    const sequence = active.cue.sequences[((choice % count) + count) % count]!;
    const frame = pickBmsonBGASequenceFrame(sequence, Math.max(0, seconds - active.seconds) + 1e-9);
    if (!frame) return undefined;
    return {
      plane: active.cue.condition === 'miss' ? 'poor' : 'layer',
      key: frame.key,
      startedSeconds: active.seconds,
      frameStartSeconds: active.seconds + frame.elapsedSeconds,
    };
  }

  private rewind(): void {
    this.cueCursor = 0;
    this.inputCursor = 0;
    this.through = -Infinity;
    this.selection = undefined;
    this.active = undefined;
    this.lastTrigger = -Infinity;
    this.ordinal = 0;
  }
}

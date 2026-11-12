/**
 * LR2's mania drawing options (the hidden panel of `LR2f.cpp` L1054-L1470): how they move, size and shake what the
 * playfield draws. They change only the drawing; note times, lanes and judgment are untouched. The formulas are LR2's
 * (`DrawNotes`, `LR2f.cpp` L2155-L2331) and run in LR2's 640x480 pixels, scaled to the stage by `unit`.
 */
import type { PlayOptions } from '@be-music/player-scene-model';

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;

/** The mania drawing options that are on. */
export interface LR2ManiaVisual {
  readonly acceleration: PlayOptions['lr2Acceleration'];
}

/** The mania drawing options of `options`, or `undefined` when none is on (the playfield then skips the pass). */
export function resolveLR2ManiaVisual(options: Partial<PlayOptions> | undefined): LR2ManiaVisual | undefined {
  if (options === undefined) return undefined;
  const visual: LR2ManiaVisual = {
    acceleration: options.lr2Acceleration ?? 'OFF',
  };
  const on = visual.acceleration !== 'OFF' || false;
  return on ? visual : undefined;
}

/** One note (or mine) as the playfield is about to draw it. Lengths are stage pixels. */
export interface LR2ManiaNoteInput {
  /** How far above the judge line the note's own time puts it (0 on the line). */
  readonly distance: number;
  /** The same for a long note's end. */
  readonly tailDistance?: number;
  /** The judge line's distance from the top of the stage: LR2 measures a note's place along the lane against it. */
  readonly lineY: number;
  /** LR2's lane number: 0 / 10 the scratches, 1–9 / 11–19 the keys. */
  readonly lane: number;
  /** The note's index among its lane's notes and mines, in time order. */
  readonly index: number;
  /** The play clock, in milliseconds. */
  readonly nowMs: number;
  /** Stage pixels per LR2 pixel (the stage's height over 480). */
  readonly unit: number;
}

/** Where and how large the options draw the note. Lengths are stage pixels. */
export interface LR2ManiaNotePlacement {
  /** The note's distance above the judge line; negative below it. */
  readonly distance: number;
  /** A long note's end, likewise. */
  readonly tailDistance: number | undefined;
  /** The sideways shift from the note's lane. */
  readonly xOffset: number;
  /** Added to the note's width and height, about its centre. */
  readonly widthDelta: number;
  readonly heightDelta: number;
}

/** A sine over one `periodMs` of the play clock, at `phaseMs` into it. */
function wave(phaseMs: number, periodMs: number): number {
  return ((((phaseMs % periodMs) + periodMs) % periodMs) / periodMs) * TAU;
}

/** Places one note under the mania options, in LR2's order of application. */
export function placeLR2ManiaNote(visual: LR2ManiaVisual, input: LR2ManiaNoteInput): LR2ManiaNotePlacement {
  const unit = input.unit > 0 ? input.unit : 1;
  const lineY = input.lineY / unit;
  const now = Math.floor(input.nowMs);
  const { lane, index } = input;
  // LR2 keeps a note's offset from the line as a negative `note_y`; `pos` is its place along the lane, 0 on the line
  // and 1 at the top of the screen.
  let y = -input.distance / unit;
  let tailY = input.tailDistance === undefined ? y : -input.tailDistance / unit;
  const pos = lineY !== 0 ? -y / lineY : 0;
  const tailPos = lineY !== 0 ? -tailY / lineY : 0;
  let x = 0;
  let widthDelta = 0;
  let heightDelta = 0;
  const eased =
    visual.acceleration === 'RANDOM'
      ? (index + lane) % 2 === 0
        ? 'ACCELERATION'
        : 'DECELERATION'
      : visual.acceleration;
  if (eased === 'ACCELERATION') {
    y = Math.sin(pos * HALF_PI) * -lineY;
    tailY = Math.sin(tailPos * HALF_PI) * -lineY;
  } else if (eased === 'DECELERATION') {
    y = (1 - Math.cos(pos * HALF_PI)) * -lineY;
    tailY = (1 - Math.cos(tailPos * HALF_PI)) * -lineY;
  }
  // A note past the line stays on it before the effects below move it.
  y = Math.min(0, y);
  tailY = Math.min(0, tailY);
  return {
    distance: -y * unit,
    tailDistance: input.tailDistance === undefined ? undefined : -tailY * unit,
    xOffset: x * unit,
    widthDelta: widthDelta * unit,
    heightDelta: heightDelta * unit,
  };
}

/**
 * Each note's and mine's index within its lane, in time order: LR2 keeps one array per lane, mines included, and its
 * effects alternate by that index. Kept per notes array, so a chart is walked once.
 */
export function resolveLR2ManiaNoteIndexes(
  notes: readonly { readonly channel: string; readonly seconds: number }[],
  mines: readonly { readonly channel: string; readonly seconds: number }[],
): WeakMap<object, number> {
  const cached = indexCache.get(notes);
  if (cached !== undefined && cached.mines === mines) return cached.indexes;
  const indexes = new WeakMap<object, number>();
  const counts = new Map<string, number>();
  const all = [...notes, ...mines].sort((left, right) => left.seconds - right.seconds);
  for (const object of all) {
    const count = counts.get(object.channel) ?? 0;
    indexes.set(object, count);
    counts.set(object.channel, count + 1);
  }
  indexCache.set(notes, { mines, indexes });
  return indexes;
}

const indexCache = new WeakMap<object, { mines: unknown; indexes: WeakMap<object, number> }>();

import type {
  ChartNotesOption,
  ChartOptionDiagnostic,
  ChartPlayOptionProgram,
  ChartPlayVariant,
  ResolvedChart,
} from '@be-music/chart-model';
import type { TimedLandmineNote, TimedPlayableNote } from '../playable-notes.ts';
import { duplicateBattleChart } from './battle-chart.ts';
import { resolveLaneOptionChannels, type ChannelLike } from './lane-layout.ts';

/**
 * Chart-authored `774:NOTES_*` (#932; docs/adr/0035-chart-authored-notes-options.md). nanasigroove's catalog gives the
 * shape, not an algorithm, so the readings are Be-Music's own:
 *
 * - `DOUBLE`: every key note (scratch, wheel and FREE ZONE excluded) gains a partner on its mirror lane of the same side,
 *   key `i` of `n` on key `n + 1 - i`, unless something already occupies the mirror lane over the note's span. The
 *   middle key of an odd side has no mirror lane and stays single.
 * - `COPY`: a 5 / 7 KEY chart is copied onto the 2P side, its keys mirrored and its scratch on the 2P scratch, which
 *   makes it a 10 / 14 KEY (double-play) chart (the catalog's DBM: `[11..15, 16]` → 2P `[15..11, 16]`). Elsewhere, and
 *   in a course, whose stages keep one key mode, it does nothing.
 * - `DBLCOPY`: DOUBLE, then COPY.
 */

/** Where a chart's options run: the variant its notes were authored for, and whether the play is a course stage. */
export interface ChartPlayOptionContext {
  /** The chart's own play variant, before any conversion. */
  playVariant: ChartPlayVariant;
  /** A course stage (GRADE, EXPERT or NONSTOP): its key mode must stay the course's. */
  course: boolean;
}

/** The single-play variants COPY makes double-play, and what they become. */
const COPIED_VARIANTS = { '5': '10', '7': '14' } as const;

/** The variants DOUBLE has key lanes for (the generic bmson modes have none). */
const DOUBLED_VARIANTS: ReadonlySet<string> = new Set(['5', '7', '9', '10', '14', '24', '48']);

/** Whether `option` copies the chart onto the 2P side. */
export function chartNotesCopies(option: ChartNotesOption | undefined): boolean {
  return option === 'COPY' || option === 'DBLCOPY';
}

/** Whether `option` doubles the key notes. */
export function chartNotesDoubles(option: ChartNotesOption | undefined): boolean {
  return option === 'DOUBLE' || option === 'DBLCOPY';
}

/**
 * The part of a declared NOTES conversion that takes effect: COPY only on a 5 / 7 KEY chart outside a course, DOUBLE on
 * every variant with key lanes. DBLCOPY keeps its DOUBLE where its COPY cannot run.
 */
export function resolveChartNotesOption(
  option: ChartNotesOption | undefined,
  context: ChartPlayOptionContext,
): ChartNotesOption | undefined {
  if (option === undefined) return undefined;
  const copies = chartNotesCopies(option) && !context.course && context.playVariant in COPIED_VARIANTS;
  const doubles = chartNotesDoubles(option) && DOUBLED_VARIANTS.has(context.playVariant);
  return copies ? (doubles ? 'DBLCOPY' : 'COPY') : doubles ? 'DOUBLE' : undefined;
}

/** The play variant a chart plays as under its effective NOTES conversion. */
export function resolveChartNotesPlayVariant(
  playVariant: ChartPlayVariant,
  option: ChartNotesOption | undefined,
): ChartPlayVariant {
  return chartNotesCopies(option) && playVariant in COPIED_VARIANTS
    ? COPIED_VARIANTS[playVariant as keyof typeof COPIED_VARIANTS]
    : playVariant;
}

/**
 * The chart's gameplay program as it runs in `context`, the form a play records (a replay keeps only what took effect):
 * the NOTES conversion narrowed by {@link resolveChartNotesOption}. A declared conversion that lost its effect is
 * diagnosed `unsupported-option` with its declaration.
 */
export function resolveEffectiveChartPlayOptions(
  program: ChartPlayOptionProgram,
  context: ChartPlayOptionContext,
): { program: ChartPlayOptionProgram; diagnostics: ChartOptionDiagnostic[] } {
  const declared = program.options.notes;
  if (declared === undefined) return { program, diagnostics: [] };
  const effective = resolveChartNotesOption(declared, context);
  const { notes: _declared, ...options } = program.options;
  return {
    program: {
      version: program.version,
      options: effective === undefined ? options : { ...options, notes: effective },
    },
    diagnostics: effective === declared ? [] : [{ code: 'unsupported-option', declaration: `774:NOTES_${declared}` }],
  };
}

/** A copied event's channel: the source event's kind (visible / long note) on `lane` (`1x` / `2x`). */
function channelOnLane(sourceChannel: string, lane: string): string {
  const longNote = sourceChannel[0] === '5' || sourceChannel[0] === '6';
  if (!longNote) return lane;
  return `${lane[0] === '1' ? '5' : '6'}${lane.slice(1)}`;
}

/** Whole microseconds, the unit replays and lane options group objects by. */
function toMicroseconds(seconds: number): number {
  return Math.round(seconds * 1_000_000);
}

/**
 * DOUBLE in place: adds each key note's mirror-lane partner where the mirror lane is free over the note's span (no note,
 * long note or mine from its head to its tail, ends included). The partners are new notes with their own event identity
 * on the mirror lane (so a replay tells them apart), the same keysound and timing, and no long-note modifier mark (the
 * modifier's placements stay the originals'). Returns the number of notes added.
 */
export function doubleChartNotes(
  notes: TimedPlayableNote[],
  mines: readonly TimedLandmineNote[],
  playVariant: ChartPlayVariant,
  channels: ReadonlyArray<ChannelLike> = notes,
): number {
  if (!DOUBLED_VARIANTS.has(playVariant)) return 0;
  const mirror = new Map<string, string>();
  for (const side of ['1P', '2P'] as const) {
    const keys = resolveLaneOptionChannels(side, playVariant, channels);
    keys.forEach((key, index) => {
      const partner = keys[keys.length - 1 - index]!;
      if (partner !== key) mirror.set(key, partner);
    });
  }
  if (mirror.size === 0) return 0;
  // Occupied spans per lane in µs, inclusive; a tap is a point.
  const spans = new Map<string, Array<[number, number]>>();
  const occupy = (channel: string, start: number, end: number): void => {
    const list = spans.get(channel);
    if (list) list.push([start, end]);
    else spans.set(channel, [[start, end]]);
  };
  const spanOf = (note: TimedPlayableNote): [number, number] => {
    const start = toMicroseconds(note.seconds);
    return [start, note.endSeconds === undefined ? start : Math.max(start, toMicroseconds(note.endSeconds))];
  };
  for (const note of notes) occupy(note.channel, ...spanOf(note));
  for (const mine of mines) occupy(mine.channel, toMicroseconds(mine.seconds), toMicroseconds(mine.seconds));
  const originals = notes
    .filter((note) => mirror.has(note.channel))
    .sort((a, b) => a.seconds - b.seconds || a.channel.localeCompare(b.channel));
  let added = 0;
  for (const original of originals) {
    const partner = mirror.get(original.channel)!;
    const [start, end] = spanOf(original);
    if ((spans.get(partner) ?? []).some(([from, to]) => from <= end && start <= to)) continue;
    const { generatedLongNote: _generated, ...fields } = original;
    notes.push({
      ...fields,
      channel: partner,
      judged: false,
      event: {
        ...original.event,
        position: [...original.event.position] as [number, number],
        channel: channelOnLane(original.event.channel, partner),
      },
    });
    occupy(partner, start, end);
    added++;
  }
  if (added > 0) notes.sort((a, b) => a.seconds - b.seconds || a.channel.localeCompare(b.channel));
  return added;
}

/**
 * COPY: the 5 / 7 KEY chart copied onto the 2P side (`duplicateBattleChart`, mines included), then the 2P keys mirrored,
 * so the 2P side is the 1P side's mirror image with the scratch on the 2P scratch. The chart becomes 10 / 14 KEY.
 */
export function copyChartNotes(
  source: ResolvedChart,
  notes: TimedPlayableNote[],
  mines: TimedLandmineNote[],
  invisible: TimedPlayableNote[],
): { chart: ResolvedChart; changedObjectCount: number } {
  if (!(source.playVariant in COPIED_VARIANTS)) throw new RangeError('NOTES COPY requires a 5KEY or 7KEY chart.');
  const copied = duplicateBattleChart(source, notes, mines, invisible, { duplicateMines: true });
  const keys = resolveLaneOptionChannels('2P', copied.chart.playVariant);
  const mirror = new Map(keys.map((key, index) => [key, keys[keys.length - 1 - index]!]));
  for (const objects of [notes, mines, invisible] as Array<Array<{ channel: string; seconds: number }>>) {
    for (const object of objects) object.channel = mirror.get(object.channel) ?? object.channel;
    objects.sort((a, b) => a.seconds - b.seconds || a.channel.localeCompare(b.channel));
  }
  return copied;
}

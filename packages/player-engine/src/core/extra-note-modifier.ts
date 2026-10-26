import {
  PLAY_MODE_LAYOUTS,
  type ResolvedChart,
  type ResolvedNote,
  type TimedSampleTrigger,
} from '@be-music/chart-model';
import type { TimedLandmineNote, TimedPlayableNote } from '../playable-notes.ts';
import { resolveModifierLanes } from './chart-modifier-timelines.ts';
import { withChartOverrides } from './resolved-chart-overrides.ts';

/** beatoraja 0.8.9 PlayerConfig: default 0 (disabled), integer range 0..100. */
export function clampExtraNoteDepth(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.trunc(value))) : 0;
}

/**
 * ExtraNoteModifier at 83574048, after LN/mine modification and before lane shuffling.
 * The source computes blank cells once per row: later depth iterations can overwrite a
 * converted note while removing its background sound. Preserve that behavior, including
 * the keyCount-1 WAV search and retaining the search offset rather than the chosen lane.
 * Source noteType is unused; every conversion remains a normal note.
 */
export function addExtraNotes(
  source: ResolvedChart,
  notes: TimedPlayableNote[],
  mines: readonly TimedLandmineNote[],
  options: { depth?: number; scratch?: boolean; laneModeExtension?: string } = {},
): { chart: ResolvedChart; changes: number } {
  const depth = clampExtraNoteDepth(options.depth ?? 0);
  if (depth === 0) return { chart: source, changes: 0 };
  const lanes = resolveModifierLanes(source, options.laneModeExtension);
  const scratch = new Set(
    (source.playVariant === '9' ? [] : PLAY_MODE_LAYOUTS[source.playVariant].lanes)
      .filter((lane) => lane.kind !== 'key')
      .map((lane) => lane.channel),
  );
  const rows = new Map<number, TimedSampleTrigger[]>();
  for (const trigger of source.sampleTriggers) {
    if (trigger.channel !== '01') continue;
    const row = rows.get(trigger.beat) ?? [];
    row.push(trigger);
    rows.set(trigger.beat, row);
  }
  const removed = new Set<TimedSampleTrigger>();
  const effective = new Map<string, { trigger: TimedSampleTrigger; note: ResolvedNote }>();
  const lastNote: Array<string | undefined> = lanes.map(() => undefined);
  const orderedNotes = [...notes].sort((a, b) => a.beat - b.beat);
  const occupied = new Map<number, Set<string>>();
  for (const note of [...notes, ...mines]) {
    const row = occupied.get(note.beat) ?? new Set<string>();
    row.add(note.channel);
    occupied.set(note.beat, row);
  }
  const heldUntil = new Map<string, number>();
  let noteIndex = 0;
  let lastOffset = 0;
  for (const [beat, background] of [...rows].sort((a, b) => a[0] - b[0])) {
    while (noteIndex < orderedNotes.length && orderedNotes[noteIndex]!.beat <= beat) {
      const note = orderedNotes[noteIndex++]!;
      if (note.endBeat !== undefined) heldUntil.set(note.channel, note.endBeat);
    }
    const blank = lanes.map(
      (lane) =>
        (options.scratch === true || !scratch.has(lane)) &&
        !occupied.get(beat)?.has(lane) &&
        (heldUntil.get(lane) ?? -Infinity) < beat,
    );
    let backgroundIndex = 0;
    for (let d = 0; d < depth && backgroundIndex < background.length; d++) {
      const trigger = background[backgroundIndex]!;
      let offset = lastOffset;
      for (let j = 1; j < lanes.length; j++, offset = (offset + 1) % lanes.length)
        if (lastNote[offset] === trigger.sampleKey) break;
      lastOffset = offset;
      for (let j = 0; j < lanes.length; j++) {
        const key = (offset + j) % lanes.length;
        if (!blank[key]) continue;
        const channel = lanes[key]!;
        lastNote[key] = trigger.sampleKey;
        removed.add(trigger);
        backgroundIndex++;
        effective.set(`${beat}:${channel}`, {
          trigger,
          note: {
            kind: 'tap',
            channel,
            beat,
            seconds: trigger.seconds,
            sampleKey: trigger.sampleKey,
            event: { ...trigger.event, channel },
          },
        });
        break;
      }
    }
  }
  if (removed.size === 0) return { chart: source, changes: 0 };
  const added = [...effective.values()];
  for (const { note } of added) notes.push({ ...note, judged: false });
  notes.sort((a, b) => a.seconds - b.seconds || a.channel.localeCompare(b.channel));
  const converted = new Map(
    added.map(({ trigger, note }) => [trigger, { ...trigger, event: note.event, channel: note.channel }]),
  );
  const sampleTriggers = source.sampleTriggers.flatMap((trigger) => {
    const replacement = converted.get(trigger);
    return replacement ? [replacement] : removed.has(trigger) ? [] : [trigger];
  });
  const resolvedNotes = [...source.notes, ...added.map(({ note }) => note)].sort(
    (a, b) => a.beat - b.beat || a.channel.localeCompare(b.channel),
  );
  return {
    chart: withChartOverrides(source, {
      notes: resolvedNotes,
      sampleTriggers,
      lastNoteSeconds: added.reduce((last, { note }) => Math.max(last, note.seconds), source.lastNoteSeconds),
    }),
    changes: removed.size,
  };
}

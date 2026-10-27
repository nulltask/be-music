import type { ResolvedChart, TimedSampleTrigger } from '@be-music/chart-model';
import type { BeMusicEvent } from '@be-music/chart-source';
import type { TimedLandmineNote, TimedPlayableNote } from '../playable-notes.ts';

/**
 * Source `PatternModifier.moveToBackground`: remove the judged objects `removes` picks and sound each removed note's
 * head as BGM at its own time. A mine is dropped without a sound unless `mineSample` (LR2 zeroes a moved mine's value,
 * so it plays WAV00). Invisible objects are not timeline notes in either source and stay where they are. An LN tail
 * carries no keysound in the resolved model, so only the head is moved. Returns the chart's new sample triggers.
 */
export function moveNotesToBackground(
  source: ResolvedChart,
  notes: TimedPlayableNote[],
  mines: TimedLandmineNote[],
  removes: (object: TimedPlayableNote | TimedLandmineNote) => boolean,
  options: { originOf?: ReadonlyMap<BeMusicEvent, BeMusicEvent>; mineSample?: boolean } = {},
): TimedSampleTrigger[] {
  const triggerByEvent = new Map(source.sampleTriggers.map((trigger) => [trigger.event, trigger]));
  const added: TimedSampleTrigger[] = [];
  for (let index = notes.length - 1; index >= 0; index--) {
    const note = notes[index]!;
    if (!removes(note)) continue;
    notes.splice(index, 1);
    // A copied note's event is a clone; its keysound trigger belongs to the original.
    const original = triggerByEvent.get(options.originOf?.get(note.event) ?? note.event);
    if (original === undefined) continue;
    added.push({
      ...original,
      event: { ...note.event, channel: '01' },
      channel: '01',
      beat: note.beat,
      seconds: note.seconds,
    });
  }
  for (let index = mines.length - 1; index >= 0; index--) {
    const mine = mines[index]!;
    if (!removes(mine)) continue;
    mines.splice(index, 1);
    if (options.mineSample && !mine.silent)
      added.push({
        event: { ...mine.event, channel: '01', value: '00' },
        channel: '01',
        sampleKey: '00',
        samplePath: source.source.resources.wav['00'],
        sampleOffsetSeconds: 0,
        beat: mine.beat,
        seconds: mine.seconds,
      });
  }
  return [...source.sampleTriggers, ...added].sort((a, b) => a.seconds - b.seconds);
}

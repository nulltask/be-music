import {
  getPlayModeLayouts,
  type ResolvedChart,
  type ResolvedNote,
  type TimedSampleTrigger,
} from '@be-music/chart-model';
import type { BeMusicEvent } from '@be-music/chart-source';
import { collectLR2ChartObjects, formatLR2Lane, type LR2ChartObject } from './lr2-chart-objects.ts';
import { resolveLR2SoundFamilies } from './lr2-sound-families.ts';
import { splitLR2SPToDP } from './lr2-sp-to-dp.ts';
import { withChartOverrides } from './resolved-chart-overrides.ts';

/** Source SP-TO-DP: no copied notes; hold endpoints stay attached to their moved heads. */
export function convertLR2SPToDPChart(
  source: ResolvedChart,
  options: { tempo?: number; assist1P?: boolean; assist2P?: boolean } = {},
): { chart: ResolvedChart; changedObjectCount: number; droppedObjectCount: number } {
  if (source.sourceFormat !== 'bms' || source.idBase !== 36)
    throw new RangeError('LR2 SP TO DP requires a base-36 BMS source.');
  if (source.playVariant !== '5' && source.playVariant !== '7')
    throw new RangeError('SP TO DP requires a 5KEY or 7KEY source chart.');
  const tempo = options.tempo ?? 1;
  if (!Number.isFinite(tempo) || tempo <= 0) throw new RangeError('SP TO DP requires a positive finite tempo.');
  const objects = collectLR2ChartObjects(source, { tempo, nativeLeadIn: true });
  objects.sort((a, b) => (a.timeMs === b.timeMs ? a.op - b.op : Math.trunc(a.timeMs - b.timeMs)));
  const ops = splitLR2SPToDP(objects, {
    soundFamilies: resolveLR2SoundFamilies(source.source, source.randomDraws),
    playLevel: Number.parseInt(String(source.source.metadata.playLevel ?? '0'), 10) || 0,
    assist1P: options.assist1P,
    assist2P: options.assist2P,
  });
  const accepted = new Set<number>();
  const lastByLane = new Map<string, { index: number; object: LR2ChartObject }>();
  let changedObjectCount = 0;
  let droppedObjectCount = 0;
  for (const [index, object] of objects.entries()) {
    const op = ops[index]!;
    if (!object.note || op < 10 || op >= 30) continue;
    if (op !== object.op) changedObjectCount++;
    const channel = formatLR2Lane(op - 10, false);
    const previous = lastByLane.get(channel);
    if (previous !== undefined) {
      // ParseBmsFile's final intArr pass suppresses heads on/inside a prior hold.
      // A normal head's native realTiming_ln is zero; an LN at the same instant
      // can replace that normal head, while two ordinary heads retain the first.
      if (object.timeMs <= (previous.object.holdEndMs ?? 0)) {
        droppedObjectCount++;
        continue;
      }
      if (object.timeMs === previous.object.timeMs) {
        if ((object.holdEndMs ?? 0) <= object.timeMs) {
          droppedObjectCount++;
          continue;
        }
        accepted.delete(previous.index);
        droppedObjectCount++;
      }
    }
    accepted.add(index);
    lastByLane.set(channel, { index, object });
  }
  const notes: ResolvedNote[] = [],
    mines: ResolvedNote[] = [];
  const replacements = new Map<BeMusicEvent, TimedSampleTrigger>();
  const droppedEvents = new Set<BeMusicEvent>();
  for (const [index, object] of objects.entries()) {
    if (!object.note || !object.event || object.op < 10 || object.op >= 30) continue;
    if (!accepted.has(index)) {
      droppedEvents.add(object.event);
      continue;
    }
    const channel = formatLR2Lane(ops[index]! - 10, false);
    const event = {
      ...object.event,
      channel: object.note.kind === 'mine' ? `${channel[0] === '1' ? 'D' : 'E'}${channel[1]}` : channel,
    };
    const note = { ...object.note, channel, event };
    (note.kind === 'mine' ? mines : notes).push(note);
    if (object.trigger) replacements.set(object.event, { ...object.trigger, channel, event });
  }
  const compare = (a: ResolvedNote, b: ResolvedNote): number =>
    a.seconds - b.seconds || a.channel.localeCompare(b.channel);
  const playVariant = source.playVariant === '5' ? '10' : '14';
  return {
    chart: withChartOverrides(source, {
      playVariant,
      layouts: getPlayModeLayouts(playVariant),
      notes: notes.sort(compare),
      mines: mines.sort(compare),
      shadowedNotes: [],
      sampleTriggers: source.sampleTriggers.flatMap((trigger) =>
        droppedEvents.has(trigger.event) ? [] : [replacements.get(trigger.event) ?? trigger],
      ),
      lastNoteSeconds: notes.reduce((last, note) => Math.max(last, note.endSeconds ?? note.seconds), 0),
    }),
    changedObjectCount,
    droppedObjectCount,
  };
}

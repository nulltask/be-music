import {
  getPlayModeLayouts,
  type ResolvedChart,
  type ResolvedNote,
  type TimedSampleTrigger,
} from '@be-music/chart-model';
import type { BeMusicEvent } from '@be-music/chart-source';
import { collectLR2ChartObjects, formatLR2Lane, type LR2ChartObject } from './lr2-chart-objects.ts';
import { resolveLR2SoundFamilies } from './lr2-sound-families.ts';
import { mergeLR2DPToSP, mergeLR2PMSToSP } from './lr2-dp-to-sp.ts';
import { splitLR2SPToDP } from './lr2-sp-to-dp.ts';
import { withChartOverrides } from './resolved-chart-overrides.ts';

const OUTPUT_VARIANTS = { '5': '10', '7': '14', '10': '5', '14': '7', '9': '7' } as const;

/**
 * Source SP TO DP (`battle` 3): a 5/7KEY chart is split onto both sides (SPtoDP), a 10/14KEY chart merged onto the 1P
 * side (DPtoSP, shown as DP-TO-SP) and a 9KEY chart folded onto seven keys (PMStoSP, 9-TO-7). No copied notes; hold
 * endpoints stay attached to their moved heads; a note with no lane left becomes background sound.
 */
export function convertLR2SPToDPChart(
  source: ResolvedChart,
  options: { tempo?: number; assist1P?: boolean; assist2P?: boolean } = {},
): { chart: ResolvedChart; changedObjectCount: number; droppedObjectCount: number } {
  if (source.sourceFormat !== 'bms' || source.idBase !== 36)
    throw new RangeError('LR2 SP TO DP requires a base-36 BMS source.');
  const sourceVariant = source.playVariant;
  if (sourceVariant.startsWith('generic-') || sourceVariant === '24' || sourceVariant === '48')
    throw new RangeError('SP TO DP requires a 5, 7, 9, 10 or 14KEY source chart.');
  const tempo = options.tempo ?? 1;
  if (!Number.isFinite(tempo) || tempo <= 0) throw new RangeError('SP TO DP requires a positive finite tempo.');
  const objects = collectLR2ChartObjects(source, { tempo, nativeLeadIn: true });
  objects.sort((a, b) => (a.timeMs === b.timeMs ? a.op - b.op : Math.trunc(a.timeMs - b.timeMs)));
  const initialBPM = source.source.metadata.bpm * tempo;
  const ops =
    sourceVariant === '5' || sourceVariant === '7'
      ? splitLR2SPToDP(objects, {
          soundFamilies: resolveLR2SoundFamilies(source.source, source.randomDraws),
          playLevel: Number.parseInt(String(source.source.metadata.playLevel ?? '0'), 10) || 0,
          assist1P: options.assist1P,
          assist2P: options.assist2P,
        })
      : sourceVariant === '9'
        ? mergeLR2PMSToSP(
            objects.map((object) => ({ ...object, mine: object.note?.kind === 'mine' })),
            { initialBPM },
          )
        : mergeLR2DPToSP(objects, { initialBPM, keymode: sourceVariant === '10' ? 10 : 14 });
  const accepted = new Set<number>();
  const lastByLane = new Map<string, { index: number; object: LR2ChartObject }>();
  let changedObjectCount = 0;
  let droppedObjectCount = 0;
  for (const [index, object] of objects.entries()) {
    const op = ops[index]!;
    if (object.note && op !== object.op && (op === 1 || op === -1)) changedObjectCount++;
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
  const appended: TimedSampleTrigger[] = [];
  const droppedEvents = new Set<BeMusicEvent>();
  for (const [index, object] of objects.entries()) {
    if (!object.note || !object.event || object.op < 10 || object.op >= 30) continue;
    const op = ops[index]!;
    if (op === 1 || op === -1) {
      // A merged note with no free lane plays as BGM (a mine's value is zeroed: WAV00); a PMS mine is dropped.
      if (op === -1) droppedEvents.add(object.event);
      else if (object.note.kind === 'mine') {
        const event = { ...object.event, channel: '01', value: '00' };
        replacements.set(object.event, {
          event,
          channel: '01',
          sampleKey: '00',
          samplePath: source.source.resources.wav['00'],
          sampleOffsetSeconds: 0,
          beat: object.note.beat,
          seconds: object.note.seconds,
        });
        // A mine has no trigger of its own; the WAV00 sound is a new one.
        appended.push(replacements.get(object.event)!);
      } else if (object.trigger) {
        const event = { ...object.event, channel: '01' };
        replacements.set(object.event, { ...object.trigger, channel: '01', event });
      }
      continue;
    }
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
  const playVariant = OUTPUT_VARIANTS[sourceVariant as keyof typeof OUTPUT_VARIANTS];
  return {
    chart: withChartOverrides(source, {
      playVariant,
      layouts: getPlayModeLayouts(playVariant),
      notes: notes.sort(compare),
      mines: mines.sort(compare),
      shadowedNotes: [],
      sampleTriggers: [
        ...source.sampleTriggers.flatMap((trigger) =>
          droppedEvents.has(trigger.event) ? [] : [replacements.get(trigger.event) ?? trigger],
        ),
        ...appended,
      ].sort((a, b) => a.seconds - b.seconds),
      lastNoteSeconds: notes.reduce((last, note) => Math.max(last, note.endSeconds ?? note.seconds), 0),
    }),
    changedObjectCount,
    droppedObjectCount,
  };
}

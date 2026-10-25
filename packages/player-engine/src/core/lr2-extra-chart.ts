import type { ResolvedChart, ResolvedNote, TimedSampleTrigger } from '@be-music/chart-model';
import { normalizeChannel, type BeMusicEvent } from '@be-music/chart-source';
import { applyLR2Extra, type LR2ExtraObject } from './lr2-extra.ts';
import type { LR2ExtraLevel } from './lr2-extra-lanes.ts';
import { resolveLR2ExtraSoundFamilies } from './lr2-extra-sounds.ts';
import { withChartOverrides } from './resolved-chart-overrides.ts';

interface ChartObject extends LR2ExtraObject {
  event?: BeMusicEvent;
  note?: ResolvedNote;
  trigger?: TimedSampleTrigger;
  shadowed?: boolean;
}

/** LR2's post-LN-decoder EXTRA input: heads and mines are ordinary ops; only LN tails retain op 50+. */
export function convertLR2ExtraChart(
  source: ResolvedChart,
  options: { level: LR2ExtraLevel; tempo?: number },
): { chart: ResolvedChart; level: LR2ExtraLevel; changes: number } {
  if (source.sourceFormat !== 'bms' || source.idBase !== 36)
    throw new RangeError('LR2 EXTRA requires a base-36 BMS source.');
  const mode = source.playVariant;
  if (mode === '24' || mode === '48') throw new RangeError('LR2 EXTRA does not support keyboard modes.');
  const tempo = options.tempo ?? 1;
  if (!Number.isFinite(tempo) || tempo <= 0) throw new RangeError('LR2 EXTRA requires a positive finite tempo.');
  const pms = mode === '9';
  const objects: ChartObject[] = [];
  const timed = (beat: number): Pick<ChartObject, 'timeMs' | 'position'> => ({
    timeMs: (source.timing.beatToSeconds(beat) * 1000) / tempo,
    // Only the ordering and sign of converted bmsTiming are tested by EXTRA.
    // LR2's ordinary and CONSTANT maps are both nondecreasing over this beat map.
    position: beat,
  });
  const triggers = new Map(source.sampleTriggers.map((trigger) => [trigger.event, trigger]));
  for (const [notes, shadowed] of [
    [source.notes, false],
    [source.shadowedNotes, true],
  ] as const) {
    for (const note of notes) {
      const lane = rawLane(note.event.channel, pms);
      if (lane === undefined) continue;
      objects.push({
        ...timed(note.beat),
        op: 10 + lane,
        value: Number.parseInt(note.sampleKey, 36),
        event: note.event,
        note,
        shadowed,
        trigger: triggers.get(note.event),
      });
      if (note.endBeat !== undefined) objects.push({ ...timed(note.endBeat), op: 50 + lane, value: 0 });
    }
  }
  for (const note of source.mines) {
    const lane = rawLane(note.event.channel, pms);
    if (lane !== undefined) objects.push({ ...timed(note.beat), op: 10 + lane, value: 0, event: note.event, note });
  }
  for (const note of source.invisibleNotes) {
    const lane = rawLane(note.event.channel, pms);
    if (lane !== undefined)
      objects.push({
        ...timed(note.beat),
        op: 30 + lane,
        value: Number.parseInt(note.sampleKey, 36),
        event: note.event,
        note,
        trigger: triggers.get(note.event),
      });
  }
  for (const trigger of source.sampleTriggers) {
    if (trigger.channel === '01')
      objects.push({
        ...timed(trigger.beat),
        op: 1,
        value: Number.parseInt(trigger.sampleKey, 36),
        event: trigger.event,
        trigger,
      });
  }
  let lastMeasure = 0;
  for (const event of source.sortedEvents) {
    lastMeasure = Math.max(lastMeasure, event.measure);
    const channel = normalizeChannel(event.channel);
    const op = Number.parseInt(channel, 10);
    if (!['03', '04', '06', '07', '08', '09'].includes(channel)) continue;
    const value =
      channel === '03'
        ? Number.parseInt(event.value, 16) * tempo
        : channel === '08'
          ? (source.source.resources.bpm[event.value] ?? 0) * tempo
          : Number.parseInt(event.value, 36);
    objects.push({ ...timed(source.beatResolver.eventToBeat(event)), op, value, event });
  }
  // ParseBmsFile adds 1000 measure markers. Only markers through the last authored
  // measure and its successor can be visited before EXTRA's last-tap cutoff.
  for (let measure = 0; measure <= Math.min(999, lastMeasure + 1); measure++)
    objects.push({ ...timed(source.beatResolver.measureToBeat(measure)), op: 2, value: 1 });
  // The sound-only fallback BGA is also a real object in LR2's input array.
  if (!source.sortedEvents.some((event) => ['04', '07'].includes(normalizeChannel(event.channel))))
    objects.push({ ...timed(0), op: 4, value: 1295 });
  const result = applyLR2Extra(objects, {
    keyMode: Number(mode) as 5 | 7 | 9 | 10 | 14,
    level: options.level,
    initialBPM: source.source.metadata.bpm * tempo,
    soundFamilies: resolveLR2ExtraSoundFamilies(source.source, source.randomDraws),
  });
  const notes: ResolvedNote[] = [],
    shadowedNotes: ResolvedNote[] = [],
    mines: ResolvedNote[] = [],
    invisibleNotes: ResolvedNote[] = [];
  const changedTriggers = new Map<BeMusicEvent, TimedSampleTrigger>();
  for (const [index, object] of objects.entries()) {
    if (!object.event || (!object.note && !object.trigger)) continue;
    const op = result.ops[index]!;
    const lane = op >= 10 && op < 30 ? op - 10 : op >= 30 && op < 50 ? op - 30 : undefined;
    const channel = lane === undefined ? '01' : canonicalLane(lane, pms);
    const event = {
      ...object.event,
      channel:
        lane !== undefined && object.note?.kind === 'mine'
          ? `${channel[0] === '1' ? 'D' : 'E'}${channel[1]}`
          : op >= 30 && op < 50
            ? `${channel[0] === '1' ? '3' : '4'}${channel[1]}`
            : channel,
    };
    if (object.trigger) changedTriggers.set(object.event, { ...object.trigger, event, channel: event.channel });
    if (lane === undefined) {
      // A DP scratch mine becomes the source's WAV00 BGM, retaining the mine's own time.
      if (object.note?.kind === 'mine') {
        event.value = '00';
        changedTriggers.set(object.event, {
          event,
          channel: '01',
          sampleKey: '00',
          samplePath: source.source.resources.wav['00'],
          sampleOffsetSeconds: 0,
          beat: object.note.beat,
          seconds: object.note.seconds,
        });
      }
      continue;
    }
    const note: ResolvedNote = {
      kind: object.note?.kind === 'mine' ? 'mine' : op >= 30 ? 'invisible' : 'tap',
      channel,
      event,
      beat: object.note?.beat ?? object.trigger!.beat,
      seconds: object.note?.seconds ?? object.trigger!.seconds,
      sampleKey: object.note?.sampleKey ?? object.trigger!.sampleKey,
      ...(object.note?.damage !== undefined ? { damage: object.note.damage } : {}),
    };
    (note.kind === 'mine'
      ? mines
      : note.kind === 'invisible'
        ? invisibleNotes
        : object.shadowed
          ? shadowedNotes
          : notes
    ).push(note);
  }
  const compare = (a: ResolvedNote, b: ResolvedNote): number => a.beat - b.beat || a.channel.localeCompare(b.channel);
  const sampleTriggers = source.sampleTriggers.map((trigger) => changedTriggers.get(trigger.event) ?? trigger);
  for (const [event, trigger] of changedTriggers) if (!triggers.has(event)) sampleTriggers.push(trigger);
  sampleTriggers.sort((a, b) => a.seconds - b.seconds);
  return {
    chart: withChartOverrides(source, {
      notes: notes.sort(compare),
      shadowedNotes: shadowedNotes.sort(compare),
      mines: mines.sort(compare),
      invisibleNotes: invisibleNotes.sort(compare),
      sampleTriggers,
      lastNoteSeconds: notes.reduce((last, note) => Math.max(last, note.seconds), 0),
    }),
    level: result.level,
    changes: result.changes,
  };
}

function rawLane(channel: string, pms: boolean): number | undefined {
  channel = normalizeChannel(channel);
  const bank = '135D'.includes(channel[0]!) ? 0 : 1;
  const digit = Number.parseInt(channel[1]!, 10);
  if (pms) {
    if (bank === 0) return [undefined, 1, 2, 3, 4, 5, 8, 9, 6, 7][digit];
    if (digit >= 2 && digit <= 5) return digit + 4;
  }
  const slot = digit >= 1 && digit <= 5 ? digit : digit === 6 ? 0 : digit === 8 ? 6 : digit === 9 ? 7 : undefined;
  return slot === undefined ? undefined : bank * 10 + slot;
}

function canonicalLane(lane: number, pms: boolean): string {
  const side = lane < 10 ? '1' : '2';
  const slot = lane % 10;
  return `${side}${pms ? slot : slot === 0 ? 6 : slot >= 6 ? slot + 2 : slot}`;
}

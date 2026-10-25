import type { ResolvedChart, ResolvedNote, TimedSampleTrigger } from '@be-music/chart-model';
import { normalizeChannel, type BeMusicEvent } from '@be-music/chart-source';

export interface LR2ChartObject {
  op: number;
  value: number;
  timeMs: number;
  position: number;
  event?: BeMusicEvent;
  note?: ResolvedNote;
  trigger?: TimedSampleTrigger;
  shadowed?: boolean;
  holdEndMs?: number;
}

/** The native decoded object stream shared by LR2 chart conversions. */
export function collectLR2ChartObjects(
  source: ResolvedChart,
  options: { tempo: number; nativeLeadIn?: boolean },
): LR2ChartObject[] {
  const tempo = options.tempo;
  const pms = source.playVariant === '9';
  const objects: LR2ChartObject[] = [];
  const nativeLeadMs =
    options.nativeLeadIn &&
    source.sortedEvents.some((event) => {
      const channel = normalizeChannel(event.channel);
      return (
        ['1', '2', '3', '4'].includes(channel[0]!) &&
        resolveLR2RawLane(channel, pms) !== undefined &&
        source.beatResolver.eventToBeat(event) === 0
      );
    })
      ? (source.beatResolver.measureToBeat(1) * 60000) / (source.source.metadata.bpm * tempo)
      : 0;
  const timed = (beat: number): Pick<LR2ChartObject, 'timeMs' | 'position'> => ({
    timeMs: (source.timing.beatToSeconds(beat) * 1000) / tempo + nativeLeadMs,
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
      const lane = resolveLR2RawLane(note.event.channel, pms);
      if (lane === undefined) continue;
      objects.push({
        ...timed(note.beat),
        op: 10 + lane,
        value: Number.parseInt(note.sampleKey, 36),
        event: note.event,
        note,
        ...(note.endSeconds !== undefined ? { holdEndMs: (note.endSeconds * 1000) / tempo + nativeLeadMs } : {}),
        shadowed,
        trigger: triggers.get(note.event),
      });
      if (note.endBeat !== undefined) objects.push({ ...timed(note.endBeat), op: 50 + lane, value: 0 });
    }
  }
  for (const note of source.mines) {
    const lane = resolveLR2RawLane(note.event.channel, pms);
    if (lane !== undefined) objects.push({ ...timed(note.beat), op: 10 + lane, value: 0, event: note.event, note });
  }
  for (const note of source.invisibleNotes) {
    const lane = resolveLR2RawLane(note.event.channel, pms);
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
  // EXTRA clears hold endpoints, but the native decoded tail objects still exist.
  // Keep their otherwise-empty rows for subsequent conversion/scratch sweeps.
  const rows = new Set(objects.map((object) => object.position));
  for (const event of source.sortedEvents) {
    const channel = normalizeChannel(event.channel);
    const isTailRow =
      '56'.includes(channel[0]!) ||
      ('12'.includes(channel[0]!) && (source.source.bms.lnObjs?.includes(event.value) ?? false));
    const beat = source.beatResolver.eventToBeat(event);
    const lane = resolveLR2RawLane(channel, pms);
    if (!isTailRow || lane === undefined || rows.has(beat)) continue;
    objects.push({ ...timed(beat), op: 50 + lane, value: 0 });
    rows.add(beat);
  }
  return objects;
}

export function resolveLR2RawLane(channel: string, pms: boolean): number | undefined {
  channel = normalizeChannel(channel);
  if (channel.length !== 2 || !'123456DE'.includes(channel[0]!)) return undefined;
  const bank = '135D'.includes(channel[0]!) ? 0 : 1;
  const digit = Number.parseInt(channel[1]!, 10);
  if (pms) {
    if (bank === 0) return [undefined, 1, 2, 3, 4, 5, 8, 9, 6, 7][digit];
    if (digit >= 2 && digit <= 5) return digit + 4;
  }
  const slot = digit >= 1 && digit <= 5 ? digit : digit === 6 ? 0 : digit === 8 ? 6 : digit === 9 ? 7 : undefined;
  return slot === undefined ? undefined : bank * 10 + slot;
}

export function formatLR2Lane(lane: number, pms: boolean): string {
  if (!Number.isInteger(lane) || lane < 0 || lane >= 20 || (!pms && lane % 10 > 7))
    throw new RangeError('Unsupported LR2 lane slot.');
  const side = lane < 10 ? '1' : '2';
  const slot = lane % 10;
  return `${side}${pms ? slot : slot === 0 ? 6 : slot >= 6 ? slot + 2 : slot}`;
}

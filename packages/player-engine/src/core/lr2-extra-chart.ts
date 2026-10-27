import { collectLR2ChartObjects, formatLR2Lane } from './lr2-chart-objects.ts';
import type { ResolvedChart, ResolvedNote, TimedSampleTrigger } from '@be-music/chart-model';
import { type BeMusicEvent } from '@be-music/chart-source';
import { applyLR2Extra } from './lr2-extra.ts';
import type { LR2ExtraLevel } from './lr2-extra-lanes.ts';
import { resolveLR2SoundFamilies } from './lr2-sound-families.ts';
import { withChartOverrides } from './resolved-chart-overrides.ts';

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
  const triggers = new Map(source.sampleTriggers.map((trigger) => [trigger.event, trigger]));
  const objects = collectLR2ChartObjects(source, { tempo });
  const result = applyLR2Extra(objects, {
    keyMode: Number(mode) as 5 | 7 | 9 | 10 | 14,
    level: options.level,
    initialBPM: source.source.metadata.bpm * tempo,
    soundFamilies: resolveLR2SoundFamilies(source.source, source.randomDraws),
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
    const channel = lane === undefined ? '01' : formatLR2Lane(lane, pms);
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

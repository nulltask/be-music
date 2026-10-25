import { normalizeChannel, type BeMusicEvent } from '@be-music/chart-source';
import { PLAY_MODE_LAYOUTS, type ResolvedChart } from '@be-music/chart-model';
import { createLaneBindings, resolveLaneOptionChannels } from './lane-layout.ts';

export interface ModifierTimeline {
  beat: number;
  event: Pick<BeMusicEvent, 'measure' | 'position'>;
}

export function resolveModifierLanes(resolved: ResolvedChart, chartExtension?: string): string[] {
  const channels = [...resolved.notes, ...resolved.mines, ...resolved.invisibleNotes].map(({ channel }) => channel);
  const bindings = createLaneBindings(channels.length > 0 ? channels : ['11'], {
    player: resolved.source.bms.player,
    playVariant: resolved.playVariant,
    chartExtension,
  });
  return (['1P', '2P'] as const).flatMap((side) => {
    const keys = resolveLaneOptionChannels(side, resolved.playVariant, bindings);
    const extra =
      resolved.playVariant === '9'
        ? []
        : PLAY_MODE_LAYOUTS[resolved.playVariant].lanes
            .filter((lane) => lane.side === side && lane.kind !== 'key')
            .sort((a, b) => a.slot - b.slot)
            .map((lane) => lane.channel);
    return [...keys, ...extra];
  });
}

export function collectModifierTimelines(resolved: ResolvedChart, lanes: readonly string[]): ModifierTimeline[] {
  const rows = new Map<number, ModifierTimeline>();
  const add = (beat: number, event: ModifierTimeline['event']): void => {
    if (Number.isFinite(beat) && !rows.has(beat)) rows.set(beat, { beat, event });
  };
  let maxMeasure = 0;
  for (const event of resolved.sortedEvents) maxMeasure = Math.max(maxMeasure, event.measure);
  for (const measure of resolved.source.measures) maxMeasure = Math.max(maxMeasure, measure.index);
  // BMS Section creates a timeline at every measure start, even for empty sections.
  if (resolved.sourceFormat === 'bms')
    for (let measure = 0; measure <= maxMeasure; measure += 1)
      add(resolved.beatResolver.measureToBeat(measure), { measure, position: [0, 1] });
  else for (const beat of resolved.barLines) add(beat, eventAtBeat(resolved, beat, maxMeasure));
  add(0, { measure: 0, position: [0, 1] });
  for (const event of resolved.sortedEvents) {
    const channel = normalizeChannel(event.channel);
    const family = channel[0]!;
    const lane = `${'135D'.includes(family) ? '1' : '2'}${channel[1] ?? ''}`;
    const laneEvent = ['1', '2', '3', '4', '5', '6', 'D', 'E'].includes(family) && lanes.includes(lane);
    if (laneEvent || ['01', '03', '04', '07', '08', '09', 'SC', 'SP'].includes(channel))
      add(resolved.beatResolver.eventToBeat(event), event);
  }
  // The normalized bmson notes carry their tails as lengths instead of raw events.
  for (const note of [...resolved.notes, ...resolved.mines, ...resolved.invisibleNotes]) {
    if (!lanes.includes(note.channel)) continue;
    add(note.beat, note.event);
    if (note.endBeat !== undefined && lanes.includes(note.channel) && !rows.has(note.endBeat))
      add(note.endBeat, eventAtBeat(resolved, note.endBeat, maxMeasure));
  }
  return [...rows.values()].sort((a, b) => a.beat - b.beat);
}

function eventAtBeat(resolved: ResolvedChart, beat: number, maxMeasure: number): ModifierTimeline['event'] {
  let low = 0,
    high = Math.max(1, maxMeasure + 1);
  while (resolved.beatResolver.measureToBeat(high) <= beat) high *= 2;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (resolved.beatResolver.measureToBeat(mid) <= beat) low = mid;
    else high = mid - 1;
  }
  const measure = low;
  const start = resolved.beatResolver.measureToBeat(measure);
  const length = resolved.beatResolver.measureToBeat(measure + 1) - start;
  const resolution = resolved.source.bmson.info.resolution || 240;
  return { measure, position: [Math.round((beat - start) * resolution), Math.round(length * resolution)] };
}

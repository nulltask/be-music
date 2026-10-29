import {
  normalizeChannel,
  normalizeObjectKey,
  resolveBMSBase,
  type BeMusicEvent,
  type BeMusicJSON,
} from '@be-music/chart-source';
import { sortEvents } from './index.ts';

export interface BGACue {
  seconds: number;
  key?: string;
}

export interface BGATimelines {
  base: BGACue[];
  layer: BGACue[];
  layer2: BGACue[];
  poor: BGACue[];
}

export interface BGATimingResolver {
  eventToSeconds: (event: BeMusicEvent) => number;
  beatToSeconds: (beat: number) => number;
}

const BGA_BASE_CHANNEL = '04';
const BGA_POOR_CHANNEL = '06';
const BGA_LAYER_CHANNEL = '07';
const BGA_LAYER2_CHANNEL = '0A';

export function buildBGATimelines(chart: BeMusicJSON, resolver: BGATimingResolver): BGATimelines {
  const idBase = resolveBMSBase(chart);
  const sortedEvents = sortEvents(chart.events);
  const timelines: BGATimelines = {
    base: buildBmsBGATimeline(sortedEvents, resolver, BGA_BASE_CHANNEL, idBase, chart.sourceFormat === 'bmson'),
    poor: buildBmsBGATimeline(sortedEvents, resolver, BGA_POOR_CHANNEL, idBase, chart.sourceFormat === 'bmson'),
    layer: buildBmsBGATimeline(sortedEvents, resolver, BGA_LAYER_CHANNEL, idBase, chart.sourceFormat === 'bmson'),
    layer2: buildBmsBGATimeline(sortedEvents, resolver, BGA_LAYER2_CHANNEL, idBase, chart.sourceFormat === 'bmson'),
  };

  const bgaSection = chart.bmson.bga;
  if (bgaSection.events.length > 0 || bgaSection.layerEvents.length > 0 || bgaSection.poorEvents.length > 0) {
    const headerById = new Map(bgaSection.header.map((entry) => [entry.id, entry.name]));
    const resolution =
      chart.bmson.info?.resolution && chart.bmson.info.resolution > 0 ? chart.bmson.info.resolution : 240;
    const toCue = (entry: { y: number; id: number }): BGACue => {
      const beat = entry.y / resolution;
      const seconds = resolver.beatToSeconds(beat);
      return { seconds, key: entry.id === 0 ? undefined : headerById.get(entry.id) };
    };
    for (const event of bgaSection.events) timelines.base.push(toCue(event));
    const sequenceIds = new Set((bgaSection.sequences ?? []).map((entry) => entry.id));
    for (const event of bgaSection.layerEvents) {
      const cue = toCue(event);
      if (
        event.idSet !== undefined ||
        event.condition !== undefined ||
        event.interval !== undefined ||
        sequenceIds.has(event.id)
      )
        cue.key = undefined;
      timelines.layer.push(cue);
    }
    for (const event of bgaSection.poorEvents) {
      const cue = toCue(event);
      if (sequenceIds.has(event.id)) cue.key = undefined;
      timelines.poor.push(cue);
    }
  }

  sortBGATimelines(timelines);
  return timelines;
}

export function buildBmsBGATimeline(
  events: ReadonlyArray<BeMusicEvent>,
  resolver: Pick<BGATimingResolver, 'eventToSeconds'>,
  channel: string,
  base: 36 | 62 = 36,
  allowLongKeys = false,
): BGACue[] {
  const normalized = normalizeChannel(channel);
  const timeline: BGACue[] = [];
  for (const event of events) {
    if (normalizeChannel(event.channel) !== normalized) {
      continue;
    }
    const key = normalizeObjectKey(event.value, base, allowLongKeys);
    timeline.push({
      seconds: resolver.eventToSeconds(event),
      key: key === '00' ? undefined : key,
    });
  }
  return timeline;
}

function sortBGATimelines(timelines: BGATimelines): void {
  const sortBySeconds = (left: BGACue, right: BGACue): number => left.seconds - right.seconds;
  timelines.base.sort(sortBySeconds);
  timelines.layer.sort(sortBySeconds);
  timelines.layer2.sort(sortBySeconds);
  timelines.poor.sort(sortBySeconds);
}

/** How a BMS chart displays its miss image: replace, overlay, or hide. */
export type PoorBGAMode = 0 | 1 | 2;

/** Parses `#POORBGA`; missing, invalid and out-of-range values use the normal replacement mode. */
export function resolvePoorBGAMode(value: string | undefined): PoorBGAMode {
  const parsed = value === undefined ? 0 : Number.parseInt(value.trim(), 10);
  return parsed === 1 || parsed === 2 ? parsed : 0;
}

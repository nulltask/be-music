import { sortEvents } from '@be-music/chart';
import {
  normalizeChannel,
  normalizeObjectKey,
  resolveBmsBase,
  type BeMusicEvent,
  type BeMusicJson,
} from '@be-music/json';

export interface BgaCue {
  seconds: number;
  key?: string;
}

export interface BgaTimelines {
  base: BgaCue[];
  layer: BgaCue[];
  layer2: BgaCue[];
  poor: BgaCue[];
}

export interface BgaTimingResolver {
  eventToSeconds: (event: BeMusicEvent) => number;
  beatToSeconds: (beat: number) => number;
}

const BGA_BASE_CHANNEL = '04';
const BGA_POOR_CHANNEL = '06';
const BGA_LAYER_CHANNEL = '07';
const BGA_LAYER2_CHANNEL = '0A';

export function buildBgaTimelines(chart: BeMusicJson, resolver: BgaTimingResolver): BgaTimelines {
  const idBase = resolveBmsBase(chart);
  const sortedEvents = sortEvents(chart.events);
  const timelines: BgaTimelines = {
    base: buildBmsBgaTimeline(sortedEvents, resolver, BGA_BASE_CHANNEL, idBase),
    poor: buildBmsBgaTimeline(sortedEvents, resolver, BGA_POOR_CHANNEL, idBase),
    layer: buildBmsBgaTimeline(sortedEvents, resolver, BGA_LAYER_CHANNEL, idBase),
    layer2: buildBmsBgaTimeline(sortedEvents, resolver, BGA_LAYER2_CHANNEL, idBase),
  };

  const bgaSection = chart.bmson.bga;
  if (bgaSection.events.length > 0 || bgaSection.layerEvents.length > 0 || bgaSection.poorEvents.length > 0) {
    const headerById = new Map(bgaSection.header.map((entry) => [entry.id, entry.name]));
    const resolution =
      chart.bmson.info?.resolution && chart.bmson.info.resolution > 0 ? chart.bmson.info.resolution : 240;
    const toCue = (entry: { y: number; id: number }): BgaCue => {
      const beat = entry.y / resolution;
      const seconds = resolver.beatToSeconds(beat);
      return { seconds, key: entry.id === 0 ? undefined : headerById.get(entry.id) };
    };
    for (const event of bgaSection.events) timelines.base.push(toCue(event));
    for (const event of bgaSection.layerEvents) timelines.layer.push(toCue(event));
    for (const event of bgaSection.poorEvents) timelines.poor.push(toCue(event));
  }

  sortBgaTimelines(timelines);
  return timelines;
}

export function buildBmsBgaTimeline(
  events: ReadonlyArray<BeMusicEvent>,
  resolver: Pick<BgaTimingResolver, 'eventToSeconds'>,
  channel: string,
  base: 36 | 62 = 36,
): BgaCue[] {
  const normalized = normalizeChannel(channel);
  const timeline: BgaCue[] = [];
  for (const event of events) {
    if (normalizeChannel(event.channel) !== normalized) {
      continue;
    }
    const key = normalizeObjectKey(event.value, base);
    timeline.push({
      seconds: resolver.eventToSeconds(event),
      key: key === '00' ? undefined : key,
    });
  }
  return timeline;
}

export function pickActiveBgaCue<T extends { seconds: number }>(
  cues: ReadonlyArray<T>,
  seconds: number,
): T | undefined {
  let low = 0;
  let high = cues.length - 1;
  let answer = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (cues[mid]!.seconds <= seconds) {
      answer = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return answer < 0 ? undefined : cues[answer];
}

export function pickActiveBgaKey(cues: ReadonlyArray<BgaCue>, seconds: number): string | undefined {
  return pickActiveBgaCue(cues, seconds)?.key;
}

function sortBgaTimelines(timelines: BgaTimelines): void {
  const sortBySeconds = (left: BgaCue, right: BgaCue): number => left.seconds - right.seconds;
  timelines.base.sort(sortBySeconds);
  timelines.layer.sort(sortBySeconds);
  timelines.layer2.sort(sortBySeconds);
  timelines.poor.sort(sortBySeconds);
}

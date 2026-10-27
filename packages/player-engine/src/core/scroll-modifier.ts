import { withChartOverrides } from './resolved-chart-overrides.ts';
import type { ResolvedChart, ResolvedNote, ScrollTimelinePoint, TimingResolver } from '@be-music/chart-model';

export type ScrollModifier = 'OFF' | 'REMOVE' | 'ADD';

/**
 * beatoraja 0.8.9 ScrollSpeedModifier.REMOVE: retain every timeline's time while replacing
 * its section with first-BPM * time / 60, its BPM/scroll with the first values and its STOP with zero.
 * This is a resolved-chart transformation, before LN/mine modifiers; source events remain untouched.
 */
export function removeScrollChanges(source: ResolvedChart): { chart: ResolvedChart; changed: boolean } {
  const bpm = source.timing.bpmAtBeat(0);
  if (!Number.isFinite(bpm) || bpm <= 0) throw new RangeError('Scroll REMOVE requires a positive initial BPM.');
  const scroll = initialScroll(source);
  const changed =
    source.timing.tempoPoints.some((point) => point.beat > 0 && point.bpm !== bpm) ||
    source.timing.stopPoints.some((point) => point.seconds !== 0) ||
    source.scroll.some((point) => point.beat > 0 && point.speed !== scroll);
  const toBeat = (seconds: number): number => (seconds * bpm) / 60;
  const mapBeat = (beat: number): number => toBeat(source.timing.beatToSeconds(beat));
  const timing: TimingResolver = {
    tempoPoints: [{ beat: 0, seconds: 0, bpm }],
    stopPoints: [],
    beatToSeconds: (beat) => (beat * 60) / bpm,
    eventToSeconds: (event) => source.timing.eventToSeconds(event),
    bpmAtBeat: () => bpm,
    displayBPMAtBeat: () => bpm,
  };
  const mapNotes = (notes: readonly ResolvedNote[]): ResolvedNote[] =>
    notes.map((note) => ({
      ...note,
      beat: toBeat(note.seconds),
      ...(note.endSeconds !== undefined ? { endBeat: toBeat(note.endSeconds) } : {}),
    }));
  const chart = withChartOverrides(source, {
    beatResolver: {
      measureToBeat: (measure, position) => mapBeat(source.beatResolver.measureToBeat(measure, position)),
      eventToBeat: (event) => toBeat(source.timing.eventToSeconds(event)),
    },
    timing,
    reversal: undefined,
    notes: mapNotes(source.notes),
    shadowedNotes: mapNotes(source.shadowedNotes),
    mines: mapNotes(source.mines),
    invisibleNotes: mapNotes(source.invisibleNotes),
    sampleTriggers: source.sampleTriggers.map((trigger) => ({ ...trigger, beat: toBeat(trigger.seconds) })),
    scroll: [{ beat: 0, speed: scroll }],
    speed: source.speed.map((point) => ({ ...point, beat: mapBeat(point.beat) })),
    barLines: source.barLines.map(mapBeat),
  });
  return { chart, changed };
}

/** PlayerConfig 0.8.9: integer sections 1..1024, default 4. */
export function clampScrollSection(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(1024, Math.trunc(value))) : 4;
}

/** PlayerConfig 0.8.9: finite rates 0..1, default 0.5. */
export function clampScrollRate(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
}

/**
 * beatoraja 83574048 ScrollSpeedModifier.ADD overwrites existing SCROLL values,
 * counting the first section line as number one. This branch does not set a source assist flag.
 */
export function addScrollChanges(
  source: ResolvedChart,
  options: { section?: number; rate?: number; random?: () => number; timeline?: readonly ScrollTimelinePoint[] },
): { chart: ResolvedChart; changed: boolean; section: number; rate: number; timeline: ScrollTimelinePoint[] } {
  const section = clampScrollSection(options.section ?? 4);
  const rate = clampScrollRate(options.rate ?? 0.5);
  const base = initialScroll(source);
  const anchors = source.barLines.filter((_, index) => (index + 1) % section === 0);
  let timeline: ScrollTimelinePoint[];
  if (options.timeline !== undefined) {
    if (
      options.timeline.length !== anchors.length + 1 ||
      options.timeline[0]?.beat !== 0 ||
      options.timeline[0]?.speed !== base
    )
      throw new RangeError('Recorded scroll ADD timeline does not match the source section lines.');
    const low = Math.min(base * (1 - rate), base * (1 + rate));
    const high = Math.max(base * (1 - rate), base * (1 + rate));
    for (const [index, beat] of anchors.entries()) {
      const point = options.timeline[index + 1]!;
      if (
        point.beat !== beat ||
        !Number.isFinite(point.speed) ||
        (rate === 0 && point.speed !== base) ||
        point.speed < low - 1e-12 ||
        point.speed > high + 1e-12
      )
        throw new RangeError('Invalid recorded scroll ADD placement.');
    }
    timeline = options.timeline.map((point) => ({ ...point }));
  } else {
    timeline = [{ beat: 0, speed: base }];
    for (const beat of anchors) {
      const draw = options.random?.();
      if (draw === undefined || !Number.isFinite(draw) || draw < 0 || draw >= 1)
        throw new RangeError('Scroll ADD requires supplied randomness in [0, 1) or a recorded timeline.');
      timeline.push({ beat, speed: base * (1 + draw * rate * 2 - rate) });
    }
  }
  const beats = [
    ...new Set([...source.scroll.map((point) => point.beat), ...timeline.map((point) => point.beat)]),
  ].sort((a, b) => a - b);
  let originalIndex = 0,
    modifiedIndex = 0,
    originalSpeed = 1,
    modifiedSpeed = 1;
  const changed = beats.some((beat) => {
    while (originalIndex < source.scroll.length && source.scroll[originalIndex]!.beat <= beat)
      originalSpeed = source.scroll[originalIndex++]!.speed;
    while (modifiedIndex < timeline.length && timeline[modifiedIndex]!.beat <= beat)
      modifiedSpeed = timeline[modifiedIndex++]!.speed;
    return originalSpeed !== modifiedSpeed;
  });
  return { chart: withChartOverrides(source, { scroll: timeline }), changed, section, rate, timeline };
}

function initialScroll(source: ResolvedChart): number {
  return scrollAt(source.scroll, 0);
}

function scrollAt(timeline: readonly ScrollTimelinePoint[], beat: number): number {
  let speed = 1;
  for (const point of timeline) {
    if (point.beat > beat) break;
    speed = point.speed;
  }
  return speed;
}

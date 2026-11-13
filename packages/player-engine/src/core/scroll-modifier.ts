import { withChartOverrides } from './resolved-chart-overrides.ts';
import type { ResolvedChart, ResolvedNote, ScrollTimelinePoint, TimingResolver } from '@be-music/chart-model';

/** beatoraja's REMOVE and ADD, and LR2's mania option SOFTLANDING at LEVEL 1 or 2. */
export type ScrollModifier = 'OFF' | 'REMOVE' | 'ADD' | 'SOFTLANDING-1' | 'SOFTLANDING-2';

/** Whether `modifier` is LR2's SOFTLANDING, at either level. */
export function isSoftLanding(modifier: ScrollModifier | undefined): modifier is 'SOFTLANDING-1' | 'SOFTLANDING-2' {
  return modifier === 'SOFTLANDING-1' || modifier === 'SOFTLANDING-2';
}

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

/** SOFTLANDING's factor is `(100 + r) / 100` or its reciprocal with `r` in 0..100: between a half and double. */
const SOFT_LANDING_MIN = 0.5;
const SOFT_LANDING_MAX = 2;

/**
 * LR2 beta3's mania option SOFTLANDING (OpenLR2 `LR2f.cpp` L26591-L26610, L26680-L26700): at each measure, and at LEVEL
 * 2 at each note and mine as well, LR2 draws a factor and multiplies both the measure length and the BPM by it, so a
 * measure lasts as long as before and only the scroll changes. That is a SCROLL value: the timeline replaces the
 * chart's own, each point the chart's initial SCROLL times the drawn factor.
 *
 * The factor is `(100 + r) / 100` or `100 / (100 + r)`, each half the time, with `r` uniform in 0..100. One factor is
 * drawn per distinct beat. A long note's end is not a redraw point.
 */
export function addSoftLanding(
  source: ResolvedChart,
  options: { level: 1 | 2; random?: () => number; timeline?: readonly ScrollTimelinePoint[] },
): { chart: ResolvedChart; changed: boolean; timeline: ScrollTimelinePoint[] } {
  const base = initialScroll(source);
  const beats = softLandingBeats(source, options.level);
  let timeline: ScrollTimelinePoint[];
  if (options.timeline !== undefined) {
    if (options.timeline.length !== beats.length)
      throw new RangeError('Recorded SOFTLANDING timeline does not match the source measures and notes.');
    for (const [index, beat] of beats.entries()) {
      const point = options.timeline[index]!;
      const factor = base !== 0 ? point.speed / base : Number.NaN;
      if (
        point.beat !== beat ||
        !Number.isFinite(factor) ||
        factor < SOFT_LANDING_MIN - 1e-12 ||
        factor > SOFT_LANDING_MAX + 1e-12
      )
        throw new RangeError('Invalid recorded SOFTLANDING placement.');
    }
    timeline = options.timeline.map((point) => ({ ...point }));
  } else {
    const draw = (): number => {
      const value = options.random?.();
      if (value === undefined || !Number.isFinite(value) || value < 0 || value >= 1)
        throw new RangeError('SOFTLANDING requires supplied randomness in [0, 1) or a recorded timeline.');
      return value;
    };
    timeline = beats.map((beat) => {
      // LR2's `GetRand(1)` picks the side and `GetRand(100)` the amount.
      const stretches = draw() < 0.5;
      const amount = 100 + Math.floor(draw() * 101);
      return { beat, speed: base * (stretches ? amount / 100 : 100 / amount) };
    });
  }
  const changed =
    timeline.some((point) => point.speed !== scrollAt(source.scroll, point.beat)) ||
    source.scroll.some((point) => point.speed !== scrollAt(timeline, point.beat));
  return { chart: withChartOverrides(source, { scroll: timeline }), changed, timeline };
}

/** The beats SOFTLANDING redraws at, in order: every measure's start through the chart's last object, and at LEVEL 2 every note and mine. */
function softLandingBeats(source: ResolvedChart, level: 1 | 2): number[] {
  let lastBeat = 0;
  for (const note of source.notes) lastBeat = Math.max(lastBeat, note.endBeat ?? note.beat);
  for (const mine of source.mines) lastBeat = Math.max(lastBeat, mine.beat);
  for (const beat of source.barLines) lastBeat = Math.max(lastBeat, beat);
  const beats = new Set<number>([0]);
  // LR2 gives every measure a measure-length object, whether the chart draws its bar line or not.
  for (let measure = 0; measure < SOFT_LANDING_MEASURES; measure += 1) {
    const beat = source.beatResolver.measureToBeat(measure, 0);
    if (!Number.isFinite(beat) || beat > lastBeat) break;
    beats.add(beat);
  }
  if (level === 2) {
    for (const note of source.notes) beats.add(note.beat);
    for (const mine of source.mines) beats.add(mine.beat);
  }
  return [...beats].sort((left, right) => left - right);
}

/** LR2 lays out 1000 measures per chart. */
const SOFT_LANDING_MEASURES = 1000;

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

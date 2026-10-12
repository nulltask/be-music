import { findLastIndexAtOrBefore } from '@be-music/utils/core';
import {
  normalizeChannel,
  normalizeObjectKey,
  resolveBmsBase,
  type BeMusicEvent,
  type BeMusicJson,
} from '@be-music/json';
import { isScrollChannel, sortEvents, type BeatResolver } from './index.ts';
import { createTimingResolver, type TimingResolver } from './timing.ts';

export interface MeasureTimelinePoint {
  measure: number;
  seconds: number;
}

export interface BpmTimelinePoint {
  bpm: number;
  seconds: number;
}

export interface ScrollTimelinePoint {
  beat: number;
  speed: number;
}

export interface SpeedTimelinePoint {
  beat: number;
  speed: number;
}

export interface StopBeatWindow {
  beat: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
}

export function createMeasureTimeline(
  json: BeMusicJson,
  resolver: TimingResolver,
  beatResolver: BeatResolver,
): MeasureTimelinePoint[] {
  const maxMeasure = resolveMaxMeasureIndex(json);
  const timeline: MeasureTimelinePoint[] = [];
  for (let measure = 0; measure <= maxMeasure + 1; measure += 1) {
    const seconds = resolver.beatToSeconds(beatResolver.measureToBeat(measure, 0));
    if (!Number.isFinite(seconds)) {
      continue;
    }
    timeline.push({ measure, seconds });
  }

  return timeline;
}

export function createBpmTimeline(json: BeMusicJson, resolver: TimingResolver): BpmTimelinePoint[] {
  const timeline: BpmTimelinePoint[] = [];
  let previousSeconds = Number.NaN;
  let previousBpm = Number.NaN;

  for (const point of resolver.tempoPoints) {
    const seconds = resolver.beatToSeconds(point.beat);
    if (!Number.isFinite(seconds) || !Number.isFinite(point.bpm) || point.bpm <= 0) {
      continue;
    }
    if (Math.abs(seconds - previousSeconds) < 1e-6 && Math.abs(point.bpm - previousBpm) < 1e-6) {
      continue;
    }
    timeline.push({
      bpm: point.bpm,
      seconds,
    });
    previousSeconds = seconds;
    previousBpm = point.bpm;
  }

  if (timeline.length === 0) {
    const fallbackBpm = Number.isFinite(json.metadata.bpm) && json.metadata.bpm > 0 ? json.metadata.bpm : 130;
    timeline.push({ bpm: fallbackBpm, seconds: 0 });
  }

  return timeline;
}

export function createScrollTimeline(json: BeMusicJson, beatResolver: BeatResolver): ScrollTimelinePoint[] {
  if (Object.keys(json.bms.scroll).length === 0) {
    return [];
  }
  return toBeatTimeline(collectScrollChanges(json, sortEvents(json.events)), beatResolver);
}

export function createSpeedTimeline(json: BeMusicJson, beatResolver: BeatResolver): SpeedTimelinePoint[] {
  if (Object.keys(json.bms.speed).length === 0) {
    return [];
  }
  return toBeatTimeline(collectSpeedChanges(json, sortEvents(json.events)), beatResolver);
}

/** A SCROLL (`SC` + `#SCROLLxx`) or SPEED (`SP` + `#SPEEDxx`) keyframe object and the value it sets. */
export interface KeyframeChange {
  readonly event: BeMusicEvent;
  readonly value: number;
}

/**
 * The SCROLL keyframes of a chart, in chart order: `SC` objects whose `#SCROLLxx` is a finite number (negative values
 * included). Not part of the package API (the chart fingerprint reads exact positions from the events).
 */
export function collectScrollChanges(json: BeMusicJson, sortedEvents: ReadonlyArray<BeMusicEvent>): KeyframeChange[] {
  return collectKeyframeChanges(json.bms.scroll, resolveBmsBase(json), sortedEvents, isScrollChannel, true);
}

/**
 * The SPEED keyframes of a chart, in chart order: `SP` objects whose `#SPEEDxx` is a finite number of at least 0. Not
 * part of the package API (the chart fingerprint reads exact positions from the events).
 */
export function collectSpeedChanges(json: BeMusicJson, sortedEvents: ReadonlyArray<BeMusicEvent>): KeyframeChange[] {
  return collectKeyframeChanges(
    json.bms.speed,
    resolveBmsBase(json),
    sortedEvents,
    (channel) => normalizeChannel(channel) === 'SP',
    false,
  );
}

function collectKeyframeChanges(
  values: Readonly<Record<string, number>>,
  idBase: 36 | 62,
  sortedEvents: ReadonlyArray<BeMusicEvent>,
  isChannel: (channel: string) => boolean,
  allowNegative: boolean,
): KeyframeChange[] {
  const changes: KeyframeChange[] = [];
  for (const event of sortedEvents) {
    if (!isChannel(event.channel)) {
      continue;
    }
    const key = normalizeObjectKey(event.value, idBase);
    if (!Object.hasOwn(values, key)) {
      continue;
    }
    const value = values[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || (!allowNegative && value < 0)) {
      continue;
    }
    changes.push({ event, value });
  }
  return changes;
}

function toBeatTimeline(changes: ReadonlyArray<KeyframeChange>, beatResolver: BeatResolver): ScrollTimelinePoint[] {
  const timeline: ScrollTimelinePoint[] = [];
  for (const change of changes) {
    const beat = beatResolver.eventToBeat(change.event);
    if (Number.isFinite(beat) && beat >= 0) {
      timeline.push({ beat, speed: change.value });
    }
  }
  return timeline;
}

export function createBeatAtSecondsResolver(json: BeMusicJson): (seconds: number) => number {
  const resolver = createTimingResolver(json);
  return createBeatAtSecondsResolverFromTimingResolver(resolver);
}

export function createBeatAtSecondsResolverFromTimingResolver(resolver: TimingResolver): (seconds: number) => number {
  const stopWindows = createStopBeatWindows(resolver);
  let lastSeconds = Number.NEGATIVE_INFINITY;
  let stopCursor = 0;
  let endedStopSeconds = 0;

  return (seconds: number): number => {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return 0;
    }
    const safeSeconds = Math.max(0, seconds);

    // Playback time usually increases monotonically; keep a cursor to avoid re-scanning stop windows every frame.
    if (safeSeconds + 1e-9 < lastSeconds) {
      stopCursor = 0;
      endedStopSeconds = 0;
    }
    lastSeconds = safeSeconds;

    while (stopCursor < stopWindows.length && safeSeconds >= stopWindows[stopCursor]!.endSeconds) {
      endedStopSeconds += stopWindows[stopCursor]!.durationSeconds;
      stopCursor += 1;
    }
    const activeWindow = stopWindows[stopCursor];
    if (activeWindow && safeSeconds >= activeWindow.startSeconds && safeSeconds < activeWindow.endSeconds) {
      return activeWindow.beat;
    }

    const adjustedSeconds = Math.max(0, safeSeconds - endedStopSeconds);
    return secondsToBeatWithoutStops(resolver.tempoPoints, adjustedSeconds);
  };
}

export function createStopBeatWindows(resolver: TimingResolver): StopBeatWindow[] {
  const durationByBeat = new Map<number, number>();
  for (const point of resolver.stopPoints) {
    const current = durationByBeat.get(point.beat) ?? 0;
    durationByBeat.set(point.beat, current + point.seconds);
  }

  return [...durationByBeat.entries()]
    .sort(([leftBeat], [rightBeat]) => leftBeat - rightBeat)
    .map(([beat, durationSeconds]) => {
      const startSeconds = resolver.beatToSeconds(beat);
      return {
        beat,
        startSeconds,
        endSeconds: startSeconds + durationSeconds,
        durationSeconds,
      } satisfies StopBeatWindow;
    });
}

export function createMeasureBoundariesBeats(json: BeMusicJson, beatResolver: BeatResolver): number[] {
  const maxMeasure = resolveMaxMeasureIndex(json);
  const boundaries: number[] = [];
  let previous = Number.NaN;

  for (let measure = 0; measure <= maxMeasure + 1; measure += 1) {
    const beat = beatResolver.measureToBeat(measure, 0);
    if (!Number.isFinite(beat)) {
      continue;
    }
    if (Math.abs(beat - previous) < 1e-9) {
      continue;
    }
    boundaries.push(beat);
    previous = beat;
  }

  return boundaries;
}

function secondsToBeatWithoutStops(
  tempoPoints: ReadonlyArray<{ beat: number; bpm: number; seconds: number }>,
  seconds: number,
): number {
  if (tempoPoints.length === 0 || seconds <= 0) {
    return 0;
  }
  const index = findLastIndexAtOrBefore(tempoPoints, seconds, (point) => point.seconds);

  const point = tempoPoints[Math.max(0, index)]!;
  const elapsed = Math.max(0, seconds - point.seconds);
  return point.beat + (elapsed * point.bpm) / 60;
}

function resolveMaxMeasureIndex(json: BeMusicJson): number {
  let maxMeasure = 0;
  for (const event of json.events) {
    if (event.measure > maxMeasure) {
      maxMeasure = event.measure;
    }
  }
  for (const measure of json.measures) {
    if (measure.index > maxMeasure) {
      maxMeasure = measure.index;
    }
  }
  return Math.max(0, maxMeasure);
}

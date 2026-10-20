/**
 * The play tempo over the play clock: chart time runs `tempo` times as fast as the play clock, and the tempo can change
 * during the play. Each change starts a segment at the chart time it took effect, so chart time stays continuous across
 * it. Pure: it reads no clock itself, the caller hands it play-clock milliseconds.
 */

/** One stretch of the play at one tempo, from its start on the play clock and in chart time. */
export interface TempoClockSegment {
  /** Play-clock milliseconds the segment starts at. */
  clockMs: number;
  /** Chart seconds the segment starts at. */
  chartSeconds: number;
  /** Chart seconds per play-clock second in the segment. */
  tempo: number;
}

export interface TempoClock {
  /** The tempo the play started at. */
  readonly initialTempo: number;
  /** The tempo in force now (the last change's, or the initial one). */
  readonly tempo: number;
  /** The segments so far, in time order; the first starts at 0 with {@link initialTempo}. */
  readonly segments: readonly TempoClockSegment[];
  /** Chart seconds at a play-clock time (0 before the start). */
  chartSecondsAt(clockMs: number): number;
  /** Play-clock milliseconds at a chart time; past the last change it runs at the current tempo. */
  clockMsAt(chartSeconds: number): number;
  /**
   * The chart time at a play-clock time as milliseconds at the initial tempo: the play clock itself until the first
   * change, and chart time scaled by `1000 / initialTempo` throughout, so it stays linear in chart time.
   */
  initialTempoMsAt(clockMs: number): number;
  /**
   * Changes the tempo at a play-clock time (clamped to the start of the last segment, so time never runs backwards).
   * Returns the chart seconds the change took effect at. A change to the tempo in force, or to a non-positive or
   * non-finite one, changes nothing.
   */
  setTempoAtClockMs(clockMs: number, tempo: number): number;
  /**
   * Changes the tempo at a chart time (clamped to the start of the last segment), e.g. to follow a change another
   * clock already made. Returns the play-clock milliseconds the change took effect at.
   */
  setTempoAtChartSeconds(chartSeconds: number, tempo: number): number;
}

const isUsableTempo = (tempo: number): boolean => Number.isFinite(tempo) && tempo > 0;

/** A {@link TempoClock} starting at `initialTempo` (1 when unusable). */
export function createTempoClock(initialTempo = 1): TempoClock {
  const startTempo = isUsableTempo(initialTempo) ? initialTempo : 1;
  const segments: TempoClockSegment[] = [{ clockMs: 0, chartSeconds: 0, tempo: startTempo }];

  const segmentAtClockMs = (clockMs: number): TempoClockSegment => {
    for (let index = segments.length - 1; index > 0; index -= 1) {
      if (segments[index]!.clockMs <= clockMs) return segments[index]!;
    }
    return segments[0]!;
  };
  const segmentAtChartSeconds = (chartSeconds: number): TempoClockSegment => {
    for (let index = segments.length - 1; index > 0; index -= 1) {
      if (segments[index]!.chartSeconds <= chartSeconds) return segments[index]!;
    }
    return segments[0]!;
  };
  const chartSecondsAt = (clockMs: number): number => {
    const segment = segmentAtClockMs(clockMs);
    // `(ms / 1000) * tempo`, as the fixed-tempo engine computed it, so a play without changes reads the same values.
    return Math.max(0, segment.chartSeconds + ((clockMs - segment.clockMs) / 1000) * segment.tempo);
  };
  const clockMsAt = (chartSeconds: number): number => {
    const segment = segmentAtChartSeconds(chartSeconds);
    return segment.clockMs + ((chartSeconds - segment.chartSeconds) * 1000) / segment.tempo;
  };
  const append = (clockMs: number, chartSeconds: number, tempo: number): void => {
    const last = segments[segments.length - 1]!;
    // A second change at the same instant replaces the first (the initial segment is never rewritten, so
    // `initialTempo` stays the tempo of the first segment).
    if (segments.length > 1 && clockMs <= last.clockMs) {
      last.tempo = tempo;
      // Merge back into the previous segment when the change undoes the last one.
      if (segments[segments.length - 2]!.tempo === tempo) segments.pop();
      return;
    }
    segments.push({ clockMs, chartSeconds, tempo });
  };

  return {
    initialTempo: startTempo,
    get tempo() {
      return segments[segments.length - 1]!.tempo;
    },
    segments,
    chartSecondsAt,
    clockMsAt,
    initialTempoMsAt: (clockMs) => {
      const segment = segmentAtClockMs(clockMs);
      if (segment === segments[0]) return clockMs;
      return (chartSecondsAt(clockMs) * 1000) / startTempo;
    },
    setTempoAtClockMs: (clockMs, tempo) => {
      const last = segments[segments.length - 1]!;
      const atMs = Math.max(last.clockMs, Number.isFinite(clockMs) ? clockMs : last.clockMs);
      const chartSeconds = chartSecondsAt(atMs);
      if (!isUsableTempo(tempo) || tempo === last.tempo) return chartSeconds;
      append(atMs, chartSeconds, tempo);
      return chartSeconds;
    },
    setTempoAtChartSeconds: (chartSeconds, tempo) => {
      const last = segments[segments.length - 1]!;
      const atSeconds = Math.max(last.chartSeconds, Number.isFinite(chartSeconds) ? chartSeconds : last.chartSeconds);
      const clockMs = clockMsAt(atSeconds);
      if (!isUsableTempo(tempo) || tempo === last.tempo) return clockMs;
      append(clockMs, atSeconds, tempo);
      return clockMs;
    },
  };
}

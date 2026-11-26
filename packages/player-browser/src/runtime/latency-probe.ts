/**
 * A developer probe of the play's audio latency, as far as the browser can report it (the web player turns it on with
 * `?latency-probe`; docs/player-web.md, "Latency probe").
 *
 * For each lane key press it keeps four moments on the `performance.now()` clock:
 *
 * - `eventAtMs`: when the browser stamped the key event (`KeyboardEvent.timeStamp`), the time the judge uses;
 * - `handlerAtMs`: when the page's key handler ran. The gap from `eventAtMs` is the main thread's queueing delay;
 * - `keysoundAtMs`: when the press's keysound started (`AudioBufferSourceNode.start`) after the engine judged it;
 * - `audibleAtMs`: when that keysound is due at the output, by the browser's own account (`getOutputTimestamp`, or
 *   failing that the reported `baseLatency` + `outputLatency`).
 *
 * Once a second during a play it also samples what the play's `AudioContext` reports: its latencies and its output clock.
 *
 * Every number is the browser's account. The physical press-to-sound time, which includes the keyboard and the audio
 * device, needs an external probe. While the probe is off the hooks find no probe (`getLatencyProbe`) and do nothing.
 */

/** The part of an `AudioContext` the probe reads. */
export interface LatencyProbeAudioClock {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly baseLatency?: number;
  readonly outputLatency?: number;
  getOutputTimestamp?: () => AudioTimestamp;
}

/** How {@link LatencyProbePress.audibleAtMs} was estimated. */
export type LatencyProbeAudibleSource = 'output-timestamp' | 'reported-latency';

/** One lane key press. Times are milliseconds on the `performance.now()` clock. */
export interface LatencyProbePress {
  /** The play the press belongs to, counted from 1 (0 for a press before any play started). */
  play: number;
  /** The physical key (`KeyboardEvent.code`). */
  code: string;
  eventAtMs: number;
  handlerAtMs: number;
  /** Absent when no keysound started for the press (an empty lane, or one past the chart's notes). */
  keysoundAtMs?: number;
  /** The audio-clock second the keysound starts at. */
  keysoundContextSeconds?: number;
  audibleAtMs?: number;
  audibleSource?: LatencyProbeAudibleSource;
}

/** What a play's `AudioContext` reported at one moment. */
export interface LatencyProbeClockSample {
  play: number;
  atMs: number;
  contextSeconds: number;
  /** `getOutputTimestamp()`: the audio-clock second leaving the output at {@link outputPerformanceMs}. */
  outputContextSeconds?: number;
  outputPerformanceMs?: number;
  baseLatencyMs?: number;
  outputLatencyMs?: number;
  sampleRate: number;
}

export interface LatencyProbe {
  /** A lane key press; call it from the key handler with the event's `timeStamp`. */
  recordPress: (code: string, eventTimeStampMs: number) => void;
  /** A player keysound started at `startContextSeconds` on `clock`; it belongs to the oldest press still waiting. */
  recordKeysoundStart: (clock: LatencyProbeAudioClock, startContextSeconds: number) => void;
  /** A play starts on `clock`: counts the play and samples the clock now and periodically until the returned stop. */
  attachClock: (clock: LatencyProbeAudioClock) => () => void;
  presses: () => LatencyProbePress[];
  clockSamples: () => LatencyProbeClockSample[];
  clear: () => void;
}

export interface LatencyProbeOptions {
  now?: () => number;
  /** Runs `callback` every `intervalMs` until the returned function is called. */
  repeat?: (callback: () => void, intervalMs: number) => () => void;
  /** How long a press waits for its keysound before it counts as having none. */
  matchWindowMs?: number;
  sampleIntervalMs?: number;
  /** The most presses and clock samples kept; older ones are dropped first. */
  maxRecords?: number;
  /** Called with the play's number when a play's clock is detached (the play finished or was abandoned). */
  onPlayEnd?: (play: number) => void;
}

/** How long a press waits for its keysound. The engine starts it within a few milliseconds of the handler. */
export const LATENCY_PROBE_MATCH_WINDOW_MS = 100;
export const LATENCY_PROBE_SAMPLE_INTERVAL_MS = 1000;
export const LATENCY_PROBE_MAX_RECORDS = 100_000;

const defaultRepeat = (callback: () => void, intervalMs: number): (() => void) => {
  const id = setInterval(callback, intervalMs);
  return () => clearInterval(id);
};

const toMs = (seconds: number | undefined): number | undefined =>
  typeof seconds === 'number' && Number.isFinite(seconds) ? seconds * 1000 : undefined;

/**
 * When a sound started at `startContextSeconds` on `clock` is due at the output, on the `performance.now()` clock.
 * `getOutputTimestamp()` maps the audio clock onto it where the browser has it and its context is running; otherwise
 * the sound is taken to leave `baseLatency` + `outputLatency` after it starts.
 */
export function estimateAudibleAtMs(
  clock: LatencyProbeAudioClock,
  startContextSeconds: number,
  nowMs: number,
): { atMs: number; source: LatencyProbeAudibleSource } {
  const stamp = clock.getOutputTimestamp?.();
  if (
    stamp !== undefined &&
    typeof stamp.contextTime === 'number' &&
    typeof stamp.performanceTime === 'number' &&
    stamp.performanceTime > 0
  ) {
    return {
      atMs: stamp.performanceTime + (startContextSeconds - stamp.contextTime) * 1000,
      source: 'output-timestamp',
    };
  }
  const latencyMs = (toMs(clock.baseLatency) ?? 0) + (toMs(clock.outputLatency) ?? 0);
  return {
    atMs: nowMs + Math.max(0, startContextSeconds - clock.currentTime) * 1000 + latencyMs,
    source: 'reported-latency',
  };
}

export function createLatencyProbe(options: LatencyProbeOptions = {}): LatencyProbe {
  const now = options.now ?? (() => performance.now());
  const repeat = options.repeat ?? defaultRepeat;
  const matchWindowMs = options.matchWindowMs ?? LATENCY_PROBE_MATCH_WINDOW_MS;
  const sampleIntervalMs = options.sampleIntervalMs ?? LATENCY_PROBE_SAMPLE_INTERVAL_MS;
  const maxRecords = Math.max(1, options.maxRecords ?? LATENCY_PROBE_MAX_RECORDS);
  let presses: LatencyProbePress[] = [];
  let samples: LatencyProbeClockSample[] = [];
  let waiting: LatencyProbePress[] = [];
  let play = 0;

  const keep = <T>(records: T[], record: T): void => {
    records.push(record);
    if (records.length > maxRecords) records.splice(0, records.length - maxRecords);
  };

  const sample = (clock: LatencyProbeAudioClock, samplePlay: number): void => {
    const stamp = clock.getOutputTimestamp?.();
    const hasStamp = stamp !== undefined && typeof stamp.performanceTime === 'number' && stamp.performanceTime > 0;
    keep(samples, {
      play: samplePlay,
      atMs: now(),
      contextSeconds: clock.currentTime,
      ...(hasStamp ? { outputContextSeconds: stamp.contextTime, outputPerformanceMs: stamp.performanceTime } : {}),
      ...(toMs(clock.baseLatency) !== undefined ? { baseLatencyMs: toMs(clock.baseLatency) } : {}),
      ...(toMs(clock.outputLatency) !== undefined ? { outputLatencyMs: toMs(clock.outputLatency) } : {}),
      sampleRate: clock.sampleRate,
    });
  };

  return {
    recordPress: (code, eventTimeStampMs) => {
      const press: LatencyProbePress = { play, code, eventAtMs: eventTimeStampMs, handlerAtMs: now() };
      keep(presses, press);
      waiting.push(press);
    },
    recordKeysoundStart: (clock, startContextSeconds) => {
      const at = now();
      waiting = waiting.filter((press) => at - press.handlerAtMs <= matchWindowMs);
      const press = waiting.shift();
      if (press === undefined) return;
      const audible = estimateAudibleAtMs(clock, startContextSeconds, at);
      press.keysoundAtMs = at;
      press.keysoundContextSeconds = startContextSeconds;
      press.audibleAtMs = audible.atMs;
      press.audibleSource = audible.source;
    },
    attachClock: (clock) => {
      play += 1;
      waiting = [];
      const attachedPlay = play;
      sample(clock, attachedPlay);
      const stop = repeat(() => sample(clock, attachedPlay), sampleIntervalMs);
      let stopped = false;
      return () => {
        if (stopped) return;
        stopped = true;
        stop();
        sample(clock, attachedPlay);
        options.onPlayEnd?.(attachedPlay);
      };
    },
    presses: () => presses.map((press) => ({ ...press })),
    clockSamples: () => samples.map((entry) => ({ ...entry })),
    clear: () => {
      presses = [];
      samples = [];
      waiting = [];
    },
  };
}

let activeProbe: LatencyProbe | undefined;

/** Turns the probe on (once; later calls return the same probe) so the input and audio hooks start recording. */
export function enableLatencyProbe(options?: LatencyProbeOptions): LatencyProbe {
  activeProbe ??= createLatencyProbe(options);
  return activeProbe;
}

/** Turns the probe off; what it recorded is dropped with it. */
export function disableLatencyProbe(): void {
  activeProbe = undefined;
}

/** The probe the hooks record to, or `undefined` while it is off. */
export function getLatencyProbe(): LatencyProbe | undefined {
  return activeProbe;
}

/** The distribution of one latency, in milliseconds. */
export interface LatencyStatistics {
  count: number;
  minMs: number;
  medianMs: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  meanMs: number;
  /** Population standard deviation: the jitter. */
  stdevMs: number;
}

export interface LatencyProbeSummary {
  presses: number;
  /** Presses whose keysound started. */
  withKeysound: number;
  /** `handlerAtMs - eventAtMs`: the main thread's queueing delay. */
  dispatch?: LatencyStatistics;
  /** `keysoundAtMs - eventAtMs`: press to keysound start. */
  keysoundStart?: LatencyStatistics;
  /** `audibleAtMs - eventAtMs`: press to keysound at the output, by the browser's account. */
  audible?: LatencyStatistics;
  /** The median of the reported latencies over the clock samples. */
  baseLatencyMs?: number;
  outputLatencyMs?: number;
}

/** The value at fraction `p` (0..1) of ascending `sorted`, interpolating between neighbours. */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower);
}

function statistics(values: readonly number[]): LatencyStatistics | undefined {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return undefined;
  const sorted = [...finite].sort((a, b) => a - b);
  const meanMs = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const variance = sorted.reduce((sum, value) => sum + (value - meanMs) ** 2, 0) / sorted.length;
  return {
    count: sorted.length,
    minMs: sorted[0]!,
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    maxMs: sorted[sorted.length - 1]!,
    meanMs,
    stdevMs: Math.sqrt(variance),
  };
}

const definedValues = (values: readonly (number | undefined)[]): number[] =>
  values.filter((value): value is number => value !== undefined);

/** The distributions of the probe's latencies over `presses`, with the reported latencies of `clockSamples`. */
export function summarizeLatencyPresses(
  presses: readonly LatencyProbePress[],
  clockSamples: readonly LatencyProbeClockSample[] = [],
): LatencyProbeSummary {
  const sounded = presses.filter((press) => press.keysoundAtMs !== undefined);
  const dispatch = statistics(presses.map((press) => press.handlerAtMs - press.eventAtMs));
  const keysoundStart = statistics(sounded.map((press) => press.keysoundAtMs! - press.eventAtMs));
  const audible = statistics(
    definedValues(
      sounded.map((press) => (press.audibleAtMs === undefined ? undefined : press.audibleAtMs - press.eventAtMs)),
    ),
  );
  const baseLatency = statistics(definedValues(clockSamples.map((entry) => entry.baseLatencyMs)));
  const outputLatency = statistics(definedValues(clockSamples.map((entry) => entry.outputLatencyMs)));
  return {
    presses: presses.length,
    withKeysound: sounded.length,
    ...(dispatch ? { dispatch } : {}),
    ...(keysoundStart ? { keysoundStart } : {}),
    ...(audible ? { audible } : {}),
    ...(baseLatency ? { baseLatencyMs: baseLatency.medianMs } : {}),
    ...(outputLatency ? { outputLatencyMs: outputLatency.medianMs } : {}),
  };
}

const csvNumber = (value: number | undefined): string =>
  value === undefined || !Number.isFinite(value) ? '' : String(Math.round(value * 1000) / 1000);

const csvText = (value: string | undefined): string =>
  value === undefined ? '' : /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

/** The presses as CSV, one row each, with the derived latencies beside the raw times. */
export function latencyProbeCSV(presses: readonly LatencyProbePress[]): string {
  const header = [
    'play',
    'code',
    'eventAtMs',
    'handlerAtMs',
    'keysoundAtMs',
    'keysoundContextSeconds',
    'audibleAtMs',
    'audibleSource',
    'dispatchMs',
    'keysoundStartMs',
    'audibleMs',
  ];
  const rows = presses.map((press) =>
    [
      String(press.play),
      csvText(press.code),
      csvNumber(press.eventAtMs),
      csvNumber(press.handlerAtMs),
      csvNumber(press.keysoundAtMs),
      press.keysoundContextSeconds === undefined ? '' : String(press.keysoundContextSeconds),
      csvNumber(press.audibleAtMs),
      csvText(press.audibleSource),
      csvNumber(press.handlerAtMs - press.eventAtMs),
      csvNumber(press.keysoundAtMs === undefined ? undefined : press.keysoundAtMs - press.eventAtMs),
      csvNumber(press.audibleAtMs === undefined ? undefined : press.audibleAtMs - press.eventAtMs),
    ].join(','),
  );
  return [header.join(','), ...rows].join('\n') + '\n';
}

/** The clock samples as CSV, one row each. */
export function latencyProbeClockCSV(samples: readonly LatencyProbeClockSample[]): string {
  const header = [
    'play',
    'atMs',
    'contextSeconds',
    'outputContextSeconds',
    'outputPerformanceMs',
    'baseLatencyMs',
    'outputLatencyMs',
    'sampleRate',
  ];
  const rows = samples.map((entry) =>
    [
      String(entry.play),
      csvNumber(entry.atMs),
      String(entry.contextSeconds),
      entry.outputContextSeconds === undefined ? '' : String(entry.outputContextSeconds),
      csvNumber(entry.outputPerformanceMs),
      csvNumber(entry.baseLatencyMs),
      csvNumber(entry.outputLatencyMs),
      String(entry.sampleRate),
    ].join(','),
  );
  return [header.join(','), ...rows].join('\n') + '\n';
}

// `?latency-probe`: turns on the player's developer latency probe (`@be-music/player-browser/audio`) and answers
// `window.beMusicLatencyProbe` in the console, logging each play's summary as it ends (docs/player-web.md,
// "Latency probe").
import {
  enableLatencyProbe,
  latencyProbeClockCSV,
  latencyProbeCSV,
  summarizeLatencyPresses,
  type LatencyProbe,
  type LatencyProbeClockSample,
  type LatencyProbePress,
  type LatencyProbeSummary,
} from '@be-music/player-browser/audio';
import { downloadBlob } from '@be-music/player-browser/recording';

export const LATENCY_PROBE_QUERY_PARAMETER = 'latency-probe';

/** What `window.beMusicLatencyProbe` offers in the console. */
export interface LatencyProbeConsole {
  /** The distributions over every press recorded so far, or over one play's. */
  summary(play?: number): LatencyProbeSummary;
  presses(): LatencyProbePress[];
  clockSamples(): LatencyProbeClockSample[];
  /** Downloads the presses and the clock samples as two CSV files. */
  download(): void;
  clear(): void;
}

declare global {
  interface Window {
    beMusicLatencyProbe?: LatencyProbeConsole;
  }
}

/** Whether `href` asks for the probe (`?latency-probe`, with or without a value other than `0`). */
export function isLatencyProbeRequested(href: string): boolean {
  try {
    const value = new URL(href).searchParams.get(LATENCY_PROBE_QUERY_PARAMETER);
    return value !== null && value !== '0';
  } catch {
    return false;
  }
}

/** The console API over `probe`; `download` hands each CSV to `save`. */
export function createLatencyProbeConsole(
  probe: LatencyProbe,
  save: (blob: Blob, filename: string) => void,
  now: () => Date = () => new Date(),
): LatencyProbeConsole {
  return {
    summary: (play) => {
      const presses = probe.presses().filter((press) => play === undefined || press.play === play);
      const samples = probe.clockSamples().filter((entry) => play === undefined || entry.play === play);
      return summarizeLatencyPresses(presses, samples);
    },
    presses: () => probe.presses(),
    clockSamples: () => probe.clockSamples(),
    download: () => {
      const stamp = now()
        .toISOString()
        .replaceAll(':', '-')
        .replace(/\.\d+Z$/, 'Z');
      save(new Blob([latencyProbeCSV(probe.presses())], { type: 'text/csv' }), `latency-presses-${stamp}.csv`);
      save(new Blob([latencyProbeClockCSV(probe.clockSamples())], { type: 'text/csv' }), `latency-clock-${stamp}.csv`);
    },
    clear: () => probe.clear(),
  };
}

/** A summary's distributions as rows for `console.table`, milliseconds rounded to 0.01. */
export function latencyProbeSummaryTable(summary: LatencyProbeSummary): Record<string, Record<string, number>> {
  const round = (value: number): number => Math.round(value * 100) / 100;
  const rows: Record<string, Record<string, number>> = {};
  for (const name of ['dispatch', 'keysoundStart', 'audible'] as const) {
    const stats = summary[name];
    if (stats === undefined) continue;
    rows[name] = {
      count: stats.count,
      median: round(stats.medianMs),
      p95: round(stats.p95Ms),
      p99: round(stats.p99Ms),
      max: round(stats.maxMs),
      stdev: round(stats.stdevMs),
    };
  }
  if (summary.baseLatencyMs !== undefined) rows.baseLatency = { median: round(summary.baseLatencyMs) };
  if (summary.outputLatencyMs !== undefined) rows.outputLatency = { median: round(summary.outputLatencyMs) };
  return rows;
}

/** Turns the probe on when `href` asks for it and installs its console API on `target`. */
export function installLatencyProbe(target: Window, href: string): LatencyProbeConsole | undefined {
  if (!isLatencyProbeRequested(href)) return undefined;
  let api: LatencyProbeConsole | undefined;
  const probe = enableLatencyProbe({
    onPlayEnd: (play) => {
      const summary = api?.summary(play);
      if (summary === undefined || summary.presses === 0) return;
      console.info(`[latency-probe] play ${play}: ${summary.presses} presses, ${summary.withKeysound} with a keysound`);
      console.table(latencyProbeSummaryTable(summary));
    },
  });
  api = createLatencyProbeConsole(probe, downloadBlob);
  target.beMusicLatencyProbe = api;
  console.info(
    '[latency-probe] on: play a chart, then beMusicLatencyProbe.summary() or beMusicLatencyProbe.download() in the console',
  );
  return api;
}

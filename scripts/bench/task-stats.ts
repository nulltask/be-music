import type { TaskResult } from 'tinybench';
import type { BenchmarkTaskStats } from './exports.types.ts';

type LegacyTaskResult = TaskResult & {
  mean?: number;
  p50?: number;
  p75?: number;
  p99?: number;
  min?: number;
  max?: number;
  hz?: number;
  rme?: number;
  samples?: number[];
  totalTime?: number;
  period?: number;
  latency?: {
    min?: number;
    max?: number;
    p50?: number;
    p75?: number;
    p99?: number;
    samplesCount?: number;
  };
  throughput?: {
    mean?: number;
    p50?: number;
    rme?: number;
    samplesCount?: number;
  };
};

export function resolveComparisonHz(stats: Pick<BenchmarkTaskStats, 'hz'> & { medianHz?: number }): number {
  if (Number.isFinite(stats.medianHz) && (stats.medianHz ?? 0) > 0) {
    return stats.medianHz ?? 0;
  }
  return Number.isFinite(stats.hz) && stats.hz > 0 ? stats.hz : 0;
}

/**
 * How long one timed sample should last when calls are batched: far above the timer's resolution (a fast function's
 * single call, tens of nanoseconds, is otherwise indistinguishable from timer noise; issue #202).
 */
export const TARGET_SAMPLE_MS = 0.05;
/** Upper bound on calls per sample, so a calibration fluke cannot make one sample run for long. */
export const MAX_ITERATIONS_PER_SAMPLE = 100_000;

/** Calls per sample for a function whose single call takes `singleCallMs`, so that a sample lasts `targetMs`. */
export function resolveIterationsPerSample(
  singleCallMs: number,
  targetMs: number = TARGET_SAMPLE_MS,
  maxIterations: number = MAX_ITERATIONS_PER_SAMPLE,
): number {
  if (!(singleCallMs > 0) || !Number.isFinite(singleCallMs)) {
    return maxIterations;
  }
  return Math.max(1, Math.min(maxIterations, Math.ceil(targetMs / singleCallMs)));
}

/** Per-sample stats of a batch of `iterations` calls, turned into per-call stats. */
export function scaleBatchedStats(stats: BenchmarkTaskStats, iterations: number): BenchmarkTaskStats {
  const perCall = (value: number) => value / iterations;
  return {
    ...stats,
    hz: stats.hz * iterations,
    medianHz: stats.medianHz * iterations,
    meanMs: perCall(stats.meanMs),
    p50Ms: perCall(stats.p50Ms),
    p75Ms: perCall(stats.p75Ms),
    p99Ms: perCall(stats.p99Ms),
    minMs: perCall(stats.minMs),
    maxMs: perCall(stats.maxMs),
    iterationsPerSample: iterations,
  };
}

/** How long one timed sample lasted: the per-call median times the calls batched into it. */
export function resolveSampleMs(stats: Pick<BenchmarkTaskStats, 'p50Ms' | 'iterationsPerSample'>): number {
  return stats.p50Ms * (stats.iterationsPerSample ?? 1);
}

export function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middleIndex = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middleIndex] ?? 0;
  }
  return ((sorted[middleIndex - 1] ?? 0) + (sorted[middleIndex] ?? 0)) / 2;
}

export function createSingleIterationStats(durationMs: number): BenchmarkTaskStats {
  const safeDurationMs = Math.max(0.000001, durationMs);
  const hz = 1000 / safeDurationMs;
  return {
    hz,
    medianHz: hz,
    meanMs: safeDurationMs,
    p50Ms: safeDurationMs,
    p75Ms: safeDurationMs,
    p99Ms: safeDurationMs,
    minMs: safeDurationMs,
    maxMs: safeDurationMs,
    rmePercent: 0,
    sampleCount: 1,
    totalTimeMs: safeDurationMs,
  };
}

export function convertTaskResult(result: TaskResult): BenchmarkTaskStats {
  const typedResult = result as LegacyTaskResult;
  const isV6 =
    typeof typedResult.period === 'number' ||
    typeof typedResult.throughput?.mean === 'number' ||
    typeof typedResult.latency?.samplesCount === 'number';
  if (isV6) {
    const periodMs = typedResult.period;
    const latency = typedResult.latency;
    const throughput = typedResult.throughput;
    // tinybench v6 exposes period/latency in milliseconds.
    const meanMs = finiteNumber(periodMs);
    const meanHz = finitePositive(throughput?.mean);
    const medianHz = finitePositive(throughput?.p50, meanHz);
    return {
      hz: meanHz,
      medianHz,
      meanMs,
      p50Ms: finitePositive(latency?.p50, meanMs),
      p75Ms: finiteNumber(latency?.p75, meanMs),
      p99Ms: finiteNumber(latency?.p99, meanMs),
      minMs: finiteNumber(latency?.min, meanMs),
      maxMs: finiteNumber(latency?.max, meanMs),
      rmePercent: finiteNumber(throughput?.rme),
      sampleCount:
        Number.isFinite(latency?.samplesCount) && (latency?.samplesCount ?? 0) > 0
          ? Math.floor(latency?.samplesCount ?? 0)
          : 0,
      totalTimeMs: finiteNumber(typedResult.totalTime),
    };
  }

  const samples = Array.isArray(typedResult.samples) ? typedResult.samples : [];
  const meanMs = finiteNumber(typedResult.mean);
  const meanHz = finitePositive(typedResult.hz);
  const p50Ms = finitePositive(typedResult.p50, samples.length > 0 ? median(samples) : meanMs);
  const medianHz = p50Ms > 0 ? 1000 / p50Ms : meanHz;
  return {
    hz: meanHz,
    medianHz,
    meanMs,
    p50Ms,
    p75Ms: finiteNumber(typedResult.p75, meanMs),
    p99Ms: finiteNumber(typedResult.p99, meanMs),
    minMs: finiteNumber(typedResult.min, meanMs),
    maxMs: finiteNumber(typedResult.max, meanMs),
    rmePercent: finiteNumber(typedResult.rme),
    sampleCount: samples.length,
    totalTimeMs: finiteNumber(typedResult.totalTime),
  };
}

function finiteNumber(value: number | undefined, fallback = Number.NaN): number {
  return Number.isFinite(value) ? (value ?? fallback) : fallback;
}

function finitePositive(value: number | undefined, fallback = 0): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? (value ?? fallback) : fallback;
}

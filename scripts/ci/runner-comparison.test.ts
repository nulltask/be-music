import { describe, expect, test } from 'vite-plus/test';
import { renderComparison, summarizeRuns, type RunnerMeasurement } from './runner-comparison.ts';

const run = (seconds: number, exitCode = 0) => ({ seconds, exitCode });
const measurement = (task: RunnerMeasurement['task'], architecture: string, seconds: number): RunnerMeasurement => ({
  commit: 'same-commit',
  runner: architecture === 'x64' ? 'ubuntu-24.04' : 'ubuntu-24.04-arm',
  architecture,
  task,
  nodeVersion: 'v26.7.0',
  cpuModel: 'Example CPU',
  cpuCount: 4,
  memoryBytes: 16 * 2 ** 30,
  installSeconds: 5,
  runs: [run(seconds), run(seconds * 2), run(seconds * 3)],
});

describe('runner comparison', () => {
  test('summarizes medians and ranges without changing recorded order', () => {
    const runs = [run(8), run(2), run(4)];
    expect(summarizeRuns(runs)).toEqual({ median: 4, min: 2, max: 8 });
    expect(runs[0]?.seconds).toBe(8);
    expect(summarizeRuns([run(2), run(4)])).toEqual({ median: 3, min: 2, max: 4 });
  });
  test('does not turn failed or missing measurements into speed improvements', () => {
    for (const runs of [[], [run(1, 1)], [run(NaN)], [run(Infinity)], [run(-1)], [run(0)]])
      expect(() => summarizeRuns(runs)).toThrow();
  });
  test('reports both tasks, first-run times, medians and architecture ratios', () => {
    const report = renderComparison([
      measurement('test', 'x64', 10),
      measurement('test', 'arm64', 5),
      measurement('benchmark', 'x64', 2),
      measurement('benchmark', 'arm64', 4),
    ]);
    expect(report).toContain('test: arm64/x64 median duration = 0.500');
    expect(report).toContain('benchmark: arm64/x64 median duration = 2.000');
    expect(report).toContain('| test | ubuntu-24.04 | x64 | 5.0 | 10.0 | 20.0 | 10.0–30.0 |');
    expect(report).toContain('4 logical CPUs, 16.0 GiB RAM');
    expect(report).toContain('not CPU architecture in isolation');
  });
  test('refuses unmatched commits, runtime versions or repetition counts', () => {
    const baseline = measurement('test', 'x64', 10);
    for (const change of [{ commit: 'other' }, { nodeVersion: 'v24.0.0' }, { runs: [run(1)] }])
      expect(() => renderComparison([baseline, { ...measurement('test', 'arm64', 5), ...change }])).toThrow();
  });
});

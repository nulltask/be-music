import { spawnSync } from 'node:child_process';
import { cpus, totalmem } from 'node:os';
import { mkdir, open, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface RunnerMeasurement {
  commit: string;
  runner: string;
  architecture: string;
  task: 'test' | 'benchmark';
  nodeVersion: string;
  cpuModel: string;
  cpuCount: number;
  memoryBytes: number;
  imageVersion?: string;
  installSeconds: number;
  runs: { seconds: number; exitCode: number }[];
}

export function summarizeRuns(runs: RunnerMeasurement['runs']) {
  if (!runs.length || runs.some((run) => run.exitCode !== 0 || !Number.isFinite(run.seconds) || run.seconds <= 0))
    throw new Error('Every measured run must complete successfully');
  const sorted = runs.map((run) => run.seconds).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    median: sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2,
    min: sorted[0]!,
    max: sorted.at(-1)!,
  };
}

export function renderComparison(results: RunnerMeasurement[]): string {
  const lines = [
    '# CI runner comparison',
    '',
    '| Task | Runner | Architecture | Install (s) | First run (s) | Median (s) | Range (s) |',
    '| --- | --- | --- | ---: | ---: | ---: | --- |',
  ];
  for (const result of results) {
    const stats = summarizeRuns(result.runs);
    lines.push(
      `| ${result.task} | ${result.runner} | ${result.architecture} | ${result.installSeconds.toFixed(1)} | ${result.runs[0]!.seconds.toFixed(1)} | ${stats.median.toFixed(1)} | ${stats.min.toFixed(1)}–${stats.max.toFixed(1)} |`,
    );
  }
  for (const task of ['test', 'benchmark']) {
    const pair = results.filter((result) => result.task === task);
    const x64 = pair.find((result) => result.architecture === 'x64');
    const arm64 = pair.find((result) => result.architecture === 'arm64');
    if (!x64 || !arm64) continue;
    if (x64.commit !== arm64.commit || x64.nodeVersion !== arm64.nodeVersion || x64.runs.length !== arm64.runs.length)
      throw new Error('Runner comparisons require the same commit, Node version and repetition count');
    const ratio = summarizeRuns(arm64.runs).median / summarizeRuns(x64.runs).median;
    lines.push('', `${task}: arm64/x64 median duration = ${ratio.toFixed(3)} (below 1 favors arm64).`);
  }
  lines.push('', '## Machines', '');
  for (const result of results)
    lines.push(
      `- ${result.runner} / ${result.task}: ${result.cpuModel}, ${result.cpuCount} logical CPUs, ${(result.memoryBytes / 2 ** 30).toFixed(1)} GiB RAM, Node ${result.nodeVersion}, image ${result.imageVersion ?? 'unknown'}, commit ${result.commit}.`,
    );
  lines.push(
    '',
    'Each task runs repeatedly on its own VM after one dependency install. The first run is shown separately; later runs may benefit from filesystem and tool caches. Installation caches are disabled. These results compare hosted runner configurations, not CPU architecture in isolation. Benchmark runs use the CI per-case settings (50 ms measurement, 25 ms warmup); production CI runs five alternating base/head pairs rather than the single-commit rounds measured here.',
    '',
  );
  return lines.join('\n');
}

async function timed(command: string, args: string[], path: string) {
  const log = await open(path, 'w');
  const start = performance.now();
  try {
    const child = spawnSync(command, args, { stdio: ['ignore', log.fd, log.fd], env: process.env });
    return { seconds: (performance.now() - start) / 1000, exitCode: child.status ?? 1 };
  } finally {
    await log.close();
  }
}

async function main() {
  const [mode, directory = 'tmp/runner-comparison'] = process.argv.slice(2);
  await mkdir(directory, { recursive: true });
  if (mode === 'install') {
    const result = await timed('vp', ['install'], resolve(directory, 'install.log'));
    await writeFile(resolve(directory, 'install.json'), JSON.stringify(result));
    if (result.exitCode) throw new Error('Dependency installation failed; inspect install.log');
    return;
  }
  if (mode === 'report') {
    const results: RunnerMeasurement[] = [];
    for (const file of await readdir(directory, { recursive: true }))
      if (file.endsWith('measurement.json'))
        results.push(JSON.parse(await readFile(resolve(directory, file), 'utf8')) as RunnerMeasurement);
    if (results.length !== 4) throw new Error('Expected successful results from both tasks on both runners');
    const report = renderComparison(
      results.sort((a, b) => a.task.localeCompare(b.task) || a.runner.localeCompare(b.runner)),
    );
    await writeFile(resolve(directory, 'comparison.md'), report);
    process.stdout.write(report);
    return;
  }
  const task = process.env.COMPARISON_TASK;
  if (mode !== 'measure' || (task !== 'test' && task !== 'benchmark'))
    throw new Error('Expected install, measure or report');
  const repeats = Number(process.env.COMPARISON_REPEATS ?? 3);
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 5) throw new Error('Repetitions must be between 1 and 5');
  const expected = process.env.COMPARISON_ARCHITECTURE;
  if (process.arch !== expected) throw new Error('Runner architecture does not match the matrix');
  const installed = JSON.parse(await readFile(resolve(directory, 'install.json'), 'utf8')) as {
    seconds: number;
    exitCode: number;
  };
  if (installed.exitCode !== 0) throw new Error('Dependency installation did not succeed');
  const result: RunnerMeasurement = {
    commit: process.env.GITHUB_SHA ?? 'local',
    runner: process.env.COMPARISON_RUNNER ?? 'local',
    architecture: process.arch,
    task,
    nodeVersion: process.version,
    cpuModel: cpus()[0]?.model ?? 'unknown',
    cpuCount: cpus().length,
    memoryBytes: totalmem(),
    imageVersion: process.env.ImageVersion,
    installSeconds: installed.seconds,
    runs: [],
  };
  for (let index = 1; index <= repeats; index++) {
    console.log(`Starting ${task} round ${index}/${repeats} on ${result.runner}`);
    const command = task === 'test' ? 'vp' : 'pnpm';
    const args =
      task === 'test'
        ? ['run', 'test']
        : [
            'run',
            'bench',
            '--output',
            resolve(directory, `benchmark-${index}.json`),
            '--time',
            '50',
            '--warmup-time',
            '25',
          ];
    const run = await timed(command, args, resolve(directory, `${task}-${index}.log`));
    result.runs.push(run);
    await writeFile(resolve(directory, 'measurement.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(`Finished in ${run.seconds.toFixed(1)} seconds (exit ${run.exitCode})`);
    if (run.exitCode) throw new Error('Measured command failed; inspect the uploaded log');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();

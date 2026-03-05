#!/usr/bin/env tsx

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Bench, type TaskResult } from 'tinybench';
import * as jsonApi from '@be-music/json';
import * as parserApi from '@be-music/parser';
import type { RenderResult } from '@be-music/audio-renderer';
import {
  PACKAGE_NAMES,
  type PackageName,
  type BenchFixtures,
  type BenchmarkCaseDefinition,
  type BenchmarkTaskStats,
  type ExportsBenchmarkCliOverrides,
  type ExportsBenchmarkSnapshot,
} from './exports.types.ts';
import { PACKAGE_DEFINITIONS, registerAllExportsBenchmarkCases } from './packages/index.ts';

interface CliDefaults {
  outputPath: string;
  timeMs: number;
  warmupTimeMs: number;
  packages: readonly PackageName[];
}

interface CliOptions {
  outputPath: string;
  timeMs: number;
  warmupTimeMs: number;
  packages: PackageName[];
  includeInteractive: boolean;
  filter?: string;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryDir = resolve(scriptDir, '../..');

const BENCH_BMS_TEXT = [
  '#TITLE Tinybench Benchmark',
  '#ARTIST be-music',
  '#BPM 130',
  '#BPM01 180',
  '#STOP01 96',
  '#WAV01 missing01.wav',
  '#WAV02 missing02.wav',
  '#WAVAA missingAA.wav',
  '#LNTYPE 1',
  '#LNOBJ AA',
  '#RANDOM 2',
  '#IF 1',
  '#00111:0100',
  '#ELSE',
  '#00111:0001',
  '#ENDIF',
  '#ENDRANDOM',
  '#00101:0102',
  '#00103:7F00',
  '#00108:0100',
  '#00109:0100',
  '#00111:0100',
  '#00131:0100',
  '#001D1:0100',
  '#00151:0101',
  '#00211:00AA',
  '',
].join('\n');

const BENCH_BMSON_TEXT = JSON.stringify(
  {
    version: '1.0.0',
    info: {
      title: 'Tinybench BMSON',
      artist: 'be-music',
      init_bpm: 130,
      mode_hint: 'beat-7k',
      resolution: 240,
      judge_rank: 100,
    },
    lines: [0, 960, 1920],
    bpm_events: [{ y: 480, bpm: 150 }],
    stop_events: [{ y: 960, duration: 96 }],
    sound_channels: [
      {
        name: 'missing01.wav',
        notes: [
          { x: 1, y: 0 },
          { x: 0, y: 240 },
          { x: 1, y: 480, l: 120 },
        ],
      },
      {
        name: 'missing02.wav',
        notes: [{ x: 2, y: 720 }],
      },
    ],
    bga: {
      bga_header: [{ id: 1, name: 'missing.bmp' }],
      bga_events: [{ y: 0, id: 1 }],
      layer_events: [],
      poor_events: [],
    },
  },
  null,
  2,
);

function createCliDefaults(overrides: ExportsBenchmarkCliOverrides = {}): CliDefaults {
  return {
    outputPath: overrides.defaultOutputPath ?? resolve(repositoryDir, 'tmp/bench/exports.json'),
    timeMs: 30,
    warmupTimeMs: 15,
    packages: [...(overrides.defaultPackages ?? PACKAGE_NAMES)],
  };
}

export async function runExportsBenchmark(options: CliOptions): Promise<ExportsBenchmarkSnapshot> {
  const fixtures = await createBenchFixtures();
  const benchmarkCases = createBenchmarkCases();

  const exportedFunctionsByPackage = collectExportedFunctionsByPackage(options.packages);
  const exportedKeys = flattenExportedKeys(exportedFunctionsByPackage);

  if (!options.filter) {
    validateCaseCoverage(exportedKeys, benchmarkCases, options.packages);
  }

  const skipped: Record<string, string> = {};
  const results: Record<string, BenchmarkTaskStats> = {};
  let filteredOutCount = 0;

  for (const packageName of options.packages) {
    const exports = exportedFunctionsByPackage[packageName];
    for (const exportName of exports) {
      const key = `${packageName}.${exportName}`;
      if (!isFilterMatch(key, options.filter)) {
        filteredOutCount += 1;
        continue;
      }

      const benchmarkCase = benchmarkCases.get(key);
      if (!benchmarkCase) {
        throw new Error(`Missing benchmark case: ${key}`);
      }

      if (benchmarkCase.interactive && !options.includeInteractive) {
        skipped[key] = 'Interactive function is skipped by default. Pass --include-interactive to benchmark it.';
        continue;
      }

      process.stdout.write(`[bench] ${key}\n`);
      const taskStats = await runBenchmarkCase(key, benchmarkCase, fixtures, options);
      results[key] = taskStats;
    }
  }

  const snapshot: ExportsBenchmarkSnapshot = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    gitSha: process.env.GITHUB_SHA,
    nodeVersion: process.version,
    platform: process.platform,
    options: {
      timeMs: options.timeMs,
      warmupTimeMs: options.warmupTimeMs,
      packages: [...options.packages],
      includeInteractive: options.includeInteractive,
      filter: options.filter,
    },
    exports: exportedFunctionsByPackage,
    totals: {
      exported: exportedKeys.length,
      benchmarked: Object.keys(results).length,
      skipped: Object.keys(skipped).length,
      filteredOut: filteredOutCount,
    },
    skipped,
    results,
  };

  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

  printSummary(snapshot, options.outputPath);
  return snapshot;
}

export async function runExportsBenchmarkCli(
  args: readonly string[] = process.argv.slice(2),
  overrides: ExportsBenchmarkCliOverrides = {},
): Promise<ExportsBenchmarkSnapshot> {
  const options = parseArgs([...args], createCliDefaults(overrides));
  return runExportsBenchmark(options);
}

async function main(): Promise<void> {
  await runExportsBenchmarkCli();
}

function createBenchmarkCases(): Map<string, BenchmarkCaseDefinition> {
  const cases = new Map<string, BenchmarkCaseDefinition>();
  const define = (key: string, value: BenchmarkCaseDefinition): void => {
    if (cases.has(key)) {
      throw new Error(`Duplicated benchmark case: ${key}`);
    }
    cases.set(key, value);
  };

  registerAllExportsBenchmarkCases(define);

  return cases;
}

async function runBenchmarkCase(
  key: string,
  benchmarkCase: BenchmarkCaseDefinition,
  fixtures: BenchFixtures,
  options: CliOptions,
): Promise<BenchmarkTaskStats> {
  const bench = new Bench({
    time: benchmarkCase.timeMs ?? options.timeMs,
    warmupTime: benchmarkCase.warmupTimeMs ?? options.warmupTimeMs,
  });

  bench.add(key, () => benchmarkCase.run(fixtures));
  if ((benchmarkCase.warmupTimeMs ?? options.warmupTimeMs) > 0) {
    const maybeWarmup = (bench as { warmup?: () => Promise<void> }).warmup;
    if (typeof maybeWarmup === 'function') {
      await maybeWarmup.call(bench);
    }
  }
  await bench.run();

  const result = bench.tasks[0]?.result;
  if (!result) {
    throw new Error(`Benchmark result is unavailable: ${key}`);
  }
  const converted = convertTaskResult(result);
  if (converted.hz > 0 && converted.sampleCount > 0 && Number.isFinite(converted.meanMs)) {
    return converted;
  }
  return runSingleIterationFallback(benchmarkCase, fixtures);
}

function convertTaskResult(result: TaskResult): BenchmarkTaskStats {
  const typedResult = result as TaskResult & {
    mean?: number;
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
      p75?: number;
      p99?: number;
      samplesCount?: number;
    };
    throughput?: {
      mean?: number;
      rme?: number;
      samplesCount?: number;
    };
  };
  const isV6 =
    typeof typedResult.period === 'number' ||
    typeof typedResult.throughput?.mean === 'number' ||
    typeof typedResult.latency?.samplesCount === 'number';
  if (isV6) {
    const periodSeconds = typedResult.period;
    const latency = typedResult.latency;
    const throughput = typedResult.throughput;
    // tinybench v6 exposes period/latency in milliseconds.
    const meanMs = Number.isFinite(periodSeconds) ? periodSeconds : Number.NaN;
    const p75Ms = Number.isFinite(latency?.p75) ? latency?.p75 ?? meanMs : meanMs;
    const p99Ms = Number.isFinite(latency?.p99) ? latency?.p99 ?? meanMs : meanMs;
    const minMs = Number.isFinite(latency?.min) ? latency?.min ?? meanMs : meanMs;
    const maxMs = Number.isFinite(latency?.max) ? latency?.max ?? meanMs : meanMs;
    return {
      hz: Number.isFinite(throughput?.mean) ? throughput?.mean ?? 0 : 0,
      meanMs,
      p75Ms,
      p99Ms,
      minMs,
      maxMs,
      rmePercent: Number.isFinite(throughput?.rme) ? throughput?.rme ?? 0 : 0,
      sampleCount:
        Number.isFinite(latency?.samplesCount) && (latency?.samplesCount ?? 0) > 0
          ? Math.floor(latency?.samplesCount ?? 0)
          : 0,
      totalTimeMs: Number.isFinite(typedResult.totalTime) ? typedResult.totalTime ?? 0 : 0,
    };
  }

  const samples = Array.isArray(typedResult.samples) ? typedResult.samples : [];
  const meanMs = Number.isFinite(typedResult.mean) ? typedResult.mean ?? Number.NaN : Number.NaN;
  return {
    hz: Number.isFinite(typedResult.hz) ? typedResult.hz ?? 0 : 0,
    meanMs,
    p75Ms: Number.isFinite(typedResult.p75) ? typedResult.p75 ?? meanMs : meanMs,
    p99Ms: Number.isFinite(typedResult.p99) ? typedResult.p99 ?? meanMs : meanMs,
    minMs: Number.isFinite(typedResult.min) ? typedResult.min ?? meanMs : meanMs,
    maxMs: Number.isFinite(typedResult.max) ? typedResult.max ?? meanMs : meanMs,
    rmePercent: Number.isFinite(typedResult.rme) ? typedResult.rme ?? 0 : 0,
    sampleCount: samples.length,
    totalTimeMs: Number.isFinite(typedResult.totalTime) ? typedResult.totalTime ?? 0 : 0,
  };
}

async function runSingleIterationFallback(
  benchmarkCase: BenchmarkCaseDefinition,
  fixtures: BenchFixtures,
): Promise<BenchmarkTaskStats> {
  const startedAt = performance.now();
  await benchmarkCase.run(fixtures);
  const durationMs = Math.max(0.000001, performance.now() - startedAt);
  return {
    hz: 1000 / durationMs,
    meanMs: durationMs,
    p75Ms: durationMs,
    p99Ms: durationMs,
    minMs: durationMs,
    maxMs: durationMs,
    rmePercent: 0,
    sampleCount: 1,
    totalTimeMs: durationMs,
  };
}

async function createBenchFixtures(): Promise<BenchFixtures> {
  const tmpDir = resolve(repositoryDir, 'tmp/bench/exports-runtime');
  await rm(tmpDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true });

  const bmsPath = resolve(tmpDir, 'bench.bms');
  const bmsonPath = resolve(tmpDir, 'bench.bmson');
  const jsonPath = resolve(tmpDir, 'bench.json');
  const editorSavePath = resolve(tmpDir, 'editor-saved.json');
  const editorExportBmsPath = resolve(tmpDir, 'editor-export.bms');
  const editorExportBmsonPath = resolve(tmpDir, 'editor-export.bmson');
  const audioOutputPath = resolve(tmpDir, 'rendered-audio.wav');
  const renderOutputPath = resolve(tmpDir, 'rendered-chart.wav');

  const sampleBmsJson = parserApi.parseBms(BENCH_BMS_TEXT);
  const sampleBmsonJson = parserApi.parseBmson(BENCH_BMSON_TEXT);
  const jsonText = JSON.stringify(sampleBmsJson, null, 2);
  const sampleJsonIr = parserApi.parseChart(jsonText, 'json');
  const controlFlowJson = parserApi.parseBms(BENCH_BMS_TEXT);
  const emptyBmsJson = jsonApi.createEmptyJson('bms');

  await writeFile(bmsPath, BENCH_BMS_TEXT, 'utf8');
  await writeFile(bmsonPath, BENCH_BMSON_TEXT, 'utf8');
  await writeFile(jsonPath, `${jsonText}\n`, 'utf8');

  if (sampleBmsJson.events.length < 2) {
    throw new Error('Benchmark fixture must contain at least two events.');
  }
  const [eventA, eventB] = sampleBmsJson.events;

  const fractionItems = Array.from({ length: 512 }, (_value, index) => ({ value: index * 2 }));

  const sampleRenderResult = createRenderResult([0, 0.2, -0.2, 0.1], [0, -0.1, 0.1, -0.05], 44_100);
  const playableRenderResult = createRenderResult([0.7, 0.2, 0], [0.68, 0.2, 0], 44_100);
  const bgmRenderResult = createRenderResult([0.6, 0.2, 0], [0.6, 0.1, 0], 44_100);

  return {
    tmpDir,
    bmsText: BENCH_BMS_TEXT,
    bmsonText: BENCH_BMSON_TEXT,
    jsonText,
    bmsBuffer: Buffer.from(BENCH_BMS_TEXT, 'utf8'),
    sampleBmsJson,
    sampleBmsonJson,
    sampleJsonIr,
    controlFlowJson,
    emptyBmsJson,
    eventA,
    eventB,
    fractionItems,
    randomPatterns: [
      { index: 1, current: 2, total: 4 },
      { index: 2, current: 1, total: 3 },
    ],
    sampleRenderResult,
    playableRenderResult,
    bgmRenderResult,
    paths: {
      bmsPath,
      bmsonPath,
      jsonPath,
      editorSavePath,
      editorExportBmsPath,
      editorExportBmsonPath,
      audioOutputPath,
      renderOutputPath,
    },
  };
}

function createRenderResult(leftValues: number[], rightValues: number[], sampleRate: number): RenderResult {
  const left = Float32Array.from(leftValues);
  const right = Float32Array.from(rightValues);
  let peak = 0;
  for (let index = 0; index < left.length; index += 1) {
    peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index] ?? 0));
  }
  return {
    sampleRate,
    left,
    right,
    durationSeconds: left.length / sampleRate,
    peak,
  };
}

function collectExportedFunctionsByPackage(selectedPackages: readonly PackageName[]): Record<PackageName, string[]> {
  const output = {} as Record<PackageName, string[]>;
  for (const packageName of selectedPackages) {
    const entries = Object.entries(PACKAGE_DEFINITIONS[packageName].module)
      .filter(([, value]) => typeof value === 'function')
      .map(([key]) => key)
      .sort((left, right) => left.localeCompare(right));
    output[packageName] = entries;
  }
  return output;
}

function flattenExportedKeys(exportsByPackage: Record<PackageName, string[]>): string[] {
  const keys: string[] = [];
  for (const packageName of Object.keys(exportsByPackage) as PackageName[]) {
    for (const exportName of exportsByPackage[packageName]) {
      keys.push(`${packageName}.${exportName}`);
    }
  }
  return keys;
}

function validateCaseCoverage(
  exportedKeys: string[],
  cases: Map<string, BenchmarkCaseDefinition>,
  selectedPackages: readonly PackageName[],
): void {
  const selectedPrefixSet = new Set(selectedPackages.map((packageName) => `${packageName}.`));
  const missingCases = exportedKeys.filter((key) => !cases.has(key));
  const staleCases = [...cases.keys()].filter(
    (key) =>
      !exportedKeys.includes(key) &&
      [...selectedPrefixSet].some((prefix) => key.startsWith(prefix)),
  );

  if (missingCases.length === 0 && staleCases.length === 0) {
    return;
  }

  const lines: string[] = [];
  if (missingCases.length > 0) {
    lines.push('Missing benchmark cases:');
    for (const key of missingCases) {
      lines.push(`  - ${key}`);
    }
  }
  if (staleCases.length > 0) {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push('Stale benchmark cases (no longer exported):');
    for (const key of staleCases) {
      lines.push(`  - ${key}`);
    }
  }

  throw new Error(lines.join('\n'));
}

function isFilterMatch(key: string, filter: string | undefined): boolean {
  if (!filter || filter.length === 0) {
    return true;
  }
  return key.toLowerCase().includes(filter.toLowerCase());
}

function parseArgs(args: string[], defaults: CliDefaults): CliOptions {
  const options: CliOptions = {
    outputPath: defaults.outputPath,
    timeMs: defaults.timeMs,
    warmupTimeMs: defaults.warmupTimeMs,
    packages: [...defaults.packages],
    includeInteractive: false,
    filter: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--help' || token === '-h') {
      printUsage(defaults);
      process.exit(0);
    }

    if (token === '--output') {
      options.outputPath = resolveValue(args[index + 1], '--output');
      index += 1;
      continue;
    }

    if (token === '--time') {
      options.timeMs = parsePositiveNumber(args[index + 1], '--time');
      index += 1;
      continue;
    }

    if (token === '--warmup-time') {
      options.warmupTimeMs = parseNonNegativeNumber(args[index + 1], '--warmup-time');
      index += 1;
      continue;
    }

    if (token === '--packages') {
      options.packages = parsePackageNames(resolveValue(args[index + 1], '--packages'));
      index += 1;
      continue;
    }

    if (token === '--include-interactive') {
      options.includeInteractive = true;
      continue;
    }

    if (token === '--filter') {
      options.filter = resolveValue(args[index + 1], '--filter');
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${token}`);
  }

  return options;
}

function printUsage(defaults: CliDefaults): void {
  const lines = [
    'Usage: pnpm run bench [options]',
    '',
    'Essential options:',
    `  --output <path>          Output snapshot path (default: ${defaults.outputPath})`,
    `  --time <ms>             tinybench time per case in ms (default: ${defaults.timeMs})`,
    `  --warmup-time <ms>      tinybench warmup time per case in ms (default: ${defaults.warmupTimeMs})`,
    `  --packages <list>       Comma-separated package names (default: ${defaults.packages.join(',')})`,
    '',
    'Advanced options:',
    '  --filter <text>         Run only matching <package>.<export> keys',
    '  --include-interactive   Include interactive APIs (player.autoPlay/manualPlay)',
    '',
    'Developer options:',
    '  -h, --help              Show this help',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

function resolveValue(value: string | undefined, optionName: string): string {
  if (!value) {
    throw new Error(`Missing value for ${optionName}`);
  }
  return value;
}

function parsePositiveNumber(value: string | undefined, optionName: string): number {
  const parsed = Number.parseFloat(resolveValue(value, optionName));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive number`);
  }
  return parsed;
}

function parseNonNegativeNumber(value: string | undefined, optionName: string): number {
  const parsed = Number.parseFloat(resolveValue(value, optionName));
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${optionName} must be a non-negative number`);
  }
  return parsed;
}

function parsePackageNames(value: string): PackageName[] {
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) {
    throw new Error('--packages must include at least one package name');
  }
  const normalized: PackageName[] = [];
  for (const entry of entries) {
    if (!PACKAGE_NAMES.includes(entry as PackageName)) {
      throw new Error(`Unknown package in --packages: ${entry}`);
    }
    const packageName = entry as PackageName;
    if (!normalized.includes(packageName)) {
      normalized.push(packageName);
    }
  }
  return normalized;
}

function printSummary(snapshot: ExportsBenchmarkSnapshot, outputPath: string): void {
  const benchmarkedKeys = Object.keys(snapshot.results).sort((left, right) => left.localeCompare(right));
  process.stdout.write('\nExports benchmark summary\n');
  process.stdout.write(`Output      : ${outputPath}\n`);
  process.stdout.write(`Packages    : ${snapshot.options.packages.join(', ')}\n`);
  process.stdout.write(`Exported    : ${snapshot.totals.exported}\n`);
  process.stdout.write(`Benchmarked : ${snapshot.totals.benchmarked}\n`);
  process.stdout.write(`Skipped     : ${snapshot.totals.skipped}\n`);
  process.stdout.write(`Filtered out: ${snapshot.totals.filteredOut}\n`);

  if (benchmarkedKeys.length > 0) {
    const topSlow = benchmarkedKeys
      .map((key) => ({ key, hz: snapshot.results[key].hz }))
      .sort((left, right) => left.hz - right.hz)
      .slice(0, 5);

    process.stdout.write('\nSlowest 5 (ops/s)\n');
    for (const row of topSlow) {
      process.stdout.write(`  ${row.key.padEnd(48)} ${row.hz.toFixed(2)}\n`);
    }
  }

  const skippedKeys = Object.keys(snapshot.skipped).sort((left, right) => left.localeCompare(right));
  if (skippedKeys.length > 0) {
    process.stdout.write('\nSkipped cases\n');
    for (const key of skippedKeys) {
      process.stdout.write(`  ${key}: ${snapshot.skipped[key]}\n`);
    }
  }
}

function isExecutedAsScript(): boolean {
  const entryPath = process.argv[1];
  if (!entryPath) {
    return false;
  }
  return import.meta.url === pathToFileURL(entryPath).href;
}

if (isExecutedAsScript()) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}

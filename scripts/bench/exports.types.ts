import type { RenderResult } from '@be-music/chart-audio-renderer';
import type { BeMusicEvent, BeMusicJSON } from '@be-music/chart-source';

export const PACKAGE_NAMES = [
  'shared-utils',
  'chart-source',
  'chart-model',
  'chart-parser',
  'chart-writer',
  'chart-editor',
  'chart-audio-renderer',
  'player-engine',
  'player-scene-model',
  'player-terminal',
  'skin-lr2',
  'skin-beatoraja',
  'player-skin-sdk',
  'player-browser',
] as const;

export type PackageName = (typeof PACKAGE_NAMES)[number];

export interface ExportsBenchmarkCLIOverrides {
  defaultOutputPath?: string;
  defaultPackages?: readonly PackageName[];
}

export interface BenchmarkTaskStats {
  hz: number;
  medianHz: number;
  meanMs: number;
  p50Ms: number;
  p75Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
  rmePercent: number;
  sampleCount: number;
  totalTimeMs: number;
  /**
   * Calls batched into one timed sample (the figures above are per call). Fast functions run many times per sample so
   * a sample lasts well past the timer's resolution; absent in snapshots from before batching, which means 1.
   */
  iterationsPerSample?: number;
  /** Median ops/s of each run an aggregated snapshot was made from, to show how much the runs disagree. */
  runMedianHz?: number[];
}

export interface ExportsBenchmarkSnapshot {
  schemaVersion: 1;
  createdAt: string;
  gitSha?: string;
  nodeVersion: string;
  platform: string;
  aggregation?: {
    strategy: 'median';
    runCount: number;
  };
  options: {
    timeMs: number;
    warmupTimeMs: number;
    packages: PackageName[];
    includeInteractive: boolean;
    filter?: string;
  };
  exports: Record<PackageName, string[]>;
  totals: {
    exported: number;
    benchmarked: number;
    skipped: number;
    filteredOut: number;
  };
  skipped: Record<string, string>;
  /** Keys of the cases marked `ioBound`; absent in snapshots from before the mark. */
  ioBound?: string[];
  results: Record<string, BenchmarkTaskStats>;
}

export interface BenchmarkCaseDefinition {
  run: (fixtures: BenchFixtures) => void | Promise<void>;
  interactive?: boolean;
  /**
   * The case touches the filesystem (or spawns processes): its time follows the OS cache and the disk more than the
   * code, so reports list it apart and never call its change a regression or an improvement.
   */
  ioBound?: boolean;
  timeMs?: number;
  warmupTimeMs?: number;
}

export type DefineBenchmarkCase = (key: string, value: BenchmarkCaseDefinition) => void;

export interface BenchmarkPackageDefinition {
  module: Record<string, unknown>;
  registerCases: (define: DefineBenchmarkCase) => void;
}

export interface BenchFixtures {
  tmpDir: string;
  bmsText: string;
  bmsonText: string;
  jsonText: string;
  bmsBuffer: Buffer;
  sampleBmsJSON: BeMusicJSON;
  sampleBmsonJSON: BeMusicJSON;
  sampleJsonIR: BeMusicJSON;
  controlFlowJSON: BeMusicJSON;
  emptyBmsJSON: BeMusicJSON;
  eventA: BeMusicEvent;
  eventB: BeMusicEvent;
  fractionItems: ReadonlyArray<{ value: number }>;
  fractionValues: ReadonlyArray<number>;
  sampleRenderResult: RenderResult;
  paths: {
    bmsPath: string;
    bmsonPath: string;
    jsonPath: string;
    editorSavePath: string;
    editorExportBMSPath: string;
    editorExportBmsonPath: string;
    audioOutputPath: string;
    renderOutputPath: string;
  };
}

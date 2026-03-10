import {
  PACKAGE_NAMES,
  type BenchmarkPackageDefinition,
  type DefineBenchmarkCase,
  type PackageName,
} from '../exports.types.ts';
import { audioRendererBenchmarkPackage } from './audio-renderer.ts';
import { chartBenchmarkPackage } from './chart.ts';
import { editorBenchmarkPackage } from './editor.ts';
import { jsonBenchmarkPackage } from './json.ts';
import { parserBenchmarkPackage } from './parser.ts';
import { playerBenchmarkPackage } from './player.ts';
import { stringifierBenchmarkPackage } from './stringifier.ts';
import { utilsBenchmarkPackage } from './utils.ts';

export const PACKAGE_DEFINITIONS: Record<PackageName, BenchmarkPackageDefinition> = {
  utils: utilsBenchmarkPackage,
  json: jsonBenchmarkPackage,
  chart: chartBenchmarkPackage,
  parser: parserBenchmarkPackage,
  stringifier: stringifierBenchmarkPackage,
  editor: editorBenchmarkPackage,
  'audio-renderer': audioRendererBenchmarkPackage,
  player: playerBenchmarkPackage,
};

export function registerAllExportsBenchmarkCases(define: DefineBenchmarkCase): void {
  for (const packageName of PACKAGE_NAMES) {
    PACKAGE_DEFINITIONS[packageName].registerCases(define);
  }
}

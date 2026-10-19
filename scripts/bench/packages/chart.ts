import * as chartAPI from '@be-music/chart';
import { registerChartExportsCases } from '../../../packages/chart/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const chartBenchmarkPackage: BenchmarkPackageDefinition = {
  module: chartAPI as Record<string, unknown>,
  registerCases: registerChartExportsCases,
};

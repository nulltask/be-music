import * as chartAPI from '@be-music/chart-model';
import { registerChartExportsCases } from '../../../packages/chart-model/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const chartBenchmarkPackage: BenchmarkPackageDefinition = {
  module: chartAPI as Record<string, unknown>,
  registerCases: registerChartExportsCases,
};

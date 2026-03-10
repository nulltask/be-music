import * as chartApi from '@be-music/chart';
import { registerChartExportsCases } from '../../../packages/chart/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const chartBenchmarkPackage: BenchmarkPackageDefinition = {
  module: chartApi as Record<string, unknown>,
  registerCases: registerChartExportsCases,
};

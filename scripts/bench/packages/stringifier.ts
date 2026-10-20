import * as stringifierAPI from '@be-music/chart-writer';
import { registerStringifierExportsCases } from '../../../packages/chart-writer/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const stringifierBenchmarkPackage: BenchmarkPackageDefinition = {
  module: stringifierAPI as Record<string, unknown>,
  registerCases: registerStringifierExportsCases,
};

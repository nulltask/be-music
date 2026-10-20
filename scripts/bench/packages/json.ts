import * as jsonAPI from '@be-music/chart-source';
import { registerJSONExportsCases } from '../../../packages/chart-source/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const jsonBenchmarkPackage: BenchmarkPackageDefinition = {
  module: jsonAPI as Record<string, unknown>,
  registerCases: registerJSONExportsCases,
};

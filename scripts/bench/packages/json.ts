import * as jsonApi from '@be-music/json';
import { registerJsonExportsCases } from '../../../packages/json/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const jsonBenchmarkPackage: BenchmarkPackageDefinition = {
  module: jsonApi as Record<string, unknown>,
  registerCases: registerJsonExportsCases,
};

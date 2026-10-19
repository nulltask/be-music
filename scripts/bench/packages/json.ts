import * as jsonAPI from '@be-music/json';
import { registerJSONExportsCases } from '../../../packages/json/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const jsonBenchmarkPackage: BenchmarkPackageDefinition = {
  module: jsonAPI as Record<string, unknown>,
  registerCases: registerJSONExportsCases,
};

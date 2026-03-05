import * as stringifierApi from '@be-music/stringifier';
import { registerStringifierExportsCases } from '../../../packages/stringifier/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const stringifierBenchmarkPackage: BenchmarkPackageDefinition = {
  module: stringifierApi as Record<string, unknown>,
  registerCases: registerStringifierExportsCases,
};

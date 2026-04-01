import * as utilsApi from '@be-music/utils';
import { registerUtilsExportsCases } from '../../../packages/utils/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const utilsBenchmarkPackage: BenchmarkPackageDefinition = {
  module: utilsApi as Record<string, unknown>,
  registerCases: registerUtilsExportsCases,
};

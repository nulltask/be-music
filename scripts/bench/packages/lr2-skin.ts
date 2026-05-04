import * as lr2SkinApi from '@be-music/lr2-skin';
import { registerLr2SkinExportsCases } from '../../../packages/lr2-skin/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const lr2SkinBenchmarkPackage: BenchmarkPackageDefinition = {
  module: lr2SkinApi as Record<string, unknown>,
  registerCases: registerLr2SkinExportsCases,
};

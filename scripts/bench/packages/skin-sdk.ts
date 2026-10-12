import * as skinSdkApi from '@be-music/skin-sdk';
import { registerSkinSdkExportsCases } from '../../../packages/skin-sdk/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const skinSdkBenchmarkPackage: BenchmarkPackageDefinition = {
  module: skinSdkApi as Record<string, unknown>,
  registerCases: registerSkinSdkExportsCases,
};

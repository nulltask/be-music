import * as skinSdkAPI from '@be-music/player-skin-sdk';
import { registerSkinSDKExportsCases } from '../../../packages/player-skin-sdk/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const skinSDKBenchmarkPackage: BenchmarkPackageDefinition = {
  module: skinSdkAPI as Record<string, unknown>,
  registerCases: registerSkinSDKExportsCases,
};

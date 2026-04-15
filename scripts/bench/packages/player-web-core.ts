import * as playerWebCoreApi from '@be-music/player-web-core';
import { registerPlayerWebCoreExportsCases } from '../../../packages/player-web-core/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const playerWebCoreBenchmarkPackage: BenchmarkPackageDefinition = {
  module: playerWebCoreApi as Record<string, unknown>,
  registerCases: registerPlayerWebCoreExportsCases,
};

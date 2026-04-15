import * as playerReactApi from '@be-music/player-react';
import { registerPlayerReactExportsCases } from '../../../packages/player-react/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const playerReactBenchmarkPackage: BenchmarkPackageDefinition = {
  module: playerReactApi as Record<string, unknown>,
  registerCases: registerPlayerReactExportsCases,
};

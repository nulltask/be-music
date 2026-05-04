import * as playerTuiApi from '@be-music/player-tui';
import { registerPlayerTuiExportsCases } from '../../../packages/player-tui/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const playerTuiBenchmarkPackage: BenchmarkPackageDefinition = {
  module: playerTuiApi as Record<string, unknown>,
  registerCases: registerPlayerTuiExportsCases,
};

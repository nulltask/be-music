import * as parserApi from '@be-music/parser';
import { registerParserExportsCases } from '../../../packages/parser/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const parserBenchmarkPackage: BenchmarkPackageDefinition = {
  module: parserApi as Record<string, unknown>,
  registerCases: registerParserExportsCases,
};

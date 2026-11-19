import * as parserAPI from '@be-music/chart-parser';
import * as parserCoreAPI from '@be-music/chart-parser/core';
import { registerParserExportsCases } from '../../../packages/chart-parser/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const parserBenchmarkPackage: BenchmarkPackageDefinition = {
  module: {
    ...parserAPI,
    ...Object.fromEntries(Object.entries(parserCoreAPI).map(([name, value]) => [`core.${name}`, value])),
  },
  registerCases: registerParserExportsCases,
};

import * as pngAPI from '@be-music/shared-utils/png';
import * as hashAPI from '@be-music/shared-utils/hash';
import * as asyncAPI from '@be-music/shared-utils/async';
import * as cliAPI from '@be-music/shared-utils/cli';
import * as utilsAPI from '@be-music/shared-utils';
import * as optionalNodeModuleAPI from '@be-music/shared-utils/optional-node-module';
import * as workerizeAPI from '@be-music/shared-utils/workerize';
import { registerUtilsExportsCases } from '../../../packages/shared-utils/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const utilsBenchmarkPackage: BenchmarkPackageDefinition = {
  module: {
    ...Object.fromEntries(Object.entries(pngAPI).map(([name, value]) => [`png.${name}`, value])),
    ...(utilsAPI as Record<string, unknown>),
    ...Object.fromEntries(Object.entries(hashAPI).map(([name, value]) => [`hash.${name}`, value])),
    ...Object.fromEntries(Object.entries(asyncAPI).map(([name, value]) => [`async.${name}`, value])),
    ...Object.fromEntries(Object.entries(cliAPI).map(([name, value]) => [`cli.${name}`, value])),
    // The Node-only subpaths the root leaves out, as `<subpath>.<name>`.
    ...Object.fromEntries(
      Object.entries(optionalNodeModuleAPI).map(([name, value]) => [`optional-node-module.${name}`, value]),
    ),
    ...Object.fromEntries(Object.entries(workerizeAPI).map(([name, value]) => [`workerize.${name}`, value])),
  },
  registerCases: registerUtilsExportsCases,
};

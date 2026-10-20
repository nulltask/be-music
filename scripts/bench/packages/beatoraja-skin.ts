import * as beatorajaSkinAPI from '@be-music/skin-beatoraja';
import * as sceneAPI from '@be-music/skin-beatoraja/scene';
import { registerBeatorajaSkinExportsCases } from '../../../packages/skin-beatoraja/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const beatorajaSkinBenchmarkPackage: BenchmarkPackageDefinition = {
  module: {
    // The skin parser, the element helpers and the theme loader of the main entry.
    ...(beatorajaSkinAPI as Record<string, unknown>),
    // Every `@be-music/skin-beatoraja/scene` export, as `scene.<name>`: a new resolver needs a case, a removed one drops it.
    ...Object.fromEntries(Object.entries(sceneAPI).map(([name, value]) => [`scene.${name}`, value])),
  },
  registerCases: registerBeatorajaSkinExportsCases,
};

import * as playerApi from '@be-music/player';
import * as audioSinkApi from '@be-music/player/audio-sink';
import * as courseApi from '@be-music/player/course';
import * as displayApi from '@be-music/player/display';
import * as lanesApi from '@be-music/player/lanes';
import * as playlogApi from '@be-music/player/playlog';
import * as recordsApi from '@be-music/player/records';
import * as rulesetApi from '@be-music/player/ruleset';
import * as signalsApi from '@be-music/player/signals';
import { registerPlayerExportsCases } from '../../../packages/player/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

/** Every export of `entry`, keyed `<prefix>.<name>`: a new export needs a case, and a removed one drops its case. */
function prefixed(prefix: string, entry: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(entry).map(([name, value]) => [`${prefix}.${name}`, value]));
}

export const playerBenchmarkPackage: BenchmarkPackageDefinition = {
  module: {
    ...(playerApi as Record<string, unknown>),
    ...prefixed('signals', signalsApi),
    ...prefixed('lanes', lanesApi),
    ...prefixed('display', displayApi),
    ...prefixed('audio-sink', audioSinkApi),
    ...prefixed('course', courseApi),
    ...prefixed('records', recordsApi),
    ...prefixed('ruleset', rulesetApi),
    ...prefixed('playlog', playlogApi),
  },
  registerCases: registerPlayerExportsCases,
};

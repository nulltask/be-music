import * as playerAPI from '@be-music/player';
import * as audioSinkAPI from '@be-music/player/audio-sink';
import * as courseAPI from '@be-music/player/course';
import * as displayAPI from '@be-music/player/display';
import * as lanesAPI from '@be-music/player/lanes';
import * as replayAPI from '@be-music/player/replay';
import * as recordsAPI from '@be-music/player/records';
import * as rulesetAPI from '@be-music/player/ruleset';
import * as signalsAPI from '@be-music/player/signals';
import { registerPlayerExportsCases } from '../../../packages/player/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

/** Every export of `entry`, keyed `<prefix>.<name>`: a new export needs a case, and a removed one drops its case. */
function prefixed(prefix: string, entry: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(entry).map(([name, value]) => [`${prefix}.${name}`, value]));
}

export const playerBenchmarkPackage: BenchmarkPackageDefinition = {
  module: {
    ...(playerAPI as Record<string, unknown>),
    ...prefixed('signals', signalsAPI),
    ...prefixed('lanes', lanesAPI),
    ...prefixed('display', displayAPI),
    ...prefixed('audio-sink', audioSinkAPI),
    ...prefixed('course', courseAPI),
    ...prefixed('records', recordsAPI),
    ...prefixed('ruleset', rulesetAPI),
    ...prefixed('replay', replayAPI),
  },
  registerCases: registerPlayerExportsCases,
};

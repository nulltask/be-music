import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPackageTsdownConfig } from '../../tsdown.package.config.mts';

const packageDir = dirname(fileURLToPath(import.meta.url));

export default createPackageTsdownConfig({
  packageDir,
  entries: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
    'bga-video-worker': 'src/bga-video-worker.ts',
    'playable-notes': 'src/playable-notes.ts',
    'core/groove-gauge': 'src/core/groove-gauge.ts',
    'core/judge-window': 'src/core/judge-window.ts',
    'core/scoring': 'src/core/scoring.ts',
    'core/scroll-distance': 'src/core/scroll-distance.ts',
    'core/timeline': 'src/core/timeline.ts',
    'node-gameplay-worker': 'src/node/node-gameplay-worker.ts',
    'node-ui-worker': 'src/node/node-ui-worker.ts',
  },
});

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPackageTsdownConfig } from '../../tsdown.package.config.mts';

const packageDir = dirname(fileURLToPath(import.meta.url));

export default createPackageTsdownConfig({
  packageDir,
  entries: {
    index: 'src/index.ts',
    'audio-sink': 'src/audio-sink.ts',
    'image-resize-algorithm': 'src/image-resize-algorithm.ts',
    'playable-notes': 'src/playable-notes.ts',
    'core/bga-timeline': 'src/core/bga-timeline.ts',
    'core/engine': 'src/core/engine.ts',
    'core/groove-gauge': 'src/core/groove-gauge.ts',
    'core/high-speed-control': 'src/core/high-speed-control.ts',
    'core/input-signal-bus': 'src/core/input-signal-bus.ts',
    'core/judge-window': 'src/core/judge-window.ts',
    'core/lane-layout': 'src/core/lane-layout.ts',
    'core/scoring': 'src/core/scoring.ts',
    'core/scroll-distance': 'src/core/scroll-distance.ts',
    'core/timeline': 'src/core/timeline.ts',
    'core/ui-options': 'src/core/ui-options.ts',
    'core/ui-signal-bus': 'src/core/ui-signal-bus.ts',
    'state-signals': 'src/state-signals.ts',
    utils: 'src/utils.ts',
  },
});

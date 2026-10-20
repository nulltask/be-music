import { defineConfig } from 'vite-plus';
import { createPackageConfig } from '../../vite.package.config.ts';

export default defineConfig({
  pack: createPackageConfig({
    packageDir: import.meta.dirname,
    entries: {
      index: 'src/index.ts',
      signals: 'src/signals.ts',
      lanes: 'src/lanes.ts',
      display: 'src/display.ts',
      'audio-sink': 'src/audio-sink.ts',
      course: 'src/course/index.ts',
      replay: 'src/replay/index.ts',
      records: 'src/records/index.ts',
      ruleset: 'src/ruleset/vocabulary.ts',
    },
  }),
});

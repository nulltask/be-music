import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = dirname(fileURLToPath(import.meta.url));

const workspacePackages = ['utils', 'json', 'chart', 'parser', 'stringifier', 'audio-renderer', 'player', 'editor'] as const;

const workspaceAliases = Object.fromEntries(
  workspacePackages.map((name) => [`@be-music/${name}`, resolve(rootDir, `packages/${name}/src/index.ts`)]),
);

const workspaceProjects = workspacePackages.map((name) => ({
  extends: true as const,
  test: {
    name: `@be-music/${name}`,
    include: [`packages/${name}/src/**/*.test.ts`],
  },
}));

export default defineConfig({
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    environment: 'node',
    projects: [
      ...workspaceProjects,
      {
        extends: true as const,
        test: {
          name: 'benchmark-scripts',
          include: ['scripts/bench/**/*.test.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: [`packages/{${workspacePackages.join(',')}}/src/**/*.ts`],
      exclude: [
        'packages/*/src/**/*.test.ts',
        'packages/*/src/cli.ts',
        'packages/*/src/**/*.d.ts',
        'packages/audio-renderer/src/index.ts',
        'packages/parser/src/index.ts',
        'packages/player/src/index.ts',
        'packages/player/src/tui.ts',
        'packages/player/src/node/*protocol.ts',
      ],
      thresholds: {
        // Use package-level thresholds so lower-coverage packages don't hide behind unrelated ones.
        'packages/audio-renderer/src/**/*.ts': {
          statements: 65,
          branches: 57,
          functions: 74,
          lines: 66,
        },
        'packages/chart/src/**/*.ts': {
          statements: 90,
          branches: 81,
          functions: 93,
          lines: 90,
        },
        'packages/editor/src/**/*.ts': {
          statements: 95,
          branches: 84,
          functions: 95,
          lines: 96,
        },
        'packages/json/src/**/*.ts': {
          statements: 94,
          branches: 91,
          functions: 70,
          lines: 99,
        },
        'packages/parser/src/**/*.ts': {
          statements: 87,
          branches: 76,
          functions: 93,
          lines: 87,
        },
        'packages/player/src/**/*.ts': {
          statements: 59,
          branches: 51,
          functions: 64,
          lines: 59,
        },
        'packages/stringifier/src/**/*.ts': {
          statements: 87,
          branches: 77,
          functions: 96,
          lines: 86,
        },
        'packages/utils/src/**/*.ts': {
          statements: 96,
          branches: 91,
          functions: 99,
          lines: 96,
        },
      },
    },
  },
});

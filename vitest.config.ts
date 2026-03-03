import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = dirname(fileURLToPath(import.meta.url));

const workspacePackages = ['utils', 'json', 'parser', 'stringifier', 'audio-renderer', 'player', 'editor'] as const;

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
    projects: workspaceProjects,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['packages/{json,stringifier,editor,utils}/src/**/*.ts'],
      exclude: ['packages/*/src/**/*.test.ts', 'packages/*/src/cli.ts', 'packages/*/src/**/*.d.ts'],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 85,
        branches: 80,
      },
    },
  },
});

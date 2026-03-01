import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts'],
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

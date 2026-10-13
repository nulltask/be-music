import { builtinModules } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite-plus';

const rootDir = dirname(fileURLToPath(import.meta.url));

const workspacePackages = [
  'utils',
  'json',
  'chart',
  'parser',
  'stringifier',
  'audio-renderer',
  'player',
  'player-tui',
  'lr2-skin',
  'beatoraja-skin',
  'skin-sdk',
  'editor',
  'player-web',
] as const;

const workspaceAliases = [
  // Subpath aliases must come first because Vite resolves aliases by string prefix
  // and `@be-music/utils` would otherwise capture `@be-music/utils/core`.
  {
    find: '@be-music/audio-renderer/triggers',
    replacement: resolve(rootDir, 'packages/audio-renderer/src/core/triggers.ts'),
  },
  { find: '@be-music/player/playable-notes', replacement: resolve(rootDir, 'packages/player/src/playable-notes.ts') },
  { find: '@be-music/player/audio-sink', replacement: resolve(rootDir, 'packages/player/src/audio-sink.ts') },
  {
    find: '@be-music/player/image-resize-algorithm',
    replacement: resolve(rootDir, 'packages/player/src/image-resize-algorithm.ts'),
  },
  { find: '@be-music/player/judging', replacement: resolve(rootDir, 'packages/player/src/judging.ts') },
  { find: '@be-music/player/playlog', replacement: resolve(rootDir, 'packages/player/src/playlog/index.ts') },
  { find: '@be-music/player/state-signals', replacement: resolve(rootDir, 'packages/player/src/state-signals.ts') },
  { find: '@be-music/player/utils', replacement: resolve(rootDir, 'packages/player/src/utils.ts') },
  { find: '@be-music/player/core', replacement: resolve(rootDir, 'packages/player/src/core') },
  { find: '@be-music/player-web/runtime', replacement: resolve(rootDir, 'packages/player-web/src/runtime/index.ts') },
  { find: '@be-music/utils/core', replacement: resolve(rootDir, 'packages/utils/src/core.ts') },
  { find: '@be-music/utils/cli-path', replacement: resolve(rootDir, 'packages/utils/src/cli-path.ts') },
  { find: '@be-music/utils/log', replacement: resolve(rootDir, 'packages/utils/src/log.ts') },
  {
    find: '@be-music/utils/optional-node-module',
    replacement: resolve(rootDir, 'packages/utils/src/optional-node-module.ts'),
  },
  { find: '@be-music/utils/path', replacement: resolve(rootDir, 'packages/utils/src/path.ts') },
  { find: '@be-music/utils/pcm', replacement: resolve(rootDir, 'packages/utils/src/pcm.ts') },
  { find: '@be-music/utils/workerize', replacement: resolve(rootDir, 'packages/utils/src/workerize.ts') },
  ...workspacePackages.map((name) => ({
    find: `@be-music/${name}`,
    replacement: resolve(rootDir, `packages/${name}/src/index.ts`),
  })),
];

/**
 * Layering (docs/architecture.md): the chart model, the IR, the parser and the engine's core / play-log / ruleset
 * code run unchanged in the browser and in Node, so they import no Node built-in and read no DOM or Node-only global.
 * Runtime services reach them through adapters (`PlayerOptions.createAudioSession`, `createUiRuntime`, the parser's
 * `node-file.ts`) instead.
 */
const runtimeNeutralSources = [
  'packages/chart/src/**/*.ts',
  'packages/json/src/**/*.ts',
  'packages/parser/src/**/*.ts',
  'packages/player/src/core/**/*.ts',
  'packages/player/src/playlog/**/*.ts',
  'packages/player/src/ruleset/**/*.ts',
];
/** Node / CLI entry points inside those trees: the runtime adapters the rule above points to. */
const runtimeAdapterSources = ['packages/parser/src/cli.ts', 'packages/parser/src/node-file.ts'];
/**
 * The deterministic judge (`judge-core*.ts`, `auto-judge-core.ts`, the ruleset rules and the play-log simulator): the
 * same inputs must give the same judgments, so these files read no clock, set no timer and draw no random number.
 */
const deterministicJudgeSources = [
  'packages/player/src/core/judge-*.ts',
  'packages/player/src/core/auto-judge-core.ts',
  'packages/player/src/ruleset/**/*.ts',
  'packages/player/src/playlog/simulate.ts',
];
const nodeBuiltinMessage = 'Runtime-neutral code must not import Node built-ins; use a runtime adapter.';
const nodeBuiltinImports = {
  paths: builtinModules.filter((name) => !name.startsWith('_')).map((name) => ({ name, message: nodeBuiltinMessage })),
  patterns: [{ group: ['node:*'], message: nodeBuiltinMessage }],
};
const runtimeGlobals = [
  'window',
  'document',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
  'HTMLElement',
  'AudioContext',
  'requestAnimationFrame',
  'process',
  'Buffer',
  'require',
  '__dirname',
  '__filename',
].map((name) => ({ name, message: 'Runtime-neutral code must not read DOM or Node globals; use a runtime adapter.' }));
const clockGlobals = ['Date', 'performance', 'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask'].map(
  (name) => ({ name, message: 'The judge core is deterministic: take time as an input instead of reading a clock.' }),
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
          name: '@be-music/player-web-demo',
          include: ['packages/player-web-demo/src/**/*.test.ts'],
        },
      },
      {
        extends: true as const,
        test: {
          name: '@be-music/leaderboard-api',
          include: ['packages/leaderboard-api/src/**/*.test.ts'],
          // The API tests start a workerd process (Miniflare) for real D1 and R2 bindings.
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        extends: true as const,
        test: {
          name: 'regression',
          include: ['tests/regression/**/*.test.ts'],
        },
      },
      {
        extends: true as const,
        test: {
          name: 'benchmark-scripts',
          include: ['scripts/bench/**/*.test.ts', 'scripts/lint/**/*.test.ts'],
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
        'packages/player-tui/src/cli.ts',
        'packages/player-tui/src/tui.ts',
        'packages/player-tui/src/node/*protocol.ts',
        'packages/player-web/src/index.ts',
        'packages/player-web/src/library.ts',
        'packages/player-web/src/pixi-*.ts',
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
        'packages/player-tui/src/**/*.ts': {
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
  staged: {
    '*': 'vp check --fix',
  },
  fmt: {
    printWidth: 120,
    singleQuote: true,
    ignorePatterns: [
      'node_modules/**',
      'packages/*/node_modules/**',
      'packages/*/dist/**',
      'examples/**',
      'tmp/**',
      // Real-world beatoraja skins are lenient JSON (missing / trailing commas) and the parser tests depend on them
      // staying byte-for-byte as shipped.
      'packages/*/src/__fixtures__/**',
      // Regression snapshots are compared byte-for-byte by `toMatchFileSnapshot`; reformatting them would fail the suite.
      'tests/regression/__expected__/**',
      // Generated by Changesets on every release; reformatting them would churn each version bump.
      '**/CHANGELOG.md',
      // Generated by the Leaderboard's `build:css`; it is rewritten whole on every rebuild.
      'packages/leaderboard-api/src/pages/styles.generated.ts',
      // Generated by drizzle-kit, which compares and rewrites them in its own layout.
      'packages/leaderboard-api/migrations/meta/**',
    ],
  },
  lint: {
    env: {
      builtin: true,
    },
    ignorePatterns: [
      'node_modules/**',
      'packages/*/node_modules/**',
      'packages/*/dist/**',
      'examples/**',
      'tmp/**',
      'packages/leaderboard-api/src/pages/styles.generated.ts',
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    jsPlugins: [
      {
        name: 'vite-plus',
        specifier: 'vite-plus/oxlint-plugin',
      },
    ],
    rules: {
      'vite-plus/prefer-vite-plus-imports': 'error',
    },
    overrides: [
      {
        // `expect(mock.method).toHaveBeenCalled()` reads a `vi.fn()` that never touches `this`; typescript-eslint pairs
        // this rule with a test-aware variant that Oxlint does not ship, so it only applies to non-test sources.
        files: ['**/*.test.ts'],
        rules: {
          'typescript/unbound-method': 'off',
        },
      },
      {
        files: runtimeNeutralSources,
        rules: {
          'no-restricted-imports': ['error', nodeBuiltinImports],
          'no-restricted-globals': ['error', ...runtimeGlobals],
        },
      },
      {
        files: deterministicJudgeSources,
        rules: {
          'no-restricted-globals': ['error', ...runtimeGlobals, ...clockGlobals],
          'no-restricted-properties': [
            'error',
            {
              object: 'Math',
              property: 'random',
              message: 'The judge core is deterministic: take randomness as an input.',
            },
          ],
        },
      },
      {
        // Tests read fixtures from disk, and the adapters exist to hold the runtime-specific code.
        files: ['**/*.test.ts', ...runtimeAdapterSources],
        rules: {
          'no-restricted-imports': 'off',
          'no-restricted-globals': 'off',
          'no-restricted-properties': 'off',
        },
      },
    ],
  },
});

import { builtinModules } from 'node:module';
import { defaultClientConditions, defaultServerConditions, defineConfig } from 'vite-plus';

const workspacePackages = [
  'shared-utils',
  'chart-source',
  'chart-model',
  'chart-parser',
  'chart-writer',
  'chart-audio-renderer',
  'player-engine',
  'player-node-audio',
  'player-scene-model',
  'player-terminal',
  'skin-lr2',
  'skin-beatoraja',
  'player-skin-sdk',
  'player-ui',
  'chart-editor',
  'player-browser',
  'app-accounts',
  'service-auth-client',
  'app-dashboard',
  'worker-play',
  'service-web-theme',
] as const;

/**
 * Layering (docs/architecture.md): the chart model, the IR, the parser, the engine's core / replay / ruleset code
 * with the player entries a browser host imports (signals, lanes, display), the scene models and the LR2 and beatoraja
 * state resolvers run unchanged in the browser and in Node, so they import no
 * Node built-in and read no DOM or Node-only global. Runtime services reach them through adapters
 * (`PlayerOptions.createAudioSession`, `createUIRuntime`, the parser's `node-file.ts`) instead.
 */
const runtimeNeutralSources = [
  'packages/shared-utils/src/core.ts',
  'packages/shared-utils/src/hash.ts',
  'packages/shared-utils/src/async.ts',
  'packages/skin-beatoraja/src/scene/**/*.ts',
  'packages/chart-model/src/**/*.ts',
  'packages/chart-source/src/**/*.ts',
  'packages/skin-lr2/src/state/**/*.ts',
  'packages/chart-parser/src/**/*.ts',
  'packages/player-engine/src/core/**/*.ts',
  'packages/player-engine/src/audio-clock.ts',
  'packages/player-engine/src/course/**/*.ts',
  'packages/player-engine/src/display.ts',
  'packages/player-engine/src/image-resize-algorithm.ts',
  'packages/player-engine/src/judging.ts',
  'packages/player-engine/src/lanes.ts',
  'packages/player-engine/src/lane-random.ts',
  'packages/player-engine/src/playable-notes.ts',
  'packages/player-engine/src/replay/**/*.ts',
  'packages/player-engine/src/records/**/*.ts',
  'packages/player-engine/src/ruleset/**/*.ts',
  'packages/player-engine/src/signals.ts',
  'packages/player-engine/src/state-signals.ts',
  'packages/player-engine/src/utils.ts',
  'packages/player-scene-model/src/**/*.ts',
];
/** Node / CLI entry points inside those trees: the runtime adapters the rule above points to. */
const runtimeAdapterSources = ['packages/chart-parser/src/cli.ts', 'packages/chart-parser/src/node-file.ts'];
/**
 * The deterministic judge (`judge-core*.ts`, `auto-judge-core.ts`, the ruleset rules and the replay simulator): the
 * same inputs must give the same judgments, so these files read no clock, set no timer and draw no random number. The
 * scene models and the LR2 and beatoraja state resolvers are held to the same rule: a scene's time comes in as an input.
 */
const deterministicJudgeSources = [
  'packages/player-engine/src/lane-random.ts',
  'packages/skin-beatoraja/src/scene/**/*.ts',
  'packages/skin-lr2/src/state/**/*.ts',
  'packages/player-engine/src/core/judge-*.ts',
  'packages/player-engine/src/core/auto-judge-core.ts',
  'packages/player-engine/src/ruleset/**/*.ts',
  'packages/player-engine/src/replay/simulate.ts',
  'packages/player-scene-model/src/**/*.ts',
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
  (name) => ({ name, message: 'Deterministic code takes time as an input instead of reading a clock.' }),
);

/**
 * The web runtime's layers (docs/player-web.md, "Layering"; ADR 0001). From the top: the host API (`host/` and the
 * package barrel), the scene sessions (`session/`) and the family views (`view/`). Every other directory is a lower
 * layer: the audio and input runtimes, chart and media preparation, the collection, the Pixi stage helpers, the skin
 * loaders, the built-in skins and the recorder. Every file starts out as a lower layer, so a new directory is one too.
 *
 * - A lower layer knows no scene: it imports no host, session or view module, not even a type.
 * - A session holds a screen's behaviour and is tested in Node with a fake view, so it uses Pixi only for types: the
 *   view owns everything drawn. It reaches its view and the host only for types.
 * - A view only draws frames and returns intents, so it reaches neither the engine nor its web runtimes, and its session
 *   and the host only for types.
 * - Only a session and the engine driver run the engine; every other file imports its types only.
 * - Only the audio layer (`runtime/`) creates an audio context; the rest of the runtime and the web demo play through
 *   the audio service.
 *
 * Oxlint does not merge the options of two overrides that set the same rule: the last one wins. So each file group
 * below gets one complete `no-restricted-imports` object, and a group comes after the wider one it narrows.
 */
const playerWebSources = ['packages/player-browser/src/**/*.ts'];
const engineDriverSources = ['packages/player-browser/src/runtime/engine-driver.ts'];
const webAudioLayerSources = ['packages/player-browser/src/runtime/**/*.ts'];
const sceneSessionSources = ['packages/player-browser/src/session/**/*.ts'];
const familyViewSources = ['packages/player-browser/src/view/**/*.ts'];
const webHostSources = ['packages/player-browser/src/host/**/*.ts', 'packages/player-browser/src/index.ts'];
const webDemoSources = ['packages/app-play/src/**/*.ts'];
/** Import specifiers that reach the named directories of `player-web/src` (or of the web demo's `src`). */
const webLayerGroup = (...dirs: string[]): string[] => dirs.flatMap((dir) => [`**/${dir}`, `**/${dir}/**`]);
const lowerLayerMessage =
  'A lower layer of the web runtime knows no scene: it imports no host, session or view module.';
const lowerLayerPatterns = [{ group: webLayerGroup('host', 'session', 'view'), message: lowerLayerMessage }];
/**
 * The engine is the root of `@be-music/player-engine`. Its other entries (`./signals`, `./lanes`, `./display`, `./ruleset`, …)
 * are the vocabulary a host shares with a play, not the engine, so any layer may import them.
 */
const engineModule = '@be-music/player-engine';
const engineMessage = `Only a scene session (and runtime/engine-driver.ts) runs the engine (${engineModule}); import its types only.`;
const engineTypeImports = {
  paths: [{ name: engineModule, allowTypeImports: true, message: engineMessage }],
};
const lowerLayerImports = { ...engineTypeImports, patterns: lowerLayerPatterns };
const engineDriverImports = { patterns: lowerLayerPatterns };
const sceneSessionPixiMessage = 'A scene session uses Pixi only for types; the family view draws.';
const sceneSessionImports = {
  paths: [{ name: 'pixi.js', allowTypeImports: true, message: sceneSessionPixiMessage }],
  patterns: [
    { group: ['pixi.js/*', '@pixi/*'], allowTypeImports: true, message: sceneSessionPixiMessage },
    {
      group: webLayerGroup('view', 'host'),
      allowTypeImports: true,
      message: 'A scene session reaches its family view and the host only for types.',
    },
  ],
};
const familyViewEngineMessage = 'A family view draws frames and returns intents; the scene session drives the engine.';
const familyViewImports = {
  paths: [
    { name: engineModule, message: `${familyViewEngineMessage} Import nothing from ${engineModule}, not even a type.` },
  ],
  patterns: [
    { group: ['**/runtime/engine-driver*', '**/runtime/web-*-runtime*'], message: familyViewEngineMessage },
    {
      group: webLayerGroup('session', 'host'),
      allowTypeImports: true,
      message: 'A family view reaches its scene session and the host only for types.',
    },
  ],
};
const audioContextNames = ['AudioContext', 'OfflineAudioContext', 'webkitAudioContext', 'webkitOfflineAudioContext'];
const webAudioMessage = 'Only the audio layer (runtime/) creates an audio context; play through the audio service.';
const webAudioGlobals = audioContextNames.map((name) => ({ name, message: webAudioMessage }));
const webAudioProperties = ['globalThis', 'window', 'self'].flatMap((object) =>
  audioContextNames.map((property) => ({ object, property, message: webAudioMessage })),
);
/**
 * The web demo's layers (docs/player-web.md, "How the demo is built"): `main.ts` boots the app, `app/` composes it (the
 * scene router, the routes, the shell), `ui/` is the Debug Menu and the panels, and `services/` hold the state and rules
 * the others share. A service knows neither the UI nor the wiring: it imports no Tweakpane, `ui/` or `app/` module, not
 * even a type, and reaches the app through the deps it is given.
 */
const webDemoServiceSources = ['packages/app-play/src/services/**/*.ts'];
const webDemoServiceMessage =
  'A demo service imports no Tweakpane, ui/ or app/ module; it takes what it needs as deps.';
const webDemoServiceImports = {
  paths: [...engineTypeImports.paths, { name: 'tweakpane', message: webDemoServiceMessage }],
  patterns: [
    {
      group: ['tweakpane', 'tweakpane/*', '@tweakpane/core', '@tweakpane/core/*', ...webLayerGroup('ui', 'app')],
      message: webDemoServiceMessage,
    },
  ],
};

const workspaceProjects = workspacePackages.map((name) => ({
  extends: true as const,
  test: {
    name: `@be-music/${name}`,
    include: [`packages/${name}/src/**/*.test.ts`],
  },
}));

export default defineConfig({
  // Workspace imports resolve to TypeScript sources through each package's `exports` `source` condition, so
  // `package.json` `exports` is the only list of entry points: a new subpath needs just a `"source"` entry there
  // (listed before `"types"`, which `customConditions` in tsconfig.typecheck.json relies on). Setting conditions
  // replaces Vite's defaults, so they are spread back in. Tests run in the `ssr` (Node) environment, where Vitest's own
  // default drops `module` because a `module` build is not always native ESM that Node can load.
  resolve: {
    conditions: ['source', ...defaultClientConditions],
  },
  ssr: {
    resolve: {
      conditions: ['source', ...defaultServerConditions.filter((condition) => condition !== 'module')],
    },
  },
  test: {
    environment: 'node',
    // Many engine tests wait on the wall clock (input scheduled in real time) rather than compute, so on CI's few cores
    // more workers than cores keep them overlapping instead of queueing behind each other.
    ...(process.env.CI === 'true' ? { maxWorkers: '200%' } : {}),
    projects: [
      ...workspaceProjects,
      {
        extends: true as const,
        test: {
          name: '@be-music/app-play',
          include: ['packages/app-play/src/**/*.test.ts'],
        },
      },
      {
        extends: true as const,
        test: {
          name: '@be-music/app-leaderboard',
          // The pages' stylesheet, icons and client script are generated, not kept in git.
          globalSetup: ['packages/app-leaderboard/src/test-support/global-setup.ts'],
          include: ['packages/app-leaderboard/src/**/*.test.ts', 'packages/app-leaderboard/client/**/*.test.ts'],
          // The API tests start a workerd process (Miniflare) for real D1 and R2 bindings.
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        extends: true as const,
        test: {
          name: 'regression',
          include: ['test/regression/**/*.test.ts'],
        },
      },
      {
        extends: true as const,
        test: {
          name: 'benchmark-scripts',
          include: [
            'scripts/bench/**/*.test.ts',
            'scripts/course-checklist/**/*.test.ts',
            'scripts/lint/**/*.test.ts',
            'scripts/release/**/*.test.ts',
          ],
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
        'packages/chart-audio-renderer/src/index.ts',
        'packages/chart-parser/src/index.ts',
        'packages/player-engine/src/index.ts',
        'packages/player-engine/src/tui.ts',
        'packages/player-engine/src/node/*protocol.ts',
        'packages/player-terminal/src/cli.ts',
        'packages/player-terminal/src/tui.ts',
        'packages/player-terminal/src/node/*protocol.ts',
        'packages/player-browser/src/index.ts',
        'packages/player-browser/src/library.ts',
        'packages/player-browser/src/pixi-*.ts',
      ],
      thresholds: {
        // Use package-level thresholds so lower-coverage packages don't hide behind unrelated ones.
        'packages/chart-audio-renderer/src/**/*.ts': {
          statements: 65,
          branches: 57,
          functions: 74,
          lines: 66,
        },
        'packages/chart-model/src/**/*.ts': {
          statements: 90,
          branches: 81,
          functions: 93,
          lines: 90,
        },
        'packages/chart-editor/src/**/*.ts': {
          statements: 95,
          branches: 84,
          functions: 95,
          lines: 96,
        },
        'packages/chart-source/src/**/*.ts': {
          statements: 94,
          branches: 91,
          functions: 70,
          lines: 99,
        },
        'packages/chart-parser/src/**/*.ts': {
          statements: 87,
          branches: 76,
          functions: 93,
          lines: 87,
        },
        'packages/player-engine/src/**/*.ts': {
          statements: 59,
          branches: 51,
          functions: 64,
          lines: 59,
        },
        'packages/player-terminal/src/**/*.ts': {
          statements: 59,
          branches: 51,
          functions: 64,
          lines: 59,
        },
        'packages/chart-writer/src/**/*.ts': {
          statements: 87,
          branches: 77,
          functions: 96,
          lines: 86,
        },
        'packages/shared-utils/src/**/*.ts': {
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
      'test/fixtures/**',
      'tmp/**',
      // Real-world beatoraja skins are lenient JSON (missing / trailing commas) and the parser tests depend on them
      // staying byte-for-byte as shipped.
      'packages/*/src/__fixtures__/**',
      // Regression snapshots are compared byte-for-byte by `toMatchFileSnapshot`; reformatting them would fail the suite.
      'test/regression/__expected__/**',
      // So are the engine characterization snapshots.
      'packages/player-engine/src/core/characterization/__expected__/**',
      // Generated by Changesets on every release; reformatting them would churn each version bump.
      '**/CHANGELOG.md',
      // Generated by the Leaderboard's `build:css`; it is rewritten whole on every rebuild.
      'packages/app-leaderboard/src/pages/styles.generated.ts',
      'packages/app-leaderboard/src/pages/icons.generated.ts',
      'packages/app-leaderboard/src/pages/fonts.generated.ts',
      'packages/app-leaderboard/src/pages/client.generated.ts',
      // Generated by drizzle-kit, which compares and rewrites them in its own layout.
      'packages/app-leaderboard/migrations/meta/**',
      // Written by the Leaderboard's OpenAPI test, which compares it byte for byte.
      'packages/app-leaderboard/openapi.json',
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
      'test/fixtures/**',
      'tmp/**',
      'packages/app-leaderboard/src/pages/styles.generated.ts',
      'packages/app-leaderboard/src/pages/icons.generated.ts',
      'packages/app-leaderboard/src/pages/fonts.generated.ts',
      'packages/app-leaderboard/src/pages/client.generated.ts',
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
              message: 'Deterministic code takes randomness as an input.',
            },
          ],
        },
      },
      {
        // Every web runtime file starts out as a lower layer; the groups below narrow it.
        files: playerWebSources,
        rules: {
          'no-restricted-imports': ['error', lowerLayerImports],
          'no-restricted-globals': ['error', ...webAudioGlobals],
          'no-restricted-properties': ['error', ...webAudioProperties],
        },
      },
      {
        files: engineDriverSources,
        rules: {
          'no-restricted-imports': ['error', engineDriverImports],
        },
      },
      {
        files: webAudioLayerSources,
        rules: {
          'no-restricted-globals': 'off',
          'no-restricted-properties': 'off',
        },
      },
      {
        files: sceneSessionSources,
        rules: {
          'no-restricted-imports': ['error', sceneSessionImports],
        },
      },
      {
        files: familyViewSources,
        rules: {
          'no-restricted-imports': ['error', familyViewImports],
        },
      },
      {
        files: webHostSources,
        rules: {
          'no-restricted-imports': ['error', engineTypeImports],
        },
      },
      {
        files: webDemoSources,
        rules: {
          'no-restricted-imports': ['error', engineTypeImports],
          'no-restricted-globals': ['error', ...webAudioGlobals],
          'no-restricted-properties': ['error', ...webAudioProperties],
        },
      },
      {
        files: webDemoServiceSources,
        rules: {
          'no-restricted-imports': ['error', webDemoServiceImports],
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

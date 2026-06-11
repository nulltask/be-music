import { chmod, mkdir, readFile, readdir, realpath, stat, unlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { builtinModules, createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build, defaultServerConditions, defaultServerMainFields } from 'vite';

const execFileAsync = promisify(execFile);

const SEA_WORKER_BANNER = [
  "globalThis.Worker ??= (() => { try { return require('node:worker_threads').Worker; } catch { return undefined; } })();",
  'globalThis.FileList ??= class FileList {};',
  'globalThis.ImageData ??= class ImageData {};',
].join('\n');

interface CliArgs {
  packageName: SeaTargetName;
  output?: string;
  nodeBinary?: string;
  bundleOnly: boolean;
}

interface EmbeddedNodeModuleRoot {
  /** Package embedded into the binary together with its production dependency closure. */
  name: string;
  /** Directory (relative to the repository root) whose dependency resolution finds the package. */
  resolveFrom: string;
  /** Files of this package (matched against the package-relative posix path) excluded from embedding. */
  excludeFilePatterns?: RegExp[];
}

interface SeaTargetConfig {
  packageDir: string;
  outputBaseName: string;
  /** Bundle entry relative to `packageDir` (default: `src/cli.ts`). */
  entry?: string;
  /**
   * Embed the bundle itself as the `sea-entry.cjs` asset so the running binary can spawn eval workers that
   * re-execute it (worker scripts cannot be loaded from disk in a SEA). Requires an entry that dispatches on
   * the workerData role marker, like `player-tui/src/sea-main.ts`.
   */
  embedBundleAsset?: boolean;
  /**
   * Optional packages (native addons and friends) embedded as SEA assets. The running binary extracts them
   * to a cache directory at startup — native addons cannot be loaded from memory — and resolves them through
   * `loadOptionalNodeModule`; see `player-tui/src/node/sea-embedded-modules.ts`.
   */
  embeddedNodeModules?: EmbeddedNodeModuleRoot[];
  optionalExternalModules?: string[];
  bundleBanner?: string;
  aliases?: Record<string, string>;
}

const TARGET_NAMES = ['player', 'audio-renderer'] as const;
type SeaTargetName = (typeof TARGET_NAMES)[number];

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryDir = resolve(scriptDir, '..');

const SEA_TARGETS: Record<SeaTargetName, SeaTargetConfig> = {
  player: {
    packageDir: resolve(repositoryDir, 'packages/player-tui'),
    outputBaseName: 'be-music-player',
    entry: 'src/sea-main.ts',
    embedBundleAsset: true,
    embeddedNodeModules: [
      { name: 'node-web-audio-api', resolveFrom: 'packages/player' },
      {
        name: '@uwx/libav.js-fat',
        resolveFrom: 'packages/player-tui',
        // Node always selects the `.wasm` build (see the target() probe in dist/libav-fat.js) and the player
        // initialises libav with `noworker: true`, so the asm.js fallback (~122MB), the worker-threaded
        // build (~35MB), and the LGPL source tarballs (~30MB) are dead weight for the SEA runtime.
        excludeFilePatterns: [/\.asm\.(js|mjs)$/, /\.thr\./, /\.d\.ts$/, /^sources\//],
      },
    ],
    optionalExternalModules: ['node-web-audio-api', '@uwx/libav.js-fat'],
    bundleBanner: SEA_WORKER_BANNER,
    aliases: {
      '@be-music/audio-renderer/triggers': resolve(repositoryDir, 'packages/audio-renderer/src/core/triggers.ts'),
      '@be-music/audio-renderer': resolve(repositoryDir, 'packages/audio-renderer/src/index.ts'),
      '@be-music/chart': resolve(repositoryDir, 'packages/chart/src/index.ts'),
      '@be-music/json': resolve(repositoryDir, 'packages/json/src/index.ts'),
      '@be-music/parser': resolve(repositoryDir, 'packages/parser/src/index.ts'),
      '@be-music/player/playable-notes': resolve(repositoryDir, 'packages/player/src/playable-notes.ts'),
      '@be-music/player/audio-sink': resolve(repositoryDir, 'packages/player/src/audio-sink.ts'),
      '@be-music/player/image-resize-algorithm': resolve(
        repositoryDir,
        'packages/player/src/image-resize-algorithm.ts',
      ),
      '@be-music/player/state-signals': resolve(repositoryDir, 'packages/player/src/state-signals.ts'),
      '@be-music/player/utils': resolve(repositoryDir, 'packages/player/src/utils.ts'),
      '@be-music/player/core': resolve(repositoryDir, 'packages/player/src/core'),
      '@be-music/player': resolve(repositoryDir, 'packages/player/src/index.ts'),
      // Subpath aliases must come before the package-root alias — Vite picks the first matching entry, so a
      // bare `@be-music/utils` alias would shadow `@be-music/utils/core` (= `packages/utils/src/index.ts/core`,
      // invalid). Each subpath here mirrors a `package.json` `exports` entry plus the in-tree TS source.
      '@be-music/utils/cli-path': resolve(repositoryDir, 'packages/utils/src/cli-path.ts'),
      '@be-music/utils/core': resolve(repositoryDir, 'packages/utils/src/core.ts'),
      '@be-music/utils/log': resolve(repositoryDir, 'packages/utils/src/log.ts'),
      '@be-music/utils/optional-node-module': resolve(repositoryDir, 'packages/utils/src/optional-node-module.ts'),
      '@be-music/utils/path': resolve(repositoryDir, 'packages/utils/src/path.ts'),
      '@be-music/utils/pcm': resolve(repositoryDir, 'packages/utils/src/pcm.ts'),
      '@be-music/utils/workerize': resolve(repositoryDir, 'packages/utils/src/workerize.ts'),
      '@be-music/utils': resolve(repositoryDir, 'packages/utils/src/index.ts'),
    },
  },
  'audio-renderer': {
    packageDir: resolve(repositoryDir, 'packages/audio-renderer'),
    outputBaseName: 'be-music-audio-render',
    bundleBanner: SEA_WORKER_BANNER,
    aliases: {
      '@be-music/chart': resolve(repositoryDir, 'packages/chart/src/index.ts'),
      '@be-music/json': resolve(repositoryDir, 'packages/json/src/index.ts'),
      '@be-music/parser': resolve(repositoryDir, 'packages/parser/src/index.ts'),
      // Same subpath-before-root order as the player target above. audio-renderer imports `@be-music/utils/
      // core` for `extname` / `isAbortError` and `@be-music/utils/path` for `resolveFirstExistingPath`.
      '@be-music/utils/cli-path': resolve(repositoryDir, 'packages/utils/src/cli-path.ts'),
      '@be-music/utils/core': resolve(repositoryDir, 'packages/utils/src/core.ts'),
      '@be-music/utils/log': resolve(repositoryDir, 'packages/utils/src/log.ts'),
      '@be-music/utils/optional-node-module': resolve(repositoryDir, 'packages/utils/src/optional-node-module.ts'),
      '@be-music/utils/path': resolve(repositoryDir, 'packages/utils/src/path.ts'),
      '@be-music/utils/pcm': resolve(repositoryDir, 'packages/utils/src/pcm.ts'),
      '@be-music/utils/workerize': resolve(repositoryDir, 'packages/utils/src/workerize.ts'),
      '@be-music/utils': resolve(repositoryDir, 'packages/utils/src/index.ts'),
    },
  },
};

function printUsage() {
  process.stdout.write(
    [
      'Usage: tsx scripts/build-sea.ts --package <player|audio-renderer> [options]',
      '',
      'Essential options:',
      '  -p, --package <name>      Target package to build SEA for',
      '  -o, --output <path>       Output executable path',
      '',
      'Advanced options:',
      '      --node-binary <path>  Node executable used for SEA build (default: current node)',
      '      --bundle-only         Build only the SEA bundle and config file',
      '',
      'Developer options:',
      '  -h, --help                Show this help',
      '',
      'Requirements:',
      '  Node.js 25.5+ with built-in `--build-sea` support',
    ].join('\n') + '\n',
  );
}

function parseArgs(argv: string[]): CliArgs {
  let packageName: SeaTargetName | undefined;
  let output: string | undefined;
  let nodeBinary: string | undefined;
  let bundleOnly = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') {
      printUsage();
      process.exit(0);
    }

    if (token === '--bundle-only') {
      bundleOnly = true;
      continue;
    }

    if (token === '--package' || token === '-p') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`Missing value for ${token}`);
      }
      if (!TARGET_NAMES.includes(value as SeaTargetName)) {
        throw new Error(`Unknown package: ${value}`);
      }
      packageName = value as SeaTargetName;
      index += 1;
      continue;
    }

    if (token === '--output' || token === '-o') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`Missing value for ${token}`);
      }
      output = value;
      index += 1;
      continue;
    }

    if (token === '--node-binary') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`Missing value for ${token}`);
      }
      nodeBinary = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!packageName) {
    throw new Error('Missing required option: --package <player|audio-renderer>');
  }

  return {
    packageName,
    output,
    nodeBinary,
    bundleOnly,
  };
}

function toAbsolutePath(pathValue?: string): string | undefined {
  if (!pathValue) {
    return undefined;
  }
  return isAbsolute(pathValue) ? pathValue : resolve(process.cwd(), pathValue);
}

function buildExternalModules(optionalExternalModules: string[]): string[] {
  const modules = new Set(optionalExternalModules);
  for (const builtin of builtinModules) {
    modules.add(builtin);
    modules.add(`node:${builtin}`);
  }
  return [...modules];
}

function createWorkspaceAliasPlugin(aliases?: Record<string, string>) {
  if (!aliases) {
    return undefined;
  }

  // Iterate longest-prefix-first so a request like `@be-music/player/core/ui-options` matches the
  // `@be-music/player/core` alias before the shorter `@be-music/player` one. Object iteration order
  // already preserves the order specified in `SEA_TARGETS`, but sorting by length makes the contract
  // explicit and survives a future map literal reorder.
  const entries = Object.entries(aliases).sort(([a], [b]) => b.length - a.length);
  // The plugin needs `this.resolve` access (provided by Rollup at call time) so the `async resolveId`
  // method can delegate extension / index resolution to Rollup's downstream resolvers. Returning a bare
  // path like `packages/player/src/core/ui-options` would otherwise fail because `@rollup/plugin-alias`
  // bypasses the rest of the resolution pipeline once a plugin returns a string from `resolveId`.
  return {
    name: 'be-music-sea-workspace-alias',
    async resolveId(this: { resolve: (id: string, importer?: string, options?: { skipSelf?: boolean }) => Promise<{ id: string } | null> }, source: string): Promise<string | null> {
      for (const [find, replacement] of entries) {
        let target: string | undefined;
        if (source === find) {
          target = replacement;
        } else if (source.startsWith(`${find}/`)) {
          target = `${replacement}/${source.slice(find.length + 1)}`;
        }
        if (target !== undefined) {
          // Delegate extension resolution (`.ts`, `.js`, `.tsx`, etc.) and index lookup to Rollup's
          // built-in resolver. `skipSelf: true` prevents infinite recursion through this plugin.
          const resolved = await this.resolve(target, undefined, { skipSelf: true });
          return resolved?.id ?? target;
        }
      }
      return null;
    },
  };
}

async function buildSeaBundle(config: SeaTargetConfig, seaDir: string): Promise<void> {
  const workspaceAliasPlugin = createWorkspaceAliasPlugin(config.aliases);
  await build({
    configFile: false,
    resolve: {
      ...(config.aliases ? { alias: config.aliases } : {}),
      // The SEA bundle runs in Node, but `build()` uses the client environment whose default conditions and
      // main fields prefer `browser` entries. That silently swapped in pino/browser (whose `flush` is a noop,
      // hanging the logger close and writing no NDJSON) and isoworker's Web Worker implementation.
      conditions: [...defaultServerConditions],
      mainFields: [...defaultServerMainFields],
    },
    build: {
      target: 'node25',
      outDir: seaDir,
      emptyOutDir: true,
      codeSplitting: false,
      minify: false,
      sourcemap: false,
      lib: {
        entry: resolve(config.packageDir, config.entry ?? 'src/cli.ts'),
        formats: ['cjs'],
        fileName: () => 'sea-entry.cjs',
      },
      rollupOptions: {
        plugins: workspaceAliasPlugin ? [workspaceAliasPlugin] : undefined,
        external: buildExternalModules(config.optionalExternalModules ?? []),
        output: {
          banner: config.bundleBanner,
          entryFileNames: 'sea-entry.cjs',
        },
      },
    },
  });
}

function replaceLocalChunkRequires(code: string, localChunkIds: Set<string>): string {
  return code.replace(/require\((['"])(\.\/[^'"]+)\1\)/g, (match, _quote, id) =>
    localChunkIds.has(id) ? `__sea_require(${JSON.stringify(id)})` : match,
  );
}

function indentBlock(code: string): string {
  return code
    .split('\n')
    .map((line) => (line.length > 0 ? `    ${line}` : ''))
    .join('\n');
}

async function inlineSeaRelativeChunks(seaDir: string): Promise<void> {
  const entryFileName = 'sea-entry.cjs';
  const seaFiles = await readdir(seaDir);
  const localChunkFileNames = seaFiles.filter(
    (fileName) => (fileName.endsWith('.cjs') || fileName.endsWith('.js')) && fileName !== entryFileName,
  );
  if (localChunkFileNames.length === 0) {
    return;
  }

  const localChunkIds = new Set(localChunkFileNames.map((fileName) => `./${fileName}`));
  const localChunkSources = await Promise.all(
    localChunkFileNames.map(async (fileName) => {
      const chunkPath = resolve(seaDir, fileName);
      const chunkCode = await readFile(chunkPath, 'utf8');
      return {
        fileName,
        code: replaceLocalChunkRequires(chunkCode, localChunkIds),
      };
    }),
  );

  const entryPath = resolve(seaDir, entryFileName);
  const entryCode = replaceLocalChunkRequires(await readFile(entryPath, 'utf8'), localChunkIds);
  const inlinedRuntime = [
    'const __sea_modules = Object.create(null);',
    'const __sea_module_cache = Object.create(null);',
    'function __sea_require(id) {',
    '  const cached = __sea_module_cache[id];',
    '  if (cached) {',
    '    return cached.exports;',
    '  }',
    '  const factory = __sea_modules[id];',
    '  if (!factory) {',
    '    return require(id);',
    '  }',
    '  const module = { exports: {} };',
    '  __sea_module_cache[id] = module;',
    '  factory(module, module.exports, __sea_require);',
    '  return module.exports;',
    '}',
    ...localChunkSources.flatMap(({ fileName, code }) => [
      `__sea_modules[${JSON.stringify(`./${fileName}`)}] = (module, exports, __sea_require) => {`,
      indentBlock(code),
      '};',
    ]),
    '',
  ].join('\n');

  await writeFile(entryPath, `${inlinedRuntime}${entryCode}`, 'utf8');
  await Promise.all(localChunkFileNames.map((fileName) => unlink(resolve(seaDir, fileName))));
}

// Asset names kept in sync with packages/player-tui/src/node/sea-embedded-modules.ts.
const EMBEDDED_MODULES_MANIFEST_ASSET = 'embedded-node-modules.json';
const EMBEDDED_MODULE_ASSET_PREFIX = 'embedded-node-modules/';
// The SEA binary targets the build host platform, so only the matching native addon is embedded.
const NATIVE_ADDON_PLATFORM_TAG = `${process.platform}-${process.arch}`;

interface EmbeddedModulesBuildResult {
  /** Asset name → absolute source file path, ready to merge into the SEA config `assets` map. */
  assets: Record<string, string>;
  manifest: { cacheKey: string; files: string[] };
}

async function resolvePackageDir(name: string, fromDir: string): Promise<string> {
  const requireFromBase = createRequire(join(fromDir, 'package.json'));
  try {
    return dirname(await realpath(requireFromBase.resolve(`${name}/package.json`)));
  } catch {
    // The package `exports` map may hide package.json; resolve the entry file and walk up to the package root.
    let dir = dirname(await realpath(requireFromBase.resolve(name)));
    while (true) {
      try {
        const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as { name?: string };
        if (manifest.name === name) {
          return dir;
        }
      } catch {
        // No package.json at this level; keep walking up.
      }
      const parent = dirname(dir);
      if (parent === dir) {
        throw new Error(`Cannot locate the package directory of ${name}`);
      }
      dir = parent;
    }
  }
}

async function collectEmbeddedPackageDirs(roots: EmbeddedNodeModuleRoot[]): Promise<Map<string, string>> {
  const packageDirs = new Map<string, string>();
  const queue = roots.map((root) => ({ name: root.name, fromDir: resolve(repositoryDir, root.resolveFrom) }));
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || packageDirs.has(next.name)) {
      continue;
    }
    const packageDir = await resolvePackageDir(next.name, next.fromDir);
    packageDirs.set(next.name, packageDir);
    const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    for (const dependencyName of Object.keys(manifest.dependencies ?? {})) {
      queue.push({ name: dependencyName, fromDir: packageDir });
    }
  }
  return packageDirs;
}

function shouldEmbedPackageFile(relativePosixPath: string, excludeFilePatterns: RegExp[] | undefined): boolean {
  const fileName = relativePosixPath.split('/').at(-1) ?? relativePosixPath;
  if (fileName.endsWith('.node') && !fileName.includes(NATIVE_ADDON_PLATFORM_TAG)) {
    return false;
  }
  return !excludeFilePatterns?.some((pattern) => pattern.test(relativePosixPath));
}

async function listEmbeddedPackageFiles(
  packageDir: string,
  excludeFilePatterns: RegExp[] | undefined,
  currentDir = packageDir,
): Promise<string[]> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') {
        continue;
      }
      files.push(...(await listEmbeddedPackageFiles(packageDir, excludeFilePatterns, entryPath)));
      continue;
    }
    const isFile = entry.isFile() || (entry.isSymbolicLink() && (await stat(entryPath)).isFile());
    const relativePosixPath = relative(packageDir, entryPath).replaceAll('\\', '/');
    if (isFile && shouldEmbedPackageFile(relativePosixPath, excludeFilePatterns)) {
      files.push(relativePosixPath);
    }
  }
  return files.sort();
}

async function buildEmbeddedNodeModuleAssets(roots: EmbeddedNodeModuleRoot[]): Promise<EmbeddedModulesBuildResult> {
  const packageDirs = await collectEmbeddedPackageDirs(roots);
  const excludeFilePatternsByName = new Map(roots.map((root) => [root.name, root.excludeFilePatterns]));
  const assets: Record<string, string> = {};
  const manifestFiles: string[] = [];
  const cacheKeyHash = createHash('sha256');
  for (const [name, packageDir] of [...packageDirs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    for (const relativePath of await listEmbeddedPackageFiles(packageDir, excludeFilePatternsByName.get(name))) {
      const manifestPath = `${name}/${relativePath}`;
      const filePath = join(packageDir, ...relativePath.split('/'));
      assets[`${EMBEDDED_MODULE_ASSET_PREFIX}${manifestPath}`] = filePath;
      manifestFiles.push(manifestPath);
      cacheKeyHash.update(manifestPath);
      cacheKeyHash.update(await readFile(filePath));
    }
  }
  return {
    assets,
    manifest: { cacheKey: cacheKeyHash.digest('hex').slice(0, 16), files: manifestFiles },
  };
}

async function supportsNodeFlag(nodeBinaryPath: string, cwd: string, flag: string): Promise<boolean> {
  try {
    const { stdout, stderr } = await execFileAsync(nodeBinaryPath, ['--help'], { cwd });
    const text = `${stdout}\n${stderr}`;
    return text.includes(flag);
  } catch {
    return false;
  }
}

async function runSeaBuild(nodeBinaryPath: string, cwd: string, configFilePath: string): Promise<void> {
  try {
    await execFileAsync(nodeBinaryPath, ['--build-sea', configFilePath], { cwd });
  } catch (error) {
    const stdout =
      typeof (error as { stdout?: unknown })?.stdout === 'string' ? (error as { stdout: string }).stdout : '';
    const stderr =
      typeof (error as { stderr?: unknown })?.stderr === 'string' ? (error as { stderr: string }).stderr : '';
    const output = `${stdout}\n${stderr}`;

    if (output.includes('--build-sea') && output.toLowerCase().includes('unknown')) {
      throw new Error(
        `The selected Node executable does not support --build-sea: ${nodeBinaryPath}. ` +
          'Use Node.js 25.5+ with built-in SEA support.',
      );
    }

    throw new Error(`SEA build failed.\n${output}`.trim());
  }
}

async function maybeAdhocSignMacBinary(cwd: string, pathValue: string): Promise<void> {
  if (process.platform !== 'darwin') {
    return;
  }
  try {
    await execFileAsync('codesign', ['--sign', '-', '--force', pathValue], { cwd });
  } catch (error) {
    // Ad-hoc signing is best-effort, but an unsigned SEA binary is killed by macOS with SIGKILL
    // ("Killed: 9") at launch — surface the failure instead of producing a silently broken executable.
    const message = error instanceof Error && error.message ? error.message : String(error);
    process.stderr.write(
      `Warning: ad-hoc code signing failed (${message.trim()}).\n` +
        `The generated binary will likely be killed by macOS at launch. Sign it manually with:\n` +
        `  codesign --sign - --force ${pathValue}\n`,
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const targetConfig = SEA_TARGETS[args.packageName];
  const seaDir = resolve(targetConfig.packageDir, 'dist-sea');
  const bundlePath = resolve(seaDir, 'sea-entry.cjs');
  const configPath = resolve(seaDir, 'sea-config.json');
  const nodeBinaryPath = toAbsolutePath(args.nodeBinary) ?? process.execPath;
  const defaultOutputName =
    process.platform === 'win32' ? `${targetConfig.outputBaseName}.exe` : targetConfig.outputBaseName;
  const outputPath = toAbsolutePath(args.output) ?? resolve(seaDir, defaultOutputName);

  await mkdir(seaDir, { recursive: true });

  process.stdout.write('Building SEA bundle...\n');
  await buildSeaBundle(targetConfig, seaDir);
  await inlineSeaRelativeChunks(seaDir);

  let embeddedModules: EmbeddedModulesBuildResult | undefined;
  const embeddedManifestPath = resolve(seaDir, EMBEDDED_MODULES_MANIFEST_ASSET);
  if (targetConfig.embeddedNodeModules && targetConfig.embeddedNodeModules.length > 0) {
    process.stdout.write('Collecting embedded node modules...\n');
    embeddedModules = await buildEmbeddedNodeModuleAssets(targetConfig.embeddedNodeModules);
    await writeFile(embeddedManifestPath, `${JSON.stringify(embeddedModules.manifest, null, 2)}\n`, 'utf8');
  }

  const assets: Record<string, string> = {
    // Asset name kept in sync with SEA_BUNDLE_ASSET_NAME in packages/player-tui/src/node/sea-worker.ts.
    ...(targetConfig.embedBundleAsset ? { 'sea-entry.cjs': bundlePath } : {}),
    ...(embeddedModules ? { [EMBEDDED_MODULES_MANIFEST_ASSET]: embeddedManifestPath, ...embeddedModules.assets } : {}),
  };
  const seaConfig = {
    main: bundlePath,
    mainFormat: 'commonjs',
    output: outputPath,
    executable: nodeBinaryPath,
    disableExperimentalSEAWarning: true,
    useCodeCache: true,
    ...(Object.keys(assets).length > 0 ? { assets } : {}),
  };
  await writeFile(configPath, `${JSON.stringify(seaConfig, null, 2)}\n`, 'utf8');

  if (args.bundleOnly) {
    process.stdout.write(`SEA bundle generated:\n  entry: ${bundlePath}\n  config: ${configPath}\n`);
    return;
  }

  const hasBuildSea = await supportsNodeFlag(nodeBinaryPath, targetConfig.packageDir, '--build-sea');
  if (!hasBuildSea) {
    throw new Error(
      `The selected Node executable does not support --build-sea: ${nodeBinaryPath}. ` +
        'Use Node.js 25.5+ with built-in SEA support.',
    );
  }

  process.stdout.write('Building SEA executable...\n');
  await runSeaBuild(nodeBinaryPath, targetConfig.packageDir, configPath);

  if (process.platform !== 'win32') {
    await chmod(outputPath, 0o755);
  }

  await maybeAdhocSignMacBinary(targetConfig.packageDir, outputPath);
  process.stdout.write(`SEA executable generated: ${outputPath}\n`);
}

void main().catch((error) => {
  const message = error instanceof Error && error.message ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});

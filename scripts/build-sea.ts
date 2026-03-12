import { chmod, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { builtinModules, createRequire } from 'node:module';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);

const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const SEA_BLOB_RESOURCE = 'NODE_SEA_BLOB';
const SEA_SEGMENT_NAME = 'NODE_SEA';
const SEA_WORKER_BANNER =
  "globalThis.Worker ??= (() => { try { return require('node:worker_threads').Worker; } catch { return undefined; } })();";

interface CliArgs {
  packageName: SeaTargetName;
  output?: string;
  nodeBinary?: string;
  bundleOnly: boolean;
}

interface SeaTargetConfig {
  packageDir: string;
  outputBaseName: string;
  optionalExternalModules?: string[];
  bundleBanner?: string;
  aliases?: Record<string, string>;
  postjectInstallHintCommand: string;
}

const TARGET_NAMES = ['player', 'audio-renderer'] as const;
type SeaTargetName = (typeof TARGET_NAMES)[number];

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryDir = resolve(scriptDir, '..');

const SEA_TARGETS: Record<SeaTargetName, SeaTargetConfig> = {
  player: {
    packageDir: resolve(repositoryDir, 'packages/player'),
    outputBaseName: 'be-music-player',
    optionalExternalModules: ['node-web-audio-api', '@uwx/libav.js-fat'],
    bundleBanner: SEA_WORKER_BANNER,
    aliases: {
      '@be-music/audio-renderer': resolve(repositoryDir, 'packages/audio-renderer/src/index.ts'),
      '@be-music/json': resolve(repositoryDir, 'packages/json/src/index.ts'),
      '@be-music/parser': resolve(repositoryDir, 'packages/parser/src/index.ts'),
      '@be-music/utils': resolve(repositoryDir, 'packages/utils/src/index.ts'),
    },
    postjectInstallHintCommand: 'pnpm --filter @be-music/player add -D postject',
  },
  'audio-renderer': {
    packageDir: resolve(repositoryDir, 'packages/audio-renderer'),
    outputBaseName: 'be-music-audio-render',
    bundleBanner: SEA_WORKER_BANNER,
    aliases: {
      '@be-music/json': resolve(repositoryDir, 'packages/json/src/index.ts'),
      '@be-music/parser': resolve(repositoryDir, 'packages/parser/src/index.ts'),
      '@be-music/utils': resolve(repositoryDir, 'packages/utils/src/index.ts'),
    },
    postjectInstallHintCommand: 'pnpm --filter @be-music/audio-renderer add -D postject',
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

  const entries = Object.entries(aliases);
  return {
    name: 'be-music-sea-workspace-alias',
    resolveId(source: string) {
      for (const [find, replacement] of entries) {
        if (source === find) {
          return replacement;
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
    resolve: config.aliases
      ? {
          alias: config.aliases,
        }
      : undefined,
    build: {
      target: 'node22',
      outDir: seaDir,
      emptyOutDir: true,
      minify: false,
      sourcemap: false,
      lib: {
        entry: resolve(config.packageDir, 'src/cli.ts'),
        formats: ['cjs'],
        fileName: () => 'sea-entry.cjs',
      },
      rollupOptions: {
        plugins: workspaceAliasPlugin ? [workspaceAliasPlugin] : undefined,
        external: buildExternalModules(config.optionalExternalModules ?? []),
        output: {
          codeSplitting: false,
          banner: config.bundleBanner,
          entryFileNames: 'sea-entry.cjs',
        },
      },
    },
  });
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
    const stdout = typeof (error as { stdout?: unknown })?.stdout === 'string' ? (error as { stdout: string }).stdout : '';
    const stderr = typeof (error as { stderr?: unknown })?.stderr === 'string' ? (error as { stderr: string }).stderr : '';
    const output = `${stdout}\n${stderr}`;

    if (output.includes('--build-sea') && output.toLowerCase().includes('unknown')) {
      throw new Error(
        `The selected Node executable does not support --build-sea: ${nodeBinaryPath}. ` +
          'Use Node.js 25+ for direct SEA builds, or a Node.js 24+ binary for legacy SEA injection.',
      );
    }

    if (output.includes(SEA_FUSE) || output.toLowerCase().includes('sentinel')) {
      throw new Error(
        `The selected Node executable is not SEA-fuse enabled: ${nodeBinaryPath}. ` +
          'Use a Node.js binary that contains the SEA fuse marker (official distribution).',
      );
    }

    throw new Error(`SEA build failed.\n${output}`.trim());
  }
}

function resolvePostjectCliPath(packageDir: string, installHintCommand: string): string {
  const packageRequire = createRequire(resolve(packageDir, 'package.json'));
  try {
    return packageRequire.resolve('postject/dist/cli.js');
  } catch {
    throw new Error(
      `postject is required for legacy SEA builds but was not found. Install it with \`${installHintCommand}\`.`,
    );
  }
}

async function maybeRemoveMacSignature(cwd: string, pathValue: string): Promise<void> {
  if (process.platform !== 'darwin') {
    return;
  }
  try {
    await execFileAsync('codesign', ['--remove-signature', pathValue], { cwd });
  } catch {
    // Some Node binaries are unsigned; this step is optional.
  }
}

async function maybeAdhocSignMacBinary(cwd: string, pathValue: string): Promise<void> {
  if (process.platform !== 'darwin') {
    return;
  }
  try {
    await execFileAsync('codesign', ['--sign', '-', '--force', pathValue], { cwd });
  } catch {
    // Ad-hoc signing is best-effort for local execution.
  }
}

async function runLegacySeaBuild(params: {
  packageDir: string;
  nodeBinaryPath: string;
  outputPath: string;
  bundlePath: string;
  legacyConfigPath: string;
  blobPath: string;
  installHintCommand: string;
}): Promise<void> {
  const {
    packageDir,
    nodeBinaryPath,
    outputPath,
    bundlePath,
    legacyConfigPath,
    blobPath,
    installHintCommand,
  } = params;

  const legacySeaConfig = {
    main: bundlePath,
    output: blobPath,
    disableExperimentalSEAWarning: true,
  };
  await writeFile(legacyConfigPath, `${JSON.stringify(legacySeaConfig, null, 2)}\n`, 'utf8');

  try {
    await execFileAsync(nodeBinaryPath, ['--experimental-sea-config', legacyConfigPath], {
      cwd: packageDir,
    });
  } catch (error) {
    const stdout = typeof (error as { stdout?: unknown })?.stdout === 'string' ? (error as { stdout: string }).stdout : '';
    const stderr = typeof (error as { stderr?: unknown })?.stderr === 'string' ? (error as { stderr: string }).stderr : '';
    throw new Error(`SEA blob generation failed.\n${stdout}\n${stderr}`.trim());
  }

  await copyFile(nodeBinaryPath, outputPath);
  await maybeRemoveMacSignature(packageDir, outputPath);

  const postjectCliPath = resolvePostjectCliPath(packageDir, installHintCommand);
  const postjectArgs = [
    postjectCliPath,
    outputPath,
    SEA_BLOB_RESOURCE,
    blobPath,
    '--sentinel-fuse',
    SEA_FUSE,
  ];
  if (process.platform === 'darwin') {
    postjectArgs.push('--macho-segment-name', SEA_SEGMENT_NAME);
  }

  try {
    await execFileAsync(process.execPath, postjectArgs, { cwd: packageDir });
  } catch (error) {
    const stdout = typeof (error as { stdout?: unknown })?.stdout === 'string' ? (error as { stdout: string }).stdout : '';
    const stderr = typeof (error as { stderr?: unknown })?.stderr === 'string' ? (error as { stderr: string }).stderr : '';
    throw new Error(`SEA blob injection failed.\n${stdout}\n${stderr}`.trim());
  }

  await maybeAdhocSignMacBinary(packageDir, outputPath);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const targetConfig = SEA_TARGETS[args.packageName];
  const seaDir = resolve(targetConfig.packageDir, 'dist-sea');
  const bundlePath = resolve(seaDir, 'sea-entry.cjs');
  const configPath = resolve(seaDir, 'sea-config.json');
  const legacyConfigPath = resolve(seaDir, 'sea-legacy-config.json');
  const blobPath = resolve(seaDir, 'sea-prep.blob');
  const nodeBinaryPath = toAbsolutePath(args.nodeBinary) ?? process.execPath;
  const defaultOutputName =
    process.platform === 'win32' ? `${targetConfig.outputBaseName}.exe` : targetConfig.outputBaseName;
  const outputPath = toAbsolutePath(args.output) ?? resolve(seaDir, defaultOutputName);

  await mkdir(seaDir, { recursive: true });

  process.stdout.write('Building SEA bundle...\n');
  await buildSeaBundle(targetConfig, seaDir);

  const seaConfig = {
    main: bundlePath,
    output: outputPath,
    executable: nodeBinaryPath,
    disableExperimentalSEAWarning: true,
  };
  await writeFile(configPath, `${JSON.stringify(seaConfig, null, 2)}\n`, 'utf8');

  if (args.bundleOnly) {
    process.stdout.write(`SEA bundle generated:\n  entry: ${bundlePath}\n  config: ${configPath}\n`);
    return;
  }

  const hasBuildSea = await supportsNodeFlag(nodeBinaryPath, targetConfig.packageDir, '--build-sea');
  const hasExperimentalSeaConfig = await supportsNodeFlag(nodeBinaryPath, targetConfig.packageDir, '--experimental-sea-config');

  process.stdout.write('Building SEA executable...\n');
  if (hasBuildSea) {
    await runSeaBuild(nodeBinaryPath, targetConfig.packageDir, configPath);
  } else if (hasExperimentalSeaConfig) {
    process.stdout.write('Falling back to legacy SEA injection flow (--experimental-sea-config + postject).\n');
    await runLegacySeaBuild({
      packageDir: targetConfig.packageDir,
      nodeBinaryPath,
      outputPath,
      bundlePath,
      legacyConfigPath,
      blobPath,
      installHintCommand: targetConfig.postjectInstallHintCommand,
    });
  } else {
    throw new Error(
      `The selected Node executable does not support SEA build flags: ${nodeBinaryPath}. ` +
        'Use Node.js 24+ with SEA support.',
    );
  }

  if (process.platform !== 'win32') {
    await chmod(outputPath, 0o755);
  }

  process.stdout.write(`SEA executable generated: ${outputPath}\n`);
}

void main().catch((error) => {
  const message = error instanceof Error && error.message ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});

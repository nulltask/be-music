#!/usr/bin/env node

import { chmod, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { builtinModules, createRequire } from 'node:module';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, '..');
const seaDir = resolve(packageDir, 'dist-sea');
const bundlePath = resolve(seaDir, 'sea-entry.cjs');
const configPath = resolve(seaDir, 'sea-config.json');
const legacyConfigPath = resolve(seaDir, 'sea-legacy-config.json');
const blobPath = resolve(seaDir, 'sea-prep.blob');

const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const SEA_BLOB_RESOURCE = 'NODE_SEA_BLOB';
const SEA_SEGMENT_NAME = 'NODE_SEA';
const OPTIONAL_EXTERNAL_MODULES = ['node-web-audio-api', '@uwx/libav.js-fat'];
const SEA_BUNDLE_BANNER =
  "globalThis.Worker ??= (() => { try { return require('node:worker_threads').Worker; } catch { return undefined; } })();";

function printUsage() {
  process.stdout.write(`Usage: node packages/player/scripts/build-sea.mjs [options]\n\nOptions:\n  -o, --output <path>       Output executable path\n      --node-binary <path>  Node executable used for SEA build (default: current node)\n      --bundle-only         Build only the SEA bundle and config file\n  -h, --help                Show this help\n`);
}

function parseArgs(argv) {
  let output;
  let nodeBinary;
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

  return {
    output,
    nodeBinary,
    bundleOnly,
  };
}

function toAbsolutePath(pathValue) {
  if (!pathValue) {
    return undefined;
  }
  return isAbsolute(pathValue) ? pathValue : resolve(process.cwd(), pathValue);
}

function buildExternalModules() {
  const modules = new Set(OPTIONAL_EXTERNAL_MODULES);
  for (const builtin of builtinModules) {
    modules.add(builtin);
    modules.add(`node:${builtin}`);
  }
  return [...modules];
}

async function buildSeaBundle() {
  await build({
    configFile: false,
    build: {
      target: 'node22',
      outDir: seaDir,
      emptyOutDir: true,
      minify: false,
      sourcemap: false,
      lib: {
        entry: resolve(packageDir, 'src/cli.ts'),
        formats: ['cjs'],
        fileName: () => 'sea-entry.cjs',
      },
      rollupOptions: {
        external: buildExternalModules(),
        output: {
          codeSplitting: false,
          banner: SEA_BUNDLE_BANNER,
          entryFileNames: 'sea-entry.cjs',
        },
      },
    },
  });
}

async function supportsNodeFlag(nodeBinaryPath, flag) {
  try {
    const { stdout, stderr } = await execFileAsync(nodeBinaryPath, ['--help'], {
      cwd: packageDir,
    });
    const text = `${stdout}\n${stderr}`;
    return text.includes(flag);
  } catch {
    return false;
  }
}

async function runSeaBuild(nodeBinaryPath, configFilePath) {
  try {
    await execFileAsync(nodeBinaryPath, ['--build-sea', configFilePath], {
      cwd: packageDir,
    });
  } catch (error) {
    const stdout = typeof error?.stdout === 'string' ? error.stdout : '';
    const stderr = typeof error?.stderr === 'string' ? error.stderr : '';
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

function resolvePostjectCliPath() {
  try {
    return require.resolve('postject/dist/cli.js');
  } catch {
    throw new Error(
      'postject is required for legacy SEA builds but was not found. Install it with `pnpm --filter @be-music/player add -D postject`.',
    );
  }
}

async function maybeRemoveMacSignature(pathValue) {
  if (process.platform !== 'darwin') {
    return;
  }
  try {
    await execFileAsync('codesign', ['--remove-signature', pathValue], {
      cwd: packageDir,
    });
  } catch {
    // Some Node binaries are unsigned; this step is optional.
  }
}

async function maybeAdhocSignMacBinary(pathValue) {
  if (process.platform !== 'darwin') {
    return;
  }
  try {
    await execFileAsync('codesign', ['--sign', '-', '--force', pathValue], {
      cwd: packageDir,
    });
  } catch {
    // Ad-hoc signing is best-effort for local execution.
  }
}

async function runLegacySeaBuild(nodeBinaryPath, outputPath) {
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
    const stdout = typeof error?.stdout === 'string' ? error.stdout : '';
    const stderr = typeof error?.stderr === 'string' ? error.stderr : '';
    throw new Error(`SEA blob generation failed.\n${stdout}\n${stderr}`.trim());
  }

  await copyFile(nodeBinaryPath, outputPath);
  await maybeRemoveMacSignature(outputPath);

  const postjectCliPath = resolvePostjectCliPath();
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
    await execFileAsync(process.execPath, postjectArgs, {
      cwd: packageDir,
    });
  } catch (error) {
    const stdout = typeof error?.stdout === 'string' ? error.stdout : '';
    const stderr = typeof error?.stderr === 'string' ? error.stderr : '';
    throw new Error(`SEA blob injection failed.\n${stdout}\n${stderr}`.trim());
  }

  await maybeAdhocSignMacBinary(outputPath);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const nodeBinaryPath = toAbsolutePath(args.nodeBinary) ?? process.execPath;
  const outputPath =
    toAbsolutePath(args.output) ??
    resolve(seaDir, process.platform === 'win32' ? 'be-music-player.exe' : 'be-music-player');

  await mkdir(seaDir, {
    recursive: true,
  });

  process.stdout.write('Building SEA bundle...\n');
  await buildSeaBundle();

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

  const hasBuildSea = await supportsNodeFlag(nodeBinaryPath, '--build-sea');
  const hasExperimentalSeaConfig = await supportsNodeFlag(nodeBinaryPath, '--experimental-sea-config');

  process.stdout.write('Building SEA executable...\n');
  if (hasBuildSea) {
    await runSeaBuild(nodeBinaryPath, configPath);
  } else if (hasExperimentalSeaConfig) {
    process.stdout.write('Falling back to legacy SEA injection flow (--experimental-sea-config + postject).\n');
    await runLegacySeaBuild(nodeBinaryPath, outputPath);
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

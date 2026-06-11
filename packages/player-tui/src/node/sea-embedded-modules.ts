import { existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { getAsset } from 'node:sea';
import { OPTIONAL_NODE_MODULE_DIR_ENV } from '@be-music/utils/optional-node-module';
import { isSeaRuntime } from './sea-worker.ts';

// Asset names kept in sync with scripts/build-sea.ts.
const MANIFEST_ASSET_NAME = 'embedded-node-modules.json';
const MODULE_ASSET_PREFIX = 'embedded-node-modules/';

interface EmbeddedModulesManifest {
  cacheKey: string;
  files: string[];
}

/**
 * Extract the optional node modules embedded as SEA assets (native addons cannot be loaded from memory, so
 * they must exist on disk) into a content-addressed cache directory under `~/.be-music`, and expose that
 * directory to `loadOptionalNodeModule` through {@link OPTIONAL_NODE_MODULE_DIR_ENV}, which worker threads
 * inherit through the environment.
 *
 * Returns the base directory containing the extracted `node_modules`, or `undefined` when not running as a
 * SEA or when the binary has no embedded modules.
 */
export async function ensureSeaEmbeddedNodeModules(): Promise<string | undefined> {
  if (!isSeaRuntime()) {
    return undefined;
  }
  const manifest = readEmbeddedModulesManifest();
  if (!manifest) {
    return undefined;
  }
  const baseDir = join(homedir(), '.be-music', 'sea-embedded-modules', manifest.cacheKey);
  if (!existsSync(completeMarkerPath(baseDir))) {
    await extractEmbeddedModules(manifest, baseDir);
  }
  process.env[OPTIONAL_NODE_MODULE_DIR_ENV] ??= baseDir;
  return baseDir;
}

function completeMarkerPath(baseDir: string): string {
  return join(baseDir, '.complete');
}

function readEmbeddedModulesManifest(): EmbeddedModulesManifest | undefined {
  try {
    const manifest = JSON.parse(getAsset(MANIFEST_ASSET_NAME, 'utf8')) as EmbeddedModulesManifest;
    if (typeof manifest.cacheKey !== 'string' || manifest.cacheKey.length === 0 || !Array.isArray(manifest.files)) {
      return undefined;
    }
    return manifest;
  } catch {
    // The binary was built without embedded modules.
    return undefined;
  }
}

async function extractEmbeddedModules(manifest: EmbeddedModulesManifest, baseDir: string): Promise<void> {
  // A base directory without the completion marker is a leftover from an interrupted extraction.
  if (existsSync(baseDir)) {
    await rm(baseDir, { recursive: true, force: true });
  }
  // Stage into a per-process directory and rename at the end so a concurrently launched player never sees a
  // half-written cache; losing the rename race to another process is fine because the content is identical.
  const stagingDir = `${baseDir}.staging-${process.pid}`;
  try {
    for (const relativePath of manifest.files) {
      if (relativePath.split('/').includes('..')) {
        continue;
      }
      const filePath = join(stagingDir, 'node_modules', ...relativePath.split('/'));
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, Buffer.from(getAsset(`${MODULE_ASSET_PREFIX}${relativePath}`)));
    }
    await writeFile(completeMarkerPath(stagingDir), '');
    await rename(stagingDir, baseDir);
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    if (!existsSync(completeMarkerPath(baseDir))) {
      throw error;
    }
  }
}

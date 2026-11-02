// Builds the player's service worker (`src/service-worker/service-worker.ts`) as `/sw.js` and writes its precache
// manifest into it (docs/player-web.md, "Installing the player").
//
// The worker is one more entry of the player's own build, so it needs no second bundler run and no plugin dependency.
// Once the bundle is complete, the precache list is read off it: every file the player's page can load (its HTML, the
// chunks and stylesheets it imports, the workers it spawns, the Help's acknowledgements) and the public files (icons,
// the web app manifest). Files only the embed page reaches, the ffmpeg core (cached on first use instead) and the
// worker itself are left out. The manifest's version is a hash of the precached bytes, so each deploy that changes
// one of them gets a fresh cache, and the changed `sw.js` is what makes browsers install it.

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type { Plugin } from 'vite-plus';
import type { PrecacheManifest } from '../src/service-worker/routes.ts';

/** The worker's file in the build output, served at the origin's root so its scope is the whole player. */
export const SERVICE_WORKER_FILE = 'sw.js';
/** The placeholder in the worker's source the build replaces with the manifest. */
export const MANIFEST_PLACEHOLDER = '__BE_MUSIC_SW_MANIFEST__';

/** A file of the build output and the files it loads (imports, stylesheets, the entry chunk of an HTML page). */
export interface PrecacheCandidate {
  fileName: string;
  references: readonly string[];
}

/** Files that are never precached: the worker itself, the ffmpeg core (cached on use), source maps, build metadata. */
export function isNeverPrecached(fileName: string): boolean {
  return (
    fileName === SERVICE_WORKER_FILE ||
    fileName.startsWith('ffmpeg-core/') ||
    fileName.startsWith('.') ||
    fileName.includes('/.') ||
    fileName.endsWith('.map')
  );
}

/**
 * The output files to precache: everything reachable from a file nothing else loads (the player's HTML, the workers,
 * the public files), except from `excludedRoots` (the embed page), minus what is never precached. A chunk the embed
 * page shares with the player stays; one only the embed page loads goes.
 */
export function selectPrecacheFiles(
  candidates: readonly PrecacheCandidate[],
  excludedRoots: readonly string[],
): string[] {
  const byName = new Map(candidates.map((candidate) => [candidate.fileName, candidate]));
  const referenced = new Set(candidates.flatMap((candidate) => candidate.references));
  const excluded = new Set(excludedRoots);
  const kept = new Set<string>();
  const pending = candidates
    .filter((candidate) => !referenced.has(candidate.fileName) && !excluded.has(candidate.fileName))
    .map((candidate) => candidate.fileName);
  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    if (kept.has(name)) continue;
    kept.add(name);
    for (const reference of byName.get(name)?.references ?? []) {
      if (byName.has(reference) && !kept.has(reference)) pending.push(reference);
    }
  }
  return [...kept].filter((name) => !isNeverPrecached(name)).sort();
}

/** The URL a precached output file is fetched and cached under: the player's HTML is the shell at `/`. */
export function precacheURL(fileName: string): string {
  return fileName === 'index.html' ? '/' : `/${fileName}`;
}

/** A short hash of the precached files' names and bytes. */
export function precacheVersion(files: ReadonlyArray<readonly [string, string | Uint8Array]>): string {
  const hash = createHash('sha256');
  for (const [name, bytes] of [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    hash.update(name).update('\0').update(bytes).update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}

/** Replaces the worker's placeholder with the manifest; the placeholder has to appear exactly once. */
export function injectManifest(code: string, manifest: PrecacheManifest): string {
  const parts = code.split(MANIFEST_PLACEHOLDER);
  if (parts.length !== 2) {
    throw new Error(`expected ${MANIFEST_PLACEHOLDER} once in ${SERVICE_WORKER_FILE}, found ${parts.length - 1}`);
  }
  return parts.join(JSON.stringify(manifest));
}

async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'));
  } catch {
    return [];
  }
}

export interface ServiceWorkerPluginOptions {
  /** The worker's source. */
  entry: string;
  /** Output HTML pages outside the app, whose files are not precached unless the player loads them too. */
  excludedPages: readonly string[];
  /** The `@ffmpeg/core` version served under `/ffmpeg-core/`, which names the core's cache. */
  ffmpegCoreVersion: string;
}

export function serviceWorkerPlugin(options: ServiceWorkerPluginOptions): Plugin {
  let root = process.cwd();
  let publicDir = '';
  return {
    name: 'be-music:service-worker',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      publicDir = config.publicDir;
    },
    buildStart() {
      this.emitFile({ type: 'chunk', id: options.entry, fileName: SERVICE_WORKER_FILE });
    },
    generateBundle: {
      order: 'post',
      async handler(_outputOptions, bundle) {
        const worker = bundle[SERVICE_WORKER_FILE];
        if (worker?.type !== 'chunk') {
          this.error(`${SERVICE_WORKER_FILE} is missing from the bundle`);
        }
        if (worker.imports.length > 0 || worker.dynamicImports.length > 0) {
          this.error(`${SERVICE_WORKER_FILE} has to be a single script, but imports ${worker.imports.join(', ')}`);
        }

        const pageChunks = new Map<string, string[]>();
        for (const output of Object.values(bundle)) {
          if (output.type !== 'chunk' || !output.facadeModuleId?.endsWith('.html')) continue;
          const page = relative(root, output.facadeModuleId).split(sep).join('/');
          pageChunks.set(page, [...(pageChunks.get(page) ?? []), output.fileName]);
        }
        const contents = new Map<string, string | Uint8Array>();
        const candidates: PrecacheCandidate[] = Object.values(bundle).map((output) => {
          if (output.type === 'asset') {
            contents.set(output.fileName, output.source);
            return { fileName: output.fileName, references: pageChunks.get(output.fileName) ?? [] };
          }
          contents.set(output.fileName, output.code);
          const metadata = output.viteMetadata;
          return {
            fileName: output.fileName,
            references: [
              ...output.imports,
              ...output.dynamicImports,
              ...(metadata ? [...metadata.importedCss, ...metadata.importedAssets] : []),
            ],
          };
        });
        for (const fileName of await listFiles(publicDir)) {
          if (bundle[fileName] !== undefined) continue;
          contents.set(fileName, await readFile(resolve(publicDir, fileName)));
          candidates.push({ fileName, references: [] });
        }

        const files = selectPrecacheFiles(candidates, options.excludedPages);
        const manifest: PrecacheManifest = {
          version: precacheVersion(files.map((name) => [name, contents.get(name) ?? ''] as const)),
          urls: files.map(precacheURL),
          ffmpegCoreVersion: options.ffmpegCoreVersion,
        };
        worker.code = injectManifest(worker.code, manifest);
      },
    },
  };
}

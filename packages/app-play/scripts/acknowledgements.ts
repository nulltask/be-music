// The Help's Open source list: one entry per third-party package the player ships, with its license text.
//
// A build lists what it actually bundled: the npm packages of every module rendered into a chunk (the player, the embed
// page and their workers), plus packages that reach the page without being modules (the stylesheet's frameworks, the
// ffmpeg core the player serves as files). The list is written as `acknowledgements.json` next to the bundle and read
// when the Open source tab opens. The dev server has no bundle, so it walks the runtime dependencies instead.
//
// A package that publishes no LICENSE file gets the upstream text kept in `licenses/` (see its README).

import { createRequire } from 'node:module';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Plugin } from 'vite-plus';

/** One package of the list. */
export interface Acknowledgement {
  name: string;
  version: string;
  license?: string;
  author?: string;
  homepage?: string;
  repository?: string;
  licenseText?: string;
}

/** The parts of a build output the list reads: each chunk's modules and how much of each it rendered. */
export type BundleLike = Readonly<
  Record<string, { type: 'chunk'; modules: Readonly<Record<string, { renderedLength: number }>> } | { type: 'asset' }>
>;

/** A package that reaches the page without being a bundled module, and the package that depends on it. */
export interface ExtraPackage {
  name: string;
  /** The `package.json` of a package that has it as a dependency, which it is resolved from. */
  from: string;
}

const VIRTUAL_ID = 'virtual:acknowledgements';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;
/** The list's file in the build output, and its path on the dev server. */
export const ACKNOWLEDGEMENTS_FILE = 'acknowledgements.json';
/** Longer license texts are cut (some packages bundle a whole attribution dump). */
const MAX_LICENSE_CHARS = 32_000;

/**
 * The directory of the npm package a module belongs to: the last `node_modules/<name>` (or `node_modules/@scope/name`)
 * of its path. `undefined` for a module outside `node_modules` (the player's own code, the workspace packages, virtual
 * modules).
 */
export function packageRootOfModule(id: string): string | undefined {
  const path = id.replace(/\\/gu, '/').split('?')[0]!;
  if (path.startsWith('\0')) return undefined;
  const match = /^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//u.exec(path);
  return match?.[1];
}

/** The package directories of the modules a build output rendered (a module tree-shaken to nothing does not count). */
export function bundledPackageRoots(bundle: BundleLike): Set<string> {
  const roots = new Set<string>();
  for (const output of Object.values(bundle)) {
    if (output.type !== 'chunk') continue;
    for (const [id, module] of Object.entries(output.modules)) {
      if (module.renderedLength <= 0) continue;
      const root = packageRootOfModule(id);
      if (root !== undefined) roots.add(root);
    }
  }
  return roots;
}

/** The file in `licenses/` that stands in for a package's missing LICENSE: `@scope/name` → `@scope__name.txt`. */
export function licenseOverrideFileName(packageName: string): string {
  return `${packageName.replace(/\//gu, '__')}.txt`;
}

/** Whether a `package.json` describes type declarations only, which nothing ships at run time. */
export function isTypesOnlyPackage(pkg: Readonly<Record<string, unknown>>): boolean {
  if (typeof pkg.name === 'string' && pkg.name.startsWith('@types/')) return true;
  return pkg.main === undefined && pkg.module === undefined && pkg.exports === undefined && pkg.browser === undefined;
}

/** The list's order: by name, then version. */
export function sortAcknowledgements(entries: Iterable<Acknowledgement>): Acknowledgement[] {
  return [...entries].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/** The text a license field holds, cut at {@link MAX_LICENSE_CHARS}. */
export function clampLicenseText(text: string): string {
  return text.length > MAX_LICENSE_CHARS ? `${text.slice(0, MAX_LICENSE_CHARS)}\n\n…[truncated]` : text;
}

async function readJSON(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

async function readLicenseFile(pkgDir: string): Promise<string | undefined> {
  // Packages do not agree on the spelling; the first match wins.
  for (const candidate of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'License', 'license', 'license.md', 'COPYING']) {
    try {
      return clampLicenseText(await readFile(resolve(pkgDir, candidate), 'utf8'));
    } catch {
      // Try the next spelling.
    }
  }
  return undefined;
}

function formatAuthor(field: unknown): string | undefined {
  if (typeof field === 'string') return field;
  if (field && typeof (field as { name?: unknown }).name === 'string') {
    const author = field as { name: string; url?: string };
    return author.url ? `${author.name} (${author.url})` : author.name;
  }
  return undefined;
}

/** Reads one package's entry: its `package.json` fields and its LICENSE, or the stand-in in `overridesDir`. */
export async function readAcknowledgement(pkgDir: string, overridesDir: string): Promise<Acknowledgement | undefined> {
  const raw = await readJSON(resolve(pkgDir, 'package.json'));
  if (!raw || typeof raw.name !== 'string' || typeof raw.version !== 'string') return undefined;
  const licenseField = raw.license;
  const license =
    typeof licenseField === 'string'
      ? licenseField
      : licenseField && typeof (licenseField as { type?: unknown }).type === 'string'
        ? (licenseField as { type: string }).type
        : undefined;
  const repositoryField = raw.repository;
  const repository =
    typeof repositoryField === 'string'
      ? repositoryField
      : repositoryField && typeof (repositoryField as { url?: unknown }).url === 'string'
        ? (repositoryField as { url: string }).url
        : undefined;
  const author = formatAuthor(raw.author);
  const licenseText =
    (await readLicenseFile(pkgDir)) ??
    (await readFile(resolve(overridesDir, licenseOverrideFileName(raw.name)), 'utf8').then(
      clampLicenseText,
      () => undefined,
    ));
  return {
    name: raw.name,
    version: raw.version,
    ...(license ? { license } : {}),
    ...(author ? { author } : {}),
    ...(typeof raw.homepage === 'string' ? { homepage: raw.homepage } : {}),
    ...(repository ? { repository } : {}),
    ...(licenseText ? { licenseText } : {}),
  };
}

/**
 * The directory of `name` as installed for the package at `fromDir`: Node's `node_modules` walk, which also finds
 * packages whose `exports` hide `./package.json`.
 */
async function resolvePackageDir(name: string, fromDir: string): Promise<string | undefined> {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = resolve(dir, 'node_modules', name);
    if (await readJSON(resolve(candidate, 'package.json'))) return realpath(candidate).catch(() => candidate);
    if (dirname(dir) === dir) break;
  }
  try {
    // A package the walk misses: resolve its entry and climb to the `package.json` of that name.
    let dir = dirname(createRequire(`${fromDir}/`).resolve(name));
    for (; dirname(dir) !== dir; dir = dirname(dir)) {
      if ((await readJSON(resolve(dir, 'package.json')))?.name === name) return dir;
    }
  } catch {
    // Not installed.
  }
  return undefined;
}

/** Reads the entries of `pkgDirs`, leaving out the workspace's own packages; one entry per name and version. */
async function readAcknowledgements(pkgDirs: Iterable<string>, overridesDir: string): Promise<Acknowledgement[]> {
  const entries = new Map<string, Acknowledgement>();
  for (const dir of pkgDirs) {
    const entry = await readAcknowledgement(dir, overridesDir);
    if (!entry || entry.name.startsWith('@be-music/')) continue;
    entries.set(`${entry.name}@${entry.version}`, entry);
  }
  return sortAcknowledgements(entries.values());
}

/**
 * The dev server's list, without a bundle: the runtime `dependencies` reachable from `roots`, through the workspace's
 * own packages (which are not listed), leaving out type-only packages. Close to the build's list, not exact: it cannot
 * see what tree-shaking drops.
 */
async function walkDependencies(roots: readonly string[]): Promise<Set<string>> {
  const found = new Set<string>();
  const visited = new Set<string>();
  const queue = roots.map((root) => dirname(root));
  while (queue.length > 0) {
    const dir = queue.shift()!;
    if (visited.has(dir)) continue;
    visited.add(dir);
    const pkg = await readJSON(resolve(dir, 'package.json'));
    for (const name of Object.keys((pkg?.dependencies as Record<string, string> | undefined) ?? {})) {
      const depDir = await resolvePackageDir(name, dir);
      if (depDir === undefined) continue;
      const depPkg = await readJSON(resolve(depDir, 'package.json'));
      if (!depPkg || isTypesOnlyPackage(depPkg)) continue;
      if (!name.startsWith('@be-music/')) found.add(depDir);
      queue.push(depDir);
    }
  }
  return found;
}

/**
 * The Vite plugins of the list: `main` for the player's build, and `worker` for its worker builds, whose bundled
 * packages `main` adds to its own. `virtual:acknowledgements` exports a loader of the list.
 */
export function acknowledgementsPlugins(options: {
  /** The `package.json` files the dev server's walk starts from. */
  roots: readonly string[];
  /** Packages on the page that are not bundled modules. */
  extraPackages: readonly ExtraPackage[];
  /** The stand-in license texts. */
  overridesDir: string;
}): { main: Plugin; worker: () => Plugin } {
  const workerRoots = new Set<string>();
  const extraDirs = async (): Promise<string[]> =>
    (
      await Promise.all(options.extraPackages.map((extra) => resolvePackageDir(extra.name, dirname(extra.from))))
    ).filter((dir): dir is string => dir !== undefined);
  return {
    worker: () => ({
      name: 'be-music:acknowledgements-worker',
      generateBundle(_, bundle) {
        for (const root of bundledPackageRoots(bundle as unknown as BundleLike)) workerRoots.add(root);
      },
    }),
    main: {
      name: 'be-music:acknowledgements',
      resolveId(id) {
        return id === VIRTUAL_ID ? RESOLVED_ID : null;
      },
      load(id) {
        if (id !== RESOLVED_ID) return null;
        return [
          `const url = new URL(${JSON.stringify(ACKNOWLEDGEMENTS_FILE)}, new URL(import.meta.env.BASE_URL, location.href));`,
          'export default async function loadAcknowledgements() {',
          '  const response = await fetch(url);',
          '  return response.ok ? response.json() : [];',
          '}',
        ].join('\n');
      },
      configureServer(server) {
        let list: Promise<string> | undefined;
        server.middlewares.use(`/${ACKNOWLEDGEMENTS_FILE}`, (_req, res, next) => {
          list ??= (async () => {
            const dirs = new Set([...(await walkDependencies(options.roots)), ...(await extraDirs())]);
            return JSON.stringify(await readAcknowledgements(dirs, options.overridesDir));
          })();
          list.then(
            (json) => {
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(json);
            },
            (error: unknown) => next(error),
          );
        });
      },
      async generateBundle(_, bundle) {
        const dirs = new Set([
          ...bundledPackageRoots(bundle as unknown as BundleLike),
          ...workerRoots,
          ...(await extraDirs()),
        ]);
        const resolved = await Promise.all([...dirs].map((dir) => realpath(dir).catch(() => dir)));
        this.emitFile({
          type: 'asset',
          fileName: ACKNOWLEDGEMENTS_FILE,
          source: JSON.stringify(await readAcknowledgements(new Set(resolved), options.overridesDir)),
        });
      },
    },
  };
}

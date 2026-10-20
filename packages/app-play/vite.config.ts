import { getBuildInfo } from '../../scripts/release/build-info.ts';
import { createRequire } from 'node:module';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { defaultClientConditions, defineConfig, type Plugin } from 'vite-plus';

const repositoryDir = resolve(import.meta.dirname, '../..');

const buildInfo = getBuildInfo(repositoryDir);

// `@ffmpeg/core` is a transitive dep of `@be-music/player-browser`, so pnpm doesn't hoist it to the workspace root. Resolve
// via the consumer package's `require` so we always find the real on-disk path regardless of pnpm's virtual-store
// layout. The package's `exports` block doesn't expose `./package.json`, but `.` under `require` points at
// `dist/umd/ffmpeg-core.js` — that gives us the package root via two `dirname` walks, and we want the ESM bundle
// alongside it.
//
// We need ESM (not UMD) because @ffmpeg/ffmpeg's outer worker is created as `type: "module"`: module workers can't
// `importScripts` (the worker catches that and falls back to `await import(coreURL)`), and dynamic- importing the UMD
// bundle yields `{ default: undefined }` because its IIFE assigns to a module-local `var` rather than to
// `module.exports` in a way the dynamic import can see. The ESM core exports `default` properly.
//
// We deliberately use the single-threaded build (`@ffmpeg/core`) rather than the multi-threaded one
// (`@ffmpeg/core-mt`). `core-mt` 0.12.x has a long-standing wasm bug where libx264's indirect calls hit `RuntimeError:
// function signature mismatch` inside the pthread workers (libx264 + SIMD + pthread). Single-threaded encoding is
// slower but actually completes; the typical BMS BGA is a few minutes, which transcodes in ~tens of seconds even
// single-threaded.
const playerWebCoreRequire = createRequire(resolve(repositoryDir, 'packages/player-browser/package.json'));
const ffmpegCorePackageRoot = dirname(dirname(dirname(playerWebCoreRequire.resolve('@ffmpeg/core'))));
const ffmpegCoreESMDir = resolve(ffmpegCorePackageRoot, 'dist/esm');
const URL_LOAD_PROXY_PATH = '/__url-load-proxy';

/**
 * Stages the single-threaded ffmpeg.wasm core (ESM bundle) under `/ffmpeg-core/` so the runtime can load it via stable
 * URLs.
 *
 * @ffmpeg/ffmpeg's load() takes explicit `coreURL` / `wasmURL`
 * arguments, but we want a stable known path that survives Vite's
 * pre-bundle / asset-fingerprinting and pnpm's virtual-store
 * layout. Vite's `?url` resolves through `package.json`'s `exports`
 * field, which only routes the package main — so we serve the
 * files from `node_modules` ourselves.
 *
 * - **Dev**: a `configureServer` middleware streams the files straight off disk on every request. Cheap; runs on every
 *   dev-server boot without a copy step.
 * - **Build**: `generateBundle` emits the same files as `dist/ffmpeg-core/...` so production deploys pick them up
 *   alongside the rest of the bundle.
 */
function ffmpegCorePlugin(sourceDir: string): Plugin {
  const files = [
    { name: 'ffmpeg-core.js', mime: 'application/javascript; charset=utf-8' },
    { name: 'ffmpeg-core.wasm', mime: 'application/wasm' },
  ] as const;
  return {
    name: 'be-music:ffmpeg-core',
    apply: () => true,
    configureServer(server) {
      server.middlewares.use('/ffmpeg-core', (req, res, next) => {
        const url = req.url ?? '/';
        const match = files.find((file) => url === `/${file.name}` || url.startsWith(`/${file.name}?`));
        if (!match) {
          next();
          return;
        }
        readFile(resolve(sourceDir, match.name)).then(
          (data) => {
            res.setHeader('Content-Type', match.mime);
            // Keep the CORP header so the wasm/worker fetch succeeds under any future `require-corp` policy.
            res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            res.end(data);
          },
          (error) => {
            // eslint-disable-next-line no-console
            console.error('[ffmpeg-core] failed to read', match.name, error);
            res.statusCode = 500;
            res.end('failed to read ffmpeg core asset');
          },
        );
      });
    },
    async generateBundle() {
      for (const file of files) {
        const data = await readFile(resolve(sourceDir, file.name));
        this.emitFile({
          type: 'asset',
          fileName: `ffmpeg-core/${file.name}`,
          source: data,
        });
      }
    },
  };
}

function resolveURLLoadProxyTarget(rawURL: string | null): URL {
  if (!rawURL) {
    throw new Error('missing url query parameter');
  }
  const target = new URL(rawURL);
  if (target.protocol !== 'https:') {
    throw new Error('only https proxy targets are allowed');
  }
  if (target.username || target.password) {
    throw new Error('proxy target credentials are not allowed');
  }
  return target;
}

function urlLoadProxyPlugin(): Plugin {
  return {
    name: 'be-music:url-load-proxy',
    configureServer(server) {
      server.middlewares.use(URL_LOAD_PROXY_PATH, (req, res) => {
        void (async () => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.statusCode = 405;
            res.setHeader('Allow', 'GET, HEAD');
            res.end('Method Not Allowed');
            return;
          }

          let target: URL;
          try {
            const requestURL = new URL(req.url ?? '/', 'http://localhost');
            target = resolveURLLoadProxyTarget(requestURL.searchParams.get('url'));
          } catch (error) {
            res.statusCode = 400;
            res.end(error instanceof Error ? error.message : 'invalid proxy target');
            return;
          }

          let upstream: Response;
          try {
            upstream = await fetch(target, {
              method: req.method === 'HEAD' ? 'HEAD' : 'GET',
              redirect: 'follow',
            });
          } catch (error) {
            res.statusCode = 502;
            res.end(`failed to fetch ${target.href}: ${error instanceof Error ? error.message : String(error)}`);
            return;
          }

          res.statusCode = upstream.status;
          res.statusMessage = upstream.statusText;
          res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/octet-stream');
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
          if (req.method === 'HEAD') {
            res.end();
            return;
          }
          const data = Buffer.from(await upstream.arrayBuffer());
          res.setHeader('Content-Length', String(data.byteLength));
          res.end(data);
        })();
      });
    },
  };
}

/**
 * Walks the production dependency tree starting from `roots` (each a path to a `package.json`) and returns one
 * `Acknowledgement` per discovered package — name, installed version, license id, author, repository, and the verbatim
 * `LICENSE` text where available. Skips:
 *
 * - Workspace packages (`@be-music/*`) — these are first-party code, listed separately in the demo's about section.
 * - `devDependencies` / `peerDependencies` — anything that doesn't ship to the runtime bundle.
 * - Already-seen packages (dedup by name; version conflicts are rare in pnpm with hoisting and the user only needs to
 *   know the library was used).
 *
 * Resolution goes through `createRequire(parent)` so we always pick the version pnpm actually installed for that
 * consumer, not whatever happens to be hoisted at the workspace root.
 */
async function collectAcknowledgements(roots: string[]): Promise<
  Array<{
    name: string;
    version: string;
    license?: string;
    author?: string;
    homepage?: string;
    repository?: string;
    licenseText?: string;
  }>
> {
  const seen = new Map<string, Awaited<ReturnType<typeof readPackageMeta>>>();
  const queue: Array<{ pkgJSONPath: string; basePath: string }> = roots.map((p) => ({
    pkgJSONPath: p,
    basePath: dirname(p),
  }));

  while (queue.length > 0) {
    const item = queue.shift()!;
    let pkg: { dependencies?: Record<string, string> };
    try {
      pkg = JSON.parse(await readFile(item.pkgJSONPath, 'utf8'));
    } catch {
      continue;
    }

    const deps = Object.keys(pkg.dependencies ?? {});
    for (const depName of deps) {
      // Workspace deps are first-party and don't belong in the third-party acknowledgement list. They're MIT under our
      // own LICENSE which is already linked from the demo.
      if (depName.startsWith('@be-music/')) continue;
      if (seen.has(depName)) continue;

      const resolved = await resolveDependencyPackageJSON(depName, item.basePath);
      if (!resolved) continue;
      const meta = await readPackageMeta(resolved.pkgJSONPath, resolved.pkgDir);
      if (!meta) continue;
      seen.set(depName, meta);
      // pnpm symlinks each package's `node_modules/<name>` to a location inside `.pnpm/...`. Walking from the symlinked
      // path finds nothing because the package's own siblings live next to its `realpath` target. Resolving the symlink
      // here lets the next iteration find transitive deps in the pnpm virtual store.
      const realPkgDir = await realpath(resolved.pkgDir).catch(() => resolved.pkgDir);
      queue.push({ pkgJSONPath: resolved.pkgJSONPath, basePath: realPkgDir });
    }
  }

  return Array.from(seen.values())
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Locates the on-disk `package.json` for `depName` as resolved from `basePath`. Robust against two common pnpm-era
 * issues:
 *
 * - 1. Packages whose `exports` field doesn't list `./package.json` — `require.resolve('pkg/package.json')` throws
 *   `ERR_PACKAGE_PATH_NOT_EXPORTED` for these (notably Pixi v8, modern @ffmpeg builds), so we walk `node_modules`
 *   chains by hand instead. 2. Symlinked virtual stores (`node_modules/.pnpm/...`) — `require.resolve(pkg)` returns the
 *   entry point inside the virtual store, so we walk `dirname` chains until we hit a `package.json` whose `name`
 *   matches.
 *
 * Returns `undefined` when no resolution path succeeds.
 */
async function resolveDependencyPackageJSON(
  depName: string,
  basePath: string,
): Promise<{ pkgJSONPath: string; pkgDir: string } | undefined> {
  // Strategy 1: walk parent `node_modules` directories. This mirrors Node's resolution algorithm and works for both
  // hoisted and non-hoisted layouts. Avoids the `exports` gating that blocks `require.resolve(pkg/package.json)`.
  let dir = basePath;
  while (true) {
    const candidate = resolve(dir, 'node_modules', depName, 'package.json');
    try {
      await readFile(candidate, 'utf8');
      return { pkgJSONPath: candidate, pkgDir: dirname(candidate) };
    } catch {
      // Not in this `node_modules`; walk up.
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Strategy 2: resolve the package's main entry and walk up until we find a `package.json` whose `name` matches. This
  // catches pnpm's virtual store layout where the actual package lives under `node_modules/.pnpm/.../node_modules/`.
  try {
    const req = createRequire(`${basePath}/`);
    const entry = req.resolve(depName);
    let cursor = dirname(entry);
    while (true) {
      const candidate = resolve(cursor, 'package.json');
      try {
        const text = await readFile(candidate, 'utf8');
        const json = JSON.parse(text) as { name?: string };
        if (json.name === depName) {
          return { pkgJSONPath: candidate, pkgDir: cursor };
        }
      } catch {
        // Not here; walk up.
      }
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  } catch {
    // require.resolve threw — package isn't installed.
  }
  return undefined;
}

async function readPackageMeta(
  pkgJSONPath: string,
  pkgDir: string,
): Promise<
  | {
      name: string;
      version: string;
      license?: string;
      author?: string;
      homepage?: string;
      repository?: string;
      licenseText?: string;
    }
  | undefined
> {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(await readFile(pkgJSONPath, 'utf8'));
  } catch {
    return undefined;
  }
  const name = typeof raw.name === 'string' ? raw.name : undefined;
  const version = typeof raw.version === 'string' ? raw.version : undefined;
  if (!name || !version) return undefined;

  // `license` can be a string ("MIT") or `{ type, url }`. Both forms are valid per package.json spec; we surface only
  // the identifier — full text comes from the LICENSE file below.
  const licenseField = raw.license;
  const license =
    typeof licenseField === 'string'
      ? licenseField
      : licenseField && typeof (licenseField as { type?: unknown }).type === 'string'
        ? (licenseField as { type: string }).type
        : undefined;

  // `author` can be a string ("Name <email>") or `{ name, email, url }`. Format consistently as "Name (url)".
  const authorField = raw.author;
  const author =
    typeof authorField === 'string'
      ? authorField
      : authorField && typeof (authorField as { name?: unknown }).name === 'string'
        ? formatAuthorObject(authorField as { name: string; email?: string; url?: string })
        : undefined;

  const homepage = typeof raw.homepage === 'string' ? raw.homepage : undefined;
  const repositoryField = raw.repository;
  const repository =
    typeof repositoryField === 'string'
      ? repositoryField
      : repositoryField && typeof (repositoryField as { url?: unknown }).url === 'string'
        ? (repositoryField as { url: string }).url
        : undefined;

  const licenseText = await tryReadLicenseFile(pkgDir);

  return { name, version, license, author, homepage, repository, licenseText };
}

function formatAuthorObject(author: { name: string; email?: string; url?: string }): string {
  const parts: string[] = [author.name];
  if (author.url) parts.push(`(${author.url})`);
  return parts.join(' ');
}

async function tryReadLicenseFile(pkgDir: string): Promise<string | undefined> {
  // Cover the common spellings — packages don't all agree. First match wins; we don't merge multiple files.
  const candidates = [
    'LICENSE',
    'LICENSE.md',
    'LICENSE.txt',
    'License',
    'license',
    'license.md',
    'COPYING',
    'COPYING.txt',
  ];
  for (const candidate of candidates) {
    try {
      const text = await readFile(resolve(pkgDir, candidate), 'utf8');
      // Truncate ridiculously long licenses (some packages bundle the full GPL + the code's own license + a third-party
      // attribution dump). 32 kB is enough to render meaningful text without bloating the bundle past usefulness.
      const MAX_LICENSE_BYTES = 32_000;
      if (text.length > MAX_LICENSE_BYTES) {
        return `${text.slice(0, MAX_LICENSE_BYTES)}\n\n…[truncated]`;
      }
      return text;
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
}

/**
 * Vite plugin that exposes the resolved acknowledgement list as a virtual module (`virtual:acknowledgements`). The demo
 * imports it once and renders it inside the about modal — staying out of the runtime bundle until the user actually
 * opens the dialog requires nothing more than dynamic-importing the consumer module if bundle size matters later.
 */
function acknowledgementsPlugin(roots: string[]): Plugin {
  const VIRTUAL_ID = 'virtual:acknowledgements';
  const RESOLVED_ID = `\0${VIRTUAL_ID}`;
  let cachedPayload: string | undefined;
  return {
    name: 'be-music:acknowledgements',
    async buildStart() {
      const data = await collectAcknowledgements(roots);
      cachedPayload = `export default ${JSON.stringify(data)};`;
    },
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
      return null;
    },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      // `cachedPayload` is populated by `buildStart`. The hook ordering guarantees `load` runs after `buildStart`
      // resolves, so the fallback here is purely defensive.
      return cachedPayload ?? 'export default [];';
    },
  };
}

export default defineConfig({
  plugins: [
    ffmpegCorePlugin(ffmpegCoreESMDir),
    urlLoadProxyPlugin(),
    // Build-time acknowledgement collector. Walks the runtime dep tree from the demo + `player-web` package.json entry
    // points so every npm dependency that ships in the bundle (direct or transitive) ends up listed in the about modal
    // — no manual maintenance, just `pnpm install` and rebuild.
    acknowledgementsPlugin([
      resolve(repositoryDir, 'packages/app-play/package.json'),
      resolve(repositoryDir, 'packages/player-browser/package.json'),
    ]),
  ],
  define: {
    __BE_MUSIC_BUILD_TIME__: JSON.stringify(buildInfo.builtAt),
    __BE_MUSIC_BUILD_REVISION__: JSON.stringify(buildInfo.revision),
    __BE_MUSIC_BUILD__: JSON.stringify(buildInfo.revision === 'unknown' ? '' : buildInfo.revision.slice(0, 8)),
  },
  // Workspace packages resolve to their TypeScript sources through the `source` condition in each `package.json`
  // `exports`, the same way as the root config. They are linked rather than installed, so the dependency optimizer
  // leaves them alone. Browser imports stay on browser-safe entry points: Node-facing code in `@be-music/shared-utils` /
  // `@be-music/chart-audio-renderer` / `@be-music/player-engine` sits behind subpath exports or lazy dynamic imports.
  resolve: {
    conditions: ['source', ...defaultClientConditions],
  },
  optimizeDeps: {
    exclude: [
      // ffmpeg.wasm (BGA-video transcode fallback) ships a Worker its `FFmpeg` class spawns via `new Worker(new
      // URL("./worker.js", import.meta.url))`. Vite's pre-bundler would rewrite the package into
      // `.vite/deps/@ffmpeg_ffmpeg.js`, which makes that relative `./worker.js` URL miss because the worker file
      // doesn't get copied alongside the rewritten entry. Excluding the package keeps Vite serving it straight out of
      // `node_modules`, where the worker file lives next to the entry and the runtime URL resolves cleanly.
      '@ffmpeg/ffmpeg',
      '@ffmpeg/util',
    ],
  },
  server: {
    fs: {
      allow: [repositoryDir],
    },
    // Cross-origin isolation headers. The single-threaded ffmpeg.wasm build we ship (`@ffmpeg/core`) doesn't need these
    // (no `SharedArrayBuffer`), but we keep them so someone re-introducing the multi-threaded core (or any other
    // SAB-dependent feature) doesn't have to re-debug the policy from scratch.
    //
    // The demo loads every chart asset / theme bundle from a user-side drag-drop (in-memory blobs, no external CDN), so
    // `require-corp` doesn't break any runtime fetches. If a future feature pulls in a third-party CORS resource, that
    // resource's response will need a `Cross-Origin-Resource-Policy: cross-origin` header to keep working under this
    // policy.
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    // The deployed Worker forwards `/api/*` to the Leaderboard Worker; in development it goes to a
    // local one (`pnpm --filter @be-music/app-leaderboard run dev`, port 8787 unless LEADERBOARD_DEV_ORIGIN says
    // otherwise). The Host header is kept, so the Leaderboard sees this dev origin like it sees the real one.
    proxy: Object.fromEntries(
      ['/api'].map((prefix) => [
        prefix,
        { target: process.env.LEADERBOARD_DEV_ORIGIN ?? 'http://localhost:8787', changeOrigin: false },
      ]),
    ),
  },
});

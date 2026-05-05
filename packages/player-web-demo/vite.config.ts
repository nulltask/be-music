import { createRequire } from 'node:module';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

const repositoryDir = resolve(import.meta.dirname, '../..');

// `@ffmpeg/core` is a transitive dep of `@be-music/player-web`, so pnpm doesn't hoist it to the workspace root. Resolve
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
const playerWebCoreRequire = createRequire(resolve(repositoryDir, 'packages/player-web/package.json'));
const ffmpegCorePackageRoot = dirname(dirname(dirname(playerWebCoreRequire.resolve('@ffmpeg/core'))));
const ffmpegCoreEsmDir = resolve(ffmpegCorePackageRoot, 'dist/esm');

// `ebml` v3 ships a `"browser": "lib/ebml.iife.js"` field that Vite picks for browser builds — but the IIFE wraps
// everything in a private closure and never assigns to the outer `module.exports`, so `ts-ebml`'s downstream `const {
// tools: _tools } = require("ebml")` ends up with `_tools === undefined` and crashes with `Cannot read properties of
// undefined (reading 'readVint')` the moment we try to patch a recorded WebM. Force-resolve to the ESM bundle, which
// exports `tools` / `schema` / `Decoder` / `Encoder` properly.
const ebmlEsmPath = resolve(repositoryDir, 'node_modules/.pnpm/ebml@3.0.0/node_modules/ebml/lib/ebml.esm.js');

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
  const queue: Array<{ pkgJsonPath: string; basePath: string }> = roots.map((p) => ({
    pkgJsonPath: p,
    basePath: dirname(p),
  }));

  while (queue.length > 0) {
    const item = queue.shift()!;
    let pkg: { dependencies?: Record<string, string> };
    try {
      pkg = JSON.parse(await readFile(item.pkgJsonPath, 'utf8'));
    } catch {
      continue;
    }

    const deps = Object.keys(pkg.dependencies ?? {});
    for (const depName of deps) {
      // Workspace deps are first-party and don't belong in the third-party acknowledgement list. They're MIT under our
      // own LICENSE which is already linked from the demo.
      if (depName.startsWith('@be-music/')) continue;
      if (seen.has(depName)) continue;

      const resolved = await resolveDependencyPackageJson(depName, item.basePath);
      if (!resolved) continue;
      const meta = await readPackageMeta(resolved.pkgJsonPath, resolved.pkgDir);
      if (!meta) continue;
      seen.set(depName, meta);
      // pnpm symlinks each package's `node_modules/<name>` to a location inside `.pnpm/...`. Walking from the symlinked
      // path finds nothing because the package's own siblings live next to its `realpath` target. Resolving the symlink
      // here lets the next iteration find transitive deps in the pnpm virtual store.
      const realPkgDir = await realpath(resolved.pkgDir).catch(() => resolved.pkgDir);
      queue.push({ pkgJsonPath: resolved.pkgJsonPath, basePath: realPkgDir });
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
async function resolveDependencyPackageJson(
  depName: string,
  basePath: string,
): Promise<{ pkgJsonPath: string; pkgDir: string } | undefined> {
  // Strategy 1: walk parent `node_modules` directories. This mirrors Node's resolution algorithm and works for both
  // hoisted and non-hoisted layouts. Avoids the `exports` gating that blocks `require.resolve(pkg/package.json)`.
  let dir = basePath;
  while (true) {
    const candidate = resolve(dir, 'node_modules', depName, 'package.json');
    try {
      await readFile(candidate, 'utf8');
      return { pkgJsonPath: candidate, pkgDir: dirname(candidate) };
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
          return { pkgJsonPath: candidate, pkgDir: cursor };
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
  pkgJsonPath: string,
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
    raw = JSON.parse(await readFile(pkgJsonPath, 'utf8'));
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

// Vite alias は string で starts-with マッチするので、長いサブパスを先に並べる必要がある。 `@be-music/audio-renderer` (root, Node 依存) と
// `@be-music/utils` (root, Node 依存) は意図的に alias しない: ブラウザ向けには pure な subpath (`/triggers`, `/core`) のみ使わせる。
const workspaceAliases = [
  {
    find: '@be-music/audio-renderer/triggers',
    replacement: resolve(repositoryDir, 'packages/audio-renderer/src/core/triggers.ts'),
  },
  {
    find: '@be-music/player/playable-notes',
    replacement: resolve(repositoryDir, 'packages/player/src/playable-notes.ts'),
  },
  {
    find: '@be-music/player/judging',
    replacement: resolve(repositoryDir, 'packages/player/src/judging.ts'),
  },
  { find: '@be-music/player/core', replacement: resolve(repositoryDir, 'packages/player/src/core') },
  { find: '@be-music/utils/core', replacement: resolve(repositoryDir, 'packages/utils/src/core.ts') },
  { find: '@be-music/chart', replacement: resolve(repositoryDir, 'packages/chart/src/index.ts') },
  { find: '@be-music/json', replacement: resolve(repositoryDir, 'packages/json/src/index.ts') },
  { find: '@be-music/lr2-skin', replacement: resolve(repositoryDir, 'packages/lr2-skin/src/index.ts') },
  { find: '@be-music/parser', replacement: resolve(repositoryDir, 'packages/parser/src/index.ts') },
  { find: '@be-music/player-web', replacement: resolve(repositoryDir, 'packages/player-web/src/index.ts') },
];

export default defineConfig({
  plugins: [
    // ts-ebml (used by `makeWebmSeekable` for the recording post-process) reaches into Node's `Buffer` and `events`
    // module from its CJS dependency chain (`ebml`, `ebml-block`, `int64-buffer`). Vite leaves those unpolyfilled by
    // default, which surfaces in the browser as `Cannot read properties of undefined (reading 'readVint')` the moment
    // we try to decode the recorded WebM. The plugin shims just enough of the Node API surface (`Buffer`, `events`,
    // `process`, etc.) for ts-ebml to run, with `protocolImports` off so the `node:` prefix imports we use elsewhere
    // stay native.
    nodePolyfills({
      include: ['buffer', 'events', 'util'],
      globals: {
        Buffer: true,
        global: false,
        process: false,
      },
      protocolImports: false,
    }),
    // Rewrite the bare `ebml` import to the package's ESM bundle. The package ships `"browser": "lib/ebml.iife.js"` and
    // Vite happily picks that for browser builds — but the IIFE wraps everything in a private closure and never assigns
    // to the outer `module.exports`, so ts-ebml's downstream `require("ebml")` ends up with `tools === undefined` and
    // crashes the recording-stop flow with `Cannot read properties of undefined (reading 'readVint')`. A plain string
    // `resolve.alias` would also match `ebml-block` / `ebml-iterator` (Vite alias is prefix-based); a regex alias makes
    // Vite's CJS optimiser throw inside `escapeRegex`. A bespoke `resolveId` hook is both narrow enough to skip the
    // prefix collisions and simple enough to dodge the optimiser's regex bug.
    {
      name: 'be-music:resolve-ebml-esm',
      enforce: 'pre',
      resolveId(source) {
        if (source === 'ebml') return ebmlEsmPath;
        return null;
      },
    },
    ffmpegCorePlugin(ffmpegCoreEsmDir),
    // Build-time acknowledgement collector. Walks the runtime dep tree from the demo + `player-web` package.json entry
    // points so every npm dependency that ships in the bundle (direct or transitive) ends up listed in the about modal
    // — no manual maintenance, just `pnpm install` and rebuild.
    acknowledgementsPlugin([
      resolve(repositoryDir, 'packages/player-web-demo/package.json'),
      resolve(repositoryDir, 'packages/player-web/package.json'),
    ]),
  ],
  resolve: {
    alias: workspaceAliases,
  },
  optimizeDeps: {
    exclude: [
      ...workspaceAliases.map((entry) => entry.find),
      // ffmpeg.wasm (BGA-video transcode fallback) ships a Worker its `FFmpeg` class spawns via `new Worker(new
      // URL("./worker.js", import.meta.url))`. Vite's pre-bundler would rewrite the package into
      // `.vite/deps/@ffmpeg_ffmpeg.js`, which makes that relative `./worker.js` URL miss because the worker file
      // doesn't get copied alongside the rewritten entry. Excluding the package keeps Vite serving it straight out of
      // `node_modules`, where the worker file lives next to the entry and the runtime URL resolves cleanly.
      '@ffmpeg/ffmpeg',
      '@ffmpeg/util',
    ],
    // Pre-bundle `ts-ebml` up-front so Vite's CJS-named-export interop runs at boot rather than the second pass a
    // dynamic import would trigger. Listed explicitly because we no longer dynamic-import it from
    // `gameplay-recorder.ts`; without this pin, the static import is still detected, but the explicit listing makes the
    // optimisation deterministic across cache-cleared dev sessions.
    include: ['ts-ebml'],
    // The pre-bundle phase resolves bare imports through Rolldown, which runs SEPARATELY from Vite's plugin pipeline —
    // so the `resolve-ebml-esm` plugin below isn't consulted while ts-ebml is being optimised, and Rolldown would once
    // again pick `ebml`'s `"browser"` field (`lib/ebml.iife.js`) and inline a private-closure module that exports
    // nothing usable. Steering the pre-bundler at the ESM bundle here is what actually makes the runtime
    // `tools.readVint` non-undefined.
    rollupOptions: {
      plugins: [
        {
          name: 'be-music:optimize-ebml-esm',
          resolveId(source: string) {
            if (source === 'ebml') return ebmlEsmPath;
            return null;
          },
        },
      ],
    },
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
  },
});

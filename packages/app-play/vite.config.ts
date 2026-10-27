import tailwindcss from '@tailwindcss/vite';
import { getBuildInfo } from '../../scripts/release/build-info.ts';
import { acknowledgementsPlugins } from './scripts/acknowledgements.ts';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
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

const appPackageJSON = resolve(import.meta.dirname, 'package.json');
const playerBrowserPackageJSON = resolve(repositoryDir, 'packages/player-browser/package.json');
const acknowledgements = acknowledgementsPlugins({
  roots: [appPackageJSON, playerBrowserPackageJSON],
  // On the page without being bundled modules: the stylesheet's frameworks (pulled in through CSS `@import`) and the
  // ffmpeg core the player serves as files (`ffmpegCorePlugin`).
  extraPackages: [
    { name: 'tailwindcss', from: appPackageJSON },
    { name: 'basecoat-css', from: appPackageJSON },
    { name: '@ffmpeg/core', from: playerBrowserPackageJSON },
  ],
  overridesDir: resolve(import.meta.dirname, 'licenses'),
});

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

export default defineConfig({
  plugins: [
    tailwindcss(),
    ffmpegCorePlugin(ffmpegCoreESMDir),
    urlLoadProxyPlugin(),
    // The Help's Open source list, from what the build bundles (`scripts/acknowledgements.ts`).
    acknowledgements.main,
  ],
  worker: {
    plugins: () => [acknowledgements.worker()],
  },
  // The player, and the preview the embed page (`/embed/?track=…`) shows inside an iframe.
  build: {
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        embed: resolve(import.meta.dirname, 'embed/index.html'),
      },
    },
  },
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
    // The player loads every chart asset / theme bundle from a user-side drag-drop (in-memory blobs, no external CDN), so
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

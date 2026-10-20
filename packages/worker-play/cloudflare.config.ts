import { bindings, defineConfig } from 'cf/config';

/**
 * The Player Worker, one configuration per environment (docs/services.md section 2): the default mode is production
 * (`play` on `play.be-music.app`, from `main`), `cf deploy --mode preview` the preview (`play-preview` on
 * `play.preview.be-music.app`, from `devel`). The preview binds the preview Leaderboard, never production data.
 * The assets are the SPA `@be-music/app-play` builds; `wrangler.config.ts` points at its `dist`.
 */
export default defineConfig(({ mode }) => {
  const preview = mode === 'preview';
  const suffix = preview ? '-preview' : '';
  return {
    // The be-music Cloudflare account. Pinned, so a session signed in to another account cannot deploy here.
    accountId: '80d4b5fd75f07e61a637b6bb9774186e',
    worker: {
      name: `play${suffix}`,
      compatibilityDate: '2026-06-02',
      compatibilityFlags: ['global_fetch_strictly_public'],
      entrypoint: './src/index.ts',
      domains: [preview ? 'play.preview.be-music.app' : 'play.be-music.app'],
      observability: { enabled: true },
      // Static Assets host the built SPA; `single-page-application` returns index.html for any unmatched path.
      // All requests pass through the Worker for automatic Accounts SSO. The FFmpeg and URL proxy routes ensure
      // the oversized ffmpeg core streams from R2 and URL auto-load archives bypass browser CORS, and send the
      // Leaderboard's API to it through the Service Binding.
      assets: {
        notFoundHandling: 'single-page-application',
        runWorkerFirst: ['/*'],
      },
      env: {
        ASSETS: bindings.assets(),
        AUTH_ISSUER: bindings.text(`https://accounts.${preview ? 'preview.be-music.app' : 'be-music.app'}/api/auth`),
        PUBLIC_ORIGIN: bindings.text(`https://play.${preview ? 'preview.be-music.app' : 'be-music.app'}`),
        OIDC_CLIENT_ID: bindings.text('play'),
        API_AUDIENCE: bindings.text(`https://leaderboard.${preview ? 'preview.be-music.app' : 'be-music.app'}`),
        SESSION_SECRET: bindings.secret(),
        // Holds `ffmpeg-core.wasm` (~31 MB, over the 25 MiB Static Assets per-file limit) and its `ffmpeg-core.js`
        // loader. Upload them with `pnpm cf:r2:push`.
        FFMPEG_CORE: bindings.r2({ name: `play${suffix}` }),
        // The Leaderboard API of the same environment; authenticated calls use an access token.
        LEADERBOARD: bindings.worker({ worker: `leaderboard${suffix}` }),
      },
    },
  };
});

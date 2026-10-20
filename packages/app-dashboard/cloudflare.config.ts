import { getBuildInfo } from '../../scripts/release/build-info.ts';
import { bindings, defineConfig } from 'cf/config';

/**
 * The Dashboard Worker, one configuration per environment (docs/services.md section 2): the default mode is production
 * (`dashboard`, from `main`), `cf deploy --mode preview` the preview (`dashboard-preview`, from `devel`). It reaches the
 * Accounts Worker of the same environment for public profiles through a Service Binding; sign-in uses Accounts OIDC.
 */
export default defineConfig(({ mode }) => {
  const buildInfo = getBuildInfo(import.meta.dirname);
  const preview = mode === 'preview';
  const suffix = preview ? '-preview' : '';
  return {
    // The be-music Cloudflare account. Pinned, so a session signed in to another account cannot deploy here.
    accountId: '80d4b5fd75f07e61a637b6bb9774186e',
    worker: {
      name: `dashboard${suffix}`,
      compatibilityDate: '2026-10-01',
      compatibilityFlags: ['global_fetch_strictly_public'],
      entrypoint: './src/index.ts',
      domains: [preview ? 'preview.be-music.app' : 'be-music.app'],
      workersDev: false,
      observability: { enabled: true },
      env: {
        BUILD_TIMESTAMP: bindings.text(buildInfo.builtAt),
        BUILD_REVISION: bindings.text(buildInfo.revision),
        SHOW_DONATE_LINK: bindings.text(String(preview)),
        ACCOUNTS: bindings.worker({ worker: `accounts${suffix}` }),
        AUTH_ISSUER: bindings.text(`https://accounts.${preview ? 'preview.be-music.app' : 'be-music.app'}/api/auth`),
        PUBLIC_ORIGIN: bindings.text(`https://${preview ? 'preview.be-music.app' : 'be-music.app'}`),
        OIDC_CLIENT_ID: bindings.text('dashboard'),
        PLAY_ORIGIN: bindings.text(`https://play.${preview ? 'preview.be-music.app' : 'be-music.app'}/`),
        LEADERBOARD_ORIGIN: bindings.text(`https://leaderboard.${preview ? 'preview.be-music.app' : 'be-music.app'}/`),
        DONATE_ORIGIN: bindings.text(`https://donate.${preview ? 'preview.be-music.app' : 'be-music.app'}/`),
        API_AUDIENCE: bindings.text(`https://leaderboard.${preview ? 'preview.be-music.app' : 'be-music.app'}`),
        SESSION_SECRET: bindings.secret(),
      },
    },
  };
});
